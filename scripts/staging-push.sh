#!/usr/bin/env bash
# Push the database to the hosted STAGING project and deploy the production app to Vercel.
# Run from a machine with network access and the Supabase CLI and Vercel CLI installed. NOT YET RUN — see docs/DEPLOYMENT.md.
# Required environment:
#   SUPABASE_PROJECT_REF   staging project ref (created 19 Nov 2026: cczakfyggevocethwayi, region ap-south-1)
#   SUPABASE_DB_PASSWORD   the project's database password (Dashboard → Project settings → Database)
#   SUPABASE_URL, SUPABASE_ANON_KEY   public URL and publishable key of the staging project
#   SUPABASE_SERVICE_ROLE_KEY         server-only key, used here once to create the synthetic staging users; never shipped to the browser
#   STAGING_PASSWORD                  password given to the synthetic staging users
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_PROJECT_REF:?}" "${SUPABASE_DB_PASSWORD:?}" "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${STAGING_PASSWORD:?}"
# 1. schema: enable pg_cron first so migration 0900 / 1300 schedule the jobs; then apply every migration in order
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase db push --include-all
# 2. one synthetic organisation and users (clearly labelled), created through the Auth admin API so real sign-in and MFA are exercised
DB="postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.${SUPABASE_PROJECT_REF}.supabase.co:5432/postgres"
ORG=$(psql "$DB" -Atc "insert into organizations (name) values ('M Andamul STAGING (synthetic data)') returning id")
psql "$DB" -c "select app.bootstrap_org('$ORG')"
for spec in md:md pd:pd pm:pm site:site_sup proc:proc fin:finance qs:qs; do
  u=${spec%%:*}; role=${spec##*:}; email="staging-${u}@example.invalid"
  id=$(curl -fsS -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
       -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"$STAGING_PASSWORD\",\"email_confirm\":true}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  psql "$DB" -c "insert into profiles (user_id, org_id, full_name, email, role_id, all_projects) values ('$id', '$ORG', 'Staging $u', '$email', '$role', '$u' in ('md','pd','proc','fin','qs'))"
done
# 3. checks against the hosted project: advisors are read in the dashboard; the scheduler must list three jobs
psql "$DB" -c "select jobname, schedule from cron.job order by jobname"
# 4. production app on Vercel (project root app/), pointed at staging
(cd app && SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" APP_ENV=staging bun run build.ts && vercel deploy --prebuilt=false --yes)
echo "Now sign in as staging-pm@example.invalid, approve something to trigger the TOTP enrolment, and record the result in docs/TEST_RESULTS.md."
