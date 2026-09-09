"""Strict, bounded production verification for the Codex Responses route.

This module is import-safe: production work starts only in ``main`` or an
explicit ``run_acceptance`` call.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import secrets
import shlex
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO

import paramiko

from production_process import popen_process, terminate_process_tree
from production_ssh import (
    ProductionSshSession,
    SshCredential,
    credential_from_environment,
)


DEFAULT_HOST = "1.12.253.86"
DEFAULT_REMOTE = "/opt/mg-gateway"
ACCEPTANCE_TIMEOUT_SECONDS = 900
HTTP_TIMEOUT_SECONDS = 90
HTTP_TOTAL_TIMEOUT_SECONDS = HTTP_TIMEOUT_SECONDS
HTTP_FIRST_BYTE_TIMEOUT_SECONDS = 20
HTTP_IDLE_TIMEOUT_SECONDS = 20
CODEX_TIMEOUT_SECONDS = 150
REMOTE_SQL_TIMEOUT_SECONDS = 60
TOKEN_CLEANUP_TIMEOUT_SECONDS = 60
TOKEN_FALLBACK_LIFETIME_SECONDS = 15 * 60
TAIL_LIMIT = 1200
CCTQ_API_KEY_STATE_MIGRATION = "migration-add-cctq-api-key-state.sql"
CCTQ_API_KEY_STATE_COLUMNS = {
    "unlimitedQuota": ("tinyint", "NO", "0"),
    "expiresAt": ("bigint", "NO", "0"),
    "modelLimits": ("json", "YES", None),
    "modelLimitsEnabled": ("tinyint", "NO", "0"),
}
SENSITIVE_CCTQ_RESPONSE_KEYS = {
    "apikey",
    "credential",
    "credentialencrypted",
    "dashboardtoken",
    "dashboardtokenencrypted",
    "key",
    "keysencrypted",
    "password",
    "secret",
    "token",
}
STATIC_ASSET_PATTERN = re.compile(
    r'''<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']''',
    re.IGNORECASE,
)
CCTQ_ROUTE_CHUNK_PATTERN = re.compile(
    r'''(?:\./|/assets/)(SupplierAccount-[A-Za-z0-9_-]+\.js)''',
)


@dataclass(frozen=True)
class AcceptanceConfig:
    host: str
    remote: str
    credential: SshCredential
    total_timeout_seconds: int = ACCEPTANCE_TIMEOUT_SECONDS

    @classmethod
    def from_environment(cls) -> "AcceptanceConfig":
        credential = credential_from_environment()
        try:
            total = int(os.environ.get("MG_CODEX_ACCEPTANCE_TIMEOUT_SECONDS", "900"))
        except ValueError as error:
            raise ValueError("MG_CODEX_ACCEPTANCE_TIMEOUT_SECONDS 必须为正整数") from error
        if total <= 0:
            raise ValueError("MG_CODEX_ACCEPTANCE_TIMEOUT_SECONDS 必须为正整数")
        return cls(os.environ.get("MG_DEPLOY_HOST", DEFAULT_HOST), os.environ.get("MG_DEPLOY_PATH", DEFAULT_REMOTE), credential, total)


class AcceptanceDeadline:
    def __init__(self, total_seconds: int, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self.expires_at = clock() + total_seconds

    def timeout(self, maximum: int, stage: str) -> int:
        remaining = int(self.expires_at - self._clock())
        if remaining <= 0:
            raise RuntimeError(f"Codex 原生 Responses 验收总体超时，停止于{stage}")
        return min(maximum, remaining)


def emit(stage: str, **fields: object) -> None:
    print(json.dumps({"stage": stage, **fields}, ensure_ascii=False), flush=True)


def remote_exec(client: paramiko.SSHClient, command: str, input_text: str = "", timeout: int = 120) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    if input_text:
        stdout.channel.sendall(input_text.encode())
        stdout.channel.shutdown_write()
    output = stdout.read().decode("utf-8", errors="replace")
    error = stderr.read().decode("utf-8", errors="replace")
    status = stdout.channel.recv_exit_status()
    if status:
        raise RuntimeError(f"远端命令失败({status})：{error[-1000:]}")
    return output


def db_sql(client: paramiko.SSHClient, sql: str, *, timeout: int) -> str:
    command = """
