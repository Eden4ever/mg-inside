#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("需要 Node.js 22 或更高版本"); process.exit(1); }'
npm --prefix mg-gateway/apps/gateway ci
npm --prefix mg-gateway/apps/web ci
