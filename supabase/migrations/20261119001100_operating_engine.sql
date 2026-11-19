-- M Andamul Development OS · 1100 Phase 3, batch 2: automated project operating engine
-- Verified business events run playbooks. Every step is written to automation_actions with an idempotency key, so a retried
-- event never repeats a step; every threshold is a rule parameter; failures retry with back-off (process_events) and park as dead.
-- Playbooks: activity overdue (delay impact) · material shortage · contractor claim · unit works complete · approved bill or invoice.
-- Automation prepares, routes and reminds. It never approves, pays, certifies or changes a budget.

-- ---------- materials, stock ledger, reservations (needed by the shortage playbook) ----------
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  code text not null, name text not null, uom text not null, category text not null default 'General',
  cost_code text, lead_days integer not null default 7 check (lead_days between 0 and 365),
  active boolean not null default true, unique (org_id, code)
);
alter table public.purchase_orders add column if not exists material_id uuid references public.materials(id);
alter table public.material_requests add column if not exists material_id uuid references public.materials(id),
  add column if not exists origin text not null default 'manual' check (origin in ('manual','automation'));
alter table public.material_requests drop constraint material_requests_status_check,
  add constraint material_requests_status_check check (status in ('Draft','Submitted','Quoting','Quotes received','PO raised','Cancelled'));

create table public.stock_moves (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id),
  project_id text not null references public.projects(id),
  material_id uuid not null references public.materials(id),
  kind text not null check (kind in ('receipt','issue','transfer_in','transfer_out','return','adjustment_in','adjustment_out')),
  qty numeric(16,3) not null check (qty > 0),
  ref_kind text, ref_id text, task_id uuid references public.tasks(id),
  moved_on date not null default current_date, by_user uuid, note text, created_at timestamptz not null default now()
);
create index stock_moves_balance on public.stock_moves (project_id, material_id);
create unique index stock_moves_one_per_grn on public.stock_moves (ref_kind, ref_id) where ref_kind = 'grn';
create table public.material_reservations (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  material_id uuid not null references public.materials(id),
  task_id uuid references public.tasks(id), qty numeric(16,3) not null check (qty > 0), needed_by date not null,
  status text not null default 'Active' check (status in ('Active','Issued','Released')),
  created_by uuid, created_at timestamptz not null default now()
);
create index material_reservations_open on public.material_reservations (project_id, material_id) where status = 'Active';

create or replace function app.stock_on_hand(p_project text, p_material uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when kind in ('receipt','transfer_in','return','adjustment_in') then qty else -qty end), 0) from stock_moves where project_id = p_project and material_id = p_material
$$;
-- a QC-passed receipt of a catalogued material enters site stock automatically (no second entry)
create or replace function app.grn_to_stock() returns trigger language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders;
begin
  if new.qc <> 'Pass' then return new; end if;
  select * into po from purchase_orders where id = new.po_id;
  if po.material_id is null then return new; end if;
  insert into stock_moves (org_id, project_id, material_id, kind, qty, ref_kind, ref_id, moved_on, by_user, note)
  values (po.org_id, po.project_id, po.material_id, 'receipt', new.qty, 'grn', new.id, new.received_on, new.received_by, 'From ' || po.id) on conflict do nothing;
  return new;
end $$;
create trigger grn_to_stock after insert on public.goods_receipts for each row execute function app.grn_to_stock();

-- ---------- shortages, contractor claims, payment requests ----------
create table public.material_shortages (
  id text primary key, org_id uuid not null references public.organizations(id), project_id text not null references public.projects(id),
  material_id uuid not null references public.materials(id), qty numeric(16,3) not null check (qty > 0), needed_by date not null,
  task_id uuid references public.tasks(id), note text, reported_by uuid not null, reported_at timestamptz not null default now(),
  status text not null default 'Open' check (status in ('Open','Covered','Ordered','Delivered','Closed')),
  assessment jsonb, mr_id text references public.material_requests(id)
);
create index material_shortages_project on public.material_shortages (project_id, status);

alter table public.profiles add column if not exists vendor_id uuid references public.vendors(id);   -- contractor portal users
create table public.contractor_claims (
  id text primary key, org_id uuid not null references public.organizations(id), project_id text not null references public.projects(id),
  contract_id text not null references public.contracts(id), claim_no integer not null, submitted_by uuid not null, submitted_at timestamptz not null default now(),
  note text, status text not null default 'Submitted' check (status in ('Submitted','Discrepancies','Matched','Billed','Rejected','Withdrawn')),
  claimed_gross numeric(18,2) not null default 0, assessment jsonb, ra_bill_id text references public.ra_bills(id),
  unique (contract_id, claim_no)
);
create table public.claim_lines (
  claim_id text not null references public.contractor_claims(id) on delete cascade, line_no integer not null,
  contract_item_id uuid references public.contract_items(id), description text not null,
  claimed_qty numeric(16,3) not null check (claimed_qty > 0), claimed_rate numeric(18,2) not null check (claimed_rate >= 0),
  primary key (claim_id, line_no)
);
create table public.payment_requests (
  id text primary key, org_id uuid not null references public.organizations(id), project_id text not null references public.projects(id),
  kind text not null check (kind in ('ra_bill','invoice')), ref text not null, vendor_id uuid not null references public.vendors(id),
  amount numeric(18,2) not null check (amount >= 0), due_date date, status text not null default 'Ready' check (status in ('Ready','Paid','Cancelled')),
  prepared_at timestamptz not null default now(), unique (kind, ref)
);

-- ---------- management alerts (one per condition; notified on creation or escalation only) ----------
create table public.alerts (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id), project_id text references public.projects(id),
  category text not null check (category in ('Budget','Schedule','Material','Quality','Contractor','Payment','Safety','Permit','Handover')),
  severity text not null check (severity in ('Critical','High','Medium','Info')),
  module text not null references public.app_modules(id),
  title text not null, detail text, owner_id uuid references public.profiles(user_id), owner_role text,
  due_at timestamptz, records jsonb not null default '[]', next_action text not null,
  dedupe_key text not null, status text not null default 'Open' check (status in ('Open','Acknowledged','Resolved','Suppressed')),
  suppressed_until timestamptz, source_event bigint, notified_severity text,
  acknowledged_by uuid, acknowledged_at timestamptz, resolved_by uuid, resolved_at timestamptz, resolution text, escalated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index alerts_open on public.alerts (org_id, status, severity) where status in ('Open','Acknowledged');
create index alerts_owner on public.alerts (owner_id) where status in ('Open','Acknowledged');
create index alerts_project on public.alerts (project_id);

create or replace function app.sev_rank(p text) returns integer language sql immutable as $$ select case p when 'Critical' then 4 when 'High' then 3 when 'Medium' then 2 else 1 end $$;
-- upsert an alert; notify the owner only when it is new or its severity rises (no repeats)
create or replace function app.raise_alert(p_org uuid, p_project text, p_category text, p_severity text, p_module text, p_title text, p_detail text,
  p_owner uuid, p_owner_role text, p_due timestamptz, p_records jsonb, p_next text, p_key text, p_event bigint default null) returns bigint
language plpgsql security definer set search_path = public, app as $$
declare a alerts; v_id bigint; v_notify boolean := false;
begin
  select * into a from alerts where org_id = p_org and dedupe_key = p_key for update;
  if not found then
    insert into alerts (org_id, project_id, category, severity, module, title, detail, owner_id, owner_role, due_at, records, next_action, dedupe_key, source_event, notified_severity)
    values (p_org, p_project, p_category, p_severity, p_module, p_title, p_detail, p_owner, p_owner_role, p_due, coalesce(p_records, '[]'), p_next, p_key, p_event, p_severity)
    returning id into v_id; v_notify := true;
  else
    v_id := a.id;
    update alerts set severity = case when app.sev_rank(p_severity) > app.sev_rank(a.severity) then p_severity else a.severity end,
      title = p_title, detail = p_detail, records = coalesce(p_records, a.records), next_action = p_next, due_at = coalesce(p_due, a.due_at),
      owner_id = coalesce(p_owner, a.owner_id), updated_at = now(),
      status = case when a.status = 'Resolved' then 'Open' when a.status = 'Suppressed' and a.suppressed_until < now() then 'Open' else a.status end,
      notified_severity = case when app.sev_rank(p_severity) > app.sev_rank(coalesce(a.notified_severity, 'Info')) or a.status = 'Resolved' then p_severity else a.notified_severity end
    where id = a.id;
    v_notify := app.sev_rank(p_severity) > app.sev_rank(coalesce(a.notified_severity, 'Info')) or a.status = 'Resolved';
  end if;
  if v_notify and p_severity <> 'Info' then
    insert into notifications (org_id, user_id, text, link, event_id)
    select p_org, x.user_id, '[' || p_severity || '] ' || p_title || ' — ' || p_next, 'alerts', p_event
    from (select p_owner as user_id where p_owner is not null
          union select p.user_id from profiles p where p_owner is null and p_owner_role is not null and p.role_id = p_owner_role and p.active and p.org_id = p_org
            and (p_project is null or p.all_projects or exists (select 1 from project_members m where m.project_id = p_project and m.user_id = p.user_id))) x;
  end if;
  return v_id;
end $$;
create or replace function app.clear_alert(p_org uuid, p_key text, p_resolution text) returns void language sql security definer set search_path = public as $$
  update alerts set status = 'Resolved', resolved_at = now(), resolution = p_resolution, updated_at = now()
  where org_id = p_org and dedupe_key = p_key and status in ('Open','Acknowledged','Suppressed')
$$;

