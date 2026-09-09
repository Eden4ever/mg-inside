#!/usr/bin/env bash
set -euo pipefail
release_id=${1:?需要发布编号}
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || exit 2
config_mode=${2:---prepare-config}
[[ "$config_mode" = --prepare-config || "$config_mode" = --preserve-config ]] || exit 2
backup="/opt/mg-desktop/backups/identity-$release_id"
test ! -e "$backup"
install -d -m 0700 "$backup"
docker inspect --format '{{.Image}}' mg-identity-identity-1 > "$backup/previous-image"
cp -a /opt/mg-identity/compose.yaml "$backup/compose.yaml"
cp -a /opt/mg-identity/secrets "$backup/secrets"
chmod 0700 "$backup/secrets"
docker image inspect "mg-identity-service:$release_id" >/dev/null
cd /opt/mg-identity
docker compose -f compose.yaml stop identity
docker exec mg-identity-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
test -s "$backup/database.dump"
chmod 0600 "$backup/database.dump"
snapshot_permissions() {
  docker exec -i mg-identity-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
SELECT jsonb_build_object(
 'users', (SELECT COALESCE(jsonb_agg(to_jsonb(u) - 'avatarUrl' ORDER BY id), '[]') FROM "User" u),
 'applications', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY "clientId"), '[]') FROM "Application" a),
 'memberships', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY "clientId", "userId"), '[]') FROM "ApplicationUser" a),
 'roles', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id), '[]') FROM "Role" r),
 'userRoles', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY "userId", "roleId"), '[]') FROM "UserRole" r),
 'roleApplications', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY "roleId", "clientId"), '[]') FROM "RoleApplication" r));
SQL
}
if [[ "$config_mode" = --preserve-config ]]; then
  snapshot_permissions > "$backup/permissions-before.json"
  chmod 0600 "$backup/permissions-before.json"
fi
docker exec -i mg-identity-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' > "$backup/application-access-before.json" <<'SQL'
SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT "clientId", "userId", "localUserId", enabled FROM "ApplicationUser" ORDER BY "clientId", "userId") t;
SQL
if [[ "$config_mode" = --prepare-config ]]; then
  python3 "/tmp/prepare-platform-config-$release_id.py" "$release_id"
else
  # 已上线平台的补丁无需重写客户端、签名密钥或服务环境。
  test -f /opt/mg-desktop/secrets/desktop.env
  test -f /opt/mg-desktop/secrets/files.env
fi
override="/opt/mg-identity/platform-$release_id.yaml"
test ! -e "$override"
printf 'services:\n  identity:\n    image: mg-identity-service:%s\n' "$release_id" > "$override"
docker compose -f compose.yaml -f "$override" run --rm --no-deps identity node node_modules/prisma/build/index.js migrate deploy
if [[ "$config_mode" = --preserve-config ]]; then
  snapshot_permissions > "$backup/permissions-after.json"
  chmod 0600 "$backup/permissions-after.json"
  cmp --silent "$backup/permissions-before.json" "$backup/permissions-after.json" || { echo '迁移修改了现有账号或授权，停止切换。' >&2; exit 1; }
fi
docker compose -f compose.yaml -f "$override" up -d --no-build --wait --wait-timeout 90 identity
curl --fail --silent http://127.0.0.1:4200/health >/dev/null
echo '身份中心已完成备份、追加迁移和健康检查。'
