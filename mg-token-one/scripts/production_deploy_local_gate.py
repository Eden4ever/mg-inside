"""Local build and test gate that must pass before production is contacted."""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys

try:
    from production_ssh import CREDENTIAL_ENVIRONMENT_VARIABLES
except ModuleNotFoundError:  # 允许以 scripts 包形式被导入
    from scripts.production_ssh import CREDENTIAL_ENVIRONMENT_VARIABLES


SENSITIVE_ENVIRONMENT_VARIABLES = {
    *CREDENTIAL_ENVIRONMENT_VARIABLES,
    "CCTQ_CLAUDE_KEY",
    "CCTQ_CODEX_KEY",
}
def npm_executable() -> str:
    candidates = ("npm.cmd", "npm") if os.name == "nt" else ("npm", "npm.cmd")
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError("找不到 npm，无法执行本地发布门禁")


def production_test_scripts() -> tuple[pathlib.Path, ...]:
    """Return the production safety tests in deterministic, non-recursive order."""
    scripts_directory = pathlib.Path(__file__).resolve().parent
    test_scripts = tuple(
        sorted(
            (
                path
                for path in scripts_directory.glob("test_production*.py")
                if path.is_file()
            ),
            key=lambda path: path.name.casefold(),
        )
    )
    if not test_scripts:
        raise RuntimeError(f"未找到生产安全测试：{scripts_directory / 'test_production*.py'}")
    return test_scripts


def production_test_command() -> tuple[str, ...]:
    """Build one cross-platform unittest discovery command for all production tests."""
    test_scripts = production_test_scripts()
    scripts_directory = test_scripts[0].parent
    return (
        sys.executable,
        "-m",
        "unittest",
        "discover",
        "-s",
        str(scripts_directory),
        "-p",
        "test_production*.py",
    )


def _run_checked_command(
    *,
    working_directory: pathlib.Path,
    command: tuple[str, ...],
    child_environment: dict[str, str],
    label: str,
) -> None:
    print(f"[本地发布门禁] {label}")
    result = subprocess.run(
        command,
        cwd=working_directory,
        env=child_environment,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"本地发布门禁失败：{label}")


def run_local_release_gate(project: pathlib.Path, *, ui_only: bool = False) -> None:
    """Run the local checks required by a full or UI-only production release."""
    child_environment = {
        key: value
        for key, value in os.environ.items()
        if key not in SENSITIVE_ENVIRONMENT_VARIABLES
    }
    scripts_directory = pathlib.Path(__file__).resolve().parent
    repository_root = scripts_directory.parent

    # Keep discovery in a separate interpreter so test imports and module-level
    # setup cannot affect the deploy process. This is unconditional: an external
    # environment variable must never be able to bypass production safety tests.
    _run_checked_command(
        working_directory=repository_root,
        command=production_test_command(),
        child_environment=child_environment,
        label="Python: unittest discover test_production*.py",
    )

    npm = npm_executable()
    if ui_only:
        npm_commands = (
            (project / "apps" / "web", (npm, "run", "typecheck")),
            (project / "apps" / "web", (npm, "run", "build")),
        )
    else:
        npm_commands = (
            (project / "apps" / "gateway", (npm, "run", "test:gateway")),
            (project / "apps" / "gateway", (npm, "run", "test:e2e")),
            (project / "apps" / "gateway", (npm, "run", "build")),
            (project / "apps" / "web", (npm, "run", "typecheck")),
            (project / "apps" / "web", (npm, "run", "build")),
        )
    for working_directory, command in npm_commands:
        label = f"{working_directory.name}: {' '.join(command[1:])}"
        _run_checked_command(
            working_directory=working_directory,
            command=command,
            child_environment=child_environment,
            label=label,
        )
