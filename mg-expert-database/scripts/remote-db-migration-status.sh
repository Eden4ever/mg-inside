#!/usr/bin/env bash
set -euo pipefail

set -a
# shellcheck disable=SC1091
. /etc/mg-expert-database/api.env
set +a

psql_url="${DATABASE_URL%%\?schema=*}"
psql "$psql_url" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT migration_name || '|' || CASE WHEN finished_at IS NULL THEN 'incomplete' ELSE 'finished' END
FROM "_prisma_migrations"
ORDER BY started_at;

SELECT 'access_table|' || COALESCE(to_regclass('"IndicatorSystemAccess"')::text, 'missing');
SQL
