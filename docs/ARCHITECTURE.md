# Architecture

## Target system

```
 Browser / phone (Next.js app, PWA)                 Vercel
 ───────────────────────────────────                ─────────────────────────────────────────
  Server components read through the user's          /api/ai        AI assistant (server-side key,
  Supabase session (RLS applies)                                    read-only tools, user's JWT)
  Forms call api.* RPCs                              /api/cron/*    fallback scheduler (CRON_SECRET)
        │                                                  │
        ▼                                                  ▼
 Supabase ─────────────────────────────────────────────────────────────────────────────────────
  Auth: email invite, TOTP MFA, no self sign-up
  PostgREST: schemas `api` (all writes, security definer) and `public` (reads under RLS)
  Postgres 16
    public.*   77 tables, RLS on every table, no INSERT/UPDATE/DELETE grants to users
    api.*      79 functions: permission check (+ aal2 for MFA actions) → validation → write → audit → event
    app.*      private helpers: can(), require(), po_steps(), next_no(), cost maths, notify
    audit_log  written by triggers on every business table; updates and deletes blocked
    automation_events  dedupe_key unique; status queued → processed | failed (backoff) → dead; replay_event
    automation_actions one row per playbook step, unique idempotency key
    alerts             one per condition (dedupe_key); Open → Acknowledged / Snoozed → Resolved
  Storage: bucket `project-files` (private, 50 MB cap, listed file types), paths <project>/<folder>/…
  pg_cron:  scan_exceptions() every 15 min · process_events() every minute · purge_expired() daily 03:17
  Edge function (to build): delivery worker for email / WhatsApp rows with delivery = 'queued'
```

## How a write works

Every user action is one RPC call, for example `api.record_grn(po, qty, qc, date, note)`:

1. `app.require(project, module, action)` — the user must belong to the project (or have all-project access) **and** their role must hold the permission in `role_permissions`. Fails with `42501`.
2. Business validation inside the same transaction — e.g. receipt cannot exceed the ordered quantity, a duplicate invoice number is refused, a payment cannot exceed the balance, a late activity needs a delay reason, the requester cannot approve their own request.
3. Optimistic locking: editable rows carry `version`; callers pass the version they read and a stale update is refused.
4. Document numbers come from `doc_counters` (`PO-26-0012`), allocated inside the transaction.
5. The audit trigger writes the before/after row, user, role and time to `audit_log`.
6. Workflow side effects run in the same transaction: approvals created with the route from `po_steps` and thresholds in `org_settings`, commitments recorded, progress moved only after verification, events queued in `automation_events`.

Reads go straight to tables through RLS (`app.can(project_id, module, 'view')`), or through reporting functions (`api.cost_position`, `api.cash_requirement`, `api.unit_readiness`, `api.po_tracking`) that apply the same checks. Commercial rows (rates, values) additionally need `budget:view`, so site teams see order status without prices.

## Financial model (no double counting)

Per project and cost code, computed in `api.cost_position`:

| Measure | Definition |
|---|---|
| Original budget | approved budget version 1 |
| Approved changes | current approved version − version 1 |
| Current budget | latest approved version |
| Committed | approved POs + active contracts + approved variations |
| Actual cost | QC-passed goods received at PO rate + certified contractor bills (gross + GST) |
| Paid | invoice payments + bill payments (cash + TDS) + advance recovered |
| Accrued unpaid | actual − paid − retention held |
| Retention held | retention deducted on certified bills, not yet released |
| Estimate to complete | QS estimate of uncommitted remaining cost |
| Forecast at completion | committed + estimate to complete |
| Variance | current budget − forecast at completion |
| Uncommitted budget | current budget − committed |
| Contingency available | contingency budget − contingency drawn − overruns on other codes |

Identities enforced by tests on every cost code: `actual = paid + accrued + retention`, `actual ≤ committed`, `forecast = committed + estimate`. Running bill: `net = gross + GST − retention − advance recovery − TDS − other deductions`, with advance recovery limited to the outstanding advance.

## Approvals

One engine (`approvals`, `approval_steps`) for budgets, revisions, POs, contracts, variations, invoices, contractor bills, daily reports, drawings and inspections. Routes are data-driven from `org_settings` thresholds (defaults: PM up to ₹5 L, PD up to ₹25 L, MD above; any budget overrun adds an MD override step). Decisions record reviewer, time and comment; `p_expected_seq` stops two people deciding the same step.

## Automation: events, playbooks, alerts

Events are queued by the API functions (approval requested, contractor claim, material shortage, safety defect, milestone, unit works complete, commitment released) and by `api.scan_exceptions()` (activity overdue, budget overrun, missing daily report, permits, slow payment approvals). `dedupe_key` is unique, so repeated scans create nothing new. `api.process_events()` hands each event to its playbook inside its own sub-transaction: a failure rolls back only that event, which retries with backoff (2, 4, 8, 16 minutes) and is parked as **dead** after 5 attempts. `api.replay_event()` requeues a failed or dead event; steps already done are skipped because each step is written through `app.step()` with a unique idempotency key.

