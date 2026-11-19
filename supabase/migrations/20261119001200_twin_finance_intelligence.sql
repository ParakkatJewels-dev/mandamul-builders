-- M Andamul Development OS · 1200 Phase 3, batches 3–5: digital project twin, financial intelligence and scenarios,
-- contractor performance, procurement intelligence. Read functions only compute; nothing here approves or buys.

-- ======================= digital twin: property → zone → building → floor → unit → work package → task =======================
create table public.zones (
  id uuid primary key default gen_random_uuid(), project_id text not null references public.projects(id) on delete cascade,
  code text not null, name text not null, kind text not null default 'Villas' check (kind in ('Villas','Amenities','Infrastructure','Landscape','Utilities','Back of house')),
  plan_x numeric(6,3) check (plan_x between 0 and 100), plan_y numeric(6,3) check (plan_y between 0 and 100), unique (project_id, code)
);
alter table public.buildings add column if not exists zone_id uuid references public.zones(id);
create table public.floors (
  id uuid primary key default gen_random_uuid(), building_id uuid not null references public.buildings(id) on delete cascade,
  level integer not null, name text not null, unique (building_id, level)
);
alter table public.units add column if not exists zone_id uuid references public.zones(id), add column if not exists floor_id uuid references public.floors(id);
create table public.work_packages (
  id uuid primary key default gen_random_uuid(), project_id text not null references public.projects(id) on delete cascade,
  code text not null, name text not null, zone_id uuid references public.zones(id), unit_id uuid references public.units(id),
  cost_code text, budget numeric(18,2) not null default 0 check (budget >= 0), unique (project_id, code)
);
alter table public.tasks add column if not exists work_package_id uuid references public.work_packages(id);
alter table public.contracts add column if not exists work_package_id uuid references public.work_packages(id);
alter table public.purchase_orders add column if not exists work_package_id uuid references public.work_packages(id);
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(), project_id text not null references public.projects(id) on delete cascade,
  unit_id uuid references public.units(id), work_package_id uuid references public.work_packages(id), task_id uuid references public.tasks(id),
  storage_path text not null, thumb_path text, caption text, taken_on date not null, uploaded_by uuid, created_at timestamptz not null default now(),
  check (storage_path ~ ('^' || project_id || '/site/'))
);
create index progress_photos_unit on public.progress_photos (unit_id, taken_on desc);
alter table public.document_links drop constraint if exists document_links_link_kind_check,
  add constraint document_links_link_kind_check check (link_kind in ('task','boq_item','cost_code','unit','zone','building','work_package'));
create index if not exists units_zone on public.units (zone_id); create index if not exists units_building on public.units (building_id);
create index if not exists tasks_wp on public.tasks (work_package_id); create index if not exists tasks_unit on public.tasks (unit_id);
create index if not exists contracts_wp on public.contracts (work_package_id); create index if not exists contracts_unit on public.contracts (unit_id);
create index if not exists po_wp on public.purchase_orders (work_package_id); create index if not exists po_unit on public.purchase_orders (unit_id);

-- one place that says what each unit and each work package has cost, done and still owes
create or replace function app.twin_leaves(p_project text)
returns table (kind text, id uuid, code text, name text, zone_id uuid, building_id uuid, floor_id uuid, unit_id uuid, budget numeric, committed numeric, actual numeric,
  open_defects bigint, safety_defects bigint, insp_passed bigint, insp_open bigint, insp_failed bigint, stages_total bigint, stages_passed bigint, photos bigint, last_photo text,
  ready boolean, handed_over boolean, contractors text[], base_start date, base_finish date, act_start date, act_finish date, forecast_finish date, design_refs bigint, status text)