-- ---------- traceable, idempotent playbook steps ----------
create table public.automation_actions (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id), project_id text, event_id bigint references public.automation_events(id),
  playbook text not null, step integer not null, action text not null, idem_key text not null,
  status text not null check (status in ('done','skipped')), result jsonb not null default '{}', created_at timestamptz not null default now(),
  unique (org_id, idem_key)
);
create index automation_actions_event on public.automation_actions (event_id);
-- returns true when the step is new (caller performs it); false when it already ran (a retry): the step is not repeated
create or replace function app.step(p_org uuid, p_project text, p_event bigint, p_playbook text, p_step integer, p_action text, p_key text, p_status text, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into automation_actions (org_id, project_id, event_id, playbook, step, action, idem_key, status, result)
  values (p_org, p_project, p_event, p_playbook, p_step, p_action, p_key, p_status, coalesce(p_result, '{}')) on conflict (org_id, idem_key) do nothing returning id into v;
  return v is not null;
end $$;

alter table public.automation_rules add column if not exists playbook text, add column if not exists params jsonb not null default '{}';

-- ---------- playbook rules (configurable; disabling a rule stops its playbook) ----------
create or replace function app.seed_playbook_rules(p_org uuid) returns void language sql security definer set search_path = public as $$
  insert into automation_rules (org_id, id, name, event, notify_roles, escalate_role, escalate_after_hours, channels, creates_risk, enabled, playbook, params) values
    (p_org, 'activity_overdue', 'Activity overdue: delay impact', 'activity_overdue', '{}', 'pd', 24, '{in_app}', true, true, 'delay',
      '{"min_days_late": 2, "critical_slip_days": 7, "recovery_plan_days": 2}'),
    (p_org, 'contractor_claim', 'Contractor claim submitted', 'contractor_claim', '{}', null, null, '{in_app}', false, true, 'claim', '{"qty_tolerance_pct": 0}'),
    (p_org, 'unit_works_complete', 'Unit works complete: handover check', 'unit_works_complete', '{}', null, null, '{in_app}', false, true, 'unit_completion', '{}'),
    (p_org, 'payment_ready', 'Certified bill or approved invoice ready to pay', 'payment_ready', '{finance}', null, null, '{in_app}', false, true, null, '{}'),
    (p_org, 'commitment_released', 'Commitment released: restate the estimate', 'commitment_released', '{qs}', null, null, '{in_app}', false, true, null, '{}'),
    (p_org, 'alert_escalation', 'Unacknowledged alerts escalate', 'alert_escalation', '{}', 'md', null, '{in_app}', false, true, null, '{"Critical_hours": 4, "High_hours": 24}')
  on conflict do nothing;
  update automation_rules set playbook = 'shortage', notify_roles = '{}', params = '{"auto_submit": true}' || params where org_id = p_org and id = 'material_shortage';
  update automation_rules set enabled = false where org_id = p_org and id = 'critical_delay';   -- replaced by activity_overdue (impact-based, not every late task)
$$;
select app.seed_playbook_rules(id) from organizations;
create or replace function app.bootstrap_org(p_org uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.bootstrap_org_base(p_org);
  perform app.apply_permission_defaults(p_org);
  perform app.seed_playbook_rules(p_org);
end $$;
create or replace function app.rule_param(p_org uuid, p_rule text, p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (params ->> p_key)::numeric from automation_rules where org_id = p_org and id = p_rule), p_default)
$$;

-- ---------- schedule forecast: forward pass over the dependency graph from today's actual state ----------
create or replace function app.schedule_forecast(p_project text, p_delay_task uuid default null, p_delay_days integer default 0)
returns table (task_id uuid, task_name text, milestone boolean, base_finish date, forecast_start date, forecast_finish date, slip integer, finished boolean)
language plpgsql security definer set search_path = public, app as $$
#variable_conflict use_column
declare v_today date := app.today((select org_id from projects where id = p_project)); n integer; i integer := 0;
begin
  create temp table if not exists _fc (id uuid primary key, nm text, ms boolean, dur integer, bf date, fs date, ff date, dn boolean, st boolean, ex integer not null default 0) on commit drop;
  delete from _fc;
  insert into _fc (id, nm, ms, dur, bf, fs, ff, dn, st)
  select t.id, t.name, t.is_milestone, t.duration_days, t.base_finish,
    case when t.act_start is not null then t.act_start when t.base_start < v_today then v_today else t.base_start end,
    case when t.act_finish is not null then t.act_finish
         when t.act_start is not null then greatest(t.base_finish, v_today + ceil(t.duration_days * (100 - t.progress) / 100.0)::integer)
         when t.base_start < v_today then v_today + t.duration_days else t.base_finish end,
    t.act_finish is not null, t.act_start is not null
  from tasks t where t.project_id = p_project;
  -- a what-if delay is extra duration on that activity, so it survives the forward pass
  if p_delay_task is not null and p_delay_days > 0 then
    update _fc set ex = p_delay_days, ff = ff + p_delay_days where id = p_delay_task and not dn;
  end if;
  loop   -- finish-to-start; the dependency trigger guarantees no cycles
    update _fc s set fs = x.pf, ff = x.pf + s.dur + s.ex
    from (select d.task_id tid, max(p.ff) pf from task_dependencies d join _fc p on p.id = d.pred_id group by d.task_id) x
    where s.id = x.tid and not s.dn and not s.st and x.pf > s.fs;
    get diagnostics n = row_count; i := i + 1;
    exit when n = 0 or i > 1000;
  end loop;
  return query select id, nm, ms, bf, fs, ff, (ff - bf)::integer, dn from _fc;
end $$;
create or replace function app.successors(p_task uuid) returns table (task_id uuid) language sql stable security definer set search_path = public as $$
  with recursive s(id) as (select task_id from task_dependencies where pred_id = p_task union select d.task_id from task_dependencies d join s on d.pred_id = s.id)
  select id from s
$$;

-- ---------- playbook: activity overdue ----------
create or replace function app.pb_activity_overdue(e automation_events) returns void language plpgsql security definer set search_path = public, app as $$
declare t tasks; p projects; v_today date := app.today(e.org_id); v_late integer; v_succ jsonb; v_ms jsonb; v_max integer; v_sev text; v_k text := 'ev:' || e.id || ':';
  v_minlate numeric := app.rule_param(e.org_id, 'activity_overdue', 'min_days_late', 2); v_crit numeric := app.rule_param(e.org_id, 'activity_overdue', 'critical_slip_days', 7);
  v_rdays numeric := app.rule_param(e.org_id, 'activity_overdue', 'recovery_plan_days', 2); v_alert bigint; v_risk_sev text;
begin
  select * into t from tasks where id = (e.payload ->> 'task_id')::uuid;
  select * into p from projects where id = t.project_id;
  v_late := v_today - t.base_finish;
  if t.id is null or t.act_finish is not null or v_late < v_minlate then
    perform app.step(e.org_id, e.project_id, e.id, 'delay', 1, 'No action: activity finished or within tolerance', v_k || 1, 'skipped', jsonb_build_object('days_late', v_late, 'tolerance_days', v_minlate));
    return;
  end if;
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 1, 'Checked the approved schedule and latest progress', v_k || 1, 'done',
    jsonb_build_object('task', t.name, 'base_finish', t.base_finish, 'progress', t.progress, 'days_late', v_late));
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.base_start), '[]') into v_succ from tasks x join app.successors(t.id) s on s.task_id = x.id where x.act_finish is null;
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 2, 'Identified dependent activities', v_k || 2, 'done', jsonb_build_object('count', jsonb_array_length(v_succ), 'activities', v_succ));
  select coalesce(jsonb_agg(jsonb_build_object('milestone', f.task_name, 'base', f.base_finish, 'forecast', f.forecast_finish, 'slip_days', f.slip) order by f.slip desc), '[]'), coalesce(max(f.slip), 0)
    into v_ms, v_max from app.schedule_forecast(t.project_id) f where f.milestone and not f.finished and f.slip > 0;
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 3, 'Calculated the impact on milestones', v_k || 3, 'done', jsonb_build_object('max_milestone_slip_days', v_max, 'milestones', v_ms));
  v_sev := case when v_max >= v_crit or (t.is_milestone and v_late >= v_crit) then 'Critical' when v_max > 0 then 'High' else 'Medium' end;
  v_alert := app.raise_alert(e.org_id, t.project_id, case when t.contractor_id is not null then 'Contractor' else 'Schedule' end, v_sev, 'schedule',
    format('%s is %s days late', t.name, v_late),
    case when v_max > 0 then format('Pushes %s milestone(s); worst slip %s days (%s).', jsonb_array_length(v_ms), v_max, v_ms -> 0 ->> 'milestone') else 'Has float: no milestone moves yet.' end,
    p.pm_id, 'pm', now() + make_interval(days => v_rdays::integer),
    jsonb_build_array(jsonb_build_object('kind', 'task', 'id', t.id, 'label', t.name)) || v_succ,
    case when t.recovery_plan is null then format('Submit a recovery plan for %s by %s', t.name, to_char(v_today + v_rdays::integer, 'DD Mon')) else 'Recovery plan on record: confirm it still holds' end,
    'delay:' || t.id, e.id);
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 4, 'Raised or updated the delay alert', v_k || 4, 'done', jsonb_build_object('alert', v_alert, 'severity', v_sev));
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 5, 'Notified the responsible project manager', v_k || 5, 'done', jsonb_build_object('pm', p.pm_id, 'note', 'notified only when the alert is new or its severity rises'));
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 6, case when t.recovery_plan is null then 'Requested a recovery plan' else 'Recovery plan already on record' end, v_k || 6,
    case when t.recovery_plan is null then 'done' else 'skipped' end, jsonb_build_object('due', v_today + v_rdays::integer));
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 7, 'Escalation armed for unacknowledged critical alerts', v_k || 7, case when v_sev = 'Critical' then 'done' else 'skipped' end,
    jsonb_build_object('escalate_to', (select escalate_role from automation_rules where org_id = e.org_id and id = 'alert_escalation'), 'after_hours', app.rule_param(e.org_id, 'alert_escalation', 'Critical_hours', 4)));
  v_risk_sev := case when v_sev in ('Critical','High') then 'High' else 'Medium' end;
  insert into risks (id, project_id, title, source, severity, owner_id, dedupe_key) values (app.next_no(e.org_id, 'RK'), t.project_id, format('Delay: %s', t.name), 'activity_overdue', v_risk_sev, p.pm_id, 'delay:' || t.id)
  on conflict (dedupe_key) do update set severity = case when excluded.severity = 'High' then 'High' else risks.severity end, status = case when risks.status = 'Closed' then 'Open' else risks.status end;
  perform app.step(e.org_id, t.project_id, e.id, 'delay', 8, 'Updated the risk register', v_k || 8, 'done', jsonb_build_object('risk_key', 'delay:' || t.id, 'severity', v_risk_sev));
