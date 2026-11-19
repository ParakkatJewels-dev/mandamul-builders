#!/usr/bin/env bash
# Recreate the local test database and apply the stub + all migrations in order.
set -euo pipefail
PG="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5544} -U postgres -v ON_ERROR_STOP=1 -q"
DB=${1:-mandamul_test}
$PG -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PG -d $DB -f "$(dirname "$0")/../supabase/tests/00_local_supabase_stub.sql"
for f in "$(dirname "$0")"/../supabase/migrations/*.sql; do $PG -d $DB -f "$f"; done
echo "applied $(ls "$(dirname "$0")"/../supabase/migrations/*.sql | wc -l) migrations to $DB"
