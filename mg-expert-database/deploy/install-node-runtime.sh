#!/usr/bin/env bash
set -euo pipefail
# 仅安装本应用独立运行时，不替换系统 Node.js。
runtime_root=/opt/mg-expert-database/runtimes
runtime_name=node-v24.20.0-linux-x64
runtime_target="$runtime_root/$runtime_name"
test "$(uname -m)" = x86_64
if [[ -x "$runtime_target/bin/node" ]]; then
  test "$("$runtime_target/bin/node" --version)" = v24.20.0
  exit 0
fi
test ! -e "$runtime_target"
runtime_stage="$(mktemp -d /tmp/mg-node-runtime.XXXXXX)"
trap 'rm -rf "$runtime_stage"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 \
  "https://nodejs.org/dist/v24.20.0/$runtime_name.tar.xz" -o "$runtime_stage/$runtime_name.tar.xz"
echo "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2  $runtime_stage/$runtime_name.tar.xz" | sha256sum --check
tar -xJf "$runtime_stage/$runtime_name.tar.xz" -C "$runtime_stage" --no-same-owner
test "$("$runtime_stage/$runtime_name/bin/node" --version)" = v24.20.0
install -d -o root -g root -m 0755 "$runtime_root"
mv "$runtime_stage/$runtime_name" "$runtime_target"
chown -R root:root "$runtime_target"