end $$;

-- approvals can be raised on behalf of the person whose verified record started the workflow (they then cannot approve it)
drop function if exists app.create_approval(text, text, text, text, numeric, jsonb, jsonb);
create or replace function app.create_approval(p_kind text, p_ref text, p_project text, p_title text, p_amount numeric, p_steps jsonb, p_ctx jsonb default '{}'::jsonb, p_requested_by uuid default null)
returns text language plpgsql security definer set search_path = public, app as $$
declare v_org uuid := coalesce(app.org(), (select org_id from projects where id = p_project)); v_id text := app.next_no(v_org, 'AP'); s jsonb; i integer := 0;
begin
  insert into approvals (id, org_id, project_id, kind, ref, title, amount, requested_by, ctx)
  values (v_id, v_org, p_project, p_kind, p_ref, p_title, p_amount, coalesce(p_requested_by, auth.uid()), p_ctx);
  for s in select * from jsonb_array_elements(p_steps) loop
    i := i + 1;
    insert into approval_steps (approval_id, seq, role_id, module, label, status)
    values (v_id, i, s ->> 'role', s ->> 'module', s ->> 'label', case when i = 1 then 'pending' else 'waiting' end);
  end loop;
  perform app.notify_role(p_project, p_steps -> 0 ->> 'role', p_kind || ' ' || p_ref || ' needs your ' || lower(p_steps -> 0 ->> 'label'), 'approvals');
  perform app.emit(p_project, 'approval_requested', 'approval:' || v_id, jsonb_build_object('approval_id', v_id, 'kind', p_kind, 'ref', p_ref));
  return v_id;
end $$;

-- running bill from verified, unbilled measurements (shared by the QS screen and the claim playbook)
create or replace function app.ra_bill_core(p_contract text, p_other_deductions numeric, p_by uuid) returns text
language plpgsql security definer set search_path = public, app as $$
declare c contracts; v_id text; v_no integer; v_gross numeric; v_gst numeric; v_ret numeric; v_adv_out numeric; v_adv numeric; v_tds numeric; v_net numeric; r record; v_ap text; s org_settings; v_steps jsonb;
begin
  select * into c from contracts where id = p_contract for update;
  if c.status <> 'Active' then raise exception 'contract % is not active', p_contract; end if;
  if exists (select 1 from ra_bills where contract_id = p_contract and status = 'In approval') then raise exception 'a bill for this contract is already in approval' using errcode = '23505'; end if;
  if not exists (select 1 from measurements m join contract_items ci on ci.id = m.contract_item_id where ci.contract_id = p_contract and m.status = 'Verified' and m.ra_bill_id is null) then
    raise exception 'no verified, unbilled measurements on %', p_contract; end if;
  select coalesce(max(bill_no), 0) + 1 into v_no from ra_bills where contract_id = p_contract;
  v_id := app.next_no(c.org_id, 'RA');
  insert into ra_bills (id, contract_id, bill_no, gross, gst, retention, advance_recovery, tds, other_deductions, net_payable, created_by)
  values (v_id, p_contract, v_no, 0.01, 0, 0, 0, 0, 0, 0.01, p_by);
  for r in select ci.id, ci.rate, sum(m.qty) as this_qty,
                  coalesce((select sum(l.this_qty) from ra_bill_lines l join ra_bills b on b.id = l.bill_id and b.status <> 'Rejected' where l.contract_item_id = ci.id and l.bill_id <> v_id), 0) as prev_qty
           from measurements m join contract_items ci on ci.id = m.contract_item_id
           where ci.contract_id = p_contract and m.status = 'Verified' and m.ra_bill_id is null group by ci.id, ci.rate loop
    insert into ra_bill_lines (bill_id, contract_item_id, prev_qty, this_qty, cum_qty, rate, amount)
    values (v_id, r.id, r.prev_qty, r.this_qty, r.prev_qty + r.this_qty, r.rate, round(r.this_qty * r.rate, 2));
  end loop;
  update measurements m set ra_bill_id = v_id from contract_items ci where ci.id = m.contract_item_id and ci.contract_id = p_contract and m.status = 'Verified' and m.ra_bill_id is null;
  select sum(amount) into v_gross from ra_bill_lines where bill_id = v_id;
  v_gst := round(v_gross * c.gst_pct / 100, 2);
  v_ret := round(v_gross * c.retention_pct / 100, 2);
  select coalesce((select sum(amount) from payments where contract_id = p_contract and kind = 'advance'), 0)
       - coalesce((select sum(advance_recovery) from ra_bills where contract_id = p_contract and status <> 'Rejected' and id <> v_id), 0) into v_adv_out;
  v_adv := least(round(v_gross * c.advance_recovery_pct / 100, 2), greatest(v_adv_out, 0));
  v_tds := round(v_gross * c.tds_pct / 100, 2);
  v_net := v_gross + v_gst - v_ret - v_adv - v_tds - coalesce(p_other_deductions, 0);
  if v_net < 0 then raise exception 'deductions exceed the bill value'; end if;
  update ra_bills set gross = v_gross, gst = v_gst, retention = v_ret, advance_recovery = v_adv, tds = v_tds, other_deductions = coalesce(p_other_deductions, 0), net_payable = v_net where id = v_id;
  select * into s from org_settings where org_id = c.org_id;
  v_steps := jsonb_build_array(jsonb_build_object('role','pm','module','site','label','Engineer certification'),
                               jsonb_build_object('role','qs','module','boq','label','QS verification'),
                               jsonb_build_object('role','finance','module','payments','label','Finance review'));
  if v_gross + v_gst > s.po_pm_limit then v_steps := v_steps || jsonb_build_object('role','pd','module','contracts','label','Approve bill'); end if;
  if v_gross + v_gst > s.po_pd_limit then v_steps := v_steps || jsonb_build_object('role','md','module','contracts','label','Approve bill'); end if;
  v_ap := app.create_approval('RABILL', v_id, c.project_id, format('RA bill %s on %s', v_no, p_contract), v_gross + v_gst, v_steps, '{}'::jsonb, p_by);
  update ra_bills set approval_id = v_ap where id = v_id;
  perform app.emit(c.project_id, 'contractor_bill', 'rabill:' || v_id, jsonb_build_object('bill', v_id, 'gross', v_gross));
  return v_id;
end $$;
create or replace function api.create_ra_bill(p_contract text, p_other_deductions numeric default 0) returns text
language plpgsql security definer set search_path = public, app as $$
declare c contracts;
begin
  select * into c from contracts where id = p_contract;
  if not found then raise exception 'contract % not found', p_contract; end if;
  perform app.require(c.project_id, 'contracts', 'create');
  return app.ra_bill_core(p_contract, p_other_deductions, auth.uid());
end $$;

-- ---------- playbook: material shortage ----------
create or replace function app.pb_material_shortage(e automation_events) returns void language plpgsql security definer set search_path = public, app as $$
declare sh material_shortages; m materials; v_today date := app.today(e.org_id); v_on numeric; v_res numeric; v_avail numeric; v_exp numeric; v_exp_list jsonb;
  v_aff jsonb; v_need numeric; v_mr text; v_k text := 'ev:' || e.id || ':'; v_auto boolean;
