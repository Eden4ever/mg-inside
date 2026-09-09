from __future__ import annotations

import pathlib
import os
import sys
import unittest
from unittest.mock import Mock, patch

try:
    import production_deploy_local_gate as gate
except ModuleNotFoundError:
    import scripts.production_deploy_local_gate as gate


run_local_release_gate = gate.run_local_release_gate


class ProductionDeployLocalGateTest(unittest.TestCase):
    @patch.object(gate.subprocess, "run")
    @patch.object(gate, "npm_executable", return_value="npm")
    @patch.dict(
        os.environ,
        {
            "MG_DEPLOY_PASSWORD": "ssh-secret",
            "CCTQ_CLAUDE_KEY": "claude-secret",
            "CCTQ_CODEX_KEY": "codex-secret",
        },
    )
    def test_gate_runs_all_checks_in_release_order(self, _npm, run) -> None:
        run.return_value.returncode = 0
        project = pathlib.Path("/project")

        run_local_release_gate(project)

        test_scripts = gate.production_test_scripts()
        python_command = gate.production_test_command()
        self.assertIn(
            pathlib.Path(gate.__file__).with_name("test_production_deploy_local_gate.py"),
            test_scripts,
        )
        expected_commands = [
            python_command,
            ("npm", "run", "test:gateway"),
            ("npm", "run", "test:e2e"),
            ("npm", "run", "build"),
            ("npm", "run", "typecheck"),
            ("npm", "run", "build"),
        ]
        self.assertEqual(
            [call.args[0] for call in run.call_args_list], expected_commands
        )
        self.assertEqual(
            run.call_args_list[0].kwargs["cwd"],
            pathlib.Path(gate.__file__).resolve().parent.parent,
        )
        self.assertEqual(
            run.call_args_list[1].kwargs["cwd"],
            project / "apps" / "gateway",
        )
        self.assertEqual(
            run.call_args_list[-1].kwargs["cwd"], project / "apps" / "web"
        )
        for call in run.call_args_list:
            self.assertNotIn("MG_DEPLOY_PASSWORD", call.kwargs["env"])
            self.assertNotIn("CCTQ_CLAUDE_KEY", call.kwargs["env"])
            self.assertNotIn("CCTQ_CODEX_KEY", call.kwargs["env"])

    @patch.object(gate.subprocess, "run")
    @patch.object(gate, "npm_executable", return_value="npm")
    def test_gate_stops_at_first_failure(self, _npm, run) -> None:
        run.return_value.returncode = 1

        with self.assertRaisesRegex(RuntimeError, "本地发布门禁失败"):
            run_local_release_gate(pathlib.Path("/project"))

        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args[0][0], gate.production_test_command())

    @patch.object(gate.subprocess, "run")
    @patch.object(gate, "npm_executable", return_value="npm")
    def test_npm_checks_start_only_after_all_python_tests_pass(self, npm, run) -> None:
        results = [Mock(returncode=0)]
        results.extend([Mock(returncode=0) for _ in range(5)])
        run.side_effect = results

        run_local_release_gate(pathlib.Path("/project"))

        npm.assert_called_once_with()
        self.assertEqual(run.call_count, 6)
        self.assertEqual(
            run.call_args_list[0].args[0],
            gate.production_test_command(),
        )

    @patch.object(gate.subprocess, "run")
    @patch.object(gate, "npm_executable", return_value="npm")
    def test_python_test_failure_prevents_npm_and_later_tests(self, npm, run) -> None:
        run.return_value = Mock(returncode=1)

        with self.assertRaisesRegex(RuntimeError, "本地发布门禁失败"):
            run_local_release_gate(pathlib.Path("/project"))

        self.assertEqual(run.call_count, 1)
        npm.assert_not_called()

    @patch.object(gate.subprocess, "run")
    @patch.object(gate, "npm_executable", return_value="npm")
    def test_npm_failure_stops_remaining_npm_checks(self, _npm, run) -> None:
        run.side_effect = [
            Mock(returncode=0),
            Mock(returncode=0),
            Mock(returncode=1),
        ]

        with self.assertRaisesRegex(RuntimeError, "本地发布门禁失败"):
            run_local_release_gate(pathlib.Path("/project"))

        self.assertEqual(run.call_count, 3)

    @patch.object(gate.subprocess, "run")
    @patch.object(gate, "npm_executable", return_value="npm")
    @patch.dict(gate.os.environ, {"MG_TOKEN_ONE_PRODUCTION_TEST_CHILD": "1"})
    def test_external_environment_cannot_skip_python_discovery(self, _npm, run) -> None:
        run.return_value = Mock(returncode=0)

        run_local_release_gate(pathlib.Path("/project"))

        self.assertEqual(run.call_count, 6)
        self.assertEqual(run.call_args_list[0].args[0], gate.production_test_command())

    @patch.object(gate.subprocess, "run")
    @patch.object(gate, "npm_executable", return_value="npm")
    def test_ui_only_gate_skips_gateway_checks(self, _npm, run) -> None:
        run.return_value = Mock(returncode=0)

        run_local_release_gate(pathlib.Path("/project"), ui_only=True)

        self.assertEqual(
            [call.args[0] for call in run.call_args_list],
            [
                gate.production_test_command(),
                ("npm", "run", "typecheck"),
                ("npm", "run", "build"),
            ],
        )
        self.assertEqual(run.call_args_list[1].kwargs["cwd"], pathlib.Path("/project/apps/web"))


if __name__ == "__main__":
    unittest.main()
