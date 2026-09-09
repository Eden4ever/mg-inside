"""Small, testable helpers for bounded subprocess execution in release scripts."""

from __future__ import annotations

import os
import signal
import subprocess
import time
from collections.abc import Sequence
from typing import Any


def popen_process(args: Sequence[str], **kwargs: Any) -> subprocess.Popen[str]:
    """Start a process in its own group so a timeout can reap all descendants."""
    kwargs.setdefault("text", True)
    kwargs.setdefault("encoding", "utf-8")
    kwargs.setdefault("errors", "replace")
    if os.name == "nt":
        kwargs["creationflags"] = kwargs.get("creationflags", 0) | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(args, **kwargs)


def terminate_process_tree(process: subprocess.Popen[Any], *, grace_seconds: float = 3.0) -> None:
    """Terminate the process group and wait, including when the parent has exited."""
    if process.poll() is None:
        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    timeout=max(1, int(grace_seconds) + 2),
                )
            else:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                try:
                    process.wait(timeout=grace_seconds)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
            pass
    try:
        process.wait(timeout=max(1.0, grace_seconds))
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except OSError:
            pass
        process.wait(timeout=5)
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass


def wait_with_timeout(process: subprocess.Popen[Any], timeout_seconds: float) -> int:
    """Wait for a process and guarantee descendant cleanup on timeout."""
    try:
        return process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        terminate_process_tree(process)
        raise
