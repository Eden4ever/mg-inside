from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parent


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


process_helpers = load_module("production_process", "production_process.py")
# The acceptance script uses standalone-script imports. Load its dependency
# only while evaluating it, then avoid shadowing scripts.production_ssh tests.
_ssh = load_module("production_ssh", "production_ssh.py")
acceptance = load_module("production_codex_acceptance", "production-codex-acceptance.py")
sys.modules.pop("production_ssh", None)


class Clock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value


class TimedResponse:
    def __init__(self, clock: Clock, chunks: list[bytes], *, advance: float = 0.0, error: BaseException | None = None) -> None:
        self.clock = clock
        self.chunks = chunks
        self.advance = advance
        self.error = error

    def read(self, _size: int) -> bytes:
        self.clock.value += self.advance
        if self.chunks:
            return self.chunks.pop(0)
        if self.error is not None:
            raise self.error
        return b""


class FakeSession:
    def __init__(self, *_args, **_kwargs) -> None:
        self.client = object()
        self.cleanup_calls = 0

    def ensure_connected(self):
        return self.client

    def run_recovery(self, operation, **_kwargs):
        self.cleanup_calls += 1
        return operation(self.client)

    def close(self) -> None:
        pass


class ProductionCodexAcceptanceTest(unittest.TestCase):
    def test_import_has_no_environment_or_network_side_effect(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(callable(acceptance.main))

    def test_sse_validates_content_type_first_event_and_completed(self) -> None:
        payload = b'event: response.created\ndata: {"type":"response.created"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n'
        result = acceptance.consume_responses_stream(io.BytesIO(payload), content_type="text/event-stream; charset=utf-8", total_timeout_seconds=10, first_byte_timeout_seconds=2, idle_timeout_seconds=2)
        self.assertEqual(result["firstEvent"], "response.created")
        self.assertTrue(result["completed"])

    def test_sse_rejects_missing_completed_and_invalid_content_type(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Content-Type"):
            acceptance.consume_responses_stream(io.BytesIO(b""), content_type="application/json", total_timeout_seconds=1, first_byte_timeout_seconds=1, idle_timeout_seconds=1)
        with self.assertRaisesRegex(RuntimeError, "response.completed"):
            acceptance.consume_responses_stream(io.BytesIO(b'data: {"type":"response.created"}\n\n'), content_type="text/event-stream", total_timeout_seconds=1, first_byte_timeout_seconds=1, idle_timeout_seconds=1)

    def test_sse_rejects_first_byte_and_idle_timeouts(self) -> None:
        first_clock = Clock()
        with self.assertRaisesRegex(RuntimeError, "首字节超时"):
            acceptance.consume_responses_stream(TimedResponse(first_clock, [], advance=2), content_type="text/event-stream", total_timeout_seconds=5, first_byte_timeout_seconds=1, idle_timeout_seconds=2, clock=first_clock)
        idle_clock = Clock()
        with self.assertRaisesRegex(RuntimeError, "空闲超时"):
            acceptance.consume_responses_stream(TimedResponse(idle_clock, [b'data: {"type":"response.created"}\n\n'], error=TimeoutError()), content_type="text/event-stream", total_timeout_seconds=5, first_byte_timeout_seconds=2, idle_timeout_seconds=1, clock=idle_clock)

    def _run_cli_fixture(self, events: str, final: str, *, exit_code: int = 0) -> dict[str, object]:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "last.txt"
            script = "import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(sys.argv[2], encoding='utf-8'); print(sys.argv[3], end=''); sys.exit(int(sys.argv[4]))"
            return acceptance.run_codex_cli([sys.executable, "-c", script, str(output), final, events, str(exit_code)], cwd=temp, env=os.environ.copy(), timeout_seconds=5, output_last_message=output)

    def test_cli_requires_exact_ok_and_success_termination(self) -> None:
        good = '{"type":"turn.started"}\n{"type":"turn.completed","status":"completed"}\n'
        result = self._run_cli_fixture(good, "  OK\n")
        self.assertTrue(result["success"])
        with self.assertRaisesRegex(RuntimeError, "不等于 OK"):
            self._run_cli_fixture(good, "NOT OK")
        with self.assertRaisesRegex(RuntimeError, "成功终止"):
            self._run_cli_fixture('{"type":"turn.started"}\n', "OK")

    def test_cli_rejects_error_empty_and_truncated_jsonl(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "失败事件"):
            self._run_cli_fixture('{"type":"error"}\n{"type":"turn.completed"}\n', "OK")
        with self.assertRaisesRegex(RuntimeError, "成功终止"):
            self._run_cli_fixture("", "OK")
        with self.assertRaisesRegex(RuntimeError, "非法 JSONL"):
            self._run_cli_fixture('{"type":"turn.completed"}\n{', "OK")

    def test_cli_timeout_reaps_descendant_process(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "last.txt"
            pid_file = Path(temp) / "child.pid"
            script = "import pathlib,subprocess,sys,time; c=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); pathlib.Path(sys.argv[1]).write_text(str(c.pid)); time.sleep(30)"
            started = time.monotonic()
            with self.assertRaisesRegex(RuntimeError, "超时"):
                acceptance.run_codex_cli([sys.executable, "-c", script, str(pid_file)], cwd=temp, env=os.environ.copy(), timeout_seconds=0.3, output_last_message=output)
            self.assertLess(time.monotonic() - started, 8)
            child_pid = int(pid_file.read_text())
            time.sleep(0.2)
            if os.name == "nt":
                probe = subprocess.run(["tasklist", "/FI", f"PID eq {child_pid}", "/NH"], capture_output=True, text=True, check=False)
                self.assertNotIn(str(child_pid), probe.stdout)
            else:
                with self.assertRaises(ProcessLookupError):
                    os.kill(child_pid, 0)

    def test_command_disables_plugin_sync_and_uses_last_message_file(self) -> None:
        command = acceptance.build_codex_command("codex", "work", Path("last.txt"))
        self.assertIn("--output-last-message", command)
        self.assertIn("--ignore-user-config", command)
        self.assertIn("--disable", command)
        self.assertIn("plugins", command)
        self.assertIn("recommended_plugins", command)

    def test_cctq_schema_requires_applied_migration_and_exact_column_contract(self) -> None:
        valid = json.dumps({
            "migrationApplied": 1,
            "columns": [
                {"name": "unlimitedQuota", "dataType": "tinyint", "nullable": "NO", "default": 0},
                {"name": "expiresAt", "dataType": "bigint", "nullable": "NO", "default": 0},
                {"name": "modelLimits", "dataType": "json", "nullable": "YES", "default": None},
                {"name": "modelLimitsEnabled", "dataType": "tinyint", "nullable": "NO", "default": 0},
            ],
        })
        with patch.object(acceptance, "db_sql", return_value=f"result\n{valid}\n"):
            acceptance.verify_cctq_schema(object(), timeout=5)

        missing_migration = json.dumps({"migrationApplied": 0, "columns": []})
        with patch.object(acceptance, "db_sql", return_value=f"result\n{missing_migration}\n"):
            with self.assertRaisesRegex(RuntimeError, "未应用"):
                acceptance.verify_cctq_schema(object(), timeout=5)

        wrong_type = json.dumps({
            "migrationApplied": 1,
            "columns": [
                {"name": "unlimitedQuota", "dataType": "int", "nullable": "NO", "default": 0},
            ],
        })
        with patch.object(acceptance, "db_sql", return_value=f"result\n{wrong_type}\n"):
            with self.assertRaisesRegex(RuntimeError, "字段类型"):
                acceptance.verify_cctq_schema(object(), timeout=5)

    def test_cctq_management_endpoint_requires_admin_json_and_rejects_secret_fields(self) -> None:
        with patch.object(
            acceptance,
            "get_http",
            return_value=(200, {"Content-Type": "application/json"}, b'{"configured":true,"credentialType":"api_key"}'),
        ):
            acceptance.verify_cctq_management_endpoint("a.b.c", timeout=5)

        with patch.object(
            acceptance,
            "get_http",
            return_value=(200, {"Content-Type": "application/json"}, b'{"keysEncrypted":"must-not-leak"}'),
        ):
            with self.assertRaisesRegex(RuntimeError, "凭据字段"):
                acceptance.verify_cctq_management_endpoint("a.b.c", timeout=5)

        with patch.object(
            acceptance,
            "get_http",
            return_value=(403, {"Content-Type": "application/json"}, b'{}'),
        ):
            with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
                acceptance.verify_cctq_management_endpoint("a.b.c", timeout=5)

    def test_cctq_static_entry_requires_spa_and_served_assets(self) -> None:
        calls: list[str] = []

        def fake_get(path: str, _headers: dict[str, str], *, timeout: int):
            calls.append(path)
            responses = {
                "/admin/suppliers/cctq": (
                    200,
                    {"Content-Type": "text/html; charset=utf-8"},
                    b'<div id="app"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
                ),
                "/assets/app.js": (200, {"Content-Type": "text/javascript"}, b'import("./SupplierAccount-route.js")'),
                "/assets/app.css": (200, {"Content-Type": "text/css"}, b"body{}"),
                "/assets/SupplierAccount-route.js": (200, {"Content-Type": "text/javascript"}, b"export default {}"),
            }
            return responses[path]

        with patch.object(acceptance, "get_http", side_effect=fake_get):
            acceptance.verify_cctq_static_entry(timeout=5)
        self.assertEqual(calls, [
            "/admin/suppliers/cctq",
            "/assets/app.js",
            "/assets/app.css",
            "/assets/SupplierAccount-route.js",
        ])

    def test_cctq_acceptance_uses_read_only_get_and_short_lived_container_jwt(self) -> None:
        schema = json.dumps({
            "migrationApplied": True,
            "columns": [
                {"name": name, "dataType": data_type, "nullable": nullable, "default": default}
                for name, (data_type, nullable, default) in acceptance.CCTQ_API_KEY_STATE_COLUMNS.items()
            ],
        })
        db_calls: list[str] = []

        def fake_db(_client, sql: str, **_kwargs):
            db_calls.append(sql)
            if "schema_migrations" in sql:
                return f"result\n{schema}\n"
            if "SELECT id FROM users" in sql:
                return "id\n7\n"
            raise AssertionError(sql)

        with patch.object(acceptance, "db_sql", side_effect=fake_db), patch.object(
            acceptance,
            "remote_exec",
            return_value="header.payload.signature\n",
        ) as remote_exec, patch.object(
            acceptance,
            "get_http",
            side_effect=[
                (200, {"Content-Type": "application/json"}, b'{"configured":false}'),
                (200, {"Content-Type": "text/html"}, b'<div id="app"></div><script src="/assets/app.js"></script>'),
                (200, {"Content-Type": "text/javascript"}, b'import("./SupplierAccount-route.js")'),
                (200, {"Content-Type": "text/javascript"}, b"export default {}"),
            ],
        ) as get_http, patch.object(acceptance, "post_json") as post_json:
            acceptance.run_cctq_management_acceptance(object(), acceptance.AcceptanceDeadline(30))

        self.assertIn("migration-add-cctq-api-key-state.sql", db_calls[0])
        self.assertIn("supplier_accounts", db_calls[0])
        self.assertIn("docker exec mg-gateway node -e", remote_exec.call_args.args[1])
        self.assertIn("expiresIn", remote_exec.call_args.args[1])
        self.assertIn("5m", remote_exec.call_args.args[1])
        self.assertEqual([call.args[0] for call in get_http.call_args_list], [
            "/api/admin/cctq-account",
            "/admin/suppliers/cctq",
            "/assets/app.js",
            "/assets/SupplierAccount-route.js",
        ])
        post_json.assert_not_called()

    def test_insert_response_loss_still_deletes_and_cleanup_failure_fails(self) -> None:
        calls: list[str] = []
        fake_session = FakeSession()

        def fake_db(_client, sql: str, **_kwargs):
            calls.append(sql)
            if "INSERT INTO" in sql:
                raise OSError("response lost after insert")
            return ""

        with patch.object(acceptance, "ProductionSshSession", return_value=fake_session), patch.object(acceptance, "db_sql", side_effect=fake_db):
            with self.assertRaisesRegex(OSError, "response lost"):
                acceptance.run_acceptance(acceptance.AcceptanceConfig("host", "remote", acceptance.SshCredential(password="password"), 20))
        self.assertTrue(any("DELETE FROM tokens" in call for call in calls))

        def cleanup_fails(_client, sql: str, **_kwargs):
            if "DELETE FROM" in sql:
                raise OSError("cleanup unavailable")
            raise OSError("response lost")

        with patch.object(acceptance, "ProductionSshSession", return_value=FakeSession()), patch.object(acceptance, "db_sql", side_effect=cleanup_fails):
            with self.assertRaisesRegex(RuntimeError, "清理失败"):
                acceptance.run_acceptance(acceptance.AcceptanceConfig("host", "remote", acceptance.SshCredential(password="password"), 20))


class ProductionProcessTest(unittest.TestCase):
    def test_terminate_process_tree_reaps_process(self) -> None:
        process = process_helpers.popen_process([sys.executable, "-c", "import time; time.sleep(30)"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        process_helpers.terminate_process_tree(process)
        self.assertIsNotNone(process.poll())


if __name__ == "__main__":
    unittest.main()
