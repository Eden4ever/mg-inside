#!/usr/bin/env bash
# 仅由最终统一发布流程显式调用；身份迁移与客户端注册必须已完成。
set -euo pipefail
release_id=${1:?需要发布编号}
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || exit 2
release_dir="/opt/mg-desktop/releases/$release_id"
test "$(realpath "$release_dir")" = "$release_dir"
test -f "$release_dir/static/apps/files/index.html"
test -f "$release_dir/static/apps/identity/index.html"
for file in /opt/mg-desktop/secrets/desktop.env /opt/mg-desktop/secrets/services.env /opt/mg-desktop/secrets/files.env; do
  test -f "$file"
  test "$(stat -c '%a' "$file")" = 600
  if grep -q 'REPLACE_WITH_' "$file"; then echo '服务凭据模板尚未替换' >&2; exit 1; fi
done
test ! -e /opt/mg-desktop/current || test -L /opt/mg-desktop/current
for image in mg-desktop-service mg-service-registry-admin mg-files-service; do docker image inspect "$image:$release_id" >/dev/null; done
backup_dir="/opt/mg-desktop/backups/$release_id"
test ! -e "$backup_dir"
install -d -m 0700 "$backup_dir"
previous_release=""
if test -L /opt/mg-desktop/current; then previous_release=$(readlink -f /opt/mg-desktop/current); echo "$previous_release" > "$backup_dir/previous-release"; fi
export RELEASE_ID="$release_id"
activated=false
rollback_on_error() {
  if test "$activated" = false && test -n "$previous_release"; then
    previous_id=$(basename "$previous_release")
    RELEASE_ID="$previous_id" docker compose -f "$previous_release/deploy/compose.yaml" up -d --no-build --wait --wait-timeout 120 || true
  fi
}
trap rollback_on_error ERR
# 停止写入后备份两套持久化数据，Files 元数据与 objects 必须同一时点。
docker compose -f "$release_dir/deploy/compose.yaml" stop
if test -d /opt/mg-desktop/shared; then tar -czf "$backup_dir/shared.tar.gz" -C /opt/mg-desktop shared; fi
docker exec mg-service-registry-db-1 pg_dump -U registry_owner -d mg_services --format=custom --no-owner --no-acl > "$backup_dir/services.dump"
test -s "$backup_dir/services.dump"
chmod 0600 "$backup_dir/services.dump"
install -d -o 1000 -g 1000 -m 0700 /opt/mg-desktop/shared/desktop /opt/mg-desktop/shared/files
docker compose -f "$release_dir/deploy/compose.yaml" up -d --wait --wait-timeout 90
curl --fail --silent http://127.0.0.1:4300/api/health >/dev/null
curl --fail --silent http://127.0.0.1:14350/health >/dev/null
ln -s "$release_dir" "/opt/mg-desktop/.current.$release_id.next"
mv -Tf "/opt/mg-desktop/.current.$release_id.next" /opt/mg-desktop/current
activated=true
echo "桌面与 Files 已切换；还需 Nginx 配置检查和真实登录回归。"