| Playbook | Trigger | Steps (each recorded in `automation_actions`) |
|---|---|---|
| Delay | activity past its baseline finish by `min_days_late` | skip if the delay is carried in from an open late predecessor → read schedule and progress → dependent activities → milestones that depend on it (what-if forward pass) → raise/raise-severity alert → notify PM → request recovery plan → arm escalation → risk register |
| Material shortage | site reports a shortage | site stock and reservations → orders due before the need date → affected activities → quantity to buy → route to procurement (PO approval route applies) → track until delivered |
| Contractor claim | contractor submits a claim | match to contract → match quantities to verified measurements → contract rates and approved variations → GST, retention, advance recovery, TDS → flag discrepancies for the QS → prepare the running bill for certification → payment request only after certification |
| Unit completion | every stage passed | stage inspections → defects → FF&E → commissioning certificates → request the final inspection, or raise a blockers alert that re-checks when a blocker clears; the unit becomes Ready only when the inspector passes it |

Rules (`automation_rules`) switch playbooks on and off and carry their parameters (`params`), e.g. tolerance days and the slip that makes a delay critical.

**Alert precision (batch 9).** `alerts.dedupe_key` holds one alert per condition. Severity only rises while an alert is open; owners are notified when it is new or worse, never on a repeat scan. A delay is alerted once, on the activity that drives it; when that activity finishes, its overdue successors are re-checked at once. Budget overruns are one alert per project listing the codes, resolved automatically when every code is back within the threshold. Unacknowledged Critical alerts escalate once to the role in the `alert_escalation` rule after `Critical_hours` (default 4); High after `High_hours` (24).

## Digital twin

Property → Zone → Building → Floor → Unit (room or villa) → Work package → Task, in `zones`, `buildings`, `floors`, `units`, `work_packages` and `tasks`, built from live records. `api.twin(project)` returns the tree with, per node: status, verified completion (stages passed by inspection, not reported progress), contractors, planned and forecast dates, current budget, committed, actual, forecast remaining, open defects, inspections, photos, design references and handover state. Cost fields are left out for users without `budget:view`. There is no 3D view: a model can be linked when model files and a viewer exist.

## Financial intelligence

`api.financial_intelligence(project)` returns two separate blocks. **Recorded** (from approved documents): baseline, approved changes, current budget, commitments, actuals, paid, accrued, retention, approved variations, contingency available. **Projected** (estimates, each with its basis): estimate to complete, forecast final cost, variance, pending-variation exposure, delay cost per day, cost per sq ft / per key / per villa, cash flow, and best / base / worst scenarios from `forecast_scenarios` (remaining-work factor, share of pending variations approved, extra delay days — editable per organisation). It also returns contractor cost performance, procurement price variance against the reference rate, and profitability where a contract value exists. Financial exceptions (contingency exhausted, variation exposure above 10 % of contract value, a PO rate more than 10 % above the reference) are raised by `app.scan_finance`.

## Contractor performance

`api.contractor_scores(project)` computes on-time finish, productivity, rework, defects per ₹1 crore certified, safety, variations, claim accuracy, response to defects and material wastage, each with its formula, sample size and minimum sample (`contractor_score_weights`). The score is the weighted average of the components that have enough data. A contractor is **comparable** only when at least four components carrying at least 60 % of the weight are measured; otherwise the components are shown and the score is not ranked against others.

## Procurement intelligence

Material catalogue, `vendor_prices` with validity dates and lead times, price history, `reference_rate`, reservations, stock position, pending orders and delivery delays. `api.procurement_plan(days)` groups open demand across projects, computes order-by dates from lead times and advises consolidation only when the earliest need still allows the lead time. `api.draft_rfq` creates a draft request for quotation; `api.vendor_comparison` compares quotes. Nothing is ordered automatically: every purchase still goes through quotation and the PO approval route.

## Performance and retention

Row-level security policies call `(select app.has_perm(...))` and `project_id in (select app.visible_projects())`, so the checks run once per query rather than once per row; every foreign key is indexed; long lists use keyset paging (`api.list_purchase_orders`, `api.alert_feed`, `api.audit_page`). Timings before and after are in `docs/perf/README.md`. `retention_policies` (minimum 90 days) drive `api.purge_expired()`, which removes only read notifications, processed events, old playbook steps and resolved alerts — never business records, approvals, payments or the audit log.

## AI assistant

