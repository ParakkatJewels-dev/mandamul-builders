# M Andamul — Development OS

*From Land to Landmark.* Resort development, construction and project-management platform for M Andamul (Parakkat Group).

This repository holds three things:

| Part | What it is | State |
|---|---|---|
| `app/` | **Production web application**: React 19 + TypeScript, built with Bun into static files for Vercel; signs in with Supabase Auth (TOTP MFA step-up) and reads and writes only through the `api` functions. Screens: command center, action center, approvals, procurement through goods receipt, site reports, contracts and contractor billing (measure → verify → claim → bill → certify), payments, cost report, warranty, feasibility. | Built. 13 unit tests and 50/50 browser checks pass against the real local database (via a local-only gateway). **Not deployed.** |
| `supabase/` | **Production database foundation** for Supabase: 20 migrations, 80 tables with row-level security, 99 permission-checked API functions, append-only audit trail, approval engine, cost engine, event-driven automation with traceable playbooks, alert center, digital-twin hierarchy, financial intelligence, contractor scoring, procurement planning, feasibility, warranty claims, retention, storage policies, scheduler. | Built. 333/333 database checks pass on Postgres 16 with a local Supabase stub, including a 20-villa synthetic lifecycle. A staging project exists (`mandamul-staging`, PostgreSQL 17) but **the schema has not been pushed to it.** |
| `app-prototype/` | **Clickable prototype** of the full application (19 screens, 16 roles) on fictional, clearly-marked demo data in the browser. It is the reference for the production screens not yet built. | Built. 95/95 browser end-to-end checks pass. Not connected to the database. |

Nothing has been deployed. Next.js, Tailwind and shadcn/ui were not used because package installs were blocked in the build environment; see `docs/ARCHITECTURE.md` (Production application) for the reasoning and the migration path. The Phase 4 report holds the gap analysis against the full specification, the eight-stage backlog, the readiness scorecard and the pilot plan.

## Repository layout

```
app/
  src/                 React + TypeScript application (lib: auth, api, money; ui: kit; screens)
  dev/gateway.ts       LOCAL ONLY: stand-in for PostgREST RPC + Supabase Auth, used by the tests; never deployed
  tests/unit/          bun test (money exactness, error wording)
  tests/e2e/app_production.py   browser run of the built app on the real database
  build.ts, vercel.json, tsconfig.json
supabase/
  migrations/          20 ordered SQL migrations (apply with `supabase db push`)
  tests/00_local_supabase_stub.sql   LOCAL ONLY: auth + storage stub for plain Postgres
  tests/10_workflows.sql             12 business workflows + security, automation, storage
  tests/20_phase3.sql                batch 1: critical security, financial and data-integrity fixes
  tests/30_operating_engine.sql      batch 2: events, playbooks, alerts, what-if
  tests/40_lifecycle.sql             20-villa synthetic resort, 15 lifecycle steps + edge cases (SYNTHETIC TEST DATA)
  tests/50_performance_retention.sql batch 7: policy rewrite, indexes, paging, retention
  tests/60_alert_precision.sql       batch 9: root-cause delay alerts, grouped budget alerts, score comparability
  tests/70_app_read_api.sql          batch 10: the read functions the production app uses
  tests/80_feasibility_warranty.sql  batch 13: feasibility model and warranty claims
  tests/90_contracts_read_api.sql    batch 14: contract, billing and payment reads (contractor sees only their own)
  tests/perf/                        synthetic volume + timing harness (scripts/perf-bench.sh)
  config.toml          Supabase CLI settings (exposes the `api` schema, MFA on, sign-up off)
app-prototype/         static prototype (index.html + scripts), deployable to Vercel as-is
tests/e2e/app_workflows.py           Playwright run of the workflows and Phase 3 screens through the prototype
tests/consistency/permissions_match.py   prototype permission matrix = database defaults
scripts/db-reset-local.sh            rebuild a local database from the migrations
scripts/db-test.sh                   database suite + backup/restore check (exit 1 on failure)
scripts/perf-bench.sh <label>        timings on synthetic volume, written to docs/perf/<label>.txt
scripts/app-e2e.sh                   production app: unit tests, build, local gateway, browser run on the real database
scripts/staging-push.sh              push to the staging Supabase project and deploy to Vercel (needs network; not yet run)
scripts/test-all.sh                  all suites
scripts/test-report.py               regenerates docs/TEST_RESULTS.md from the last runs
scripts/schema-doc.py                regenerates docs/SCHEMA.md from the migrated test database
docs/                  architecture, schema, deployment, admin guide, runbook, test results, performance
.github/workflows/ci.yml             CI definition (not yet run on GitHub)
vercel.json            static deploy of the prototype with security headers
.env.example           every environment variable the production app will need
```

