#!/usr/bin/env bash
# Production app end-to-end run on the real local database:
# build the app, copy the migrated + seeded test database (run scripts/db-test.sh first) to mandamul_app,
# start the LOCAL-ONLY gateway (PostgREST RPC + Auth stand-in), run the browser tests, stop the gateway.
set -euo pipefail
cd "$(dirname "$0")/.."
BUN=${BUN:-bun}; PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5544} -U postgres -q"
(cd app && $BUN test tests/unit && $BUN run build.ts)
stop_gateway() { [ -f /tmp/gateway.pid ] && kill "$(cat /tmp/gateway.pid)" 2>/dev/null; pkill -f 'bun run dev/gateway.ts'; sleep 0.5; }
stop_gateway || true
$PSQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'mandamul_app'" >/dev/null
$PSQL -d postgres -c "drop database if exists mandamul_app" -c "create database mandamul_app template mandamul_test"
(cd app && PGDATABASE=mandamul_app setsid nohup $BUN run dev/gateway.ts > /tmp/gateway.log 2>&1 < /dev/null & echo $! > /tmp/gateway.pid)
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8790/env.json && break; sleep 0.3; done
set +e; python3 app/tests/e2e/app_production.py ${CHROME:-}; rc=$?; set -e
stop_gateway || true
exit $rc
