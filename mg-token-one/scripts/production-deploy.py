"""Deploy mg-gateway with backups, migrations and production metadata.

Required environment variables (二选一，不可同时提供):
  MG_DEPLOY_PASSWORD  SSH password for the production host
  MG_DEPLOY_SSH_KEY   SSH private key material for the production host

Optional environment variables:
  MG_DEPLOY_SSH_KEY_PASSPHRASE
                      Passphrase for an encrypted MG_DEPLOY_SSH_KEY.
  CCTQ_CODEX_KEY      Upstream CCTQ Codex API key. When omitted, leave the
                      existing CCTQ-Codex credential untouched.
  CCTQ_CLAUDE_KEY     Upstream CCTQ Claude API key. When omitted, leave the
                      Claude channel untouched.

Secrets are transferred through a temporary mode-0600 file and are never
printed or stored in the project or release backup.
"""

from __future__ import annotations

import datetime as dt
import argparse
import hashlib
import os
import pathlib
import posixpath
import secrets
import shlex
import subprocess
import sys
import tempfile

import paramiko

from production_deploy_package import build_package
from production_deploy_preflight import build_preflight_script
from production_deploy_rollback import build_rollback_script
from production_deploy_local_gate import run_local_release_gate
from production_deploy_lock import (
    build_acquire_lock_script,
    build_release_lock_script,
)
from production_ssh import ProductionSshSession, credential_from_environment
from production_process import popen_process, terminate_process_tree


ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = ROOT / "mg-gateway"
HOST = os.environ.get("MG_DEPLOY_HOST", "1.12.253.86")
REMOTE = os.environ.get("MG_DEPLOY_PATH", "/opt/mg-gateway")
RELEASE = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
DEPLOYMENT_LOCK_TOKEN = secrets.token_urlsafe(32)
REMOTE_PACKAGE = f"/tmp/mg-gateway-{RELEASE}.tar.gz"
REMOTE_CODEX_SECRETS = f"/tmp/mg-gateway-{RELEASE}.codex.env"
REMOTE_CLAUDE_SECRETS = f"/tmp/mg-gateway-{RELEASE}.claude.env"
BACKUP = posixpath.join(REMOTE, "backups", RELEASE)


def optional_secret(name: str) -> str:
    """Return an opt-in secret while rejecting a supplied blank value before SSH."""
    value = os.environ.get(name, "")
    if value and not value.strip():
        raise SystemExit(f"{name} must not be blank")
    if "\r" in value or "\n" in value:
        raise SystemExit(f"{name} must be a single line")
    return value


def remote_run(client: paramiko.SSHClient, label: str, script: str, timeout: int = 600) -> str:
    print(f"[{label}]")
    command = f"bash -lc {shlex.quote('set -euo pipefail\n' + script)}"
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", errors="replace")
    error = stderr.read().decode("utf-8", errors="replace")
    status = stdout.channel.recv_exit_status()
    if output.strip():
        print(output.rstrip())
    if status != 0:
        if error.strip():
            print(error.rstrip())
        raise RuntimeError(f"{label} 失败，退出码 {status}")
    return output


ACCEPTANCE_TIMEOUT_SECONDS = 900
ACCEPTANCE_OUTER_TIMEOUT_SECONDS = 1020


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="发布 Token One 网关")
    parser.add_argument(
        "--ui-only",
        action="store_true",
        help="仅发布前端资源，跳过网关 E2E、数据库迁移和上游验收",
    )
    return parser.parse_args()