db_pass=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="DB_PASSWORD"{print substr($0,index($0,"=")+1)}')
db_user=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="DB_USERNAME"{print substr($0,index($0,"=")+1)}')
db_name=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="DB_DATABASE"{print substr($0,index($0,"=")+1)}')
docker exec -i -e MYSQL_PWD="$db_pass" mgnewapi-mysql mysql -u"$db_user" -D"$db_name" --batch --raw
unset db_pass db_user db_name
"""
    return remote_exec(client, "bash -lc " + shlex.quote("set -e\n" + command), sql, timeout=timeout)


class SseDecoder:
    """Incremental SSE decoder; callers retain only event metadata."""

    def __init__(self) -> None:
        self._buffer = ""
        self._event_name = ""
        self._data: list[str] = []

    def feed(self, chunk: bytes, *, final: bool = False) -> Iterator[tuple[str, object]]:
        self._buffer += chunk.decode("utf-8", errors="replace")
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            yield from self._line(line.rstrip("\r"))
        if final:
            if self._buffer:
                yield from self._line(self._buffer.rstrip("\r"))
                self._buffer = ""
            yield from self._finish()

    def _line(self, line: str) -> Iterator[tuple[str, object]]:
        if not line:
            yield from self._finish()
        elif line.startswith("event:"):
            self._event_name = line[6:].strip()
        elif line.startswith("data:"):
            self._data.append(line[5:].lstrip())

    def _finish(self) -> Iterator[tuple[str, object]]:
        if not self._data:
            self._event_name = ""
            return
        raw_data = "\n".join(self._data)
        event_name = self._event_name
        self._event_name = ""
        self._data = []
        if raw_data == "[DONE]":
            yield event_name or "[DONE]", "[DONE]"
            return
        try:
            payload = json.loads(raw_data)
        except json.JSONDecodeError as error:
            raise RuntimeError("Responses 流包含非法 SSE JSON 事件") from error
        if not isinstance(payload, dict):
            raise RuntimeError("Responses 流包含非对象 SSE 事件")
        payload_type = payload.get("type")
        if isinstance(payload_type, str) and payload_type:
            event_name = payload_type
        if not event_name:
            raise RuntimeError("Responses 流事件缺少类型")
        yield event_name, payload


def _set_response_read_timeout(response: object, timeout_seconds: int) -> None:
    """Best effort socket timeout for urllib HTTPResponse across Python versions."""
    for path in (("fp", "raw", "_sock"), ("fp", "_sock"), ("_fp", "fp", "raw", "_sock")):
        target = response
        try:
            for attribute in path:
                target = getattr(target, attribute)
            target.settimeout(timeout_seconds)
            return
        except (AttributeError, OSError):
            continue


def consume_responses_stream(
    response: BinaryIO,
    *,
    content_type: str,
    total_timeout_seconds: int,
    first_byte_timeout_seconds: int,
    idle_timeout_seconds: int,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    if content_type.lower().split(";", 1)[0].strip() != "text/event-stream":
        raise RuntimeError("Responses 流验收失败：Content-Type 不是 text/event-stream")
    started = clock()
    first_byte_at: float | None = None
    last_byte_at = started
    decoder = SseDecoder()
    first_event: str | None = None
    completed = False
    event_count = 0
    _set_response_read_timeout(response, min(first_byte_timeout_seconds, idle_timeout_seconds))
    while True:
        now = clock()
        if now - started > total_timeout_seconds:
            raise RuntimeError("Responses 流验收失败：总超时")
        if first_byte_at is None and now - started > first_byte_timeout_seconds:
            raise RuntimeError("Responses 流验收失败：首字节超时")
        if first_byte_at is not None and now - last_byte_at > idle_timeout_seconds:
            raise RuntimeError("Responses 流验收失败：空闲超时")
        try:
            chunk = response.read(4096)
        except (TimeoutError, OSError) as error:
            if first_byte_at is None:
                raise RuntimeError("Responses 流验收失败：首字节超时") from error
            raise RuntimeError("Responses 流验收失败：空闲超时") from error
        now = clock()
        if not chunk:
            if first_byte_at is None and now - started > first_byte_timeout_seconds:
                raise RuntimeError("Responses 流验收失败：首字节超时")
            break
        if first_byte_at is None:
            first_byte_at = now
            if first_byte_at - started > first_byte_timeout_seconds:
                raise RuntimeError("Responses 流验收失败：首字节超时")
        last_byte_at = now
        for event_type, _payload in decoder.feed(chunk):
            event_count += 1
            first_event = first_event or event_type
            completed = completed or event_type == "response.completed"
    for event_type, _payload in decoder.feed(b"", final=True):
        event_count += 1
        first_event = first_event or event_type
        completed = completed or event_type == "response.completed"
    if first_event is None:
        raise RuntimeError("Responses 流验收失败：未收到有效事件")
    if not completed:
        raise RuntimeError("Responses 流验收失败：未收到 response.completed")
    return {"firstEvent": first_event, "eventCount": event_count, "completed": True}


def post_json(path: str, body: dict[str, object], headers: dict[str, str], *, timeout: int) -> tuple[int, str]:
    request = urllib.request.Request("https://token.meta-gravity.com" + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")


def get_http(path: str, headers: dict[str, str], *, timeout: int) -> tuple[int, dict[str, str], bytes]:
    """Fetch a Token One public resource without logging its response body."""
    request = urllib.request.Request(
        "https://token.meta-gravity.com" + path,
        headers=headers,
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()


def parse_db_json(output: str, label: str) -> dict[str, object]:
    """Decode the one JSON value emitted by mysql --batch without echoing it."""
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"{label} 验收失败：数据库未返回结果")
    try:
        value = json.loads(lines[-1])
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{label} 验收失败：数据库返回不是 JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} 验收失败：数据库返回不是对象")
    return value


def verify_cctq_schema(client: object, *, timeout: int) -> None:
    output = db_sql(client, f"""
