"""Build the guarded remote rollback command used by production deployment."""

from __future__ import annotations

import shlex


def build_rollback_script(
    *,
    remote: str,
    backup: str,
    release: str,
    restore_database: bool,
) -> str:
    rollback_marker = backup.rstrip("/") + "/rollback-verified"
    database_step = """
db_name=$(awk -F= '$1=="DB_DATABASE" {print substr($0,index($0,"=")+1)}' mg-gateway.env | tail -n 1 | tr -d '\\r')
db_root_pass=$(docker inspect mgnewapi-mysql --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="MYSQL_ROOT_PASSWORD" {print substr($0,index($0,"=")+1)}')
case "$db_name" in
  ''|*[!A-Za-z0-9_]*) echo '数据库名包含不安全字符，拒绝恢复' >&2; exit 1 ;;
esac
test -n "$db_root_pass"
docker exec -e MYSQL_PWD="$db_root_pass" -i mgnewapi-mysql mysql -uroot < database.sql
docker exec -e MYSQL_PWD="$db_root_pass" mgnewapi-mysql mysql -uroot -N -B -e \
  "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='$db_name'" | grep -Fxq "$db_name"
unset db_name db_root_pass
echo 'database_restore=ok'
""" if restore_database else "echo 'database_restore=not-required'"

    return f"""
test "$(cd {shlex.quote(remote)} && pwd -P)" = {shlex.quote(remote)}
test -d {shlex.quote(backup)}
cd {shlex.quote(backup)}
sha256sum -c SHA256SUMS
rollback_marker={shlex.quote(rollback_marker)}
if test -f "$rollback_marker"; then
  test "$(cat "$rollback_marker")" = {shlex.quote(release)}
  echo 'rollback=already-verified'
  exit 0
fi
expected_image=$(cat image.id)
test "$(docker image inspect mg-gateway:rollback-{release} --format '{{{{.Id}}}}')" = "$expected_image"
docker stop mg-gateway >/dev/null 2>&1 || true
cd {shlex.quote(remote)}
failed_items=()
for item in apps web-dist scripts Dockerfile docker-compose.yml verify.sh verify2.sh; do
  if test -e "$item"; then
    failed_items+=("$item")
  fi
done
if test "${{#failed_items[@]}}" -gt 0; then
  tar -czf {shlex.quote(backup + '/failed-release-files.tar.gz')} "${{failed_items[@]}}" || true
fi
rm -rf -- apps web-dist scripts
rm -f -- Dockerfile docker-compose.yml verify.sh verify2.sh
tar -xzf {shlex.quote(backup + '/files.tar.gz')}
cp {shlex.quote(backup + '/mg-gateway.env')} mg-gateway.env
chmod 600 mg-gateway.env
cd {shlex.quote(backup)}
{database_step}
cd {shlex.quote(remote)}
docker image tag mg-gateway:rollback-{release} mg-gateway:latest
docker compose up -d --force-recreate --no-build gateway
for attempt in $(seq 1 30); do
  live=$(curl -fsS http://127.0.0.1:3001/api/health/live 2>/dev/null || true)
  ready=$(curl -fsS http://127.0.0.1:3001/api/health/ready 2>/dev/null || true)
  if printf '%s' "$live" | grep -q '"status":"ok"' && printf '%s' "$ready" | grep -q '"status":"ready"'; then
    break
  fi
  sleep 2
done
printf 'rollback_live=%s\nrollback_ready=%s\n' "$live" "$ready"
printf '%s' "$live" | grep -q '"status":"ok"'
printf '%s' "$ready" | grep -q '"status":"ready"'
test "$(docker inspect mg-gateway --format '{{{{.Image}}}}')" = "$expected_image"
docker compose ps gateway
printf '%s\n' {shlex.quote(release)} > "$rollback_marker.tmp"
mv -f -- "$rollback_marker.tmp" "$rollback_marker"
echo 'rollback=verified'
"""