language sql volatile security definer set search_path = public, app as $$
  with fc as materialized (select f.task_id, f.forecast_finish from app.schedule_forecast(p_project) f),
  po_c as (select coalesce(work_package_id::text, unit_id::text) k, sum(case when status in ('Approved','Part received','Received') then total else 0 end) c,
                  sum(coalesce((select sum(g.accepted_value) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0)) a
           from purchase_orders po where project_id = p_project and (unit_id is not null or work_package_id is not null) group by 1),
  co_c as (select coalesce(c.work_package_id::text, c.unit_id::text) k, sum(case when c.status = 'Active' then app.incl_gst(app.contract_value(c.id), c.gst_pct) else 0 end) c,
                  sum(coalesce((select sum(b.gross + b.gst) from ra_bills b where b.contract_id = c.id and b.status in ('Approved','Paid')), 0)) a,
                  array_agg(distinct v.name) names
           from contracts c join vendors v on v.id = c.vendor_id where c.project_id = p_project and (c.unit_id is not null or c.work_package_id is not null) group by 1),
  leaves as (
    select 'unit'::text kind, u.id, u.code, u.name, coalesce(u.zone_id, b.zone_id) zone_id, u.building_id, u.floor_id, u.id unit_id, u.budget from units u left join buildings b on b.id = u.building_id where u.project_id = p_project
    union all
    select 'work_package', w.id, w.code, w.name, coalesce(w.zone_id, uu.zone_id, bb.zone_id), uu.building_id, uu.floor_id, w.unit_id, w.budget
    from work_packages w left join units uu on uu.id = w.unit_id left join buildings bb on bb.id = uu.building_id where w.project_id = p_project and w.unit_id is null)
  select l.kind, l.id, l.code, l.name, l.zone_id, l.building_id, l.floor_id, l.unit_id, l.budget,
    coalesce(pc.c, 0) + coalesce(cc.c, 0) + coalesce((select sum(coalesce(p2.c, 0) + coalesce(c2.c, 0)) from work_packages w2 left join po_c p2 on p2.k = w2.id::text left join co_c c2 on c2.k = w2.id::text where l.kind = 'unit' and w2.unit_id = l.id), 0),
    coalesce(pc.a, 0) + coalesce(cc.a, 0) + coalesce((select sum(coalesce(p2.a, 0) + coalesce(c2.a, 0)) from work_packages w2 left join po_c p2 on p2.k = w2.id::text left join co_c c2 on c2.k = w2.id::text where l.kind = 'unit' and w2.unit_id = l.id), 0),
    (select count(*) from snags s where s.unit_id = l.unit_id and l.kind = 'unit' and s.status <> 'Closed'),
    (select count(*) from snags s where s.unit_id = l.unit_id and l.kind = 'unit' and s.status <> 'Closed' and s.severity = 'Safety-critical'),
    (select count(*) from inspections i where i.unit_id = l.unit_id and l.kind = 'unit' and i.status = 'Passed'),
    (select count(*) from inspections i where i.unit_id = l.unit_id and l.kind = 'unit' and i.status = 'Requested'),
    (select count(*) from inspections i where i.unit_id = l.unit_id and l.kind = 'unit' and i.status = 'Failed'),
    (select count(*) from unit_stages s where s.unit_id = l.unit_id and l.kind = 'unit'),
    (select count(*) from unit_stages s where s.unit_id = l.unit_id and l.kind = 'unit' and s.status = 'Passed'),
    (select count(*) from progress_photos ph where (l.kind = 'unit' and ph.unit_id = l.id) or (l.kind = 'work_package' and ph.work_package_id = l.id)),
    (select ph.storage_path from progress_photos ph where (l.kind = 'unit' and ph.unit_id = l.id) or (l.kind = 'work_package' and ph.work_package_id = l.id) order by ph.taken_on desc limit 1),
    l.kind = 'unit' and app.unit_readiness(l.id) ->> 'status' = 'Ready',
    l.kind = 'unit' and (select handed_over_at is not null from units where id = l.id),
    coalesce(cc.names, '{}') || coalesce((select array_agg(distinct v.name) from contracts c join vendors v on v.id = c.vendor_id join work_packages w2 on w2.id = c.work_package_id where l.kind = 'unit' and w2.unit_id = l.id), '{}'),
    t.bs, t.bf, t.ast, t.af, t.ff,
    (select count(*) from document_links dl where dl.link_id = l.id::text and dl.link_kind in ('unit','work_package')),
    case when l.kind = 'unit' then app.unit_readiness(l.id) ->> 'status'
         when t.af is not null and t.open = 0 then 'Complete' when t.ast is not null then 'In progress' else 'Not started' end
  from leaves l
  left join po_c pc on pc.k = l.id::text left join co_c cc on cc.k = l.id::text
  left join lateral (select min(tk.base_start) bs, max(tk.base_finish) bf, min(tk.act_start) ast, max(tk.act_finish) af, max(fc.forecast_finish) ff, count(*) filter (where tk.act_finish is null) open
                     from tasks tk left join fc on fc.task_id = tk.id
                     where tk.project_id = p_project and (tk.unit_id = l.id or tk.work_package_id = l.id or tk.work_package_id in (select w3.id from work_packages w3 where w3.unit_id = l.id and l.kind = 'unit'))) t on true
$$;

-- the whole tree with rolled-up figures; cost figures appear only for people who may see costs
create or replace function api.twin(p_project text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_cost boolean; v jsonb;
begin
  perform app.require(p_project, 'projects', 'view');
  v_cost := app.has_perm('budget', 'view');
  create temp table if not exists _tw on commit drop as select * from app.twin_leaves(p_project) limit 0;
  delete from _tw; insert into _tw select * from app.twin_leaves(p_project);
  with m as (select *, jsonb_build_object(
      'budget', case when v_cost then budget end, 'committed', case when v_cost then committed end, 'actual', case when v_cost then actual end,
      'forecast_remaining', case when v_cost then greatest(budget, committed) - actual end,
      'completion_pct', case when stages_total > 0 then round(stages_passed * 100.0 / stages_total, 1) end,
      'open_defects', open_defects, 'safety_defects', safety_defects, 'inspections', jsonb_build_object('passed', insp_passed, 'open', insp_open, 'failed', insp_failed),
      'photos', photos, 'last_photo', last_photo, 'design_refs', design_refs, 'contractors', to_jsonb(contractors),
      'planned', jsonb_build_object('start', base_start, 'finish', base_finish), 'actual_dates', jsonb_build_object('start', act_start, 'finish', act_finish), 'forecast_finish', forecast_finish,
      'status', status, 'handed_over', handed_over, 'ready', ready) metrics from _tw),
  ctr as (select k.key_kind, k.key_id, jsonb_agg(distinct c) names from _tw x,
          lateral (values ('property', null::uuid), ('zone', x.zone_id), ('building', x.building_id), ('floor', x.floor_id)) k(key_kind, key_id), unnest(x.contractors) c group by 1, 2),
  roll as (
    -- aggregate any set of leaves into the same metric shape
    select y.key_kind, y.key_id, jsonb_build_object(
      'budget', case when v_cost then sum(budget) end, 'committed', case when v_cost then sum(committed) end, 'actual', case when v_cost then sum(actual) end,
      'forecast_remaining', case when v_cost then sum(greatest(budget, committed) - actual) end,
      'completion_pct', case when sum(stages_total) > 0 then round(sum(stages_passed) * 100.0 / sum(stages_total), 1) end,
      'open_defects', sum(open_defects), 'safety_defects', sum(safety_defects),
      'inspections', jsonb_build_object('passed', sum(insp_passed), 'open', sum(insp_open), 'failed', sum(insp_failed)),
      'photos', sum(photos), 'design_refs', sum(design_refs),
      'contractors', coalesce((select ctr.names from ctr where ctr.key_kind = y.key_kind and ctr.key_id is not distinct from y.key_id), '[]'),
      'planned', jsonb_build_object('start', min(base_start), 'finish', max(base_finish)), 'actual_dates', jsonb_build_object('start', min(act_start), 'finish', case when bool_and(act_finish is not null) then max(act_finish) end),
      'forecast_finish', max(forecast_finish),
      'units', count(*) filter (where kind = 'unit'), 'units_ready', count(*) filter (where ready), 'units_handed_over', count(*) filter (where handed_over),
      'status', case when count(*) filter (where kind = 'unit') > 0 and count(*) filter (where kind = 'unit') = count(*) filter (where handed_over) then 'Handed over'
                     when sum(safety_defects) > 0 then 'Blocked' when count(*) filter (where status in ('Not started')) = count(*) then 'Not started' else 'In progress' end) metrics
    from (select x.*, k.key_kind, k.key_id from _tw x,
          lateral (values ('property', null::uuid), ('zone', x.zone_id), ('building', x.building_id), ('floor', x.floor_id)) k(key_kind, key_id)) y
    group by y.key_kind, y.key_id)
  select jsonb_build_object('kind', 'property', 'id', p_project, 'name', (select name from projects where id = p_project), 'cost_visible', v_cost,
    'metrics', (select metrics from roll where key_kind = 'property'),
    'children', coalesce((select jsonb_agg(jsonb_build_object('kind', 'zone', 'id', z.id, 'code', z.code, 'name', z.name, 'zone_kind', z.kind, 'metrics', (select metrics from roll where key_kind = 'zone' and key_id = z.id),
       'children', coalesce((select jsonb_agg(jsonb_build_object('kind', 'building', 'id', b.id, 'code', b.code, 'name', b.name, 'metrics', (select metrics from roll where key_kind = 'building' and key_id = b.id),
          'children', coalesce((select jsonb_agg(jsonb_build_object('kind', 'floor', 'id', f.id, 'name', f.name, 'level', f.level, 'metrics', (select metrics from roll where key_kind = 'floor' and key_id = f.id),
             'children', coalesce((select jsonb_agg(jsonb_build_object('kind', 'unit', 'id', m.id, 'code', m.code, 'name', m.name, 'metrics', m.metrics) order by m.code) from m where m.floor_id = f.id), '[]')) order by f.level)
             from floors f where f.building_id = b.id), '[]')
           || coalesce((select jsonb_agg(jsonb_build_object('kind', 'unit', 'id', m.id, 'code', m.code, 'name', m.name, 'metrics', m.metrics) order by m.code) from m where m.building_id = b.id and m.floor_id is null and m.kind = 'unit'), '[]'))
          order by b.code) from buildings b where b.zone_id = z.id), '[]')
        || coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'id', m.id, 'code', m.code, 'name', m.name, 'metrics', m.metrics) order by m.kind desc, m.code) from m where m.zone_id = z.id and m.building_id is null), '[]'))
      order by z.code) from zones z where z.project_id = p_project), '[]')
     || coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'id', m.id, 'code', m.code, 'name', m.name, 'metrics', m.metrics) order by m.code) from m where m.zone_id is null and m.building_id is null), '[]'))
  into v;
  return v;
end $$;

