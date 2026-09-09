#!/usr/bin/env bash
set -euo pipefail

cd /opt/mg-expert-database/current
sha256sum \
  apps/api/package.json \
  apps/api/tsconfig.json \
  apps/api/tsconfig.build.json \
  packages/contracts/package.json \
  package.json \
  tsconfig.base.json

(cd apps/api && node <<'NODE'
const { Prisma } = require('@prisma/client');
const hasAccessModel = Prisma.dmmf.datamodel.models.some((model) => model.name === 'IndicatorSystemAccess');
console.log(`access_model|${hasAccessModel}`);
NODE
)
