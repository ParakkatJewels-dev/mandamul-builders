# Deployment

Status (19 Nov 2026): a STAGING Supabase project was created with your approval — `mandamul-staging`, ref `cczakfyggevocethwayi`, Mumbai, PostgreSQL 17.12 — but the schema has **not** been pushed to it and nothing is deployed to Vercel. The build environment could not reach Supabase or install the Supabase CLI, and a check of the hosted-specific statements stopped waiting for a confirmation. `scripts/staging-push.sh` performs the steps below from a machine with network access; it has not been run. Everything else here was verified only on PostgreSQL 16 locally. The migrations and tests have been verified on plain PostgreSQL 16 with a local stub of Supabase's `auth` and `storage` schemas (`supabase/tests/00_local_supabase_stub.sql`). Expect to confirm each step below the first time it is done for real, and record the result in `docs/TEST_RESULTS.md`.

## 1. Supabase project

1. Create a project in the Mumbai region (`ap-south-1`) on a paid plan (daily backups; add point-in-time recovery for production).
2. Install the Supabase CLI locally, then:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push          # applies supabase/migrations/* in order
   ```
   Never run anything in `supabase/tests/` against the hosted project — the stub would clash with Supabase's own `auth` and `storage` schemas and the test suite creates fixture organisations.
3. Run the database advisors (Dashboard → Advisors, or the Supabase MCP `get_advisors`) and resolve any security warnings before inviting users.

## 2. API exposure

In the project's Data API settings, set **Exposed schemas** to `api, public` (same as `supabase/config.toml`). Users write only through `api.*` RPCs; `public` tables are read-only under RLS. Do not expose `app` (private helpers).

## 3. Authentication

- Turn **off** public sign-ups; users are invited by an administrator.
- Enable **TOTP multi-factor** and enrol Super Admin, MD, PD and Finance. The database refuses the actions listed in `org_settings.mfa_actions` (approving POs, contracts, budgets and handover, creating or editing payments, changing settings) unless the session's JWT carries `aal: aal2`, so the app must run the TOTP challenge before those screens. Verified locally with simulated JWT claims only; confirm on the hosted project that Supabase issues `aal2` after the challenge.
- Set the Site URL to the production domain and add the Vercel preview pattern to redirect URLs.
- Configure custom SMTP for invitation and reset emails (Supabase's built-in sender is rate-limited).

## 4. First organisation and administrator

Run once in the SQL editor (as `postgres`):

```sql
insert into organizations (name) values ('M Andamul') returning id;          -- note the id
select app.bootstrap_org('<org-id>');                                        -- roles, permissions, cost codes, templates, rules, channels (disabled)
-- invite the first administrator from Authentication → Users, then:
insert into profiles (user_id, org_id, full_name, email, role_id, all_projects)
select id, '<org-id>', 'Your Name', email, 'super_admin', true from auth.users where email = 'you@company.com';
```

Everything after that (users, roles, thresholds, rules) is managed in the app's Settings screens through the `api` functions. No demo data is loaded into a real database.

## 5. File storage

Migration `0900` creates the private bucket `project-files` (50 MB cap, listed file types) and two policies on `storage.objects`: read for anyone who may view the project's documents; upload for document creators, plus site and quality users into `<project>/site/` only. There is no update or delete policy — a new revision is a new file.

If `supabase db push` reports that it may not create policies on `storage.objects`, create the same two policies from Dashboard → Storage → Policies using the expressions in the migration. The app must serve files only through **signed URLs** (60–300 seconds), never public URLs, and must reject files whose type is not in `org_settings.allowed_mime` before upload (the database enforces the size limit again when the version is registered).

## 6. Scheduler

Preferred: **pg_cron**. Enable the extension (Database → Extensions → `pg_cron`) **before** `supabase db push`, and migration `0900` schedules:

| Job | Schedule | Command |
|---|---|---|
| `mandamul-scan-exceptions` | every 15 minutes | `select api.scan_exceptions()` |
| `mandamul-process-events` | every minute | `select api.process_events(200)` |
| `mandamul-purge-expired` | daily 03:17 | `select api.purge_expired()` (migration `1300`; removes only read notifications, processed events, old playbook steps and resolved alerts past `retention_policies`) |

If pg_cron was enabled after the push, run the three `cron.schedule(...)` statements from migrations `0900` and `1300` by hand. pg_cron was not available on the build machine, so these schedules have not been exercised. Check with `select * from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 20;`.

Fallback: Vercel Cron calling `/api/cron/scan`, `/api/cron/process` and `/api/cron/purge` (to be written in the Next.js app), authenticated with `CRON_SECRET`, calling the functions with the service-role key. They are revoked from ordinary users.

## 7. Notifications (email, WhatsApp)

Channels start disabled (`channel_config.enabled = false`), so every external notification is stored as `not_configured`. To go live:

1. Create the provider accounts (e.g. Resend or Amazon SES for email; Meta WhatsApp Business Cloud API with approved templates).
2. Put the keys in Supabase Edge Function secrets (and `.env` for local work) — see `.env.example`.
3. Build and deploy the delivery worker (Edge Function, scheduled every minute): read `notifications` where `delivery = 'queued'`, send, then set `delivery = 'delivered'` with the provider message id, or `failed` with the error. Not built yet.
4. Enable the channel in Settings → Automation.

## 7a. Production application on Vercel

Create a Vercel project with root directory `app/` (`app/vercel.json` sets `bun install`, `bun run build.ts`, output `dist`, SPA rewrites and a strict Content-Security-Policy that allows only `https://*.supabase.co`). Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key) and `APP_ENV` (`staging` or `production`) for each environment; the build writes them to `env.json`. The service-role key is never given to the app. In Supabase, add the Vercel URLs to Auth → URL configuration, keep **Exposed schemas** = `api, public`, and enable TOTP MFA.

## 8. Vercel

- **Prototype (now):** import the repository; `vercel.json` publishes `app-prototype/` as a static site with a strict Content-Security-Policy. It runs entirely in the browser on fictional demo data and does not connect to Supabase.
- **Production app (when built):** Next.js App Router project; set the variables from `.env.example` for Production and Preview (service-role key and provider keys as server-only). Use a separate Supabase project (or branch) for Preview deployments so test data never reaches production.

## 9. Backups and restore

- Supabase daily backups (paid plan) plus point-in-time recovery for production.
- Weekly logical export kept outside Supabase: `pg_dump -Fc --no-owner "$DATABASE_URL" > mandamul-$(date +%F).dump`, stored encrypted.
- Restore drill every quarter into a scratch project: `pg_restore --no-owner -d "$SCRATCH_URL" file.dump`, then compare row counts of the business tables (the same comparison `scripts/db-test.sh` performs locally — it currently passes).

## 10. CI

`.github/workflows/ci.yml` runs the database suite on a Postgres 16 service container and the browser suite with Playwright's Chromium on every push and pull request. It has not been run on GitHub yet; check the first run.
