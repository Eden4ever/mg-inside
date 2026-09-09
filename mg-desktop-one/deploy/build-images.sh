#!/usr/bin/env bash
# 只校验已经解压的发布包并构建新镜像，不切换生产容器。
set -euo pipefail
release_id=${1:?需要发布编号}
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || exit 2
release_dir="/opt/mg-desktop/releases/$release_id"
test -d "$release_dir"
test "$(realpath "$release_dir")" = "$release_dir"
cd "$release_dir"
sha256sum --check --quiet SHA256SUMS
for image in mg-desktop-service mg-files-service mg-identity-service; do
  if docker image inspect "$image:$release_id" >/dev/null 2>&1; then
    echo "镜像已存在，禁止覆盖：$image:$release_id" >&2
    exit 1
  fi
done
docker build -f deploy/desktop.Dockerfile -t "mg-desktop-service:$release_id" .
docker build -f deploy/files.Dockerfile -t "mg-files-service:$release_id" .
docker build -f deploy/identity.Dockerfile -t "mg-identity-service:$release_id" .
echo "新镜像已构建，尚未切换生产服务。"
