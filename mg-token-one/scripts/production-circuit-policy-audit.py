"""Read-only production audit for the automatic circuit-breaker policy.

Required environment variables (二选一):
  MG_DEPLOY_PASSWORD  SSH password for the production host
  MG_DEPLOY_SSH_KEY   SSH private key material for the production host

The script reports only non-sensitive policy and channel-health metadata.
"""

from __future__ import annotations

import json
import os
import shlex
import sys

import paramiko

from production_ssh import connect_production, credential_from_environment
from production_circuit_policy import evaluate_compliance


HOST = os.environ.get("MG_DEPLOY_HOST", "1.12.253.86")


def run(client: paramiko.SSHClient, script: str) -> str:
    command = f"bash -lc {shlex.quote('set -euo pipefail\n' + script)}"
    _, stdout, stderr = client.exec_command(command, timeout=30)
    output = stdout.read().decode("utf-8", errors="replace")
    error = stderr.read().decode("utf-8", errors="replace")
    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(error.strip() or f"remote command failed: {status}")
    return output.strip()


client = connect_production(
    host=HOST,
    **credential_from_environment().connect_kwargs(),
)
try:
    health = run(client, "curl -fsS http://127.0.0.1:3001/api/health/ready")
    environment = run(
        client,
        """
docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' |
  awk -F= '$1=="NODE_ENV" || $1=="AUTO_CIRCUIT_BREAKER_ENABLED" || $1=="MG_RELEASE_ID" || $1=="MG_RELEASE_SHA256" {print $1"="$2}'
""",
    )
    release_labels = dict(
        line.split("=", 1)
        for line in run(
            client,
            """
printf 'containerRelease=%s\nimageRelease=%s\ncontainerArtifact=%s\nimageArtifact=%s\n' \
  "$(docker inspect mg-gateway --format '{{if .Config.Labels}}{{index .Config.Labels "com.meta-gravity.token-one.release-id"}}{{end}}')" \
  "$(docker image inspect mg-gateway:latest --format '{{if .Config.Labels}}{{index .Config.Labels "com.meta-gravity.token-one.release-id"}}{{end}}')" \
  "$(docker inspect mg-gateway --format '{{if .Config.Labels}}{{index .Config.Labels "com.meta-gravity.token-one.artifact-sha256"}}{{end}}')" \
  "$(docker image inspect mg-gateway:latest --format '{{if .Config.Labels}}{{index .Config.Labels "com.meta-gravity.token-one.artifact-sha256"}}{{end}}')"
""",
        ).splitlines()
        if "=" in line
    )
    channel_state = run(
        client,
        """
db_pass=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' |
  awk -F= '$1=="DB_PASSWORD" {print substr($0,index($0,"=")+1)}')
db_user=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' |
  awk -F= '$1=="DB_USERNAME" {print substr($0,index($0,"=")+1)}')
db_name=$(docker inspect mg-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' |
  awk -F= '$1=="DB_DATABASE" {print substr($0,index($0,"=")+1)}')
docker exec -e MYSQL_PWD="$db_pass" mgnewapi-mysql mysql -u"$db_user" -D"$db_name" -N -B -e \
  "SELECT COUNT(*) FROM channels WHERE disabledUntil IS NOT NULL AND disabledUntil > UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000;
   SELECT COUNT(*) FROM channels WHERE consecutiveErrors > 0;"
unset db_pass db_user db_name
""",
    ).splitlines()
    container_state = json.loads(
        run(client, "docker inspect mg-gateway --format '{{json .State}}'")
    )

    env_values = dict(
        line.split("=", 1) for line in environment.splitlines() if "=" in line
    )
    health_payload = json.loads(health)
    node_env = env_values.get("NODE_ENV")
    circuit_env = env_values.get("AUTO_CIRCUIT_BREAKER_ENABLED")
    temporarily_disabled = int(channel_state[0]) if channel_state else 0
    compliance = evaluate_compliance(
        health=health_payload,
        environment=env_values,
        container_release_label=release_labels.get("containerRelease"),
        image_release_label=release_labels.get("imageRelease"),
        container_artifact_label=release_labels.get("containerArtifact"),
        image_artifact_label=release_labels.get("imageArtifact"),
        temporarily_disabled=temporarily_disabled,
        expected_release_id=os.environ.get("MG_EXPECTED_RELEASE_ID") or None,
        expected_release_sha256=os.environ.get("MG_EXPECTED_RELEASE_SHA256") or None,
    )
    payload = {
        "host": HOST,
        "compliant": compliance["compliant"],
        "complianceChecks": compliance["checks"],
        "release": compliance["release"],
        "artifact": compliance["artifact"],
        "health": health_payload,
        "environment": {
            "nodeEnv": node_env,
            "autoCircuitBreakerEnabled": circuit_env,
        },
        "channels": {
            "temporarilyDisabled": temporarily_disabled,
            "withConsecutiveErrors": int(channel_state[1])
            if len(channel_state) > 1
            else 0,
        },
        "container": {
            "status": container_state.get("Status", "unknown"),
            "health": container_state.get("Health", {}).get(
                "Status", "not-configured"
            ),
        },
    }
    print(json.dumps(payload, ensure_ascii=False))
    if not payload["compliant"]:
        sys.exit(2)
finally:
    client.close()