## Run the tests locally

Requirements: PostgreSQL 16 (`psql`, `pg_dump`, `pg_restore`), Python 3.11+ with `playwright` and Chromium, Bun 1.4+ (and `cd app && bun install` for React and TypeScript).

```bash
export PGHOST=localhost PGPORT=5432 PGPASSWORD=postgres   # your local server
./scripts/db-test.sh                                      # migrations + 333 checks + backup/restore
./scripts/app-e2e.sh                                      # production app: 13 unit tests + 50 browser checks on the real database
python3 tests/e2e/app_workflows.py app-prototype          # prototype: 95 browser checks
./scripts/test-all.sh                                     # everything, including the permission match and type check
./scripts/perf-bench.sh mylabel                           # optional: timings on synthetic volume
```

`db-test.sh` and `perf-bench.sh` drop and recreate the databases `mandamul_test`, `mandamul_restore` and `mandamul_perf`. Never point them at a server holding real data.

## Rules the code follows

- Money is never floating point: `numeric(18,2)` in the database, whole paise (integers) in the browser.
- Every write goes through an `api.*` function that checks role permission **and** project membership; tables are read-only to users and protected by row-level security. Permissions are data (`role_permissions`), not hard-coded.
- Approving, paying, changing budgets, approving handover and changing settings need a multi-factor session (`aal2`); the list is `org_settings.mfa_actions`.
- Segregation of duties: a requester cannot approve their own request, nobody approves two steps of one chain, the person who books an invoice cannot pay it, the author of a report cannot review it.
- Every change is written to `audit_log` by trigger; the log cannot be updated or deleted.
- Automation is traceable and idempotent: every playbook step is a row in `automation_actions` with a unique key, so a retry or replay never repeats a step.
- Alerts are for decisions, not noise: one alert per condition, delays reported on the activity that drives them, budget overruns grouped per project, owners notified only when an alert is new or worse.
- Recorded figures and projections are kept apart; every projection states its assumptions.
- The AI assistant can only read through the signed-in user's own permissions. It cannot approve, pay, certify or change anything.
- Email and WhatsApp are never reported as sent unless a provider is configured and the delivery worker confirms it.
- Never put a bare `auth.uid()` in a query: leave the user filter to row-level security or write `(select auth.uid())`.
- Land, zoning and coastal (CRZ) information stays marked **Estimate** until a qualified local professional validates it.

## Documents

- `docs/ARCHITECTURE.md` — system design, data flow, security model, automation and intelligence layers
- `docs/SCHEMA.md` — every table and API function (generated from the database)
- `docs/DEPLOYMENT.md` — step-by-step Supabase + Vercel setup, scheduler, storage, backups
- `docs/ADMIN_GUIDE.md` — users, roles, permissions, MFA actions, thresholds, playbooks, scenarios, score weights, retention
- `docs/RUNBOOK.md` — daily checks, failed events and replay, alerts, restore procedure, incidents
- `docs/TEST_RESULTS.md` — the latest results of every suite, with what is and is not verified
- `docs/perf/README.md` — before/after timings on synthetic volume