-- the level below a unit: its work packages and every task with planned, actual and forecast dates
create or replace function api.twin_tasks(p_project text, p_unit uuid default null, p_work_package uuid default null)
returns table (task_id uuid, wbs text, name text, work_package text, contractor text, progress integer, base_start date, base_finish date, act_start date, act_finish date, forecast_finish date, slip integer, recovery_plan text)
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'schedule', 'view');
  return query
  select t.id, t.wbs, t.name, w.code || ' ' || w.name, v.name, t.progress, t.base_start, t.base_finish, t.act_start, t.act_finish, f.forecast_finish, f.slip, t.recovery_plan
  from tasks t left join work_packages w on w.id = t.work_package_id left join vendors v on v.id = t.contractor_id
  left join app.schedule_forecast(p_project) f on f.task_id = t.id
  where t.project_id = p_project and (p_unit is null or t.unit_id = p_unit or w.unit_id = p_unit) and (p_work_package is null or t.work_package_id = p_work_package)
  order by t.base_start, t.wbs;
end $$;

-- ======================= financial intelligence =======================
-- the cost engine without the permission check, for the scheduler and other engine functions; people call api.cost_position
create or replace function app.cost_position_internal(p_project text)
returns table (code text, name text, original_budget numeric, approved_changes numeric, current_budget numeric, committed numeric, pending numeric,
               actual numeric, paid_against_cost numeric, retention_held numeric, accrued_unpaid numeric, uncommitted_forecast numeric,
               forecast numeric, variance numeric, uncommitted_budget numeric)
language plpgsql stable security definer set search_path = public, app as $$
declare v_orig uuid; v_cur uuid;
begin
  select id into v_orig from budget_versions where project_id = p_project and v = 1 and status = 'Approved';
  v_cur := app.current_budget(p_project);
  return query
  with cc as (select c.code, c.name from cost_codes c join projects p on p.org_id = c.org_id where p.id = p_project),
  com as (select x.code, (app.code_commitments(p_project, x.code)).* from cc x),
  grn as (select po.code, sum(g.accepted_value) v from goods_receipts g join purchase_orders po on po.id = g.po_id where po.project_id = p_project group by po.code),
  bills as (select c.code, sum(b.gross + b.gst) v, sum(b.retention) ret, sum(b.advance_recovery) adv from ra_bills b join contracts c on c.id = b.contract_id
            where c.project_id = p_project and b.status in ('Approved','Paid') group by c.code),
  pinv as (select po.code, sum(pm.amount) v from payments pm join vendor_invoices i on i.id = pm.invoice_id join purchase_orders po on po.id = i.po_id where pm.project_id = p_project group by po.code),
  pbill as (select c.code, sum(pm.amount + pm.tds) v from payments pm join ra_bills b on b.id = pm.ra_bill_id join contracts c on c.id = b.contract_id where pm.project_id = p_project group by c.code)
  select cc.code, cc.name,
    coalesce((select amount from budget_lines where version_id = v_orig and budget_lines.code = cc.code), 0),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0) - coalesce((select amount from budget_lines where version_id = v_orig and budget_lines.code = cc.code), 0),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0),
    com.committed, com.pending,
    coalesce(grn.v, 0) + coalesce(bills.v, 0),
    coalesce(pinv.v, 0) + coalesce(pbill.v, 0) + coalesce(bills.adv, 0),
    coalesce(bills.ret, 0),
    coalesce(grn.v, 0) + coalesce(bills.v, 0) - (coalesce(pinv.v, 0) + coalesce(pbill.v, 0) + coalesce(bills.adv, 0)) - coalesce(bills.ret, 0),
    coalesce(e.amount, 0),
    com.committed + coalesce(e.amount, 0),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0) - (com.committed + coalesce(e.amount, 0)),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0) - com.committed
  from cc join com on com.code = cc.code
  left join grn on grn.code = cc.code left join bills on bills.code = cc.code left join pinv on pinv.code = cc.code left join pbill on pbill.code = cc.code
  left join etc_estimates e on e.project_id = p_project and e.code = cc.code
  order by cc.code;
end $$;
create or replace function api.cost_position(p_project text)
returns table (code text, name text, original_budget numeric, approved_changes numeric, current_budget numeric, committed numeric, pending numeric,
               actual numeric, paid_against_cost numeric, retention_held numeric, accrued_unpaid numeric, uncommitted_forecast numeric,
               forecast numeric, variance numeric, uncommitted_budget numeric)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'budget', 'view');
  return query select * from app.cost_position_internal(p_project);
end $$;

-- Recorded figures come from approved documents; projected figures are labelled with the assumption behind them.
create table public.forecast_scenarios (
  org_id uuid not null references public.organizations(id), scenario text not null check (scenario in ('Best','Base','Worst')),
  etc_factor numeric(5,3) not null check (etc_factor between 0.5 and 2),
  pending_variation_pct numeric(5,2) not null check (pending_variation_pct between 0 and 100),
  delay_days_adjust integer not null default 0, note text not null, primary key (org_id, scenario)
);
create or replace function app.seed_scenarios(p_org uuid) returns void language sql security definer set search_path = public as $$
  insert into forecast_scenarios values
    (p_org, 'Best', 0.95, 50, -15, 'Remaining work 5% below estimate; half of pending variations approved; 15 days of the forecast delay recovered'),
    (p_org, 'Base', 1.00, 75, 0, 'Remaining work as estimated; three quarters of pending variations approved; delay as forecast'),
    (p_org, 'Worst', 1.15, 100, 30, 'Remaining work 15% above estimate; all pending variations approved; a further 30 days of delay')
  on conflict do nothing;
$$;
select app.seed_scenarios(id) from organizations;
create or replace function app.bootstrap_org(p_org uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.bootstrap_org_base(p_org); perform app.apply_permission_defaults(p_org); perform app.seed_playbook_rules(p_org); perform app.seed_scenarios(p_org);
end $$;

create table public.vendor_prices (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  material_id uuid not null references public.materials(id), vendor_id uuid not null references public.vendors(id),
  rate numeric(18,2) not null check (rate > 0), gst_pct numeric(5,2) not null default 18, min_qty numeric(16,3) not null default 0 check (min_qty >= 0),
  lead_days integer not null check (lead_days between 0 and 365), valid_from date not null, valid_to date, approved_by uuid, approved_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index vendor_prices_material on public.vendor_prices (material_id, valid_from desc);
alter table public.boq_items add column if not exists material_id uuid references public.materials(id), add column if not exists material_factor numeric(12,4);

-- reference rate for a material on a date: the lowest approved price list rate, else the median of earlier orders
create or replace function app.reference_rate(p_material uuid, p_on date, p_exclude_po text default null) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(rate) from vendor_prices where material_id = p_material and valid_from <= p_on and (valid_to is null or valid_to >= p_on)),
    (select percentile_cont(0.5) within group (order by rate) from purchase_orders where material_id = p_material and status not in ('Rejected','Cancelled') and created_at::date < p_on and id is distinct from p_exclude_po))
$$;

