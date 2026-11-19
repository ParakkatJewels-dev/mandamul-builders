#!/usr/bin/env bash
# Rebuild the local database, run the test suite, print results, verify backup/restore. Exit 1 on any failure.
set -euo pipefail
cd "$(dirname "$0")/.."
PG="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5544} -U postgres -v ON_ERROR_STOP=1 -q"
./scripts/db-reset-local.sh mandamul_test >/dev/null; : > /tmp/mandamul-test.log
for t in supabase/tests/[0-9][0-9]_*.sql; do
  [ "$(basename "$t")" = "00_local_supabase_stub.sql" ] && continue
  $PG -d mandamul_test -f "$t" >>/tmp/mandamul-test.log 2>&1 || { echo "TEST SCRIPT ABORTED in $t:"; tail -20 /tmp/mandamul-test.log; exit 1; }
done
$PG -d mandamul_test -P footer=off -c "select workflow, count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.results group by workflow order by min(n)"
$PG -d mandamul_test -P footer=off -c "select n, workflow, name, detail from tests.results where not ok order by n"
# backup / restore: dump, restore into a fresh database, compare row counts of every business table
pg_dump -h ${PGHOST:-/tmp} -p ${PGPORT:-5544} -U postgres -Fc -f /tmp/mandamul.dump mandamul_test
$PG -d postgres -c "drop database if exists mandamul_restore" -c "create database mandamul_restore"
pg_restore -h ${PGHOST:-/tmp} -p ${PGPORT:-5544} -U postgres -d mandamul_restore /tmp/mandamul.dump
q="select string_agg(t || '=' || (xpath('/row/c/text()', query_to_xml('select count(*) c from public.' || t, false, true, '')))[1]::text, ',' order by t) from unnest(array['projects','tasks','purchase_orders','goods_receipts','vendor_invoices','payments','contracts','ra_bills','measurements','inspections','snags','audit_log','approvals']) t"
a=$($PG -d mandamul_test -At -c "$q"); b=$($PG -d mandamul_restore -At -c "$q")
if [ "$a" = "$b" ]; then r="backup/restore: PASS ($a)"; else r="backup/restore: FAIL (before: $a; after: $b)"; fi
echo "$r"; echo "$r" > tests/last-backup-check.txt; [[ "$r" == *PASS* ]] || exit 1
failed=$($PG -d mandamul_test -At -c "select count(*) from tests.results where not ok")
total=$($PG -d mandamul_test -At -c "select count(*) from tests.results")
echo "database tests: $((total - failed))/$total passed"
[ "$failed" = "0" ]