SELECT JSON_OBJECT(
  'migrationApplied', EXISTS(
    SELECT 1 FROM schema_migrations WHERE id = '{CCTQ_API_KEY_STATE_MIGRATION}'
  ),
  'columns', COALESCE((
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'name', COLUMN_NAME,
      'dataType', DATA_TYPE,
      'nullable', IS_NULLABLE,
      'default', COLUMN_DEFAULT
    ))
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'supplier_accounts'
      AND COLUMN_NAME IN ('unlimitedQuota', 'expiresAt', 'modelLimits', 'modelLimitsEnabled')
  ), JSON_ARRAY())
) AS result;
""", timeout=timeout)
    result = parse_db_json(output, "CCTQ 数据库")
    if result.get("migrationApplied") not in (True, 1):
        raise RuntimeError(f"CCTQ 数据库验收失败：未应用 {CCTQ_API_KEY_STATE_MIGRATION}")
    columns = result.get("columns")
    if not isinstance(columns, list):
        raise RuntimeError("CCTQ 数据库验收失败：字段元数据无效")
    actual: dict[str, tuple[str, str, str | None]] = {}
    for column in columns:
        if not isinstance(column, dict):
            continue
        name = column.get("name")
        data_type = column.get("dataType")
        nullable = column.get("nullable")
        default = column.get("default")
        if isinstance(name, str) and isinstance(data_type, str) and isinstance(nullable, str):
            actual[name] = (
                data_type.lower(),
                nullable.upper(),
                None if default is None else str(default),
            )
    if actual != CCTQ_API_KEY_STATE_COLUMNS:
        raise RuntimeError("CCTQ 数据库验收失败：supplier_accounts 额度字段类型不符合迁移")


def normalize_response_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def assert_cctq_response_has_no_secrets(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if normalize_response_key(key) in SENSITIVE_CCTQ_RESPONSE_KEYS:
                raise RuntimeError("CCTQ 管理接口验收失败：响应包含凭据字段")
            assert_cctq_response_has_no_secrets(child)
    elif isinstance(value, list):
        for child in value:
            assert_cctq_response_has_no_secrets(child)


def issue_short_lived_admin_jwt(client: object, *, timeout: int) -> str:
    admin_output = db_sql(client, """