begin
  select * into sh from material_shortages where id = e.payload ->> 'shortage';
  select * into m from materials where id = sh.material_id;
  v_on := app.stock_on_hand(sh.project_id, sh.material_id);
  select coalesce(sum(qty), 0) into v_res from material_reservations where project_id = sh.project_id and material_id = sh.material_id and status = 'Active' and coalesce(task_id::text, '') <> coalesce(sh.task_id::text, '-');
  v_avail := greatest(v_on - v_res, 0);
  perform app.step(e.org_id, sh.project_id, e.id, 'shortage', 1, 'Checked site stock and reservations', v_k || 1, 'done', jsonb_build_object('on_hand', v_on, 'reserved_for_other_work', v_res, 'available', v_avail));
  select coalesce(sum(po.qty - coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0)), 0),
         coalesce(jsonb_agg(jsonb_build_object('po', po.id, 'expected', po.expected_delivery, 'outstanding', po.qty - coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0))), '[]')
    into v_exp, v_exp_list from purchase_orders po
   where po.project_id = sh.project_id and po.material_id = sh.material_id and po.status in ('Approved','Part received') and po.expected_delivery is not null and po.expected_delivery <= sh.needed_by;
  perform app.step(e.org_id, sh.project_id, e.id, 'shortage', 2, 'Checked orders due before the need date', v_k || 2, 'done', jsonb_build_object('expected_in_time', v_exp, 'orders', v_exp_list));
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)), '[]') into v_aff from tasks t
   where t.id = sh.task_id or t.id in (select task_id from app.successors(sh.task_id)) and t.act_finish is null;
  perform app.step(e.org_id, sh.project_id, e.id, 'shortage', 3, 'Identified affected activities', v_k || 3, 'done', jsonb_build_object('activities', v_aff));
  v_need := greatest(sh.qty - v_avail - v_exp, 0);
  perform app.step(e.org_id, sh.project_id, e.id, 'shortage', 4, 'Calculated the quantity to buy', v_k || 4, 'done',
    jsonb_build_object('requested', sh.qty, 'available', v_avail, 'expected_in_time', v_exp, 'to_buy', v_need, 'formula', 'requested − available − expected in time'));
  update material_shortages set assessment = jsonb_build_object('on_hand', v_on, 'reserved', v_res, 'available', v_avail, 'expected_in_time', v_exp, 'to_buy', v_need, 'affected', v_aff) where id = sh.id;
  if v_need = 0 then
    update material_shortages set status = 'Covered' where id = sh.id;
    perform app.raise_alert(e.org_id, sh.project_id, 'Material', 'Info', 'procurement', format('%s shortage is covered by stock or orders', m.name), null, sh.reported_by, null, null,
      jsonb_build_array(jsonb_build_object('kind', 'shortage', 'id', sh.id)), 'Issue the stock or track the order', 'shortage:' || sh.id, e.id);
    perform app.step(e.org_id, sh.project_id, e.id, 'shortage', 5, 'No purchase needed: covered', v_k || 5, 'skipped', '{}');
    return;
  end if;
  v_auto := coalesce((select (params ->> 'auto_submit')::boolean from automation_rules where org_id = e.org_id and id = 'material_shortage'), true);
  if app.step(e.org_id, sh.project_id, e.id, 'shortage', 5, case when v_auto then 'Raised the material request' else 'Drafted the material request' end, 'shortage-mr:' || sh.id, 'done', jsonb_build_object('qty', v_need)) then
    v_mr := app.next_no(e.org_id, 'MR');
    insert into material_requests (id, org_id, project_id, code, item, qty, uom, needed_by, urgency, requested_by, status, material_id, origin, duplicate_note)
    values (v_mr, e.org_id, sh.project_id, coalesce(m.cost_code, '01'), m.name, v_need, m.uom, sh.needed_by,
            case when sh.needed_by <= v_today + m.lead_days then 'Urgent — work stopped' else 'Urgent' end, sh.reported_by,
            case when v_auto then 'Submitted' else 'Draft' end, m.id, 'automation', 'Raised automatically from shortage ' || sh.id);
    update material_shortages set mr_id = v_mr where id = sh.id;
    if sh.task_id is not null then
      insert into material_reservations (project_id, material_id, task_id, qty, needed_by, created_by) values (sh.project_id, m.id, sh.task_id, sh.qty, sh.needed_by, sh.reported_by);
    end if;
  else select mr_id into v_mr from material_shortages where id = sh.id;
  end if;
  perform app.raise_alert(e.org_id, sh.project_id, 'Material', case when sh.needed_by <= v_today + m.lead_days then 'High' else 'Medium' end, 'procurement',
    format('Shortage: %s %s %s needed by %s', v_need, m.uom, m.name, to_char(sh.needed_by, 'DD Mon')),
    format('Lead time %s days. Affects %s activit%s.', m.lead_days, jsonb_array_length(v_aff), case when jsonb_array_length(v_aff) = 1 then 'y' else 'ies' end),
    null, 'proc', sh.needed_by - m.lead_days, jsonb_build_array(jsonb_build_object('kind', 'shortage', 'id', sh.id), jsonb_build_object('kind', 'material_request', 'id', v_mr)) || v_aff,
    format('Get quotations and raise the PO for %s (approval route applies)', v_mr), 'shortage:' || sh.id, e.id);
  perform app.step(e.org_id, sh.project_id, e.id, 'shortage', 6, 'Routed to procurement; PO approval follows the normal thresholds', v_k || 6, 'done', jsonb_build_object('request', v_mr));
  perform app.step(e.org_id, sh.project_id, e.id, 'shortage', 7, 'Tracking until delivery', v_k || 7, 'done', jsonb_build_object('tracked_by', 'scan_exceptions updates the shortage from the request, order and receipts'));
end $$;

-- ---------- playbook: contractor claim ----------
create or replace function app.pb_contractor_claim(e automation_events) returns void language plpgsql security definer set search_path = public, app as $$
declare cl contractor_claims; c contracts; v_sub profiles; r record; v_disc jsonb := '[]'; v_lines jsonb := '[]'; v_gross numeric := 0; v_gst numeric; v_ret numeric; v_adv_out numeric; v_adv numeric; v_tds numeric;
  v_tol numeric := app.rule_param(e.org_id, 'contractor_claim', 'qty_tolerance_pct', 0); v_k text := 'ev:' || e.id || ':'; v_bill text; v_var numeric;
begin
  select * into cl from contractor_claims where id = e.payload ->> 'claim';
  select * into c from contracts where id = cl.contract_id;
  select * into v_sub from profiles where user_id = cl.submitted_by;
  -- 1 contract
  if c.status <> 'Active' then v_disc := v_disc || jsonb_build_object('type', 'contract', 'issue', 'contract is ' || c.status); end if;
  if v_sub.role_id = 'vendor' and v_sub.vendor_id is distinct from c.vendor_id then v_disc := v_disc || jsonb_build_object('type', 'contract', 'issue', 'submitted by a user of another contractor'); end if;
  perform app.step(e.org_id, cl.project_id, e.id, 'claim', 1, 'Matched the claim to its contract', v_k || 1, 'done', jsonb_build_object('contract', c.id, 'status', c.status));
  -- 2 quantities against verified, unbilled measurements · 3 rates and variations
  for r in select l.line_no, l.description, l.claimed_qty, l.claimed_rate, ci.id item_id, ci.rate, ci.qty contract_qty,
                  coalesce((select sum(m.qty) from measurements m where m.contract_item_id = ci.id and m.status = 'Verified' and m.ra_bill_id is null), 0) verified_unbilled,
                  (ci.contract_id = c.id) on_contract
           from claim_lines l left join contract_items ci on ci.id = l.contract_item_id where l.claim_id = cl.id order by l.line_no loop
    if r.item_id is null or not r.on_contract then
      v_disc := v_disc || jsonb_build_object('line', r.line_no, 'type', 'scope', 'issue', format('"%s" is not a contract item; it needs an approved variation', r.description), 'claimed', round(r.claimed_qty * r.claimed_rate, 2));
      continue;
    end if;
    if r.claimed_qty > r.verified_unbilled * (1 + v_tol / 100) then
      v_disc := v_disc || jsonb_build_object('line', r.line_no, 'type', 'quantity', 'issue', format('claims %s; verified and unbilled %s', r.claimed_qty, r.verified_unbilled), 'excess_qty', r.claimed_qty - r.verified_unbilled);
    end if;
    if r.claimed_rate <> r.rate then
      v_disc := v_disc || jsonb_build_object('line', r.line_no, 'type', 'rate', 'issue', format('claims rate %s; contract rate %s', r.claimed_rate, r.rate));
    end if;
    v_lines := v_lines || jsonb_build_object('line', r.line_no, 'item', r.item_id, 'assessed_qty', least(r.claimed_qty, r.verified_unbilled), 'rate', r.rate, 'amount', round(least(r.claimed_qty, r.verified_unbilled) * r.rate, 2));
    v_gross := v_gross + round(least(r.claimed_qty, r.verified_unbilled) * r.rate, 2);
  end loop;
  perform app.step(e.org_id, cl.project_id, e.id, 'claim', 2, 'Matched quantities to verified measurements', v_k || 2, 'done', jsonb_build_object('lines', v_lines));
  select coalesce(sum(amount), 0) into v_var from contract_variations where contract_id = c.id and status = 'Approved';
  perform app.step(e.org_id, cl.project_id, e.id, 'claim', 3, 'Checked contract rates and approved variations', v_k || 3, 'done', jsonb_build_object('approved_variations', v_var));
  -- 4 deductions, same formulas as the running bill
  v_gst := round(v_gross * c.gst_pct / 100, 2); v_ret := round(v_gross * c.retention_pct / 100, 2); v_tds := round(v_gross * c.tds_pct / 100, 2);
  select coalesce((select sum(amount) from payments where contract_id = c.id and kind = 'advance'), 0) - coalesce((select sum(advance_recovery) from ra_bills where contract_id = c.id and status <> 'Rejected'), 0) into v_adv_out;
  v_adv := least(round(v_gross * c.advance_recovery_pct / 100, 2), greatest(v_adv_out, 0));
  update contractor_claims set assessment = jsonb_build_object('lines', v_lines, 'discrepancies', v_disc, 'gross', v_gross, 'gst', v_gst, 'retention', v_ret, 'advance_recovery', v_adv, 'tds', v_tds,
    'net', v_gross + v_gst - v_ret - v_adv - v_tds, 'claimed_gross', cl.claimed_gross, 'difference', cl.claimed_gross - v_gross,
    'formula', 'net = assessed gross + GST − retention − advance recovery − TDS; assessed qty = least(claimed, verified unbilled)') where id = cl.id;
  perform app.step(e.org_id, cl.project_id, e.id, 'claim', 4, 'Calculated GST, retention, advance recovery and TDS', v_k || 4, 'done',
    jsonb_build_object('gross', v_gross, 'gst', v_gst, 'retention', v_ret, 'advance_recovery', v_adv, 'tds', v_tds));
  -- 5 discrepancies
  if jsonb_array_length(v_disc) > 0 then
    update contractor_claims set status = 'Discrepancies' where id = cl.id;
    perform app.raise_alert(e.org_id, cl.project_id, 'Contractor', 'Medium', 'contracts', format('Claim %s on %s has %s discrepanc%s', cl.claim_no, c.id, jsonb_array_length(v_disc), case when jsonb_array_length(v_disc) = 1 then 'y' else 'ies' end),
      format('Claimed %s, assessable %s.', cl.claimed_gross, v_gross), null, 'qs', now() + interval '3 days',
      jsonb_build_array(jsonb_build_object('kind', 'claim', 'id', cl.id), jsonb_build_object('kind', 'contract', 'id', c.id)),
      'Review the discrepancies; bill the assessed amount or return the claim', 'claim:' || cl.id, e.id);
    perform app.step(e.org_id, cl.project_id, e.id, 'claim', 5, 'Flagged discrepancies for the QS', v_k || 5, 'done', jsonb_build_object('discrepancies', v_disc));
    return;
  end if;
  perform app.step(e.org_id, cl.project_id, e.id, 'claim', 5, 'No discrepancies', v_k || 5, 'skipped', '{}');
  -- 6 route: the running bill is created from the verified measurements and enters the certification chain on the submitter's behalf
  if app.step(e.org_id, cl.project_id, e.id, 'claim', 6, 'Prepared the running bill and routed it for certification', 'claim-bill:' || cl.id, 'done', '{}') then
    v_bill := app.ra_bill_core(c.id, 0, cl.submitted_by);
    update contractor_claims set status = 'Billed', ra_bill_id = v_bill where id = cl.id;
    update automation_actions set result = jsonb_build_object('bill', v_bill) where org_id = e.org_id and idem_key = 'claim-bill:' || cl.id;
  end if;
  perform app.step(e.org_id, cl.project_id, e.id, 'claim', 7, 'Payment request will be prepared when the bill is certified', v_k || 7, 'done', '{}');