Server route only. The model gets read-only tools that call the reporting functions with the **user's** session token, so it sees exactly what the user may see. Every answer names its sources (record numbers) and separates recorded figures from projections, stating the assumptions. The seven management questions (attention today, reasons for delay, what to buy this week, funding to finish the villas, defects by contractor, what if a contractor is delayed, executive summary) have tools behind them: action center, schedule what-if, purchase plan, contractor scores, scenarios. There are no write tools: it may draft text (an RFQ note, a recovery-plan request) for a person to submit, but it cannot approve, pay, certify, change budgets or modify records. If the model is unavailable the screen says so and offers the built-in data answers.

## Executive reports

Daily, weekly and monthly reports are generated from the records at that moment, saved as a draft, reviewed by the MD or PD (not by the person who generated it), and only then distributed. Distribution is in-app; email and WhatsApp stay "not configured" until providers are connected. Export to Excel and PDF (print).

## Production application (`app/`)

React 19 + TypeScript, bundled by Bun into static files (`dist/`) for Vercel. It talks to Supabase only through two public interfaces, with the user's own session:

- **Auth (GoTrue):** password sign-in, token refresh, and TOTP multi-factor (enrol, challenge, verify). Verifying a code raises the session to `aal2`; the database then accepts the actions in `org_settings.mfa_actions`. When the database answers "multi-factor sign-in required", the app asks for the code and retries the same action once.
- **Data (PostgREST RPC):** every read and write is `POST /rest/v1/rpc/<function>` on the `api` schema (`Content-Profile: api`). No table is read or written directly, so every screen goes through the same permission checks, project visibility and price hiding as the rest of the platform. The read functions added for the app are `session_info`, `portfolio_summary`, `my_approvals`, `mr_list`, `vendor_list`, `po_detail`, `daily_report_list`, `task_list`, `cost_code_list`, `contract_list`, `contract_detail`, `payment_queue`, `feasibility`, `feasibility_list` and `warranty_register`.

Money arrives as PostgreSQL `numeric` and is converted to whole paise in a `BigInt` before any sum or comparison (`src/lib/money.ts`); amounts people type are validated and sent as exact decimal strings. Screens: command center, action center, approvals, procurement (request → quotations → order → receipt), site reports, contracts and contractor billing (measurement → verification → claim → automatic assessment → running bill → certification), payments, cost report, warranty, feasibility. Contractors (role `vendor`) sign in to their own contracts only and can claim against verified, unbilled quantities; site staff record measurements and see no money. Menus show only the screens a role allows; the database refuses the rest even when called directly. Daily-report drafts stay on the device until submitted; the database refuses a second report for the same site and day.

**Why not Next.js, Tailwind and shadcn/ui as the specification recommends:** package installs were blocked in the build environment, so only what was already installed could be used (React, TypeScript, Bun). The application needs no server rendering — the database holds every rule — so a static React build on Vercel is a sound production shape. Moving to Next.js later is a packaging change; `src/lib` and the screens carry over. `src/types/react-shim.d.ts` stands in for `@types/react` and should be replaced by the official types once packages can be installed.

**Local testing:** `app/dev/gateway.ts` is a LOCAL-ONLY stand-in for the PostgREST RPC endpoint and the Auth endpoints the app uses, so the real app can run against the real local database. It sets the same JWT claims and database role as PostgREST. It is never deployed.

## Feasibility and warranty (batch 13)

`feasibility_studies` hold a proposed property's land, keys, built-up area, costs, ADR, occupancy and operating ratios. `app.feasibility_model` is the single formula set: investment (land + construction + infrastructure + FF&E + contingency + pre-opening), stabilised rooms and total revenue, operating cost, EBITDA, ROI and simple payback, plus the three `feasibility_scenarios` and a payback sensitivity on ADR, occupancy and cost. Regulatory figures stay *Estimate — not validated* until the MD or PD records who validated them. `warranty_claims` record whether an item is still in warranty, a response deadline from the warranty's `response_hours`, the response, and a resolution that needs an evidence document of the same project.

## Prototype ↔ production mapping

The prototype (`app-prototype/`) implements the same rules in the browser so the workflows can be tried end to end: `core.js` (permissions, approvals, audit, money helpers), `engine.js` (cost, contingency, cash, billing, readiness, automation), `views-*.js` (screens). Its state lives in the browser (`localStorage`) and is fictional demo data. Each screen maps to the API functions listed in `docs/SCHEMA.md`; the production app replaces the in-browser engine with those calls.

## Not built yet

- Production screens for BOQ, schedule and Gantt, quality, handover, documents, settings and reports; the prototype is their reference.
- Hosted deployment: the staging Supabase project exists but the schema is not pushed; nothing is on Vercel.
- Delivery worker for email / WhatsApp, and the provider accounts.
- Offline capture for site phones: the prototype keeps drafts on the device and compresses photos before upload; the production PWA with a queued-submission service worker is not built (server-side duplicate checks are in place).
- Stock screens in the prototype (the database has the ledger: reservations, issues, stock position), land feasibility calculator, accounting / bank integration, 3D / BIM.
