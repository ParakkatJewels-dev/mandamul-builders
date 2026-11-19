# Administrator guide

For the Super Admin and IT. Screens named here are in the prototype today and map to the `api` functions in the production design.

## Users and access

- **Add a user:** invite the email from Supabase Auth, then create the profile (Settings → Users): name, role, and either *all projects* (MD, PD, Finance, Super Admin) or membership of specific projects. A user sees nothing of a project they are not a member of.
- **Leaver:** set the profile inactive the same day. Inactive users lose every permission immediately (all checks read `profiles.active`); their history stays in the audit log. Do not delete auth users who have signed anything.
- **MFA:** required for Super Admin, MD, PD and Finance. The actions in `org_settings.mfa_actions` are refused without a multi-factor session — default: `procurement:approve, contracts:approve, budget:approve, payments:approve, payments:create, payments:edit, handover:approve, settings:create, settings:edit`. Change the list with `api.set_org_settings` (Settings → Rules). Reset a lost device from Supabase Auth only after confirming the person by phone.
- **Two people per sensitive role:** keep at least two Finance users — the person who books an invoice cannot pay it.

## Roles and permissions

16 roles are created by `app.bootstrap_org`: Super Admin, Managing Director, Project Director, Project Manager, Architect, Interior Designer, Civil Engineer, Site Supervisor, Quantity Surveyor, Procurement Manager, Finance Manager, Store Manager, HR / Labour Manager, Quality Engineer, Contractor / Vendor, Client / Investor.

Permissions are rows in `role_permissions` — *(role, module, action)* — edited in Settings → Roles. Modules: dashboard, projects, schedule, site, boq, budget, procurement, contracts, payments, quality, handover, documents, approvals, settings, audit. Actions: view, create, edit, approve, export. Modules marked sensitive (budget, contracts, payments) hide money from anyone without `budget:view`, so site teams see order status but not prices.

Changes take effect on the next request and are written to the audit log with who changed what. Review the matrix every quarter; remove rights nobody uses.

The starting matrix for every new organisation is `permission_defaults` (277 grants), applied by `app.bootstrap_org`; a test checks it matches the prototype exactly. Administration goes through these functions (all audited; all need `settings:edit` and a multi-factor session, except project membership, which needs `projects:edit` on that project):

| Function | Use | Guard |
|---|---|---|
| `api.set_permission(role, module, action, granted)` | grant or remove one right | refuses to remove the last route to `settings:edit` (no lock-out) |
| `api.set_user_access(user, role, all_projects, active, expected_version)` | change role, project scope, deactivate | version check against concurrent edits |
| `api.set_project_member(project, user, responsibility, member)` | add or remove a project member | — |
| `api.set_org_settings(json, expected_version)` | thresholds, cut-off, uploads, `mfa_actions` | version check |
| `api.set_automation_rule(rule, json)` | enable/disable, channels, escalation, `params` | — |

## Approval thresholds

Settings → Rules (`org_settings`):

| Setting | Default | Effect |
|---|---|---|
| PM limit | ₹5,00,000 | POs, contracts, invoices and contractor bills above this add a Project Director step |
| PD limit | ₹25,00,000 | above this add a Managing Director step |
| Warn at | 90 % committed | cost code shown amber |
| Flag at | 100 % forecast | cost code shown red, `budget_overrun` event |
| Daily report cut-off | 19:00 | after this, a missing report raises `missing_report` |
| Max upload | 25 MB (1–50) | per file; the storage bucket hard cap is 50 MB |
| Allowed file types | PDF, images, Excel, Word, CSV, DWG | uploads of other types are refused |
| Invoice / bill due | 30 / 15 days | due dates for the cash requirement and overdue lists |

Any purchase that takes a cost code over its budget always adds an MD budget-override step, whatever the amount. Budgets and budget revisions always go Finance → MD.

## Automation rules

Settings → Automation lists each event, who is told, by which channels, whether it opens a risk, and when it escalates:

| Event | Notified | Channels | Risk | Escalates |
|---|---|---|---|---|
| Approval waiting | the approver | in-app | — | MD after 48 h |
| Budget overrun | PM, Finance | in-app, email | yes | MD after 48 h |
| Contractor bill submitted | QS, Finance | in-app | — | — |
| Activity overdue (delay playbook) | PM (owner of the alert) | in-app | yes | Critical alerts: MD after 4 h if not acknowledged |
| Drawing revision approved | PM, QS, Procurement, Site | in-app | — | — |
| Material shortage | Procurement, PM | in-app, WhatsApp | — | — |
| Critical milestone completed | MD, PD | in-app, email | — | — |
| Missing daily report | Site, PM | in-app, WhatsApp | — | PD after 24 h |
| Safety-critical defect | PD, Quality, PM | in-app, WhatsApp, email | yes | MD after 4 h |
| Unit ready for handover | PD, Quality | in-app | — | — |

