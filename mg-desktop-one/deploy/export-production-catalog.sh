#!/usr/bin/env bash
set -euo pipefail
umask 077
destination=/opt/mg-desktop/backups/catalog-20260909T173539Z
test -d "$destination"
test ! -e "$destination/runtime-catalog.json"
docker run --rm --read-only --network host \
  --env-file /opt/mg-desktop/secrets/desktop.env \
  --env-file /opt/mg-desktop/secrets/services.env \
  -e DESKTOP_CONFIG_FILE=/app/application-catalog.json \
  -v /tmp/ExportLegacyCatalog.class:/migration-helper/ExportLegacyCatalog.class:ro \
  -v /opt/mg-desktop/config:/etc/mg-desktop:ro \
  --entrypoint java mg-desktop-service:20260909T075714Z \
  -Dloader.path=/migration-helper -Dloader.main=ExportLegacyCatalog \
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher > "$destination/runtime-catalog.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["schemaVersion"]==1; assert len(d["applications"])==12; assert len({a["id"] for a in d["applications"]})==12; print("生产运行目录已保存并验证：12 个应用")' "$destination/runtime-catalog.json"