end $$;

-- ---------- playbook: unit works complete ----------
create or replace function app.pb_unit_completion(e automation_events) returns void language plpgsql security definer set search_path = public, app as $$
declare u units; p projects; v_stages jsonb; v_snags jsonb; v_ffe jsonb; v_comm jsonb; v_blk integer; v_safety integer; v_ins text; v_k text := 'ev:' || e.id || ':';
begin
  select * into u from units where id = (e.payload ->> 'unit')::uuid; select * into p from projects where id = u.project_id;
  if u.handed_over_at is not null or exists (select 1 from inspections where unit_id = u.id and kind = 'Final' and status in ('Requested','Passed')) then
    perform app.step(e.org_id, u.project_id, e.id, 'unit_completion', 1, 'No action: final inspection already requested or unit handed over', v_k || 1, 'skipped', '{}'); return;
  end if;
  select coalesce(jsonb_agg(label order by seq), '[]') into v_stages from unit_stages where unit_id = u.id and (status <> 'Passed' or passed_inspection_id is null);
  perform app.step(e.org_id, u.project_id, e.id, 'unit_completion', 1, 'Verified mandatory stage inspections', v_k || 1, 'done', jsonb_build_object('stages_not_passed', v_stages));
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'severity', severity)), '[]'), count(*) filter (where severity = 'Safety-critical') into v_snags, v_safety from snags where unit_id = u.id and status <> 'Closed';
  perform app.step(e.org_id, u.project_id, e.id, 'unit_completion', 2, 'Checked unresolved defects', v_k || 2, 'done', jsonb_build_object('open', v_snags));
  select coalesce(jsonb_agg(item || ' (' || status || ')'), '[]') into v_ffe from ffe_items where unit_id = u.id and status not in ('Installed','Tested');
  perform app.step(e.org_id, u.project_id, e.id, 'unit_completion', 3, 'Verified FF&E installation', v_k || 3, 'done', jsonb_build_object('not_installed', v_ffe));
  select coalesce(jsonb_agg(system), '[]') into v_comm from unit_commissioning where unit_id = u.id and status <> 'Passed';
  perform app.step(e.org_id, u.project_id, e.id, 'unit_completion', 4, 'Verified commissioning certificates', v_k || 4, 'done', jsonb_build_object('not_passed', v_comm));
  v_blk := jsonb_array_length(v_stages) + jsonb_array_length(v_snags) + jsonb_array_length(v_ffe) + jsonb_array_length(v_comm);
  if v_blk > 0 then
    perform app.raise_alert(e.org_id, u.project_id, 'Handover', case when v_safety > 0 then 'High' else 'Medium' end, 'handover', format('%s: %s handover blocker%s', u.code, v_blk, case when v_blk = 1 then '' else 's' end),
      format('Stages %s · defects %s · FF&E %s · commissioning %s', jsonb_array_length(v_stages), jsonb_array_length(v_snags), jsonb_array_length(v_ffe), jsonb_array_length(v_comm)),
      p.pm_id, 'pm', null, jsonb_build_array(jsonb_build_object('kind', 'unit', 'id', u.id, 'label', u.code)) || v_snags, 'Clear the blockers; the final inspection is requested automatically when the last one closes',
      'handover:' || u.id, e.id);
    perform app.step(e.org_id, u.project_id, e.id, 'unit_completion', 5, 'Handover blocked: alert raised', v_k || 5, 'skipped', jsonb_build_object('blockers', v_blk));
    return;
  end if;
  if app.step(e.org_id, u.project_id, e.id, 'unit_completion', 5, 'Created the handover inspection request', 'final-request:' || u.id, 'done', '{}') then
    v_ins := app.next_no(e.org_id, 'IN');
    insert into inspections (id, project_id, unit_id, kind, requested_by, notes) values (v_ins, u.project_id, u.id, 'Final', coalesce(p.pm_id, p.created_by), 'Requested automatically: all stages, defects, FF&E and commissioning clear');
    update automation_actions set result = jsonb_build_object('inspection', v_ins) where org_id = e.org_id and idem_key = 'final-request:' || u.id;
  end if;
  perform app.clear_alert(e.org_id, 'handover:' || u.id, 'All blockers cleared');
  perform app.raise_alert(e.org_id, u.project_id, 'Handover', 'Medium', 'quality', format('%s is ready for its final handover inspection', u.code), null, null, 'quality', now() + interval '2 days',
    jsonb_build_array(jsonb_build_object('kind', 'unit', 'id', u.id, 'label', u.code)), 'Carry out the final inspection; readiness changes to Ready when it passes', 'final:' || u.id, e.id);
  perform app.step(e.org_id, u.project_id, e.id, 'unit_completion', 6, 'Readiness becomes Ready only after the inspector passes it', v_k || 6, 'done', '{}');
end $$;

-- ---------- certified bills and approved invoices become payment requests (finance still pays) ----------
create or replace function app.payment_request_from_approval() returns trigger language plpgsql security definer set search_path = public, app as $$
declare v_org uuid; v_proj text; v_vendor uuid; v_amt numeric; v_kind text;
begin
  if new.status <> 'Approved' or old.status = 'Approved' then return new; end if;
  if tg_table_name = 'ra_bills' then
    select c.org_id, c.project_id, c.vendor_id into v_org, v_proj, v_vendor from contracts c where c.id = new.contract_id; v_amt := new.net_payable; v_kind := 'ra_bill';
  else v_org := new.org_id; v_proj := new.project_id; v_vendor := new.vendor_id; v_amt := new.total; v_kind := 'invoice'; end if;
  insert into payment_requests (id, org_id, project_id, kind, ref, vendor_id, amount, due_date)
  values (app.next_no(v_org, 'PR'), v_org, v_proj, v_kind, new.id, v_vendor, v_amt, new.due_date) on conflict (kind, ref) do nothing;
  perform app.emit(v_proj, 'payment_ready', 'payready:' || new.id, jsonb_build_object('ref', new.id, 'title', new.id || ' ready for payment'));
  return new;
end $$;
create trigger ra_bill_payment_request after update of status on public.ra_bills for each row execute function app.payment_request_from_approval();
create trigger invoice_payment_request after update of status on public.vendor_invoices for each row execute function app.payment_request_from_approval();
create or replace function app.payment_request_paid() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Paid' and old.status <> 'Paid' then update payment_requests set status = 'Paid' where ref = new.id; end if;
  return new;
end $$;
create trigger ra_bill_request_paid after update of status on public.ra_bills for each row execute function app.payment_request_paid();
create trigger invoice_request_paid after update of status on public.vendor_invoices for each row execute function app.payment_request_paid();

-- the last stage inspection of a unit starts the completion playbook at once
create or replace function app.unit_stage_complete() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.status = 'Passed' and old.status <> 'Passed' and not exists (select 1 from unit_stages where unit_id = new.unit_id and status <> 'Passed') then
    perform app.emit((select project_id from units where id = new.unit_id), 'unit_works_complete', 'complete:' || new.unit_id || ':stages:' || app.today((select org_id from projects p join units u on u.project_id = p.id where u.id = new.unit_id)),
      jsonb_build_object('unit', new.unit_id));
  end if;
  return new;
end $$;
create trigger unit_stage_complete after update of status on public.unit_stages for each row execute function app.unit_stage_complete();

create or replace function app.run_playbook(e automation_events, p_playbook text) returns void language plpgsql security definer set search_path = public, app as $$
begin
  case p_playbook
    when 'delay' then perform app.pb_activity_overdue(e);
    when 'shortage' then perform app.pb_material_shortage(e);
    when 'claim' then perform app.pb_contractor_claim(e);
    when 'unit_completion' then perform app.pb_unit_completion(e);
    else null;
  end case;
end $$;

