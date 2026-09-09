"""Build ownership-checked remote production deployment lock commands."""

from __future__ import annotations

import shlex


def lock_path(remote: str) -> str:
    return remote.rstrip("/") + "/.production-deploy.lock"


def build_acquire_lock_script(
    *, remote: str, token: str, release: str
) -> str:
    if not token:
        raise ValueError("deployment lock token is required")
    target = lock_path(remote)
    return f"""
lock={shlex.quote(target)}
if ! mkdir -- "$lock" 2>/dev/null; then
  echo '已有生产发布任务持有锁，拒绝并发发布' >&2
  if test -f "$lock/metadata"; then
    sed -n '1,3p' "$lock/metadata" >&2
  fi
  exit 1
fi
if ! printf '%s' {shlex.quote(token)} > "$lock/owner"; then
  rmdir -- "$lock" 2>/dev/null || true
  exit 1
fi
chmod 600 "$lock/owner"
printf 'release=%s\nstarted_at=%s\n' {shlex.quote(release)} "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$lock/metadata"
echo 'deployment_lock=acquired'
"""


def build_release_lock_script(
    *, remote: str, token: str, require_owned: bool = True
) -> str:
    if not token:
        raise ValueError("deployment lock token is required")
    target = lock_path(remote)
    missing_action = (
        "echo '已确认持有的发布锁缺失' >&2; exit 1"
        if require_owned
        else "echo 'deployment_lock=absent'; exit 0"
    )
    mismatch_action = (
        "echo '发布锁所有权不匹配，拒绝清理' >&2; exit 1"
        if require_owned
        else "echo 'deployment_lock=not-owned'; exit 0"
    )
    return f"""
lock={shlex.quote(target)}
if ! test -d "$lock"; then
  {missing_action}
fi
if ! test -f "$lock/owner"; then
  {missing_action}
fi
actual_owner=$(cat "$lock/owner")
if test "$actual_owner" != {shlex.quote(token)}; then
  {mismatch_action}
fi
rm -f -- "$lock/owner" "$lock/metadata"
rmdir -- "$lock"
unset actual_owner
echo 'deployment_lock=released'
"""