def run_codex_responses_acceptance() -> None:
    """Run the public Responses acceptance before the release can be marked successful.

    验收子进程自行从环境变量解析同一份 SSH 凭据，因此这里只透传本进程已有的
    凭据变量，不再把口令写进新的映射。
    """
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"CCTQ_CODEX_KEY", "CCTQ_CLAUDE_KEY"}
    }
    environment.update({
        "MG_DEPLOY_HOST": HOST,
        "MG_DEPLOY_PATH": REMOTE,
        "MG_CODEX_ACCEPTANCE_TIMEOUT_SECONDS": str(ACCEPTANCE_TIMEOUT_SECONDS),
    })
    process = popen_process(
        [sys.executable, str(ROOT / "scripts" / "production-codex-acceptance.py")],
        cwd=ROOT,
        env=environment,
    )
    try:
        # The inner deadline is 900 seconds, leaving cleanup time before this
        # outer guard reaps the entire process group.
        result = process.wait(timeout=ACCEPTANCE_OUTER_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as error:
        terminate_process_tree(process)
        raise RuntimeError("Codex 原生 Responses 发布验收超时") from error
    if result != 0:
        raise RuntimeError(f"Codex 原生 Responses 发布验收失败，退出码 {result}")


args = parse_args()
ui_only = args.ui_only
credential = credential_from_environment()
cctq_codex_key = optional_secret("CCTQ_CODEX_KEY")
cctq_claude_key = optional_secret("CCTQ_CLAUDE_KEY")

with tempfile.TemporaryDirectory(prefix="mg-gateway-release-") as temp_dir:
    if ui_only:
        run_local_release_gate(PROJECT, ui_only=True)
    else:
        run_local_release_gate(PROJECT)
    package = pathlib.Path(temp_dir) / "release.tar.gz"
    build_package(PROJECT, package)
    package_sha256 = hashlib.sha256(package.read_bytes()).hexdigest()

    session = ProductionSshSession(host=HOST, **credential.connect_kwargs())
    backup_ready = False
    release_files_may_have_changed = False
    database_may_have_changed = False
    remote_artifacts_may_exist = False
    deployment_lock_may_exist = False
    deployment_lock_acquired = False
    deployed = False
    try:
        remote_run(
            session.ensure_connected(),
            "发布前置检查",
            build_preflight_script(
                remote=REMOTE,
                minimum_free_kilobytes=2 * 1024 * 1024,
            ),
        )

        deployment_lock_may_exist = True
        remote_run(
            session.ensure_connected(),
            "获取生产发布锁",
            build_acquire_lock_script(
                remote=REMOTE,
                token=DEPLOYMENT_LOCK_TOKEN,
                release=RELEASE,
            ),
        )
        deployment_lock_acquired = True

        remote_artifacts_may_exist = True
        if cctq_codex_key:
            remote_run(
                session.ensure_connected(),
                "创建受保护的 Codex 临时密钥文件",
                f"umask 077; : > {shlex.quote(REMOTE_CODEX_SECRETS)}; "
                f"test \"$(stat -c %a {shlex.quote(REMOTE_CODEX_SECRETS)})\" = 600",
            )
        if cctq_claude_key:
            remote_run(
                session.ensure_connected(),
                "创建受保护的 Claude 临时密钥文件",
                f"umask 077; : > {shlex.quote(REMOTE_CLAUDE_SECRETS)}; "
                f"test \"$(stat -c %a {shlex.quote(REMOTE_CLAUDE_SECRETS)})\" = 600",
            )
        sftp = session.ensure_connected().open_sftp()
        try:
            sftp.put(str(package), REMOTE_PACKAGE)
            if cctq_codex_key:
                with sftp.file(REMOTE_CODEX_SECRETS, "w") as secret_file:
                    secret_file.write(cctq_codex_key)
                sftp.chmod(REMOTE_CODEX_SECRETS, 0o600)
            if cctq_claude_key:
                with sftp.file(REMOTE_CLAUDE_SECRETS, "w") as secret_file:
                    secret_file.write(cctq_claude_key)
                sftp.chmod(REMOTE_CLAUDE_SECRETS, 0o600)
        finally:
            sftp.close()

        remote_run(
            session.ensure_connected(),
            "校验发布包传输完整性",
            f"""
test -s {shlex.quote(REMOTE_PACKAGE)}
test "$(sha256sum {shlex.quote(REMOTE_PACKAGE)} | awk '{{print $1}}')" = {shlex.quote(package_sha256)}
tar -tzf {shlex.quote(REMOTE_PACKAGE)} >/dev/null
{f'test "$(stat -c %a {shlex.quote(REMOTE_CODEX_SECRETS)})" = 600' if cctq_codex_key else ':'}
{f'test "$(stat -c %a {shlex.quote(REMOTE_CLAUDE_SECRETS)})" = 600' if cctq_claude_key else ':'}
echo 'release_package=verified'
""",
        )

        remote_run(
            session.ensure_connected(),
            "备份生产文件、数据库和镜像",
            f"""
mkdir -p {shlex.quote(BACKUP)}
cd {shlex.quote(REMOTE)}
cp mg-gateway.env {shlex.quote(BACKUP + '/mg-gateway.env')}
printf '{{"releaseId":"%s","artifactSha256":"%s"}}\n' \
  {shlex.quote(RELEASE)} {shlex.quote(package_sha256)} \
  > {shlex.quote(BACKUP + '/release-manifest.json')}
backup_items=()
for item in apps web-dist scripts Dockerfile docker-compose.yml verify.sh verify2.sh; do
  if test -e "$item"; then
    backup_items+=("$item")
  fi
done
test "${{#backup_items[@]}}" -gt 0
tar -czf {shlex.quote(BACKUP + '/files.tar.gz')} "${{backup_items[@]}}"
test -s {shlex.quote(BACKUP + '/files.tar.gz')}
docker image inspect mg-gateway:latest >/dev/null
docker image tag mg-gateway:latest mg-gateway:rollback-{RELEASE}
docker image inspect mg-gateway:rollback-{RELEASE} --format '{{{{.Id}}}}' \
  > {shlex.quote(BACKUP + '/image.id')}
db_name=$(docker inspect mg-gateway --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | awk -F= '$1=="DB_DATABASE"{{print substr($0,index($0,"=")+1)}}')
db_root_pass=$(docker inspect mgnewapi-mysql --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | awk -F= '$1=="MYSQL_ROOT_PASSWORD"{{print substr($0,index($0,"=")+1)}}')
case "$db_name" in
  ''|*[!A-Za-z0-9_]*) echo '数据库名包含不安全字符，拒绝备份' >&2; exit 1 ;;
esac
test -n "$db_root_pass"
docker exec -e MYSQL_PWD="$db_root_pass" mgnewapi-mysql \
  mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces \
  --databases --add-drop-database "$db_name" \
  > {shlex.quote(BACKUP + '/database.sql')}
test -s {shlex.quote(BACKUP + '/database.sql')}
chmod 600 {shlex.quote(BACKUP + '/mg-gateway.env')} {shlex.quote(BACKUP + '/database.sql')}
cd {shlex.quote(BACKUP)}
sha256sum mg-gateway.env files.tar.gz database.sql image.id release-manifest.json > SHA256SUMS
sha256sum -c SHA256SUMS
unset db_name db_root_pass
echo "backup={BACKUP}"
""",
        )
        backup_ready = True

        release_files_may_have_changed = True
        remote_run(
            session.ensure_connected(),
            "更新发布文件并构建镜像",
            f"""
cd {shlex.quote(REMOTE)}
test "$(pwd -P)" = {shlex.quote(REMOTE)}
rm -rf -- apps web-dist scripts
rm -f -- Dockerfile verify.sh verify2.sh
tar -xzf {shlex.quote(REMOTE_PACKAGE)}
if grep -q '^DB_SYNCHRONIZE=' mg-gateway.env; then
  sed -i 's/^DB_SYNCHRONIZE=.*/DB_SYNCHRONIZE=false/' mg-gateway.env
else
  printf '\nDB_SYNCHRONIZE=false\n' >> mg-gateway.env
fi
if grep -q '^AUTO_CIRCUIT_BREAKER_ENABLED=' mg-gateway.env; then
  sed -i 's/^AUTO_CIRCUIT_BREAKER_ENABLED=.*/AUTO_CIRCUIT_BREAKER_ENABLED=false/' mg-gateway.env
else
  printf '\nAUTO_CIRCUIT_BREAKER_ENABLED=false\n' >> mg-gateway.env
fi
if grep -q '^MG_RELEASE_ID=' mg-gateway.env; then
  sed -i 's/^MG_RELEASE_ID=.*/MG_RELEASE_ID={RELEASE}/' mg-gateway.env
else
  printf '\nMG_RELEASE_ID={RELEASE}\n' >> mg-gateway.env
fi
if grep -q '^MG_RELEASE_SHA256=' mg-gateway.env; then
  sed -i 's/^MG_RELEASE_SHA256=.*/MG_RELEASE_SHA256={package_sha256}/' mg-gateway.env
else
  printf '\nMG_RELEASE_SHA256={package_sha256}\n' >> mg-gateway.env
fi
docker compose build \
  --build-arg MG_RELEASE_ID={RELEASE} \
  --build-arg MG_RELEASE_SHA256={package_sha256} \
  gateway
test "$(docker image inspect mg-gateway:latest --format '{{{{index .Config.Labels "com.meta-gravity.token-one.release-id"}}}}')" = {RELEASE}
test "$(docker image inspect mg-gateway:latest --format '{{{{index .Config.Labels "com.meta-gravity.token-one.artifact-sha256"}}}}')" = {package_sha256}
""",
            timeout=1200,
        )

        remote_run(
            session.ensure_connected(),
            "冻结写入并刷新最终数据库备份",
            f"""
cd {shlex.quote(REMOTE)}
docker stop mg-gateway >/dev/null
test "$(docker inspect mg-gateway --format '{{{{.State.Running}}}}')" = false
db_name=$(awk -F= '$1=="DB_DATABASE" {{print substr($0,index($0,"=")+1)}}' {shlex.quote(BACKUP + '/mg-gateway.env')} | tail -n 1 | tr -d '\r')
db_root_pass=$(docker inspect mgnewapi-mysql --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | awk -F= '$1=="MYSQL_ROOT_PASSWORD"{{print substr($0,index($0,"=")+1)}}')
case "$db_name" in
  ''|*[!A-Za-z0-9_]*) echo '数据库名包含不安全字符，拒绝最终备份' >&2; exit 1 ;;
esac
test -n "$db_root_pass"
docker exec -e MYSQL_PWD="$db_root_pass" mgnewapi-mysql \
  mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces \
  --databases --add-drop-database "$db_name" \
  > {shlex.quote(BACKUP + '/database.final.sql')}
test -s {shlex.quote(BACKUP + '/database.final.sql')}
chmod 600 {shlex.quote(BACKUP + '/database.final.sql')}
mv {shlex.quote(BACKUP + '/database.final.sql')} {shlex.quote(BACKUP + '/database.sql')}
cd {shlex.quote(BACKUP)}
sha256sum mg-gateway.env files.tar.gz database.sql image.id release-manifest.json > SHA256SUMS
sha256sum -c SHA256SUMS
unset db_name db_root_pass
echo 'write_freeze=ok final_database_backup=verified'
""",
        )

        if not ui_only:
            database_may_have_changed = True
            remote_run(
                session.ensure_connected(),
                "执行数据库迁移",
                f"""
cd {shlex.quote(REMOTE)}
docker compose run --rm --no-deps gateway node scripts/migrate.mjs
docker compose run --rm --no-deps gateway node scripts/migrate.mjs --status
""",
            )

        if not ui_only:
            remote_run(
                session.ensure_connected(),
                "配置 Codex 原生 Responses 元数据",
                f"""
cd {shlex.quote(REMOTE)}
docker compose run --rm --no-deps gateway node scripts/configure-codex-responses.mjs
""",
            )

        if not ui_only and cctq_codex_key:
            remote_run(
                session.ensure_connected(),
                "更新可选 Codex 上游凭据",
                f"""
cd {shlex.quote(REMOTE)}
CCTQ_CODEX_KEY="$(< {shlex.quote(REMOTE_CODEX_SECRETS)})" docker compose run --rm --no-deps \\
  -e CCTQ_CODEX_KEY \\
  gateway node scripts/configure-codex-upstream.mjs
""",
            )

        if not ui_only and cctq_claude_key:
            remote_run(
                session.ensure_connected(),
                "更新可选 Claude 上游凭据",
                f"""
cd {shlex.quote(REMOTE)}
CCTQ_CLAUDE_KEY="$(< {shlex.quote(REMOTE_CLAUDE_SECRETS)})" docker compose run --rm --no-deps \
  -e CCTQ_CLAUDE_KEY \
  gateway node scripts/configure-cctq-claude-upstream.mjs
""",
            )

        remote_run(
            session.ensure_connected(),
            "启动并检查生产服务",
            f"""
cd {shlex.quote(REMOTE)}
docker compose up -d --force-recreate gateway
for attempt in $(seq 1 30); do
  live=$(curl -fsS http://127.0.0.1:3001/api/health/live 2>/dev/null || true)
  ready=$(curl -fsS http://127.0.0.1:3001/api/health/ready 2>/dev/null || true)
  if printf '%s' "$live" | grep -q '"status":"ok"' && printf '%s' "$ready" | grep -q '"status":"ready"'; then
    break
  fi
  sleep 2
done
printf 'live=%s\nready=%s\n' "$live" "$ready"
printf '%s' "$live" | grep -q '"status":"ok"'
printf '%s' "$ready" | grep -q '"status":"ready"'
printf '%s' "$ready" | grep -q '"autoCircuitBreakerEnabled":false'
printf '%s' "$live" | grep -q '"releaseId":"{RELEASE}"'
printf '%s' "$ready" | grep -q '"releaseId":"{RELEASE}"'
printf '%s' "$live" | grep -q '"releaseSha256":"{package_sha256}"'
printf '%s' "$ready" | grep -q '"releaseSha256":"{package_sha256}"'
test "$(docker inspect mg-gateway --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | awk -F= '$1=="DB_SYNCHRONIZE"{{print $2}}')" = false
test "$(docker inspect mg-gateway --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | awk -F= '$1=="AUTO_CIRCUIT_BREAKER_ENABLED"{{print $2}}')" = false
test "$(docker inspect mg-gateway --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | awk -F= '$1=="MG_RELEASE_ID"{{print $2}}')" = {RELEASE}
test "$(docker inspect mg-gateway --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | awk -F= '$1=="MG_RELEASE_SHA256"{{print $2}}')" = {package_sha256}
test "$(docker inspect mg-gateway --format '{{{{index .Config.Labels "com.meta-gravity.token-one.release-id"}}}}')" = {RELEASE}
test "$(docker inspect mg-gateway --format '{{{{index .Config.Labels "com.meta-gravity.token-one.artifact-sha256"}}}}')" = {package_sha256}
test "$(docker image inspect mg-gateway:latest --format '{{{{index .Config.Labels "com.meta-gravity.token-one.release-id"}}}}')" = {RELEASE}
test "$(docker image inspect mg-gateway:latest --format '{{{{index .Config.Labels "com.meta-gravity.token-one.artifact-sha256"}}}}')" = {package_sha256}
docker compose ps gateway
""",
            timeout=300,
        )
        if not ui_only:
            print("[Codex 原生 Responses 与 CCTQ 管理面发布验收]")
            run_codex_responses_acceptance()
        deployed = True
        print(f"release={RELEASE}")
        print(f"artifact_sha256={package_sha256}")
        print(f"rollback_image=mg-gateway:rollback-{RELEASE}")
    except Exception:
        if not deployed and backup_ready and release_files_may_have_changed:
            try:
                session.run_recovery(
                    lambda recovery_client: remote_run(
                        recovery_client,
                        "恢复数据库、生产文件、环境和旧应用镜像",
                        build_rollback_script(
                            remote=REMOTE,
                            backup=BACKUP,
                            release=RELEASE,
                            restore_database=database_may_have_changed,
                        ),
                        timeout=600,
                    ),
                    retry_after_connection_loss=True,
                )
            except Exception as rollback_error:
                print(f"自动回滚失败：{rollback_error}")
        raise
    finally:
        try:
            if remote_artifacts_may_exist:
                session.run_recovery(
                    lambda recovery_client: remote_run(
                        recovery_client,
                        "清理临时发布文件",
                        f"rm -f {shlex.quote(REMOTE_PACKAGE)} "
                        f"{shlex.quote(REMOTE_CODEX_SECRETS)} {shlex.quote(REMOTE_CLAUDE_SECRETS)}",
                    ),
                    retry_after_connection_loss=True,
                )
        finally:
            try:
                if deployment_lock_may_exist:
                    session.run_recovery(
                        lambda recovery_client: remote_run(
                            recovery_client,
                            "释放生产发布锁",
                            build_release_lock_script(
                                remote=REMOTE,
                                token=DEPLOYMENT_LOCK_TOKEN,
                                require_owned=deployment_lock_acquired,
                            ),
                        ),
                        retry_after_connection_loss=True,
                        # 若服务端已执行但回包丢失，重试需接受已移除的锁，
                        # 同时绝不删除后续发布者持有的锁。
                        retry_operation=lambda recovery_client: remote_run(
                            recovery_client,
                            "确认生产发布锁已释放",
                            build_release_lock_script(
                                remote=REMOTE,
                                token=DEPLOYMENT_LOCK_TOKEN,
                                require_owned=False,
                            ),
                        ),
                    )
            finally:
                session.close()
