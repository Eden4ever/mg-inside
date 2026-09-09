#!/usr/bin/env bash
set -euo pipefail

archive_path="${1:?release archive is required}"
release_id="${2:?release id is required}"

if [[ ! "$release_id" =~ ^stage[1-9][0-9]*-[0-9]{8}-[0-9]{6}$ ]]; then
  echo "invalid release id" >&2
  exit 2
fi

app_root="/opt/mg-expert-database"
current_link="$app_root/current"
current_target="$(readlink -f "$current_link")"
release_target="$app_root/releases/$release_id"
web_parent="/var/www/mg-expert-database"
web_target="$web_parent/knowledge-base-inside"
backup_root="$app_root/backups/$release_id"
web_next="$web_parent/.knowledge-base-inside.$release_id.next"
web_previous="$web_parent/.knowledge-base-inside.$release_id.previous"
stage_dir="$(mktemp -d "/tmp/mg-expert-release.XXXXXX")"
release_switched=0
service_installed=0
web_old_moved=0
web_new_active=0

rollback() {
  local exit_code="$?"
  trap - ERR
  set +e
  # 新认证版本可能已经接收 MFA 设置；旧代码不能安全解释这些策略。
  # 切换后的故障关闭 API，保留新版本和备份，禁止自动降级到单因素旧版本。
  if [[ "$release_switched" == 1 ]]; then
    systemctl stop mg-expert-database-api
    echo "deployment failed after authentication cutover; API stopped; repair forward or restore an authentication-compatible release; backup: $backup_root" >&2
    exit "$exit_code"
  fi
  if [[ "$web_new_active" == 1 ]]; then
    mv "$web_target" "$web_parent/.knowledge-base-inside.$release_id.failed"
    mv "$web_previous" "$web_target"
  elif [[ "$web_old_moved" == 1 ]]; then
    mv "$web_previous" "$web_target"
  fi
  if [[ "$service_installed" == 1 && -f "$backup_root/mg-expert-database-api.service" ]]; then
    install -o root -g root -m 0644 "$backup_root/mg-expert-database-api.service" /etc/systemd/system/mg-expert-database-api.service
    systemctl daemon-reload
  fi
  if [[ "$release_switched" == 1 || "$service_installed" == 1 ]]; then
    systemctl restart mg-expert-database-api
  fi
  rm -rf "$stage_dir"
  echo "deployment failed and runtime rollback attempted; backup: $backup_root" >&2
  exit "$exit_code"
}
trap rollback ERR
trap 'rm -rf "$stage_dir"' EXIT

test -f "$archive_path"
test -f "$current_target/apps/api/src/main.ts"
test -d "$web_target"
test ! -e "$backup_root"
test ! -e "$release_target"
test ! -e "$web_next"
test ! -e "$web_previous"

tar -xzf "$archive_path" -C "$stage_dir"
test -f "$stage_dir/source/apps/api/src/main.ts"
test -f "$stage_dir/source/apps/api/package.json"
test -f "$stage_dir/source/apps/web/package.json"
test -f "$stage_dir/source/package.json"
test -f "$stage_dir/source/pnpm-lock.yaml"
test -f "$stage_dir/source/pnpm-workspace.yaml"
test -f "$stage_dir/source/apps/api/dist/apps/api/src/main.js"
test -f "$stage_dir/source/apps/api/src/system-access.ts"
test -f "$stage_dir/source/apps/api/prisma/migrations/20260822000900_add_indicator_system_access/migration.sql"
test -f "$stage_dir/source/packages/contracts/dist/index.js"
test -f "$stage_dir/source/packages/contracts/dist/package.json"
test -f "$stage_dir/source/packages/contracts/package.json"
test -f "$stage_dir/source/docs/research-module-schema.json"
test -f "$stage_dir/web/index.html"
test -f "$stage_dir/SHA256SUMS"
test -f "$stage_dir/deploy/mg-expert-database-api.service"
(cd "$stage_dir" && sha256sum --check SHA256SUMS)
test -f "$stage_dir/deploy/install-node-runtime.sh"
sed -i 's/\r$//' "$stage_dir/deploy/install-node-runtime.sh"
bash "$stage_dir/deploy/install-node-runtime.sh"
export PATH="/opt/mg-expert-database/runtimes/node-v24.20.0-linux-x64/bin:$PATH"
test "$(node --version)" = v24.20.0
grep -q '/knowledge-base-inside/' "$stage_dir/web/index.html"

# Backups contain database and service configuration, so keep the release
# backup directory private while preserving the existing public web owner.
install -d -o root -g root -m 0700 "$backup_root"
mkdir -p "$backup_root/web"
printf '%s\n' "$current_target" > "$backup_root/previous-release.txt"
cp -a "$web_target/." "$backup_root/web/"
cp -L /etc/systemd/system/mg-expert-database-api.service "$backup_root/mg-expert-database-api.service"

set -a
# shellcheck disable=SC1091
. /etc/mg-expert-database/api.env
set +a
# 数据库内的 SMTP 和认证器配置依赖此密钥，恢复时必须成套保留。
auth_key_path="${AUTH_CONFIG_KEY_FILE:-/opt/mg-expert-database/shared/auth-config.key}"
if [[ -f "$auth_key_path" ]]; then
  test "$(stat -Lc '%s' "$auth_key_path")" = 32
  install -o root -g root -m 0600 "$auth_key_path" "$backup_root/auth-config.key"
fi
psql_url="${DATABASE_URL%%\?schema=*}"
pg_dump --format=custom --file="$backup_root/database.dump" "$psql_url"
test -s "$backup_root/database.dump"
pg_restore --list "$backup_root/database.dump" > "$backup_root/database-contents.txt"

mkdir -p "$release_target"
cp -a "$stage_dir/source/." "$release_target/"

cd "$release_target"
# 安装失败时终止发布；不允许继续使用旧依赖或改变已审核的锁文件。
expected_pnpm="$(node -p 'require("./package.json").packageManager.replace(/^pnpm@/, "")')"
test "$(pnpm --version)" = "$expected_pnpm"
pnpm --filter @mg-expert/api... install --frozen-lockfile --ignore-scripts --prod=false
apps/api/node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma
node -e 'const {createRequire}=require("node:module");const r=createRequire(process.cwd()+"/apps/api/package.json");r("yauzl");r("exceljs");r("@prisma/client");require("./apps/api/dist/apps/api/src/xlsx-import-worker.js")'
apps/api/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma
chown -R mgexpert:mgexpert "$release_target"
install -o root -g root -m 0644 "$stage_dir/deploy/mg-expert-database-api.service" /etc/systemd/system/mg-expert-database-api.service
service_installed=1
systemctl daemon-reload

mkdir -p "$web_next"
cp -a "$stage_dir/web/." "$web_next/"
web_owner="$(stat -c '%u:%g' "$web_target")"
chown -R "$web_owner" "$web_next"

ln -s "$release_target" "$app_root/.current.$release_id.next"
mv -Tf "$app_root/.current.$release_id.next" "$current_link"
release_switched=1
systemctl restart mg-expert-database-api
for _ in $(seq 1 30); do
  if systemctl is-active --quiet mg-expert-database-api && curl --fail --silent http://127.0.0.1:4100/api/health >/dev/null; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet mg-expert-database-api
curl --fail --silent --show-error http://127.0.0.1:4100/api/health >/dev/null

mv "$web_target" "$web_previous"
web_old_moved=1
mv "$web_next" "$web_target"
web_new_active=1

echo "deployment complete: $release_id"
echo "backup: $backup_root"
echo "release: $release_target"
echo "previous web: $web_previous"
