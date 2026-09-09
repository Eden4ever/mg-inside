#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm --prefix mg-gateway/apps/web run typecheck
npm --prefix mg-gateway/apps/web run build
npm --prefix mg-gateway/apps/gateway run build
npm --prefix mg-gateway/apps/gateway run test:gateway
