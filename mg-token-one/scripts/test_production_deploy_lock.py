from __future__ import annotations

import pathlib
import subprocess
import tempfile
import unittest

try:
    from production_deploy_lock import (
        build_acquire_lock_script,
        build_release_lock_script,
    )
except ModuleNotFoundError:
    from scripts.production_deploy_lock import (
        build_acquire_lock_script,
        build_release_lock_script,
    )


class ProductionDeployLockTest(unittest.TestCase):
    def test_lock_commands_are_ownership_checked(self) -> None:
        acquire = build_acquire_lock_script(
            remote="/opt/mg-gateway", token="owner-token", release="release-id"
        )
        release = build_release_lock_script(
            remote="/opt/mg-gateway", token="owner-token", require_owned=True
        )

        self.assertIn("if ! mkdir --", acquire)
        self.assertIn("拒绝并发发布", acquire)
        self.assertIn("chmod 600", acquire)
        self.assertNotIn("echo owner-token", acquire)
        self.assertIn("actual_owner=$(cat", release)
        self.assertIn("所有权不匹配", release)
        self.assertLess(release.index("actual_owner=$(cat"), release.index("rm -f --"))

    def test_lock_commands_have_valid_bash_syntax(self) -> None:
        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe")
        if not bash.is_file():
            self.skipTest("Git Bash 不可用")
        for script in (
            build_acquire_lock_script(
                remote="/opt/mg-gateway", token="token", release="release"
            ),
            build_release_lock_script(remote="/opt/mg-gateway", token="token"),
        ):
            result = subprocess.run(
                [str(bash), "-n"],
                input=script,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_real_lock_rejects_competitor_and_only_owner_releases(self) -> None:
        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe")
        if not bash.is_file():
            self.skipTest("Git Bash 不可用")
        with tempfile.TemporaryDirectory(prefix="token-one-lock-") as temp:
            remote = pathlib.Path(temp).as_posix()

            acquired = subprocess.run(
                [str(bash), "-c", build_acquire_lock_script(
                    remote=remote, token="owner-one", release="release-one"
                )],
                capture_output=True,
                text=True,
                check=False,
            )
            competitor = subprocess.run(
                [str(bash), "-c", build_acquire_lock_script(
                    remote=remote, token="owner-two", release="release-two"
                )],
                capture_output=True,
                text=True,
                check=False,
            )
            wrong_release = subprocess.run(
                [str(bash), "-c", build_release_lock_script(
                    remote=remote,
                    token="owner-two",
                    require_owned=False,
                )],
                capture_output=True,
                text=True,
                check=False,
            )
            owner_release = subprocess.run(
                [str(bash), "-c", build_release_lock_script(
                    remote=remote,
                    token="owner-one",
                    require_owned=True,
                )],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(acquired.returncode, 0, acquired.stderr)
            self.assertNotEqual(competitor.returncode, 0)
            self.assertEqual(wrong_release.returncode, 0, wrong_release.stderr)
            self.assertIn("not-owned", wrong_release.stdout)
            self.assertEqual(owner_release.returncode, 0, owner_release.stderr)
            self.assertFalse((pathlib.Path(temp) / ".production-deploy.lock").exists())


if __name__ == "__main__":
    unittest.main()
