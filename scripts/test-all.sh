#!/usr/bin/env bash
# Runs every suite: database (migrations + workflows + security + Phase 3/4 batches + backup/restore),
# prototype browser run, permission match, and the PRODUCTION app (unit tests, type check, build, browser run on the real database).
set -uo pipefail
cd "$(dirname "$0")/.."
BUN=${BUN:-bun}; TSC=${TSC:-tsc}
./scripts/db-test.sh; db=$?
python3 tests/e2e/app_workflows.py app-prototype ${CHROME:-}; e2e=$?
python3 tests/consistency/permissions_match.py app-prototype ${CHROME:-}; perms=$?
(cd app && $TSC -p tsconfig.json); tc=$?
BUN=$BUN ./scripts/app-e2e.sh; app=$?
r() { [ "$1" = 0 ] && echo PASS || echo FAIL; }
echo "database: $(r $db) · prototype e2e: $(r $e2e) · permission match: $(r $perms) · app type check: $(r $tc) · production app (unit + e2e): $(r $app)"
[ $db = 0 ] && [ $e2e = 0 ] && [ $perms = 0 ] && [ $tc = 0 ] && [ $app = 0 ]