create or replace function api.financial_intelligence(p_project text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare p projects; v_org uuid; cp record; v_fc record; v_slip integer; v_prelim_day numeric; v_dur integer; v_pv numeric; v_av numeric; v_cont record;
  v_villas integer; v_villa_attr numeric; v_villa_share numeric; v_scen jsonb; v_contracts jsonb; v_price jsonb; v_rev jsonb; v_cash jsonb; v_rec jsonb; v_proj jsonb;
begin
  perform app.require(p_project, 'budget', 'view');
  select * into p from projects where id = p_project; v_org := p.org_id;
  select sum(original_budget) ob, sum(current_budget) cb, sum(committed) co, sum(actual) ac, sum(paid_against_cost) pa, sum(accrued_unpaid) au, sum(retention_held) rh,
         sum(uncommitted_forecast) etc, sum(forecast) fac, sum(variance) var into cp from api.cost_position(p_project);
  select * into v_cont from api.contingency(p_project);
  select coalesce(sum(app.incl_gst(v.amount, c.gst_pct)) filter (where v.status = 'Pending approval'), 0), coalesce(sum(app.incl_gst(v.amount, c.gst_pct)) filter (where v.status = 'Approved'), 0)
    into v_pv, v_av from contract_variations v join contracts c on c.id = v.contract_id where c.project_id = p_project;
  select coalesce(max(slip) filter (where milestone and not finished), 0) into v_slip from app.schedule_forecast(p_project);
  select greatest(max(base_finish) - min(base_start), 1) into v_dur from tasks where project_id = p_project;
  -- time-related overhead per day of delay = preliminaries budget spread over the planned duration (an assumption, shown as such)
  v_prelim_day := round(coalesce((select current_budget from api.cost_position(p_project) where code = '01'), 0) / v_dur, 2);
  select count(*) into v_villas from units where project_id = p_project and template_id = 'villa';
  select coalesce(sum(committed), 0) into v_villa_attr from app.twin_leaves(p_project) where kind = 'unit' and id in (select id from units where project_id = p_project and template_id = 'villa');
  select coalesce(sum(budget) filter (where template_id = 'villa') / nullif(sum(budget), 0), 0) into v_villa_share from units where project_id = p_project;
  select coalesce(jsonb_agg(jsonb_build_object('scenario', s.scenario, 'assumptions', s.note,
           'etc', round(cp.etc * s.etc_factor, 2), 'pending_variations', round(v_pv * s.pending_variation_pct / 100, 2),
           'delay_days', greatest(v_slip + s.delay_days_adjust, 0), 'delay_cost', round(greatest(v_slip + s.delay_days_adjust, 0) * v_prelim_day, 2),
           'final_cost', round(cp.co + cp.etc * s.etc_factor + v_pv * s.pending_variation_pct / 100 + greatest(v_slip + s.delay_days_adjust, 0) * v_prelim_day, 2),
           'vs_budget', round(cp.cb - (cp.co + cp.etc * s.etc_factor + v_pv * s.pending_variation_pct / 100 + greatest(v_slip + s.delay_days_adjust, 0) * v_prelim_day), 2),
           'margin', case when p.contract_value is not null then round(p.contract_value - (cp.co + cp.etc * s.etc_factor + v_pv * s.pending_variation_pct / 100 + greatest(v_slip + s.delay_days_adjust, 0) * v_prelim_day), 2) end)
         order by case s.scenario when 'Best' then 1 when 'Base' then 2 else 3 end), '[]') into v_scen
  from forecast_scenarios s where s.org_id = v_org;
  select coalesce(jsonb_agg(x order by (x ->> 'growth_pct')::numeric desc nulls last), '[]') into v_contracts from (
    select jsonb_build_object('contract', c.id, 'vendor', v.name, 'title', c.title, 'status', c.status,
      'original', app.incl_gst(app.contract_value(c.id), c.gst_pct),
      'variations_approved', coalesce((select sum(app.incl_gst(amount, c.gst_pct)) from contract_variations where contract_id = c.id and status = 'Approved'), 0),
      'variations_pending', coalesce((select sum(app.incl_gst(amount, c.gst_pct)) from contract_variations where contract_id = c.id and status = 'Pending approval'), 0),
      'certified', coalesce((select sum(gross + gst) from ra_bills where contract_id = c.id and status in ('Approved','Paid')), 0),
      'growth_pct', round(coalesce((select sum(amount) from contract_variations where contract_id = c.id and status = 'Approved'), 0) * 100 / nullif(app.contract_value(c.id), 0), 1),
      'claim_accuracy_pct', (select round(avg(case when claimed_gross > 0 then (assessment ->> 'gross')::numeric * 100 / claimed_gross end), 1) from contractor_claims where contract_id = c.id and assessment is not null)) x
    from contracts c join vendors v on v.id = c.vendor_id where c.project_id = p_project and c.status in ('Active','Closed')) q;
  select coalesce(jsonb_agg(x order by abs((x ->> 'variance')::numeric) desc), '[]') into v_price from (
    select jsonb_build_object('po', po.id, 'item', po.item, 'vendor', v.name, 'qty', po.qty, 'rate', po.rate, 'reference_rate', round(r.ref, 2),
      'variance', round((po.rate - r.ref) * po.qty, 2), 'variance_pct', round((po.rate - r.ref) * 100 / r.ref, 1), 'reference_basis', case when exists (select 1 from vendor_prices vp where vp.material_id = po.material_id) then 'approved price list' else 'median of earlier orders' end) x
    from purchase_orders po join vendors v on v.id = po.vendor_id, lateral (select app.reference_rate(po.material_id, po.created_at::date, po.id) ref) r
    where po.project_id = p_project and po.material_id is not null and po.status not in ('Rejected','Cancelled') and r.ref is not null) q;
  select coalesce(jsonb_agg(jsonb_build_object('version', v, 'status', status, 'reason', reason, 'decided_at', decided_at,
           'total', (select sum(amount) from budget_lines where version_id = bv.id)) order by v), '[]') into v_rev from budget_versions bv where project_id = p_project;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'due', due, 'forecast', forecast)), '[]') into v_cash from api.cash_requirement(p_project, 90);
  return jsonb_build_object(
    'project', p_project, 'as_of', now(),
    'recorded', jsonb_build_object('basis', 'approved documents: budget versions, orders, contracts, receipts, certified bills, payments',
      'original_budget', cp.ob, 'current_budget', cp.cb, 'approved_changes', cp.cb - cp.ob, 'revisions', v_rev, 'committed', cp.co, 'actual', cp.ac, 'paid', cp.pa,
      'accrued_unpaid', cp.au, 'retention_held', cp.rh, 'variations_approved', v_av,
      'contingency', jsonb_build_object('budget', v_cont.contingency_budget, 'overruns_on_other_codes', v_cont.overruns, 'available', v_cont.available)),
    'projected', jsonb_build_object('basis', 'QS estimate to complete plus the schedule forecast; these are projections, not records',
      'estimate_to_complete', cp.etc, 'forecast_final_cost', cp.fac, 'variance_to_budget', cp.var, 'variations_pending', v_pv,
      'schedule_slip_days', v_slip, 'delay_cost_per_day', v_prelim_day, 'delay_cost_basis', 'preliminaries budget ÷ planned duration', 'cash_requirement', v_cash),
    'kpis', jsonb_build_object('built_up_sqft', p.built_up_sqft, 'keys', p.keys, 'villas', v_villas,
      'forecast_cost_per_sqft', round(cp.fac / nullif(p.built_up_sqft, 0), 2), 'actual_cost_per_sqft', round(cp.ac / nullif(p.built_up_sqft, 0), 2),
      'forecast_cost_per_key', round(cp.fac / nullif(p.keys, 0), 2),
      'cost_per_villa_attributed', round(v_villa_attr / nullif(v_villas, 0), 2), 'cost_per_villa_attributed_basis', 'commitments linked to villa units ÷ villas',
      'cost_per_villa_allocated', round(cp.fac * v_villa_share / nullif(v_villas, 0), 2), 'cost_per_villa_allocated_basis', 'forecast final cost × villa share of unit budgets ÷ villas'),
    'profitability', jsonb_build_object('contract_value', p.contract_value, 'forecast_final_cost', cp.fac, 'margin', p.contract_value - cp.fac,
      'margin_pct', round((p.contract_value - cp.fac) * 100 / nullif(p.contract_value, 0), 1), 'basis', 'client contract value (recorded) − forecast final cost (projected)'),
    'contractors', v_contracts, 'price_variance', v_price, 'scenarios', v_scen);