Email and WhatsApp show **not configured** until a provider is connected (see `docs/DEPLOYMENT.md` §7). The Automation tab also shows the event log, failed events and their next retry, and dead events.

### Playbook parameters (`automation_rules.params`)

| Rule | Parameter | Default | Meaning |
|---|---|---|---|
| `activity_overdue` | `min_days_late` | 2 | days past the baseline finish before the delay playbook acts |
| | `critical_slip_days` | 7 | milestone slip that makes the delay Critical |
| | `recovery_plan_days` | 2 | days the PM has to submit a recovery plan |
| `alert_escalation` | `Critical_hours` / `High_hours` | 4 / 24 | unacknowledged alerts escalate once to the rule's escalation role (MD) |
| `contractor_claim` | `qty_tolerance_pct` | 0 | claimed quantity above verified measurement that is held for the QS |
| `material_shortage` | `auto_submit` | true | the computed quantity becomes a submitted material request for procurement (false: a draft request); never an order |

Example: `select api.set_automation_rule('activity_overdue', '{"params": {"min_days_late": 3}}');`. Turning a rule off (`{"enabled": false}`) stops its playbook: events still queue and are marked processed without running any step, and turning it back on applies to new events only — events processed while it was off are not re-run (replay them with `api.replay_event` only if they failed).

### Forecast scenarios

`forecast_scenarios` holds Best, Base and Worst per organisation: a factor on the remaining estimate (0.95 / 1.00 / 1.15), the share of pending variations assumed approved (50 / 75 / 100 %) and extra delay days (−15 / 0 / +30), each with its wording. Finance and the MD should agree these once a year; reports always print the assumptions next to the figures.

### Contractor score weights

`contractor_score_weights` lists each component with its weight, minimum sample and formula: on-time finish 25, productivity 15, rework 15, defects 15, safety 10, claim accuracy 10, variations 5, response to defects 5, material wastage 0 (not measured until consumption norms exist). Weights are percentages of the score; a contractor is ranked as comparable only when four or more components carrying 60 % of the weight have enough data.

### Feasibility scenarios and regulatory validation

`feasibility_scenarios` hold Optimistic (ADR +10%, occupancy +5 points, cost −5%), Base case and Conservative (ADR −10%, occupancy −10 points, cost +10%) per organisation. Only the MD, PD or Super Admin can record that a qualified professional validated a study's regulatory assumptions (`api.validate_feasibility_regulatory`, which names the professional and registration); until then the study says *Estimate — not validated*.

### Warranty response times

Each warranty carries a type (equipment, contractor workmanship, defect liability period) and `response_hours` (default 48). A claim's response deadline is set from it when the claim is raised; the register shows overdue responses and the average response time. Claims are raised by roles with handover create rights and answered or closed by roles with handover edit rights; closing needs an evidence document of the same project.

### Retention

`retention_policies` (minimum 90 days): read notifications 180 days, processed events 400, playbook steps 730, resolved alerts 730. `api.purge_expired()` runs nightly and never touches business records, approvals, payments or the audit log, which are kept for the statutory period and archived, not deleted.

## Projects and master data

- New projects come from Projects → New project: property, land (kept as *Estimate* until validated by a qualified local professional), keys and unit type, amenities, budget with contingency, plan template, team. This creates the units with readiness stages, the baseline schedule, document folders, the handover checklist and the budget approval.
- Cost codes, readiness stage templates and plan templates are organisation data; change them before projects start, not during.
- Vendors: Procurement → Vendors. Keep the GSTIN (validated as 15 characters), approval status and credit days current. Bank account details are not stored in this system; payments record the bank transaction reference only.

## Audit log

Audit log screen (needs `audit:view`): filter by user, project, action and date; export to CSV. Entries cannot be edited or deleted by any user, including the Super Admin (a trigger blocks it).

## Demo data

The prototype's data is fictional and clearly labelled "Demo environment"; *Reset demo* restores it. It must never be loaded into the production database.
