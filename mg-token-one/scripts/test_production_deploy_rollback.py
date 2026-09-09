from __future__ import annotations

import pathlib
import subprocess
import unittest

try:
    from production_deploy_rollback import build_rollback_script
except ModuleNotFoundError:
    from scripts.production_deploy_rollback import build_rollback_script


class ProductionDeployRollbackTest(unittest.TestCase):
    def build(self, restore_database: bool) -> str:
        return build_rollback_script(
            remote="/opt/mg-gateway",
            backup="/opt/mg-gateway/backups/20260819T000000Z",
            release="20260819T000000Z",
            restore_database=restore_database,
        )

    def test_database_restore_is_enabled_only_after_database_phase(self) -> None:
        before_database = self.build(False)
        after_database = self.build(True)

        self.assertIn("database_restore=not-required", before_database)
        self.assertNotIn("< database.sql", before_database)
        self.assertIn("< database.sql", after_database)
        self.assertIn("database_restore=ok", after_database)
        self.assertIn("tail -n 1 | tr -d '\\r'", after_database)

    def test_rollback_checks_backup_before_stopping_gateway(self) -> None:
        script = self.build(True)

        self.assertLess(script.index("sha256sum -c"), script.index("docker stop mg-gateway"))
        self.assertLess(script.index("docker stop mg-gateway"), script.index("rm -rf --"))
        self.assertIn("rm -rf -- apps web-dist scripts", script)
        self.assertNotIn("rm -rf -- /opt/mg-gateway", script)
        self.assertIn("docker compose up -d --force-recreate --no-build gateway", script)
        self.assertIn("--format '{{.Id}}'", script)
        self.assertIn("--format '{{.Image}}'", script)
        self.assertIn("rollback=verified", script)
        self.assertIn("rollback=already-verified", script)
        self.assertIn("rollback-verified", script)
        self.assertLess(script.index("rollback_marker="), script.index("docker stop mg-gateway"))
        self.assertLess(script.index("docker compose ps gateway"), script.index("rollback=verified"))

    def test_generated_script_has_valid_bash_syntax_when_bash_is_available(self) -> None:
        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe")
        if not bash.is_file():
            self.skipTest("Git Bash 不可用")

        result = subprocess.run(
            [str(bash), "-n"],
            input=self.build(True),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