-- ---------- event processing: rules, then the rule's playbook, in one sub-transaction per event ----------
create or replace function api.process_events(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = public, app as $$
declare e automation_events; rl automation_rules; ch text; v_role text; n integer := 0; v_text text; cfg channel_config; a approvals;
begin
  if auth.uid() is not null then perform app.require_perm('settings', 'edit'); end if;
  for e in select * from automation_events where status in ('queued','failed') and next_attempt_at <= now() order by id limit p_limit for update skip locked loop
    begin
      select * into rl from automation_rules where org_id = e.org_id and event = e.event and enabled;
      if found then
        v_text := rl.name || coalesce(' — ' || (select name from projects where id = e.project_id), '') || coalesce(': ' || coalesce(e.payload ->> 'title', e.payload ->> 'task', e.payload ->> 'item', e.payload ->> 'code'), '');
        foreach v_role in array rl.notify_roles loop
          foreach ch in array rl.channels loop
            if ch = 'in_app' then
              insert into notifications (org_id, user_id, channel, delivery, text, link, event_id)
              select e.org_id, p.user_id, 'in_app', 'delivered', v_text, coalesce(e.project_id, ''), e.id from profiles p
              where p.org_id = e.org_id and p.role_id = v_role and p.active and (e.project_id is null or p.all_projects or exists (select 1 from project_members m where m.project_id = e.project_id and m.user_id = p.user_id));
            else
              select * into cfg from channel_config where org_id = e.org_id and channel = ch;
              insert into notifications (org_id, user_id, channel, delivery, text, link, event_id)
              select e.org_id, p.user_id, ch, case when cfg.enabled then 'queued' else 'not_configured' end, v_text, coalesce(e.project_id, ''), e.id from profiles p
              where p.org_id = e.org_id and p.role_id = v_role and p.active and (e.project_id is null or p.all_projects or exists (select 1 from project_members m where m.project_id = e.project_id and m.user_id = p.user_id));
            end if;
          end loop;
        end loop;
        if rl.creates_risk and e.project_id is not null and rl.playbook is null then
          insert into risks (id, project_id, title, source, severity, dedupe_key)
          values (app.next_no(e.org_id, 'RK'), e.project_id, v_text, e.event, case when e.event in ('safety_defect','budget_overrun') then 'High' else 'Medium' end, 'risk:' || e.dedupe_key)
          on conflict (dedupe_key) do nothing;
        end if;
        if rl.playbook is not null then perform app.run_playbook(e, rl.playbook); end if;
      end if;
      update automation_events set status = 'processed', processed_at = now(), attempts = attempts + 1, last_error = null where id = e.id;
      n := n + 1;
    exception when others then
      update automation_events set attempts = attempts + 1, last_error = sqlerrm,
        status = case when attempts + 1 >= 5 then 'dead' else 'failed' end,
        next_attempt_at = now() + make_interval(mins => power(2, attempts + 1)::integer) where id = e.id;
    end;
  end loop;
  for e in select ev.* from automation_events ev join automation_rules r on r.org_id = ev.org_id and r.event = ev.event and r.escalate_role is not null
           where ev.event = 'approval_requested' and ev.escalated_at is null and ev.created_at < now() - make_interval(hours => r.escalate_after_hours) loop
    select * into a from approvals where id = e.payload ->> 'approval_id';
    if a.status = 'Pending' then
      perform app.notify_role(a.project_id, (select escalate_role from automation_rules where org_id = e.org_id and event = e.event), 'Escalation: ' || a.kind || ' ' || a.ref || ' has waited too long for approval', 'approvals', e.id);
    end if;
    update automation_events set escalated_at = now() where id = e.id;
  end loop;
  return n;
end $$;

-- a dead or failed event can be replayed after its cause is fixed (steps already done are not repeated)
create or replace function api.replay_event(p_event bigint) returns text language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm('settings', 'edit');
  update automation_events set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null where id = p_event and org_id = app.org() and status in ('failed','dead');
  if not found then raise exception 'event % is not failed or dead', p_event; end if;
  return 'queued';
end $$;

create or replace function app.scan_finance(p_project text, p_org uuid, p_pm uuid) returns void language sql as $$ select null::void $$;   -- replaced in 1200

-- ---------- exception scan: emits verified events, keeps alerts current, resolves what has cleared, escalates ----------
create or replace function api.scan_exceptions() returns integer
language plpgsql security definer set search_path = public, app as $$
declare n integer := 0; r record; s org_settings; v_week text := to_char(now(), 'IYYY-IW'); v_today date; v_t time; x record; v_h numeric;
begin
  if auth.uid() is not null then perform app.require_perm('settings', 'view'); end if;
  for r in select p.id project_id, p.org_id, p.stage, p.pm_id from projects p where p.stage in ('Pre-construction','Construction','Pre-opening') and (auth.uid() is null or p.org_id = app.org()) loop
    select * into s from org_settings where org_id = r.org_id;
    v_today := app.today(r.org_id); v_t := app.local_time(r.org_id);
    -- budget: forecast above the flag threshold on an approved budget line
    if app.current_budget(r.project_id) is not null then
      for x in select cp.code, cp.forecast, cp.cb from (select l.code, l.amount cb, coalesce(e.amount, 0) + (app.code_commitments(r.project_id, l.code)).committed forecast
               from budget_lines l left join etc_estimates e on e.project_id = r.project_id and e.code = l.code where l.version_id = app.current_budget(r.project_id)) cp
               where cp.cb > 0 and cp.forecast * 100 > cp.cb * s.flag_pct loop
        n := n + case when app.emit(r.project_id, 'budget_overrun', format('overrun:%s:%s:%s', r.project_id, x.code, v_week), jsonb_build_object('code', x.code, 'forecast', x.forecast, 'budget', x.cb)) is null then 0 else 1 end;
        perform app.raise_alert(r.org_id, r.project_id, 'Budget', case when x.forecast > x.cb * 1.1 then 'Critical' else 'High' end, 'budget',
          format('Cost code %s forecast %s%% of budget', x.code, round(x.forecast * 100 / x.cb)), format('Forecast %s against budget %s.', x.forecast, x.cb), r.pm_id, 'pm', null,
          jsonb_build_array(jsonb_build_object('kind', 'cost_code', 'id', x.code)), 'Review commitments and the estimate; request a budget revision or a transfer from contingency', 'budget:' || r.project_id || ':' || x.code);
      end loop;
    end if;
    -- overdue activities go to the delay playbook (weekly re-check; the alert itself notifies only when new or worse)
    n := n + coalesce((select count(app.emit(r.project_id, 'activity_overdue', format('overdue:%s:%s', t.id, v_week), jsonb_build_object('task_id', t.id, 'task', t.name)))
      from tasks t where t.project_id = r.project_id and t.act_finish is null and t.base_finish < v_today), 0);
    -- missing daily report after the local cut-off
    if r.stage = 'Construction' and v_t > s.report_cutoff and not exists (select 1 from daily_reports where project_id = r.project_id and report_date = v_today and status in ('Submitted','Approved')) then
      n := n + case when app.emit(r.project_id, 'missing_report', format('missing:%s:%s', r.project_id, v_today), '{}'::jsonb) is null then 0 else 1 end;
    end if;
    -- units with every stage passed and no final inspection yet: re-check daily until blockers clear
    -- the key carries the blocker count, so clearing a blocker triggers a fresh check the same day
    n := n + coalesce((select count(app.emit(r.project_id, 'unit_works_complete', format('complete:%s:%s:b%s', u.id, v_today,
          (select count(*) from snags sn where sn.unit_id = u.id and sn.status <> 'Closed') + (select count(*) from ffe_items f where f.unit_id = u.id and f.status not in ('Installed','Tested'))
          + (select count(*) from unit_commissioning cm where cm.unit_id = u.id and cm.status <> 'Passed')), jsonb_build_object('unit', u.id)))
      from units u where u.project_id = r.project_id and u.handed_over_at is null and exists (select 1 from unit_stages st where st.unit_id = u.id)
        and not exists (select 1 from unit_stages st where st.unit_id = u.id and st.status <> 'Passed')
        and not exists (select 1 from inspections i where i.unit_id = u.id and i.kind = 'Final' and i.status in ('Requested','Passed'))), 0);
    -- safety-critical defects, failed inspections, permits, payment approvals
    for x in select id, title, unit_id from snags where project_id = r.project_id and severity = 'Safety-critical' and status <> 'Closed' loop
      perform app.raise_alert(r.org_id, r.project_id, 'Safety', 'Critical', 'quality', 'Safety-critical defect: ' || x.title, null, r.pm_id, 'pm', now() + interval '1 day',
        jsonb_build_array(jsonb_build_object('kind', 'snag', 'id', x.id)), 'Make the area safe and fix it; a quality engineer closes it after re-inspection', 'safety:' || x.id);
    end loop;
    for x in select i.id, i.kind, coalesce(i.stage_key, i.system, '') what, u.code from inspections i left join units u on u.id = i.unit_id
             where i.project_id = r.project_id and i.status = 'Failed' and i.decided_at > now() - interval '30 days'
               and not exists (select 1 from inspections j where j.unit_id is not distinct from i.unit_id and j.kind = i.kind and coalesce(j.stage_key, j.system, '') = coalesce(i.stage_key, i.system, '') and j.status = 'Passed' and j.decided_at > i.decided_at) loop
      perform app.raise_alert(r.org_id, r.project_id, 'Quality', 'High', 'quality', format('%s inspection failed: %s %s', x.kind, x.code, x.what), null, null, 'quality', null,
        jsonb_build_array(jsonb_build_object('kind', 'inspection', 'id', x.id)), 'Agree the corrective action with the contractor and re-inspect', 'inspfail:' || x.id);
    end loop;
    for x in select id, title, expiry from documents where project_id = r.project_id and expiry is not null and expiry <= v_today + 30 loop
      perform app.raise_alert(r.org_id, r.project_id, 'Permit', case when x.expiry < v_today then 'Critical' when x.expiry <= v_today + 7 then 'High' else 'Medium' end, 'documents',
        format('%s %s %s', x.title, case when x.expiry < v_today then 'expired on' else 'expires on' end, to_char(x.expiry, 'DD Mon YYYY')), null, null, 'pd', x.expiry::timestamptz,
        jsonb_build_array(jsonb_build_object('kind', 'document', 'id', x.id)), 'Start the renewal and upload the renewed document', 'permit:' || x.id);
    end loop;
    for x in select a.id, a.kind, a.ref, a.requested_at, st.role_id from approvals a join approval_steps st on st.approval_id = a.id and st.status = 'pending'
             where a.project_id = r.project_id and a.status = 'Pending' and a.kind in ('INVOICE','RABILL') and a.requested_at < now() - interval '3 days' loop
      perform app.raise_alert(r.org_id, r.project_id, 'Payment', 'Medium', 'approvals', format('%s %s waiting %s days for %s', case x.kind when 'INVOICE' then 'Invoice' else 'Running bill' end, x.ref,
        extract(day from now() - x.requested_at)::integer, x.role_id), null, null, x.role_id, null, jsonb_build_array(jsonb_build_object('kind', 'approval', 'id', x.id)), 'Decide the approval', 'approval:' || x.id);
    end loop;
    perform app.scan_finance(r.project_id, r.org_id, r.pm_id);   -- financial exceptions (defined with the financial intelligence)
    -- shortages: follow the request to its order and receipt
    for x in select sh.id, sh.mr_id, (sh.assessment ->> 'to_buy')::numeric to_buy, po.id po_id, po.status po_status, po.expected_delivery,
                    coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0) accepted
             from material_shortages sh left join purchase_orders po on po.mr_id = sh.mr_id and po.status not in ('Rejected','Cancelled')
             where sh.project_id = r.project_id and sh.status in ('Open','Ordered') and sh.mr_id is not null loop
      if x.po_id is not null and x.accepted >= x.to_buy then
        update material_shortages set status = 'Delivered' where id = x.id;
        perform app.clear_alert(r.org_id, 'shortage:' || x.id, format('Delivered on %s', x.po_id));
      elsif x.po_id is not null and x.po_status <> 'Pending approval' then
        update material_shortages set status = 'Ordered' where id = x.id and status = 'Open';
        update alerts set next_action = format('Track delivery of %s%s', x.po_id, coalesce(', expected ' || to_char(x.expected_delivery, 'DD Mon'), '')), updated_at = now()
         where org_id = r.org_id and dedupe_key = 'shortage:' || x.id and status <> 'Resolved';
      end if;
    end loop;
  end loop;
  -- resolve alerts whose condition has cleared
  update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Activity finished', updated_at = now()
   from tasks t where a.dedupe_key = 'delay:' || t.id and t.act_finish is not null and a.status <> 'Resolved' and (auth.uid() is null or a.org_id = app.org());
  update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Defect closed', updated_at = now()
   from snags sn where a.dedupe_key = 'safety:' || sn.id and sn.status = 'Closed' and a.status <> 'Resolved';
  update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Approval decided', updated_at = now()
   from approvals ap where a.dedupe_key = 'approval:' || ap.id and ap.status <> 'Pending' and a.status <> 'Resolved';
  update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Final inspection decided', updated_at = now()
   from inspections i where a.dedupe_key = 'final:' || i.unit_id and i.kind = 'Final' and i.status <> 'Requested' and a.status <> 'Resolved';
  update alerts set status = 'Open', updated_at = now() where status = 'Suppressed' and suppressed_until < now();
  -- escalate unacknowledged critical and high alerts, once
  for x in select a.*, r2.escalate_role, (r2.params ->> (a.severity || '_hours'))::numeric hrs from alerts a
           join automation_rules r2 on r2.org_id = a.org_id and r2.id = 'alert_escalation' and r2.enabled
           where a.status = 'Open' and a.escalated_at is null and a.severity in ('Critical','High') and (auth.uid() is null or a.org_id = app.org()) loop
    if x.hrs is not null and x.created_at < now() - make_interval(hours => x.hrs::integer) then
      if x.project_id is not null then perform app.notify_role(x.project_id, x.escalate_role, format('Escalation [%s]: %s — %s', x.severity, x.title, x.next_action), 'alerts'); end if;
      update alerts set escalated_at = now() where id = x.id;
    end if;
  end loop;
  return n;