end $$;

-- financial exceptions raised by the scan (called for every active project)
create or replace function app.scan_finance(p_project text, p_org uuid, p_pm uuid) returns void language plpgsql security definer set search_path = public, app as $$
declare v_cont record; v_orig numeric; v_var numeric; x record;
begin
  if app.current_budget(p_project) is null then return; end if;
  select contingency_budget, overruns, available into v_cont from (
    select sum(cp.current_budget) filter (where c.is_contingency) contingency_budget, sum(greatest(cp.forecast - cp.current_budget, 0)) filter (where not c.is_contingency) overruns,
           sum(cp.current_budget - cp.committed) filter (where c.is_contingency) - coalesce(sum(greatest(cp.forecast - cp.current_budget, 0)) filter (where not c.is_contingency), 0) available
    from app.cost_position_internal(p_project) cp join cost_codes c on c.code = cp.code and c.org_id = p_org) q;
  if v_cont.available < 0 then
    perform app.raise_alert(p_org, p_project, 'Budget', 'Critical', 'budget', 'Contingency exhausted', format('Overruns %s exceed the remaining contingency by %s.', v_cont.overruns, -v_cont.available),
      null, 'pd', null, '[]', 'Decide a budget revision or cost reductions with the MD', 'contingency:' || p_project);
  else perform app.clear_alert(p_org, 'contingency:' || p_project, 'Contingency positive again'); end if;
  select coalesce(sum(app.incl_gst(app.contract_value(c.id), c.gst_pct)), 0), coalesce(sum((select sum(app.incl_gst(v.amount, c.gst_pct)) from contract_variations v where v.contract_id = c.id and v.status in ('Approved','Pending approval'))), 0)
    into v_orig, v_var from contracts c where c.project_id = p_project and c.status in ('Active','Closed');
  if v_orig > 0 and v_var * 100 > v_orig * 10 then
    perform app.raise_alert(p_org, p_project, 'Budget', 'High', 'contracts', format('Variation exposure %s%% of contract value', round(v_var * 100 / v_orig, 1)), null, null, 'qs', null, '[]',
      'Review pending variations against scope and the budget', 'variations:' || p_project);
  end if;
  for x in select po.id, po.item, po.rate, app.reference_rate(po.material_id, po.created_at::date, po.id) ref from purchase_orders po
           where po.project_id = p_project and po.material_id is not null and po.status in ('Pending approval','Approved') and po.created_at > now() - interval '30 days' loop
    if x.ref is not null and x.rate > x.ref * 1.10 then
      perform app.raise_alert(p_org, p_project, 'Budget', 'Medium', 'procurement', format('%s: rate %s is %s%% above the reference %s', x.id, x.rate, round((x.rate - x.ref) * 100 / x.ref, 1), round(x.ref, 2)),
        x.item, null, 'proc', null, jsonb_build_array(jsonb_build_object('kind', 'purchase_order', 'id', x.id)), 'Confirm the reason for paying above the reference rate before approval', 'price:' || x.id);
    end if;
  end loop;
end $$;

-- ======================= contractor performance =======================
create table public.contractor_score_weights (
  org_id uuid not null references public.organizations(id), metric text not null, weight numeric(5,2) not null check (weight >= 0),
  min_sample integer not null default 1, formula text not null, primary key (org_id, metric)
);
create or replace function app.seed_score_weights(p_org uuid) returns void language sql security definer set search_path = public as $$
  insert into contractor_score_weights values
    (p_org, 'on_time', 25, 3, 'score = % of finished activities finished by their baseline date'),
    (p_org, 'productivity', 15, 1, 'score = min(100, certified quantity ÷ quantity planned to date × 100)'),
    (p_org, 'rework', 15, 5, 'score = 100 − 5 × % of inspections failed (floor 0)'),
    (p_org, 'defects', 15, 1, 'score = 100 − 10 × open-or-closed defects per ₹1 crore certified (floor 0)'),
    (p_org, 'safety', 10, 1, 'score = 100 − 25 × safety-critical defects (floor 0)'),
    (p_org, 'variations', 5, 1, 'score = 100 − 2 × approved variations as % of original value (floor 0)'),
    (p_org, 'claim_accuracy', 10, 1, 'score = average assessed ÷ claimed × 100'),
    (p_org, 'response', 5, 3, 'score = 100 − 5 × average days to fix an assigned defect (floor 0)'),
    (p_org, 'wastage', 0, 1, 'not measured yet: needs material consumption norms per BOQ item')
  on conflict do nothing;
