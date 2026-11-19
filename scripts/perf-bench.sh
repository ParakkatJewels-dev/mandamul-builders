#!/usr/bin/env bash
# Builds mandamul_perf from the migrations, loads synthetic volume, times the key reads. Usage: scripts/perf-bench.sh <label>
set -euo pipefail
cd "$(dirname "$0")/.."
LABEL=${1:-run}
PG="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5544} -U postgres -v ON_ERROR_STOP=1 -q"
./scripts/db-reset-local.sh mandamul_perf >/dev/null 2>&1
s=$(date +%s); $PG -d mandamul_perf -f supabase/tests/perf/load.sql; echo "load: $(( $(date +%s) - s )) s"
mkdir -p docs/perf
$PG -d mandamul_perf -f supabase/tests/perf/bench.sql | tee "docs/perf/$LABEL.txt"