end $$;
update automation_rules set notify_roles = '{finance}' where id = 'budget_overrun' and notify_roles = '{pm,finance}';

-- ---------- API ----------
create or replace function api.add_material(p_code text, p_name text, p_uom text, p_category text, p_cost_code text, p_lead_days integer) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v uuid;
begin
  perform app.require_perm('procurement', 'edit');
  insert into materials (org_id, code, name, uom, category, cost_code, lead_days) values (app.org(), upper(trim(p_code)), trim(p_name), p_uom, coalesce(p_category, 'General'), p_cost_code, coalesce(p_lead_days, 7))
  on conflict (org_id, code) do update set name = excluded.name, uom = excluded.uom, category = excluded.category, cost_code = excluded.cost_code, lead_days = excluded.lead_days returning id into v;
  return v;
end $$;

create or replace function api.report_shortage(p_project text, p_material uuid, p_qty numeric, p_needed_by date, p_task uuid default null, p_note text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_id text;
begin
  perform app.require(p_project, 'site', 'create');
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  if p_needed_by < app.today() then raise exception 'the need date is in the past'; end if;
  if not exists (select 1 from materials where id = p_material and org_id = app.org() and active) then raise exception 'unknown material'; end if;
  if p_task is not null and not exists (select 1 from tasks where id = p_task and project_id = p_project) then raise exception 'activity is not in this project'; end if;
  if exists (select 1 from material_shortages where project_id = p_project and material_id = p_material and status in ('Open','Ordered') and reported_at > now() - interval '3 days') then
    raise exception 'this shortage is already reported and being handled' using errcode = '23505'; end if;
  v_id := app.next_no(app.org(), 'SH');
  insert into material_shortages (id, org_id, project_id, material_id, qty, needed_by, task_id, note, reported_by) values (v_id, app.org(), p_project, p_material, p_qty, p_needed_by, p_task, p_note, auth.uid());
  perform app.emit(p_project, 'material_shortage', 'shortage:' || v_id, jsonb_build_object('shortage', v_id, 'title', (select name from materials where id = p_material)));
  return v_id;
end $$;

create or replace function api.issue_stock(p_project text, p_material uuid, p_qty numeric, p_task uuid default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = public, app as $$
declare v bigint; v_on numeric;
begin
  perform app.require(p_project, 'procurement', 'edit');
  perform pg_advisory_xact_lock(hashtext(p_project || p_material::text));   -- two people issuing the last bags cannot both succeed
  v_on := app.stock_on_hand(p_project, p_material);
  if p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  if p_qty > v_on then raise exception 'only % in stock', v_on using errcode = '23514'; end if;
  insert into stock_moves (org_id, project_id, material_id, kind, qty, ref_kind, task_id, moved_on, by_user, note) values (app.org(), p_project, p_material, 'issue', p_qty, 'issue', p_task, app.today(), auth.uid(), p_note) returning id into v;
  update material_reservations set status = 'Issued' where project_id = p_project and material_id = p_material and task_id is not distinct from p_task and status = 'Active' and qty <= p_qty;
  return v;
end $$;

create or replace function api.reserve_material(p_project text, p_material uuid, p_task uuid, p_qty numeric, p_needed_by date) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v uuid;
begin
  perform app.require(p_project, 'procurement', 'create');
  insert into material_reservations (project_id, material_id, task_id, qty, needed_by, created_by) values (p_project, p_material, p_task, p_qty, p_needed_by, auth.uid()) returning id into v;
  return v;
end $$;

create or replace function api.stock_position(p_project text)
returns table (material_id uuid, code text, name text, uom text, on_hand numeric, reserved numeric, available numeric, on_order numeric, next_delivery date)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'procurement', 'view');
  return query
  select m.id, m.code, m.name, m.uom, app.stock_on_hand(p_project, m.id),
    coalesce((select sum(qty) from material_reservations r where r.project_id = p_project and r.material_id = m.id and r.status = 'Active'), 0),
    app.stock_on_hand(p_project, m.id) - coalesce((select sum(qty) from material_reservations r where r.project_id = p_project and r.material_id = m.id and r.status = 'Active'), 0),
    coalesce((select sum(po.qty - coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0)) from purchase_orders po where po.project_id = p_project and po.material_id = m.id and po.status in ('Approved','Part received')), 0),
    (select min(po.expected_delivery) from purchase_orders po where po.project_id = p_project and po.material_id = m.id and po.status in ('Approved','Part received'))
  from materials m where m.org_id = (select org_id from projects where id = p_project)
    and (exists (select 1 from stock_moves sm where sm.project_id = p_project and sm.material_id = m.id) or exists (select 1 from purchase_orders po where po.project_id = p_project and po.material_id = m.id)
         or exists (select 1 from material_reservations r where r.project_id = p_project and r.material_id = m.id))
  order by m.code;
end $$;

