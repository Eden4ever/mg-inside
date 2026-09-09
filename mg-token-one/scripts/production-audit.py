"""Read-only production audit for mg-gateway.

The SSH credential is supplied through MG_DEPLOY_PASSWORD or MG_DEPLOY_SSH_KEY
and is never printed.
"""

import os

from production_ssh import connect_production, credential_from_environment


HOST = os.environ.get("MG_DEPLOY_HOST", "1.12.253.86")
REMOTE = os.environ.get("MG_DEPLOY_PATH", "/opt/mg-gateway")


def run(client, command):
    _, stdout, stderr = client.exec_command(command, timeout=30)
    output = stdout.read().decode("utf-8", errors="replace")
    error = stderr.read().decode("utf-8", errors="replace")
    print(f"$ {command}")
    if output.strip():
        print(output.rstrip())
    if error.strip():
        print(f"[stderr] {error.rstrip()}")


client = connect_production(
    host=HOST, **credential_from_environment().connect_kwargs()
)
try:
    commands = [
        "hostname; date -Is; uname -a",
        f"test -d {REMOTE} && (cd {REMOTE} && pwd && find . -maxdepth 2 -type f -printf '%p\\n' | sort | head -120)",
        f"cd {REMOTE} && (docker compose ps 2>&1 || true)",
        "docker ps --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}'",
        "docker network ls --format 'table {{.Name}}\\t{{.Driver}}'",
        f"cd {REMOTE} && (grep -E '^(NODE_ENV|PORT|DB_|WEB_DIST_DIR|JWT_|GATEWAY_PUBLIC_URL|RELAY_|CHANNEL_|AUTO_CIRCUIT_BREAKER_ENABLED)' mg-gateway.env .env 2>/dev/null | sed -E 's/=.*$/=<redacted>/' || true)",
        f"cd {REMOTE} && (grep -RniE 'server_name|proxy_pass|token.meta-gravity.com' /etc/nginx /etc/caddy 2>/dev/null | head -80 || true)",
        f"cd {REMOTE} && (sed -n '1,220p' docker-compose.yml; printf '\\n--- Dockerfile ---\\n'; sed -n '1,220p' Dockerfile; printf '\\n--- verify.sh ---\\n'; sed -n '1,220p' verify.sh)",
        "docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -E 's/^(DB_PASSWORD|JWT_SECRET|WECOM_SECRET|WECOM_ENCODING_AES_KEY|ADMIN_PASSWORD)=.*$/\\1=<redacted>/' | sort",
        "curl -fsS http://127.0.0.1:3001/api/health/ready",
        "db_pass=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1==\"DB_PASSWORD\"{print substr($0,index($0,\"=\")+1)}'); db_user=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1==\"DB_USERNAME\"{print substr($0,index($0,\"=\")+1)}'); db_name=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1==\"DB_DATABASE\"{print substr($0,index($0,\"=\")+1)}'); docker exec -e MYSQL_PWD=\"$db_pass\" mgnewapi-mysql mysql -u\"$db_user\" -D\"$db_name\" -N -e \"SHOW TABLES; SELECT '---CHANNEL COLUMNS---'; SHOW COLUMNS FROM channels; SELECT '---MODEL COLUMNS---'; SHOW COLUMNS FROM model_configs; SELECT '---REQUEST LOG COLUMNS---'; SHOW COLUMNS FROM request_logs; SELECT '---CHANNELS---'; SELECT id,name,type,status,baseUrl FROM channels ORDER BY id; SELECT '---MODELS---'; SELECT id,name,status,inputPrice,cachePrice,outputPrice,supportsResponses,supportsAnthropic,bindings FROM model_configs ORDER BY id;\"; unset db_pass db_user db_name",
    ]
    for command in commands:
        run(client, command)
finally:
    client.close()
