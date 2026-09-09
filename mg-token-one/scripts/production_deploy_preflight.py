"""Build the read-only remote preflight command for production deployment."""

from __future__ import annotations

import shlex


def build_preflight_script(*, remote: str, minimum_free_kilobytes: int) -> str:
    if minimum_free_kilobytes < 1:
        raise ValueError("minimum_free_kilobytes must be positive")

    return f"""
test "$(cd {shlex.quote(remote)} && pwd -P)" = {shlex.quote(remote)}
cd {shlex.quote(remote)}
test -f mg-gateway.env
test -f docker-compose.yml
command -v sha256sum >/dev/null
command -v tar >/dev/null
docker compose version >/dev/null
docker compose config --images | grep -Fxq 'mg-gateway:latest'
test "$(docker inspect mg-gateway --format '{{{{.State.Running}}}}')" = true
test "$(docker inspect mgnewapi-mysql --format '{{{{.State.Running}}}}')" = true
test "$(docker inspect mg-gateway --format '{{{{.Config.Image}}}}')" = 'mg-gateway:latest'
test "$(docker inspect mg-gateway --format '{{{{.Image}}}}')" = \
  "$(docker image inspect mg-gateway:latest --format '{{{{.Id}}}}')"
db_root_pass_present=$(docker inspect mgnewapi-mysql --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' |
  awk -F= '$1=="MYSQL_ROOT_PASSWORD" && length(substr($0,index($0,"=")+1))>0 {{found=1}} END{{print found+0}}')
test "$db_root_pass_present" = 1
docker exec mgnewapi-mysql sh -lc 'command -v mysqldump >/dev/null'
free_kilobytes=$(df -Pk {shlex.quote(remote)} | awk 'NR==2 {{print $4}}')
case "$free_kilobytes" in
  ''|*[!0-9]*) echo '无法确定部署磁盘剩余空间' >&2; exit 1 ;;
esac
test "$free_kilobytes" -ge {minimum_free_kilobytes}
live=$(curl -fsS http://127.0.0.1:3001/api/health/live)
ready=$(curl -fsS http://127.0.0.1:3001/api/health/ready)
printf '%s' "$live" | grep -q '"status":"ok"'
printf '%s' "$ready" | grep -q '"status":"ready"'
unset db_root_pass_present
printf 'preflight=ok free_kilobytes=%s\n' "$free_kilobytes"
"""
