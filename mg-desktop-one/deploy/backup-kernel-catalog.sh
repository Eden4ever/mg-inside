#!/usr/bin/env bash
set -euo pipefail
umask 077
backup="/opt/mg-desktop/backups/catalog-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$backup"
for pair in 'identity:mg-identity-db-1' 'service:mg-service-registry-db-1'; do
  label=${pair%%:*}
  container=${pair#*:}
  docker exec "$container" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/$label.dump"
  test -s "$backup/$label.dump"
  docker exec -i "$container" pg_restore --list < "$backup/$label.dump" > "$backup/$label.contents"
done
cp -a /opt/mg-identity/compose.yaml "$backup/identity-compose.yaml"
cp -a /opt/mg-identity/secrets "$backup/identity-secrets"
cp -a /opt/mg-desktop/secrets "$backup/desktop-secrets"
cp -a /opt/mg-desktop/config "$backup/desktop-config"
docker inspect mg-desktop-desktop-1 --format '{{.Image}}' > "$backup/desktop-image"
docker inspect mg-identity-identity-1 --format '{{.Image}}' > "$backup/identity-image"
printf '备份目录：%s\n' "$backup"
stat -c '%n %s bytes' "$backup/identity.dump" "$backup/service.dump"
