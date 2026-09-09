#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
migration_dir="${1:?migration directory required}"
stamp="$(date +%Y%m%d%H%M%S)"
test_db="mg_auth_verify_$stamp"
backup_dir="/opt/mg-expert-database/backups/auth-preflight-$stamp"
[[ "$test_db" =~ ^mg_auth_verify_[0-9]{14}$ ]]
install -d -o root -g root -m 0700 "$backup_dir"
set -a
. /etc/mg-expert-database/api.env
set +a
pg_dump --format=custom --file="$backup_dir/database.dump" "${DATABASE_URL%%\?schema=*}"
test -s "$backup_dir/database.dump"
pg_restore --list "$backup_dir/database.dump" > "$backup_dir/database-contents.txt"
test_created=0
cleanup() {
  if [[ "$test_created" == 1 && "$test_db" =~ ^mg_auth_verify_[0-9]{14}$ ]]; then
    runuser -u postgres -- dropdb --if-exists "$test_db"
  fi
}
trap cleanup EXIT
runuser -u postgres -- createdb "$test_db"
test_created=1
pg_restore --no-owner --no-acl --file=- "$backup_dir/database.dump" | runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d "$test_db"
fingerprint() {
  for table in ResearchRecord ResearchModule ResearchRevision ResearchSummaryRevision Evidence; do
    runuser -u postgres -- psql -X -At -v ON_ERROR_STOP=1 -d "$test_db" -c "SELECT '$table',count(*),md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM \"$table\" t;"
  done
}
fingerprint > "$backup_dir/records-before.txt"
for migration in 20260907006000_wecom_revocation 20260907007000_account_security 20260907008000_mail_config; do
  test -f "$migration_dir/$migration/migration.sql"
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d "$test_db" < "$migration_dir/$migration/migration.sql"
done
fingerprint > "$backup_dir/records-after.txt"
cmp "$backup_dir/records-before.txt" "$backup_dir/records-after.txt"
runuser -u postgres -- psql -X -At -v ON_ERROR_STOP=1 -d "$test_db" -c 'SELECT count(*) AS users, count(*) FILTER (WHERE "mfaEnabled") AS mfa_enabled FROM "User"; SELECT count(*) AS revoked_identities FROM "WeComIdentityRevocation"; SELECT count(*) FROM "AuthChallenge"; SELECT count(*) FROM "MailConfig";'
echo "迁移演练通过：知识记录、依据和历史修订逐表内容哈希一致。"
echo "备份保留于 $backup_dir；临时测试数据库将在退出时删除。"
