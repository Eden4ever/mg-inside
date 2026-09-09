#!/usr/bin/env bash
# 由发布任务在服务器执行。参数只能为已上传的不可变 release 目录；秘密单独准备。
set -euo pipefail
test "$(id -u)" = 0
release="${1:?需要 release 绝对路径}"
case "$release" in /opt/mg-resource/releases/[0-9A-Za-z_-]*) ;; *) echo '发布路径无效' >&2; exit 2;; esac
test "$(realpath "$release")" = "$release"
test "$(dirname "$release")" = /opt/mg-resource/releases
test -f "$release/server/main.ts"
test -f "$release/server/resources.json"
test -s /opt/mg-resource/shared/resource.env
for entry in platform knowledge known_hosts; do test -s "/opt/mg-resource/shared/credentials/$entry"; done
node_binary="${RESOURCE_NODE_PATH:-/usr/local/bin/node}"
"$node_binary" --experimental-transform-types --input-type=module -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
if ! id mg-resource-service >/dev/null 2>&1; then useradd --system --no-create-home --shell /sbin/nologin mg-resource-service; fi
chown root:mg-resource-service /opt/mg-resource/shared
chmod 750 /opt/mg-resource/shared
install -d -m 700 -o mg-resource-service -g mg-resource-service /opt/mg-resource/shared/data
chown root:root /opt/mg-resource/shared/resource.env
chmod 600 /opt/mg-resource/shared/resource.env
chown -R mg-resource-service:mg-resource-service /opt/mg-resource/shared/credentials
chmod 700 /opt/mg-resource/shared/credentials
chmod 600 /opt/mg-resource/shared/credentials/platform /opt/mg-resource/shared/credentials/knowledge /opt/mg-resource/shared/credentials/known_hosts
cat > /etc/systemd/system/mg-resource-one.service <<EOF
[Unit]
Description=MG resource inventory service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mg-resource-service
Group=mg-resource-service
WorkingDirectory=/opt/mg-resource/current
Environment=NODE_ENV=production
Environment=RESOURCE_HOST=127.0.0.1
Environment=RESOURCE_PORT=14370
Environment=RESOURCE_DATA_DIR=/opt/mg-resource/shared/data
Environment=RESOURCE_CREDENTIAL_DIR=/opt/mg-resource/shared/credentials
EnvironmentFile=/opt/mg-resource/shared/resource.env
ExecStart=$node_binary --experimental-transform-types server/main.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/mg-resource/shared/data
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
MemoryMax=256M
CPUQuota=25%

[Install]
WantedBy=multi-user.target
EOF
old_release=''
if test -L /opt/mg-resource/current; then
  old_release="$(readlink -e /opt/mg-resource/current 2>/dev/null || true)"
  case "$old_release" in /opt/mg-resource/releases/*) ;; *) old_release='';; esac
fi
ln -sfn "$release" /opt/mg-resource/current.next
mv -Tf /opt/mg-resource/current.next /opt/mg-resource/current
systemctl daemon-reload
systemctl enable mg-resource-one.service >/dev/null
systemctl restart mg-resource-one.service
for attempt in {1..15}; do
  if curl -fsS --max-time 2 http://127.0.0.1:14370/health >/dev/null; then echo '资源服务健康检查通过'; exit 0; fi
  sleep 1
done
if test -n "$old_release" && test -d "$old_release"; then
  ln -sfn "$old_release" /opt/mg-resource/current.next
  mv -Tf /opt/mg-resource/current.next /opt/mg-resource/current
  systemctl restart mg-resource-one.service
else
  systemctl stop mg-resource-one.service
fi
echo '资源服务启动失败，已回退原版本或停止新服务' >&2
exit 1