SELECT id FROM users WHERE role = 'admin' AND status = 1 ORDER BY id LIMIT 1;
""", timeout=timeout)
    rows = [line.strip() for line in admin_output.splitlines() if line.strip()]
    if len(rows) < 2 or not re.fullmatch(r"[1-9][0-9]*", rows[-1]):
        raise RuntimeError("CCTQ 管理接口验收失败：未找到启用管理员")
    admin_id = rows[-1]
    signer = (
        "const jwt=require('jsonwebtoken');"
        "const id=Number(process.argv[1]);"
        "if(!Number.isSafeInteger(id)||id<=0||!process.env.JWT_SECRET)process.exit(2);"
        "process.stdout.write(jwt.sign({sub:id,role:'admin',username:'production-cctq-acceptance'},"
        "process.env.JWT_SECRET,{expiresIn:'5m'}));"
    )
    token = remote_exec(
        client,
        f"docker exec mg-gateway node -e {shlex.quote(signer)} {admin_id}",
        timeout=timeout,
    ).strip()
    if token.count(".") != 2:
        raise RuntimeError("CCTQ 管理接口验收失败：无法签发短期管理员登录态")
    return token


def verify_cctq_management_endpoint(admin_jwt: str, *, timeout: int) -> None:
    status, headers, body = get_http(
        "/api/admin/cctq-account",
        {"Authorization": f"Bearer {admin_jwt}", "Accept": "application/json"},
        timeout=timeout,
    )
    if status != 200:
        raise RuntimeError(f"CCTQ 管理接口验收失败：HTTP {status}")
    content_type = headers.get("Content-Type", headers.get("content-type", ""))
    if "application/json" not in content_type.lower():
        raise RuntimeError("CCTQ 管理接口验收失败：响应不是 JSON")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("CCTQ 管理接口验收失败：响应 JSON 无效") from error
    if not isinstance(payload, dict):
        raise RuntimeError("CCTQ 管理接口验收失败：响应不是对象")
    assert_cctq_response_has_no_secrets(payload)


def verify_cctq_static_entry(*, timeout: int, deadline: AcceptanceDeadline | None = None) -> None:
    def request_timeout(stage: str) -> int:
        return deadline.timeout(timeout, stage) if deadline is not None else timeout

    status, headers, body = get_http(
        "/admin/suppliers/cctq",
        {"Accept": "text/html"},
        timeout=request_timeout("CCTQ 管理页面入口"),
    )
    if status != 200:
        raise RuntimeError(f"CCTQ 管理页面验收失败：入口 HTTP {status}")
    content_type = headers.get("Content-Type", headers.get("content-type", ""))
    if "text/html" not in content_type.lower():
        raise RuntimeError("CCTQ 管理页面验收失败：入口不是 HTML")
    try:
        html = body.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError("CCTQ 管理页面验收失败：入口编码无效") from error
    if 'id="app"' not in html and "id='app'" not in html:
        raise RuntimeError("CCTQ 管理页面验收失败：缺少 SPA 入口")
    paths: list[str] = []
    for candidate in STATIC_ASSET_PATTERN.findall(html):
        if candidate.startswith("/assets/") and candidate not in paths:
            paths.append(candidate)
    if not paths or not any(path.endswith(".js") for path in paths):
        raise RuntimeError("CCTQ 管理页面验收失败：未发现 JavaScript 静态资源")
    resources: dict[str, bytes] = {}
    for path in paths:
        resource_status, _resource_headers, resource = get_http(
            path,
            {},
            timeout=request_timeout("CCTQ 管理页面静态资源"),
        )
        if resource_status != 200 or not resource:
            raise RuntimeError(f"CCTQ 管理页面验收失败：静态资源不可用 {path}")
        resources[path] = resource

    cctq_chunk: str | None = None
    for path, resource in resources.items():
        if not path.endswith(".js"):
            continue
        try:
            source = resource.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RuntimeError(f"CCTQ 管理页面验收失败：JavaScript 资源编码无效 {path}") from error
        match = CCTQ_ROUTE_CHUNK_PATTERN.search(source)
        if match is not None:
            cctq_chunk = "/assets/" + match.group(1)
            break
    if cctq_chunk is None:
        raise RuntimeError("CCTQ 管理页面验收失败：未发现 CCTQ 路由模块")
    route_status, _route_headers, route_resource = get_http(
        cctq_chunk,
        {},
        timeout=request_timeout("CCTQ 路由模块"),
    )
    if route_status != 200 or not route_resource:
        raise RuntimeError(f"CCTQ 管理页面验收失败：路由模块不可用 {cctq_chunk}")


def run_cctq_management_acceptance(client: object, deadline: AcceptanceDeadline) -> None:
    verify_cctq_schema(
        client,
        timeout=deadline.timeout(REMOTE_SQL_TIMEOUT_SECONDS, "CCTQ 数据库元数据"),
    )
    admin_jwt = issue_short_lived_admin_jwt(
        client,
        timeout=deadline.timeout(REMOTE_SQL_TIMEOUT_SECONDS, "CCTQ 管理员登录态"),
    )
    verify_cctq_management_endpoint(
        admin_jwt,
        timeout=deadline.timeout(HTTP_TOTAL_TIMEOUT_SECONDS, "CCTQ 管理接口"),
    )
    verify_cctq_static_entry(
        timeout=HTTP_TOTAL_TIMEOUT_SECONDS,
        deadline=deadline,
    )


def verify_responses_stream(raw_key: str, *, timeout: int) -> dict[str, object]:
    request = urllib.request.Request("https://token.meta-gravity.com/v1/responses", data=json.dumps({"model": "gpt-5.6-terra", "input": "Reply with exactly OK.", "max_output_tokens": 8, "stream": True}).encode(), headers={"Content-Type": "application/json", "Authorization": f"Bearer {raw_key}", "User-Agent": "codex_cli/acceptance", "openai-beta": "responses=experimental"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=min(timeout, HTTP_FIRST_BYTE_TIMEOUT_SECONDS)) as response:
            evidence = consume_responses_stream(response, content_type=response.headers.get("Content-Type", ""), total_timeout_seconds=timeout, first_byte_timeout_seconds=min(HTTP_FIRST_BYTE_TIMEOUT_SECONDS, timeout), idle_timeout_seconds=min(HTTP_IDLE_TIMEOUT_SECONDS, timeout))
            return {"status": response.status, **evidence}
    except urllib.error.HTTPError as error:
        return {"status": error.code}


def _append_tail(tail: deque[str], value: str, *, limit: int = TAIL_LIMIT) -> None:
    tail.append(value)
    total = sum(len(item) for item in tail)
    while tail and total > limit:
        total -= len(tail.popleft())


def _event_is_failure(payload: dict[str, object]) -> bool:
    event_type = str(payload.get("type", "")).lower()
    status = str(payload.get("status", "")).lower()
    return event_type in {"error", "failure", "turn.failed"} or status in {"failed", "failure", "error", "cancelled"}


def run_codex_cli(
    args: list[str], *, cwd: str, env: dict[str, str], timeout_seconds: int, output_last_message: Path,
    clock: Callable[[], float] = time.monotonic, process_factory: Callable[..., Any] = popen_process,
) -> dict[str, object]:
    """Consume Codex JSONL in real time without logging model text."""
    process = process_factory(args, cwd=cwd, env=env, stdout=-1, stderr=-1, bufsize=1)
    events: "queue.Queue[tuple[str, str | None]]" = queue.Queue()
    stdout_tail: deque[str] = deque()
    stderr_tail: deque[str] = deque()

    def pump(kind: str, stream: Any) -> None:
        try:
            for line in iter(stream.readline, ""):
                events.put((kind, line))
        finally:
            events.put((kind, None))

    threads = [threading.Thread(target=pump, args=(kind, stream), daemon=True) for kind, stream in (("stdout", process.stdout), ("stderr", process.stderr)) if stream is not None]
    for thread in threads:
        thread.start()
    started = clock()
    closed: set[str] = set()
    event_types: list[str] = []
    completed = False
    failures: list[str] = []
    try:
        while len(closed) < len(threads) or process.poll() is None:
            remaining = timeout_seconds - (clock() - started)
            if remaining <= 0:
                raise RuntimeError("Codex CLI 验收超时")
            try:
                kind, line = events.get(timeout=min(0.2, remaining))
            except queue.Empty:
                continue
            if line is None:
                closed.add(kind)
                continue
            if kind == "stderr":
                _append_tail(stderr_tail, line)
                continue
            _append_tail(stdout_tail, line)
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError("Codex CLI 输出包含非法 JSONL") from error
            if not isinstance(payload, dict):
                raise RuntimeError("Codex CLI 输出包含非对象 JSONL")
            event_type = payload.get("type")
            if not isinstance(event_type, str) or not event_type:
                raise RuntimeError("Codex CLI 事件缺少类型")
            event_types.append(event_type)
            failures.extend([event_type] if _event_is_failure(payload) else [])
            completed = completed or (event_type == "turn.completed" and str(payload.get("status", "completed")).lower() in {"completed", "success", "succeeded"})
        exit_code = process.wait(timeout=2)
    except BaseException:
        terminate_process_tree(process)
        raise
    finally:
        for thread in threads:
            thread.join(timeout=1)
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                stream.close()
    duration_ms = round((clock() - started) * 1000)
    if exit_code != 0:
        raise RuntimeError(f"Codex CLI 验收失败：退出码 {exit_code}")
    if failures:
        raise RuntimeError(f"Codex CLI 验收失败：收到失败事件 {','.join(failures)}")
    if not completed:
        raise RuntimeError("Codex CLI 验收失败：未收到成功终止事件")
    try:
        final_text = output_last_message.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise RuntimeError("Codex CLI 验收失败：缺少最终助手输出") from error
    if final_text != "OK":
        raise RuntimeError("Codex CLI 验收失败：最终助手输出不等于 OK")
    return {"exitCode": exit_code, "success": True, "eventTypes": event_types[-20:], "durationMs": duration_ms, "stdoutTailBytes": sum(len(item) for item in stdout_tail), "stderrTailBytes": sum(len(item) for item in stderr_tail)}


def build_codex_command(codex: str, work_dir: str, output_last_message: Path) -> list[str]:
    return [codex, "exec", "--ignore-user-config", "--disable", "plugins", "--disable", "recommended_plugins", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--cd", work_dir, "--json", "--output-last-message", str(output_last_message), "-c", 'model_provider="token_one"', "-c", 'model="gpt-5.6-terra"', "-c", 'approval_policy="never"', "-c", "disable_response_storage=true", "-c", 'model_providers.token_one.name="Token One"', "-c", 'model_providers.token_one.wire_api="responses"', "-c", 'model_providers.token_one.base_url="https://token.meta-gravity.com/v1"', "-c", 'model_providers.token_one.env_key="TOKEN_ONE_API_KEY"', "-c", "model_providers.token_one.requires_openai_auth=false", "Reply with exactly OK. Do not use tools."]


def run_acceptance(config: AcceptanceConfig) -> None:
    deadline = AcceptanceDeadline(config.total_timeout_seconds)
    session = ProductionSshSession(host=config.host, **config.credential.connect_kwargs())
    raw_key = "sk-" + secrets.token_urlsafe(24)
    key_hash = hashlib.sha256(raw_key[3:].encode()).hexdigest()
    token_name = f"codex-acceptance-{secrets.token_hex(4)}"
    cleanup_required = False
    failure: BaseException | None = None
    cleanup_failure: BaseException | None = None
    try:
        # Mark first: the INSERT may have succeeded even if its response was lost.
        cleanup_required = True
        expires_at = int((time.time() + TOKEN_FALLBACK_LIFETIME_SECONDS) * 1000)
        emit("temporaryTokenCreate")
        db_sql(session.ensure_connected(), f"""
