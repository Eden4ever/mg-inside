#!/usr/bin/env bash
set -euo pipefail
release=/opt/mg-desktop/releases/20260908T155000Z
backup=/opt/mg-desktop/backups/migrate-20260908T154000Z
test -s "$backup/migrated-invariants.json"
cd /opt/mg-identity
docker compose -f compose.yaml -f platform-20260908T155000Z.yaml up -d --no-build --wait --wait-timeout 120 identity
cd "$release"
RELEASE_ID=20260908T155000Z docker compose -f deploy/compose.yaml up -d --no-build --wait --wait-timeout 120
test ! -e /opt/mg-desktop/current
ln -s "$release" /opt/mg-desktop/current
install -m 644 "$release/deploy/nginx-desktop.conf" /etc/nginx/conf.d/desktop.meta-gravity.conf
install -m 644 "$backup/configuration/nginx/identity.meta-gravity.conf" /etc/nginx/conf.d/identity.meta-gravity.conf
nginx -t
systemctl reload nginx
curl --noproxy '*' -fsS --resolve desktop.meta-gravity.com:443:127.0.0.1 https://desktop.meta-gravity.com/api/health
curl --noproxy '*' -fsS --resolve identity.meta-gravity.com:443:127.0.0.1 https://identity.meta-gravity.com/health
curl --noproxy '*' -fsS --resolve desktop.meta-gravity.com:443:127.0.0.1 https://desktop.meta-gravity.com/office-engine/healthcheck
systemctl is-active mg-resource-one mg-expert-database-api