$$;
select app.seed_score_weights(id) from organizations;
create or replace function app.bootstrap_org(p_org uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.bootstrap_org_base(p_org); perform app.apply_permission_defaults(p_org); perform app.seed_playbook_rules(p_org); perform app.seed_scenarios(p_org); perform app.seed_score_weights(p_org);
end $$;

-- weighted score over the metrics that have enough data; every component is returned with its sample size and formula
create or replace function api.contractor_scores(p_project text default null)
returns table (vendor_id uuid, vendor text, score numeric, comparable boolean, metrics_used integer, components jsonb)
language plpgsql security definer set search_path = public, app as $$
declare v_org uuid := app.org(); v_today date := app.today();
begin
  if p_project is not null then perform app.require(p_project, 'contracts', 'view'); else perform app.require_perm('contracts', 'view'); end if;
  return query
  with ven as (select distinct c.vendor_id from contracts c join projects p on p.id = c.project_id
               where p.org_id = v_org and c.status in ('Active','Closed') and (p_project is null or c.project_id = p_project) and app.has_project(c.project_id)),
  raw as (
    select v.vendor_id,
      (select jsonb_build_object('value', round(100.0 * count(*) filter (where t.act_finish <= t.base_finish) / nullif(count(*), 0), 1), 'sample', count(*))
         from tasks t where t.contractor_id = v.vendor_id and t.act_finish is not null and (p_project is null or t.project_id = p_project)) on_time,
      (select jsonb_build_object('value', round(100.0 * sum(coalesce((select sum(m.qty) from measurements m where m.contract_item_id = ci.id and m.status = 'Verified'), 0))
                 / nullif(sum(ci.qty * least(1, greatest(0, (v_today - c.start_date)::numeric / greatest(c.end_date - c.start_date, 1)))), 0), 1), 'sample', count(*))
         from contract_items ci join contracts c on c.id = ci.contract_id where c.vendor_id = v.vendor_id and c.status in ('Active','Closed') and (p_project is null or c.project_id = p_project)) productivity,
      (select jsonb_build_object('value', round(100.0 * count(*) filter (where i.status = 'Failed') / nullif(count(*), 0), 1), 'sample', count(*))
         from inspections i where i.status in ('Passed','Failed') and (p_project is null or i.project_id = p_project) and i.unit_id in (select c.unit_id from contracts c where c.vendor_id = v.vendor_id and c.unit_id is not null
                                                                                   union select w.unit_id from contracts c join work_packages w on w.id = c.work_package_id where c.vendor_id = v.vendor_id)) rework,
      (select jsonb_build_object('value', round(count(*) / nullif((select sum(b.gross + b.gst) from ra_bills b join contracts c on c.id = b.contract_id where c.vendor_id = v.vendor_id and b.status in ('Approved','Paid') and (p_project is null or c.project_id = p_project)) / 10000000.0, 0), 2), 'sample',
                 (select count(*) from ra_bills b join contracts c on c.id = b.contract_id where c.vendor_id = v.vendor_id and b.status in ('Approved','Paid') and (p_project is null or c.project_id = p_project)))
         from snags s where s.assignee_vendor_id = v.vendor_id and (p_project is null or s.project_id = p_project)) defects,
      (select jsonb_build_object('value', count(*), 'sample', 1) from snags s where s.assignee_vendor_id = v.vendor_id and s.severity = 'Safety-critical' and (p_project is null or s.project_id = p_project)) safety,
      (select jsonb_build_object('value', round(100.0 * coalesce(sum((select sum(x.amount) from contract_variations x where x.contract_id = c.id and x.status = 'Approved')), 0) / nullif(sum(app.contract_value(c.id)), 0), 1), 'sample', count(*))
         from contracts c where c.vendor_id = v.vendor_id and c.status in ('Active','Closed') and (p_project is null or c.project_id = p_project)) variations,
      (select jsonb_build_object('value', round(avg((cl.assessment ->> 'gross')::numeric * 100 / nullif(cl.claimed_gross, 0)), 1), 'sample', count(*))
         from contractor_claims cl join contracts c on c.id = cl.contract_id where c.vendor_id = v.vendor_id and cl.assessment is not null and (p_project is null or c.project_id = p_project)) claim_accuracy,
      (select jsonb_build_object('value', round(avg(extract(epoch from s.fixed_at - s.created_at) / 86400)::numeric, 1), 'sample', count(*))
         from snags s where s.assignee_vendor_id = v.vendor_id and s.fixed_at is not null and (p_project is null or s.project_id = p_project)) response
    from ven v),
  sc as (
    select r.vendor_id, w.metric, w.weight, w.min_sample, w.formula, m.val, m.sample,
      case w.metric
        when 'on_time' then m.val when 'productivity' then least(100, m.val) when 'rework' then greatest(0, 100 - 5 * m.val)
        when 'defects' then greatest(0, 100 - 10 * m.val) when 'safety' then greatest(0, 100 - 25 * m.val) when 'variations' then greatest(0, 100 - 2 * m.val)
        when 'claim_accuracy' then least(100, m.val) when 'response' then greatest(0, 100 - 5 * m.val) end s
    from raw r cross join lateral (values ('on_time', r.on_time), ('productivity', r.productivity), ('rework', r.rework), ('defects', r.defects), ('safety', r.safety),
                                          ('variations', r.variations), ('claim_accuracy', r.claim_accuracy), ('response', r.response), ('wastage', null::jsonb)) x(metric, j)
    join contractor_score_weights w on w.org_id = v_org and w.metric = x.metric
    cross join lateral (select (x.j ->> 'value')::numeric val, coalesce((x.j ->> 'sample')::integer, 0) sample) m)
  select sc.vendor_id, (select name from vendors where id = sc.vendor_id),
    round(sum(sc.weight * sc.s) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0) / nullif(sum(sc.weight) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0), 0), 1),
    count(*) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0) >= 4,
    (count(*) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0))::integer,
    jsonb_agg(jsonb_build_object('metric', sc.metric, 'value', sc.val, 'sample', sc.sample, 'score', round(sc.s, 1), 'weight', sc.weight, 'formula', sc.formula,
      'used', sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0, 'note', case when sc.weight = 0 then 'not weighted' when sc.s is null then 'no data' when sc.sample < sc.min_sample then format('needs %s, has %s', sc.min_sample, sc.sample) end)
      order by sc.weight desc)
  from sc group by sc.vendor_id order by 3 desc nulls last;
end $$;

-- ======================= procurement intelligence =======================
create table public.rfqs (
  id text primary key, org_id uuid not null references public.organizations(id), material_id uuid not null references public.materials(id),
  qty numeric(16,3) not null check (qty > 0), needed_by date not null, lines jsonb not null, vendors uuid[] not null, status text not null default 'Draft' check (status in ('Draft','Sent','Closed','Cancelled')),
  note text, created_by uuid, created_at timestamptz not null default now()
);

-- demand across every project the user can see: dated demand (reservations, open shortages, unordered requests) and undated BOQ remaining
create or replace function api.procurement_plan(p_days integer default 60)
returns table (material_id uuid, code text, name text, uom text, dated_demand numeric, boq_remaining numeric, on_hand numeric, on_order numeric, net_requirement numeric,
  earliest_need date, order_by date, lead_days integer, projects jsonb, best_price numeric, best_vendor text, recent_avg_rate numeric, consolidation jsonb)
language plpgsql security definer set search_path = public, app as $$
declare v_today date := app.today();
begin
  perform app.require_perm('procurement', 'view');
  return query
  with pj as (select id from projects where org_id = app.org() and stage <> 'Handed over' and app.has_project(id)),
  dem as (
    select r.material_id, r.project_id, r.qty, r.needed_by from material_reservations r where r.status = 'Active' and r.project_id in (select id from pj) and r.needed_by <= v_today + p_days
    union all
    select m.material_id, m.project_id, m.qty, m.needed_by from material_requests m where m.material_id is not null and m.status in ('Draft','Submitted','Quoting','Quotes received') and m.project_id in (select id from pj) and m.needed_by <= v_today + p_days),
  per as (select d.material_id, d.project_id, sum(d.qty) qty, min(d.needed_by) need from dem d group by 1, 2),
  agg as (select per.material_id, sum(per.qty) qty, min(per.need) need, jsonb_agg(jsonb_build_object('project', per.project_id, 'qty', per.qty, 'needed_by', per.need) order by per.need) projects, count(*) n from per group by 1),
  boq as (select b.material_id, sum(greatest(b.qty - b.executed_qty, 0) * coalesce(b.material_factor, 1)) rem from boq_items b where b.material_id is not null and b.project_id in (select id from pj) group by 1),
  stock as (select s.material_id, sum(case when kind in ('receipt','transfer_in','return','adjustment_in') then qty else -qty end) oh from stock_moves s where s.project_id in (select id from pj) group by 1),
  ord as (select po.material_id, sum(po.qty - coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0)) oo from purchase_orders po
          where po.material_id is not null and po.status in ('Approved','Part received') and po.project_id in (select id from pj) group by 1),
  price as (select distinct on (vp.material_id) vp.material_id, vp.rate, v.name vendor, vp.lead_days from vendor_prices vp join vendors v on v.id = vp.vendor_id
            where vp.valid_from <= v_today and (vp.valid_to is null or vp.valid_to >= v_today) and v.approved order by vp.material_id, vp.rate),
  hist as (select po.material_id, round(avg(po.rate), 2) avg_rate from purchase_orders po where po.material_id is not null and po.status not in ('Rejected','Cancelled') and po.created_at > now() - interval '180 days' group by 1)
  select m.id, m.code, m.name, m.uom, coalesce(a.qty, 0), coalesce(bq.rem, 0), coalesce(st.oh, 0), coalesce(o.oo, 0),
    greatest(coalesce(a.qty, 0) - greatest(coalesce(st.oh, 0), 0) - coalesce(o.oo, 0), 0),
    a.need, a.need - coalesce(pr.lead_days, m.lead_days), coalesce(pr.lead_days, m.lead_days), coalesce(a.projects, '[]'), pr.rate, pr.vendor, h.avg_rate,
    case when a.n >= 2 and a.need - coalesce(pr.lead_days, m.lead_days) >= v_today then jsonb_build_object(
      'advice', format('Combine %s projects into one RFQ for %s %s; earliest need %s still allows the %s-day lead time', a.n, a.qty, m.uom, to_char(a.need, 'DD Mon'), coalesce(pr.lead_days, m.lead_days)),
      'estimated_saving', case when pr.rate is not null and h.avg_rate is not null and h.avg_rate > pr.rate then round((h.avg_rate - pr.rate) * a.qty, 2) end,
      'saving_basis', 'recent average order rate − best approved price-list rate, × combined quantity; actual saving depends on the quotes received')
    when a.n >= 2 then jsonb_build_object('advice', 'Several projects need it, but the earliest need is inside the lead time: order separately to protect the schedule') end
  from materials m left join agg a on a.material_id = m.id left join boq bq on bq.material_id = m.id left join stock st on st.material_id = m.id left join ord o on o.material_id = m.id
  left join price pr on pr.material_id = m.id left join hist h on h.material_id = m.id
  where m.org_id = app.org() and m.active and (a.qty is not null or bq.rem is not null or o.oo is not null)
  order by a.need nulls last, m.code;