INSERT INTO tokens (keyHash, keyPrefix, name, userId, groupTag, status, expiresAt)
SELECT '{key_hash}', '{raw_key[3:][:8]}', '{token_name}', id, NULL, 1, {expires_at}
FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;
""", timeout=deadline.timeout(REMOTE_SQL_TIMEOUT_SECONDS, "创建临时 token"))
        chat_status, _ = post_json("/v1/chat/completions", {"model": "MiniMax-M3", "messages": [{"role": "user", "content": "Reply OK"}], "max_tokens": 8, "stream": False}, {"Authorization": f"Bearer {raw_key}"}, timeout=deadline.timeout(HTTP_TOTAL_TIMEOUT_SECONDS, "Chat Completions 请求"))
        responses = verify_responses_stream(raw_key, timeout=deadline.timeout(HTTP_TOTAL_TIMEOUT_SECONDS, "Responses 流式请求"))
        anthropic_status, anthropic_body = post_json("/v1/messages", {"model": "claude-sonnet-4-6", "messages": [{"role": "user", "content": "Reply OK"}], "max_tokens": 8, "stream": False}, {"x-api-key": raw_key, "anthropic-version": "2023-06-01"}, timeout=deadline.timeout(HTTP_TOTAL_TIMEOUT_SECONDS, "Anthropic 请求"))
        try:
            anthropic_error_type = json.loads(anthropic_body).get("error", {}).get("type")
        except (json.JSONDecodeError, AttributeError):
            anthropic_error_type = None
        emit("protocolChecks", chatStatus=chat_status, responsesStatus=responses.get("status"), responsesFirstEvent=responses.get("firstEvent"), responsesCompleted=responses.get("completed", False), anthropicStatus=anthropic_status, anthropicErrorType=anthropic_error_type)
        if chat_status != 200:
            raise RuntimeError(f"Chat Completions 验收失败：HTTP {chat_status}")
        if responses.get("status") != 200:
            raise RuntimeError(f"Responses 完整流验收失败：HTTP {responses.get('status')}")
        metadata = db_sql(session.ensure_connected(), """