create or replace function api.submit_claim(p_contract text, p_lines jsonb, p_note text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare c contracts; me profiles; v_id text; v_no integer; l jsonb; i integer := 0; v_gross numeric := 0;
begin
  select * into c from contracts where id = p_contract;
  if not found then raise exception 'contract % not found', p_contract; end if;
  select * into me from profiles where user_id = auth.uid() and active;
  if me.role_id = 'vendor' then
    if me.vendor_id is distinct from c.vendor_id or not app.has_project(c.project_id) then raise exception 'you can claim only on your own contracts' using errcode = '42501'; end if;
  else perform app.require(c.project_id, 'contracts', 'create'); end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'a claim needs at least one line'; end if;
  if exists (select 1 from contractor_claims where contract_id = p_contract and status in ('Submitted','Discrepancies')) then raise exception 'a claim on this contract is already open' using errcode = '23505'; end if;
  if exists (select 1 from ra_bills where contract_id = p_contract and status = 'In approval') then raise exception 'the previous bill on this contract is still in certification' using errcode = '23505'; end if;
  select coalesce(max(claim_no), 0) + 1 into v_no from contractor_claims where contract_id = p_contract;
  v_id := app.next_no(c.org_id, 'CL');
  insert into contractor_claims (id, org_id, project_id, contract_id, claim_no, submitted_by, note) values (v_id, c.org_id, c.project_id, p_contract, v_no, auth.uid(), p_note);
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into claim_lines (claim_id, line_no, contract_item_id, description, claimed_qty, claimed_rate)
    values (v_id, i, (l ->> 'contract_item_id')::uuid, coalesce(l ->> 'description', (select description from contract_items where id = (l ->> 'contract_item_id')::uuid), 'Item'), (l ->> 'qty')::numeric, (l ->> 'rate')::numeric);
    v_gross := v_gross + round((l ->> 'qty')::numeric * (l ->> 'rate')::numeric, 2);
  end loop;
  update contractor_claims set claimed_gross = v_gross where id = v_id;
  perform app.emit(c.project_id, 'contractor_claim', 'claim:' || v_id, jsonb_build_object('claim', v_id, 'title', format('Claim %s on %s', v_no, p_contract)));
  return v_id;
end $$;

-- after reviewing discrepancies the QS can bill the assessed (verified) quantities, or return the claim
create or replace function api.decide_claim(p_claim text, p_decision text, p_note text) returns text
language plpgsql security definer set search_path = public, app as $$
declare cl contractor_claims; v_bill text;
begin
  select * into cl from contractor_claims where id = p_claim for update;
  if not found then raise exception 'claim % not found', p_claim; end if;
  perform app.require(cl.project_id, 'contracts', 'edit');
  if cl.status <> 'Discrepancies' then raise exception 'claim is %', cl.status; end if;
  if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'record why (at least 5 characters)'; end if;
  if p_decision = 'bill_assessed' then
    v_bill := app.ra_bill_core(cl.contract_id, 0, cl.submitted_by);
    update contractor_claims set status = 'Billed', ra_bill_id = v_bill, note = coalesce(note || ' · ', '') || 'QS: ' || p_note where id = p_claim;
  elsif p_decision = 'return' then
    update contractor_claims set status = 'Rejected', note = coalesce(note || ' · ', '') || 'QS: ' || p_note where id = p_claim;
  else raise exception 'decision must be bill_assessed or return'; end if;
  perform app.clear_alert(cl.org_id, 'claim:' || p_claim, p_decision);
  return coalesce(v_bill, 'returned');
end $$;

create or replace function api.submit_recovery_plan(p_task uuid, p_plan text, p_expected_finish date) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'activity not found'; end if;
  perform app.require(t.project_id, 'schedule', 'edit');
  if coalesce(length(trim(p_plan)), 0) < 10 then raise exception 'describe the recovery plan (at least 10 characters)'; end if;
  update tasks set recovery_plan = p_plan || coalesce(' · expected finish ' || to_char(p_expected_finish, 'DD Mon YYYY'), '') where id = p_task;
  update alerts set status = 'Acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now(), next_action = 'Deliver the recovery plan; the alert closes when the activity finishes', updated_at = now()
   where dedupe_key = 'delay:' || p_task and status = 'Open';
end $$;

-- what-if: move one activity by N days and see the milestones (nothing is saved)
create or replace function api.simulate_delay(p_task uuid, p_days integer)
returns table (milestone text, base_finish date, forecast_now date, forecast_if_delayed date, extra_slip_days integer)
language plpgsql security definer set search_path = public, app as $$
declare v_project text;
begin
  select project_id into v_project from tasks where id = p_task;
  perform app.require(v_project, 'schedule', 'view');
  if p_days not between 1 and 365 then raise exception 'days must be between 1 and 365'; end if;
  return query
  with now_f as (select * from app.schedule_forecast(v_project)), if_f as (select * from app.schedule_forecast(v_project, p_task, p_days))
  select n.task_name, n.base_finish, n.forecast_finish, i.forecast_finish, (i.forecast_finish - n.forecast_finish)::integer
  from now_f n join if_f i on i.task_id = n.task_id where n.milestone order by n.base_finish;
end $$;

create or replace function api.ack_alert(p_alert bigint, p_note text default null) returns void language plpgsql security definer set search_path = public, app as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found or a.org_id <> app.org() then raise exception 'alert not found'; end if;
  if a.owner_id is distinct from auth.uid() then perform app.require(a.project_id, a.module, 'edit'); end if;
  update alerts set status = 'Acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now(), resolution = coalesce(p_note, resolution), updated_at = now() where id = p_alert and status = 'Open';
end $$;
create or replace function api.resolve_alert(p_alert bigint, p_resolution text) returns void language plpgsql security definer set search_path = public, app as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found or a.org_id <> app.org() then raise exception 'alert not found'; end if;
  if a.owner_id is distinct from auth.uid() then perform app.require(a.project_id, a.module, 'edit'); end if;
  if coalesce(length(trim(p_resolution)), 0) < 5 then raise exception 'say how it was resolved (at least 5 characters)'; end if;
  update alerts set status = 'Resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = p_resolution, updated_at = now() where id = p_alert;
end $$;
create or replace function api.snooze_alert(p_alert bigint, p_until timestamptz, p_reason text) returns void language plpgsql security definer set search_path = public, app as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found or a.org_id <> app.org() then raise exception 'alert not found'; end if;
  if a.severity = 'Critical' then raise exception 'critical alerts cannot be snoozed' using errcode = '42501'; end if;
  if a.owner_id is distinct from auth.uid() then perform app.require(a.project_id, a.module, 'edit'); end if;
  if p_until > now() + interval '14 days' then raise exception 'snooze for at most 14 days'; end if;
  update alerts set status = 'Suppressed', suppressed_until = p_until, resolution = p_reason, updated_at = now() where id = p_alert;
end $$;

-- ---------- row-level security and grants for the new tables ----------
alter table public.materials enable row level security; alter table public.stock_moves enable row level security; alter table public.material_reservations enable row level security;
alter table public.material_shortages enable row level security; alter table public.contractor_claims enable row level security; alter table public.claim_lines enable row level security;
alter table public.payment_requests enable row level security; alter table public.alerts enable row level security; alter table public.automation_actions enable row level security;
create policy materials_org on public.materials for select to authenticated using (org_id = app.org());
create policy stock_moves_scope on public.stock_moves for select to authenticated using (app.can(project_id, 'procurement', 'view'));
create policy reservations_scope on public.material_reservations for select to authenticated using (app.can(project_id, 'procurement', 'view'));
create policy shortages_scope on public.material_shortages for select to authenticated using (app.can(project_id, 'procurement', 'view') or app.can(project_id, 'site', 'view'));
create policy claims_scope on public.contractor_claims for select to authenticated using (app.can(project_id, 'contracts', 'view') or submitted_by = auth.uid());
create policy claim_lines_scope on public.claim_lines for select to authenticated using (exists (select 1 from contractor_claims c where c.id = claim_id and (app.can(c.project_id, 'contracts', 'view') or c.submitted_by = auth.uid())));
create policy payment_requests_scope on public.payment_requests for select to authenticated using (app.can(project_id, 'payments', 'view'));
create policy alerts_scope on public.alerts for select to authenticated using (org_id = app.org() and (owner_id = auth.uid() or (project_id is not null and app.can(project_id, module, 'view'))
  or (project_id is null and app.has_perm(module, 'view'))));
create policy actions_scope on public.automation_actions for select to authenticated using (org_id = app.org() and app.has_perm('settings', 'view'));
revoke all on public.materials, public.stock_moves, public.material_reservations, public.material_shortages, public.contractor_claims, public.claim_lines,
  public.payment_requests, public.alerts, public.automation_actions from anon, authenticated;
grant select on public.materials, public.stock_moves, public.material_reservations, public.material_shortages, public.contractor_claims, public.claim_lines,
  public.payment_requests, public.alerts, public.automation_actions to authenticated;
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
grant execute on function app.uid(), app.org(), app.role(), app.has_perm(text, text), app.has_project(text), app.can(text, text, text), app.today(uuid), app.local_time(uuid) to authenticated;
revoke execute on function api.process_events(integer), api.scan_exceptions() from authenticated;
-- audit the new business tables like the rest
do $$ declare t text; begin
  foreach t in array array['materials','stock_moves','material_reservations','material_shortages','contractor_claims','claim_lines','payment_requests','alerts'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- an order raised from a catalogued request carries the material, so its receipt reaches the stock ledger
create or replace function app.po_material_from_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.material_id is null and new.mr_id is not null then new.material_id := (select material_id from material_requests where id = new.mr_id); end if;
  return new;
end $$;
create trigger po_material_from_request before insert on public.purchase_orders for each row execute function app.po_material_from_request();

-- rule parameters are configurable through the administration API
create or replace function api.set_automation_rule(p_rule text, p jsonb) returns boolean
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm('settings', 'edit');
  update automation_rules set
    enabled = coalesce((p ->> 'enabled')::boolean, enabled),
    notify_roles = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'notify_roles') x), notify_roles),
    channels = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'channels') x), channels),
    escalate_role = case when p ? 'escalate_role' then p ->> 'escalate_role' else escalate_role end,
    escalate_after_hours = coalesce((p ->> 'escalate_after_hours')::integer, escalate_after_hours),
    params = params || coalesce(p -> 'params', '{}')
  where org_id = app.org() and id = p_rule;
  if not found then raise exception 'unknown rule %', p_rule; end if;
  return true;
end $$;
revoke all on function app.po_material_from_request() from public;