end $$;

create or replace function api.vendor_comparison(p_material uuid)
returns table (vendor_id uuid, vendor text, approved boolean, price numeric, min_qty numeric, lead_days integer, orders integer, last_rate numeric, on_time_delivery_pct numeric, qc_fail_pct numeric, avg_actual_lead_days numeric)
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm('procurement', 'view');
  return query
  select v.id, v.name, v.approved, vp.rate, vp.min_qty, vp.lead_days,
    (select count(*)::integer from purchase_orders po where po.vendor_id = v.id and po.material_id = p_material and po.status not in ('Rejected','Cancelled')),
    (select po.rate from purchase_orders po where po.vendor_id = v.id and po.material_id = p_material and po.status not in ('Rejected','Cancelled') order by po.created_at desc limit 1),
    (select round(100.0 * count(*) filter (where g1.d <= po.expected_delivery) / nullif(count(*), 0), 1) from purchase_orders po
       join lateral (select min(g.received_on) d from goods_receipts g where g.po_id = po.id) g1 on g1.d is not null where po.vendor_id = v.id and po.expected_delivery is not null),
    (select round(100.0 * count(*) filter (where g.qc = 'Fail') / nullif(count(*), 0), 1) from goods_receipts g join purchase_orders po on po.id = g.po_id where po.vendor_id = v.id),
    (select round(avg(g1.d - po.approved_at::date), 1) from purchase_orders po join lateral (select min(g.received_on) d from goods_receipts g where g.po_id = po.id) g1 on g1.d is not null
       where po.vendor_id = v.id and po.material_id = p_material and po.approved_at is not null)
  from vendors v left join lateral (select * from vendor_prices x where x.vendor_id = v.id and x.material_id = p_material and x.valid_from <= app.today() and (x.valid_to is null or x.valid_to >= app.today()) order by x.rate limit 1) vp on true
  where v.org_id = app.org() and (vp.rate is not null or exists (select 1 from purchase_orders po where po.vendor_id = v.id and po.material_id = p_material))
  order by vp.rate nulls last;
end $$;

create or replace function api.set_vendor_price(p_material uuid, p_vendor uuid, p_rate numeric, p_gst numeric, p_min_qty numeric, p_lead integer, p_from date, p_to date) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v uuid;
begin
  perform app.require_perm('procurement', 'approve');
  if not exists (select 1 from vendors where id = p_vendor and org_id = app.org() and approved) then raise exception 'prices can be recorded only for approved vendors'; end if;
  insert into vendor_prices (org_id, material_id, vendor_id, rate, gst_pct, min_qty, lead_days, valid_from, valid_to, approved_by)
  values (app.org(), p_material, p_vendor, p_rate, coalesce(p_gst, 18), coalesce(p_min_qty, 0), p_lead, p_from, p_to, auth.uid()) returning id into v;
  return v;
end $$;

-- a draft RFQ only: sending it and choosing a vendor stay with people, and the order still goes through PO approval
create or replace function api.draft_rfq(p_material uuid, p_lines jsonb, p_vendors uuid[] default null, p_note text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_id text; v_qty numeric; v_need date; l jsonb; v_vendors uuid[];
begin
  perform app.require_perm('procurement', 'create');
  for l in select * from jsonb_array_elements(p_lines) loop
    if not app.can(l ->> 'project', 'procurement', 'create') then raise exception 'no procurement access to project %', l ->> 'project' using errcode = '42501'; end if;
  end loop;
  select sum((x ->> 'qty')::numeric), min((x ->> 'needed_by')::date) into v_qty, v_need from jsonb_array_elements(p_lines) x;
  v_vendors := coalesce(p_vendors, (select array_agg(distinct vp.vendor_id) from vendor_prices vp join vendors v on v.id = vp.vendor_id where vp.material_id = p_material and v.approved and (vp.valid_to is null or vp.valid_to >= app.today())));
  if v_vendors is null or cardinality(v_vendors) = 0 then raise exception 'no approved vendor has a price for this material; name the vendors to invite'; end if;
  v_id := app.next_no(app.org(), 'RFQ');
  insert into rfqs (id, org_id, material_id, qty, needed_by, lines, vendors, note, created_by) values (v_id, app.org(), p_material, v_qty, v_need, p_lines, v_vendors, p_note, auth.uid());
  return v_id;
end $$;

create or replace function api.delivery_delays(p_project text)
returns table (po_id text, item text, vendor text, expected_delivery date, days_late integer, outstanding numeric)
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'procurement', 'view');
  return query select po.id, po.item, v.name, po.expected_delivery, (app.today() - po.expected_delivery)::integer,
    po.qty - coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0)
  from purchase_orders po join vendors v on v.id = po.vendor_id
  where po.project_id = p_project and po.status in ('Approved','Part received') and po.expected_delivery < app.today() order by po.expected_delivery;
end $$;