SELECT channels.protocol, channels.protocols, COUNT(*) AS model_count, MIN(model_configs.status) AS all_enabled, MIN(model_configs.supportsResponses) AS all_responses
FROM channels JOIN model_routes ON model_routes.channelId = channels.id AND model_routes.status = 1 JOIN model_configs ON model_configs.id = model_routes.modelId
WHERE channels.name = 'CCTQ-Codex' AND model_configs.name IN ('gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra') GROUP BY channels.id, channels.protocol, channels.protocols;
""", timeout=deadline.timeout(REMOTE_SQL_TIMEOUT_SECONDS, "读取路由元数据"))
        if "responses" not in metadata or "\t3\t1\t1" not in metadata:
            raise RuntimeError("CCTQ-Codex 元数据验收失败")
        codex = shutil.which("codex") or shutil.which("codex.exe")
        if not codex:
            raise RuntimeError("本机未找到 Codex CLI")
        with tempfile.TemporaryDirectory(prefix="token-one-codex-") as work_dir:
            output_last_message = Path(work_dir) / "last-message.txt"
            env = os.environ.copy()
            env["TOKEN_ONE_API_KEY"] = raw_key
            env["CODEX_HOME"] = work_dir
            emit("codexCliStarted")
            emit("codexCli", **run_codex_cli(build_codex_command(codex, work_dir, output_last_message), cwd=work_dir, env=env, timeout_seconds=deadline.timeout(CODEX_TIMEOUT_SECONDS, "Codex CLI"), output_last_message=output_last_message))
        emit("cctqManagementStarted")
        run_cctq_management_acceptance(session.ensure_connected(), deadline)
        emit("cctqManagementPassed")
    except BaseException as error:
        failure = error
    finally:
        if cleanup_required:
            try:
                emit("temporaryTokenCleanup")
                session.run_recovery(lambda recovery_client: db_sql(recovery_client, f"DELETE FROM tokens WHERE keyHash = '{key_hash}';", timeout=TOKEN_CLEANUP_TIMEOUT_SECONDS), retry_after_connection_loss=True)
            except BaseException as error:
                cleanup_failure = error
                emit("temporaryTokenCleanupFailed", errorType=type(error).__name__)
        session.close()
    if cleanup_failure is not None:
        raise RuntimeError("临时 token 清理失败，验收必须失败") from cleanup_failure
    if failure is not None:
        raise failure


def main() -> int:
    try:
        run_acceptance(AcceptanceConfig.from_environment())
    except BaseException as error:
        emit("acceptanceFailed", errorType=type(error).__name__)
        return 1
    emit("acceptancePassed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
