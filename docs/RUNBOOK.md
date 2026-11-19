# Operations runbook

## Daily (5 minutes)

```sql
-- events that need a person
select id, event, project_id, attempts, last_error, created_at from automation_events where status in ('failed','dead') order by id desc limit 50;
-- scheduler ran in the last hour
select jobname, status, start_time, return_message from cron.job_run_details d join cron.job j using (jobid) where start_time > now() - interval '1 hour' order by start_time desc;
-- external messages waiting on a provider
select channel, delivery, count(*) from notifications where created_at > now() - interval '1 day' group by 1, 2;
-- critical and high alerts nobody has acknowledged, oldest first
select id, project_id, severity, category, title, created_at, escalated_at from alerts where status = 'Open' and severity in ('Critical','High') order by created_at limit 30;
-- the nightly purge ran
select jobname, status, start_time from cron.job_run_details d join cron.job j using (jobid) where jobname = 'mandamul-purge-expired' order by start_time desc limit 3;
```

Also look at Supabase logs (API 5xx, auth failures) and the advisors.

## A dead event

1. Read `last_error`. Typical causes: the project was deleted or archived, a rule names a role that no longer exists, a provider key expired.
2. Fix the cause (rule, role, key).
3. Replay: `select api.replay_event(<id>);` (needs `settings:edit`) — it requeues a failed or dead event and the next run processes it. Steps that already ran are skipped because each step has an idempotency key in `automation_actions`; the `dedupe_key` stays, so the event cannot be duplicated.
4. Read what the playbook did: `select step, action, status, result from automation_actions where event_id = <id> order by step;`

## Alerts

- An alert names its owner (a person or a role), urgency, records and next action. The owner acknowledges it (`api.ack_alert`), snoozes it with a reason (`api.snooze_alert`), or resolves it with a note (`api.resolve_alert`); conditions that clear (activity finished, defect closed, approval decided, codes back within budget) resolve it automatically.
- Escalation: an unacknowledged Critical alert notifies the MD once after 4 hours (High after 24). If escalations are arriving for alerts that are being handled, the owner is not acknowledging in the app — follow up with the person, do not raise the threshold.
- Too many alerts is a defect, not a setting to live with: check which `category` dominates (`select category, severity, count(*) from alerts where status = 'Open' group by 1, 2 order by 3 desc;`) and adjust the rule's `params`, or report it.

## Approvals stuck

`select a.id, a.kind, a.ref, s.seq, s.role_id, a.requested_at from approvals a join approval_steps s on s.approval_id = a.id and s.status = 'Pending' where a.status = 'Pending' order by a.requested_at;`
If the approver has left, assign another user to that role on the project; approvals route by role, so nothing needs editing. Never change approval rows by hand — decisions must come from the person through the app.

## Data corrections

There is no direct editing of business tables. Corrections are made through the app (cancel and re-raise, reject and resubmit, credit note) so the audit trail explains them. If a database-level fix is ever unavoidable, run it as `postgres` in a transaction, with a written reason, and attach the reason to the ticket; the audit trigger still records the before and after rows.

## Restore

1. Decide the point in time (PITR) or the dump to use.
2. Restore into a **new** project first, never over production.
3. Check row counts of the business tables against the last known numbers, open three recent POs, bills and payments and compare with the source documents.
4. Switch the app's environment variables to the restored project, or restore over production only after sign-off from the MD and Finance.

## Incidents

- **Suspected account compromise:** set the profile inactive, revoke sessions in Supabase Auth, review that user's audit entries for the period, reset MFA.
- **Wrong payment recorded:** record the reversal through Finance, with the bank reference; do not delete.
- **Data exposure concern:** confirm with the advisors that RLS is on for every table (`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;` must return nothing).

## Production application

- The browser holds only the public project URL and publishable key (`env.json`). If a user reports "This action needs your authenticator code" repeatedly, check that Supabase Auth has TOTP MFA enabled and that their factor is verified (Authentication → Users → the user → MFA factors).
- "Your role does not have the … right" comes from the database: fix the role's permissions in Settings, not in the app.
- To reproduce a problem locally: `scripts/db-test.sh`, then `scripts/app-e2e.sh`; the local gateway (`app/dev/gateway.ts`) is for this only and must never be deployed.

## Releasing a change

1. Write a new migration (never edit an applied one).
2. `./scripts/test-all.sh` locally; CI must pass.
3. Apply to a staging project or branch, try the affected workflow in the app.
4. `supabase db push` to production during a quiet hour; regenerate `docs/SCHEMA.md` with `scripts/schema-doc.py` and `docs/TEST_RESULTS.md` with `scripts/test-report.py`.