-- ---------- security for batch 3–5 tables ----------
alter table public.zones enable row level security; alter table public.floors enable row level security; alter table public.work_packages enable row level security;
alter table public.progress_photos enable row level security; alter table public.forecast_scenarios enable row level security; alter table public.vendor_prices enable row level security;
alter table public.contractor_score_weights enable row level security; alter table public.rfqs enable row level security;
create policy zones_scope on public.zones for select to authenticated using (app.can(project_id, 'projects', 'view'));
create policy floors_scope on public.floors for select to authenticated using (exists (select 1 from buildings b where b.id = building_id and app.can(b.project_id, 'projects', 'view')));
create policy wp_scope on public.work_packages for select to authenticated using (app.can(project_id, 'projects', 'view'));
create policy photos_scope on public.progress_photos for select to authenticated using (app.can(project_id, 'site', 'view') or app.can(project_id, 'projects', 'view'));
create policy scenarios_org on public.forecast_scenarios for select to authenticated using (org_id = app.org());
create policy vendor_prices_scope on public.vendor_prices for select to authenticated using (org_id = app.org() and app.has_perm('procurement', 'view') and app.has_perm('budget', 'view'));
create policy weights_org on public.contractor_score_weights for select to authenticated using (org_id = app.org());
create policy rfqs_scope on public.rfqs for select to authenticated using (org_id = app.org() and app.has_perm('procurement', 'view'));
revoke all on public.zones, public.floors, public.work_packages, public.progress_photos, public.forecast_scenarios, public.vendor_prices, public.contractor_score_weights, public.rfqs from anon, authenticated;
grant select on public.zones, public.floors, public.work_packages, public.progress_photos, public.forecast_scenarios, public.vendor_prices, public.contractor_score_weights, public.rfqs to authenticated;
do $$ declare t text; begin
  foreach t in array array['zones','floors','work_packages','progress_photos','forecast_scenarios','vendor_prices','contractor_score_weights','rfqs'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' loop execute format('revoke all on function %s from public', f); end loop;
end $$;
grant execute on function app.uid(), app.org(), app.role(), app.has_perm(text, text), app.has_project(text), app.can(text, text, text), app.today(uuid), app.local_time(uuid) to authenticated;
revoke execute on function api.process_events(integer), api.scan_exceptions() from authenticated;

-- ---------- write APIs the audit found missing (BOQ entry, twin structure, task assignment, progress photos) ----------
create or replace function api.add_boq_items(p_project text, p_items jsonb) returns integer
language plpgsql security definer set search_path = public, app as $$
declare i jsonb; n integer := 0;
begin
  perform app.require(p_project, 'boq', 'create');
  for i in select * from jsonb_array_elements(p_items) loop
    if (i ->> 'qty')::numeric <= 0 or (i ->> 'rate')::numeric < 0 then raise exception 'BOQ % needs a positive quantity and a rate', i ->> 'ref'; end if;
    if not exists (select 1 from cost_codes where org_id = app.org() and code = i ->> 'code') then raise exception 'unknown cost code %', i ->> 'code'; end if;
    insert into boq_items (project_id, code, ref, description, unit, qty, rate, gst_pct, material_id, material_factor)
    values (p_project, i ->> 'code', i ->> 'ref', i ->> 'description', i ->> 'unit', (i ->> 'qty')::numeric, (i ->> 'rate')::numeric, coalesce((i ->> 'gst_pct')::numeric, 18),
            (i ->> 'material_id')::uuid, (i ->> 'material_factor')::numeric);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function api.set_twin_structure(p_project text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare x jsonb; nz integer := 0; nb integer := 0; nf integer := 0; nu integer := 0; nw integer := 0;
begin
  perform app.require(p_project, 'projects', 'edit');
  for x in select * from jsonb_array_elements(coalesce(p -> 'zones', '[]')) loop
    insert into zones (project_id, code, name, kind) values (p_project, x ->> 'code', x ->> 'name', coalesce(x ->> 'kind', 'Villas'))
    on conflict (project_id, code) do update set name = excluded.name, kind = excluded.kind; nz := nz + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'buildings', '[]')) loop
    insert into buildings (project_id, code, name, zone_id) values (p_project, x ->> 'code', x ->> 'name', (select id from zones where project_id = p_project and code = x ->> 'zone'))
    on conflict (project_id, code) do update set name = excluded.name, zone_id = excluded.zone_id; nb := nb + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'floors', '[]')) loop
    insert into floors (building_id, level, name) values ((select id from buildings where project_id = p_project and code = x ->> 'building'), (x ->> 'level')::integer, x ->> 'name')
    on conflict (building_id, level) do update set name = excluded.name; nf := nf + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'units', '[]')) loop
    update units set zone_id = (select id from zones where project_id = p_project and code = x ->> 'zone'),
      building_id = coalesce((select id from buildings where project_id = p_project and code = x ->> 'building'), building_id),
      floor_id = (select f.id from floors f join buildings b on b.id = f.building_id where b.project_id = p_project and b.code = x ->> 'building' and f.level = (x ->> 'level')::integer)
    where project_id = p_project and code = x ->> 'code';
    if not found then raise exception 'unit % not in project', x ->> 'code'; end if; nu := nu + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'work_packages', '[]')) loop
    insert into work_packages (project_id, code, name, zone_id, unit_id, cost_code, budget)
    values (p_project, x ->> 'code', x ->> 'name', (select id from zones where project_id = p_project and code = x ->> 'zone'), (select id from units where project_id = p_project and code = x ->> 'unit'),
            x ->> 'cost_code', coalesce((x ->> 'budget')::numeric, 0))
    on conflict (project_id, code) do update set name = excluded.name, zone_id = excluded.zone_id, unit_id = excluded.unit_id, cost_code = excluded.cost_code, budget = excluded.budget; nw := nw + 1;
  end loop;
  return jsonb_build_object('zones', nz, 'buildings', nb, 'floors', nf, 'units', nu, 'work_packages', nw);
end $$;

create or replace function api.assign_task(p_task uuid, p_work_package uuid, p_contractor uuid, p_unit uuid default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'activity not found'; end if;
  perform app.require(t.project_id, 'schedule', 'edit');
  if p_work_package is not null and not exists (select 1 from work_packages where id = p_work_package and project_id = t.project_id) then raise exception 'work package is not in this project'; end if;
  if p_unit is not null and not exists (select 1 from units where id = p_unit and project_id = t.project_id) then raise exception 'unit is not in this project'; end if;
  update tasks set work_package_id = coalesce(p_work_package, work_package_id), contractor_id = coalesce(p_contractor, contractor_id), unit_id = coalesce(p_unit, unit_id) where id = p_task;
end $$;

create or replace function api.add_progress_photo(p_project text, p_storage_path text, p_unit uuid, p_work_package uuid, p_task uuid, p_caption text, p_taken_on date, p_thumb text default null) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v uuid;
begin
  perform app.require(p_project, 'site', 'create');
  if p_taken_on > app.today() then raise exception 'photo date cannot be in the future'; end if;
  insert into progress_photos (project_id, unit_id, work_package_id, task_id, storage_path, thumb_path, caption, taken_on, uploaded_by)
  values (p_project, p_unit, p_work_package, p_task, p_storage_path, p_thumb, p_caption, p_taken_on, auth.uid()) returning id into v;
  return v;
end $$;
revoke all on function api.add_boq_items(text, jsonb), api.set_twin_structure(text, jsonb), api.assign_task(uuid, uuid, uuid, uuid),
  api.add_progress_photo(text, text, uuid, uuid, uuid, text, date, text) from public;
grant execute on function api.add_boq_items(text, jsonb), api.set_twin_structure(text, jsonb), api.assign_task(uuid, uuid, uuid, uuid),
  api.add_progress_photo(text, text, uuid, uuid, uuid, text, date, text) to authenticated, service_role;

create or replace function api.assign_contract(p_contract text, p_work_package uuid, p_unit uuid default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare c contracts;
begin
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'contract % not found', p_contract; end if;
  perform app.require(c.project_id, 'contracts', 'edit');
  if p_work_package is not null and not exists (select 1 from work_packages where id = p_work_package and project_id = c.project_id) then raise exception 'work package is not in this project'; end if;
  update contracts set work_package_id = coalesce(p_work_package, work_package_id), unit_id = coalesce(p_unit, unit_id) where id = p_contract;
end $$;
create or replace function api.set_request_material(p_mr text, p_material uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare m material_requests;
begin
  select * into m from material_requests where id = p_mr for update;
  if not found then raise exception 'request % not found', p_mr; end if;
  perform app.require(m.project_id, 'procurement', 'edit');
  if m.status = 'PO raised' then raise exception 'the order is already raised'; end if;
  if not exists (select 1 from materials where id = p_material and org_id = app.org()) then raise exception 'unknown material'; end if;
  update material_requests set material_id = p_material where id = p_mr;
end $$;
revoke all on function api.assign_contract(text, uuid, uuid), api.set_request_material(text, uuid) from public;
grant execute on function api.assign_contract(text, uuid, uuid), api.set_request_material(text, uuid) to authenticated, service_role;
