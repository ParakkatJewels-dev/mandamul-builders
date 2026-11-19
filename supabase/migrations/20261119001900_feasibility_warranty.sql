-- Batch 13: the two missing P1 modules — land / investment feasibility (acceptance item 2) and warranty & defect liability (item 24).
-- Money is numeric(18,2); every write goes through an `api` function; RLS on every new table; audited.

-- =========================== feasibility ===========================
create table public.feasibility_studies (
  id text primary key, org_id uuid not null references public.organizations(id), project_id text references public.projects(id),
  name text not null check (length(trim(name)) >= 3), location text, land_area_acres numeric(12,3) check (land_area_acres > 0),
  ownership text check (ownership in ('Freehold purchase','Long lease','Joint development','Existing company land')),
  land_cost numeric(18,2) not null default 0 check (land_cost >= 0), lease_annual numeric(18,2) not null default 0 check (lease_annual >= 0),
  keys integer not null check (keys > 0), built_up_sqft numeric(12,2) not null check (built_up_sqft > 0),
  build_cost_per_sqft numeric(18,2) not null check (build_cost_per_sqft > 0), infra_cost numeric(18,2) not null default 0 check (infra_cost >= 0),
  ffe_per_key numeric(18,2) not null default 0 check (ffe_per_key >= 0), preopening_cost numeric(18,2) not null default 0 check (preopening_cost >= 0),
  contingency_pct numeric(5,2) not null default 7.5 check (contingency_pct between 0 and 50),
  adr numeric(18,2) not null check (adr > 0), occupancy_pct numeric(5,2) not null check (occupancy_pct > 0 and occupancy_pct <= 100),
  other_revenue_pct numeric(6,2) not null default 35 check (other_revenue_pct between 0 and 300),
  opex_pct numeric(5,2) not null default 55 check (opex_pct between 0 and 100), mgmt_fee_pct numeric(5,2) not null default 0 check (mgmt_fee_pct between 0 and 30),
  regulatory_note text, regulatory_status text not null default 'Estimate — not validated' check (regulatory_status in ('Estimate — not validated','Validated by qualified professional')),
  regulatory_validated_by text,
  status text not null default 'Draft' check (status in ('Draft','Recommended','Rejected','Converted to project')),
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create index on public.feasibility_studies (org_id, created_at desc); create index on public.feasibility_studies (project_id);
create table public.feasibility_scenarios (
  org_id uuid not null references public.organizations(id), name text not null, adr_factor numeric(5,3) not null, occupancy_delta_pp numeric(5,2) not null,
  cost_factor numeric(5,3) not null, note text not null, primary key (org_id, name)
);
create or replace function app.seed_feasibility_scenarios(p_org uuid) returns void language sql security definer set search_path = public as $$
  insert into feasibility_scenarios values
    (p_org, 'Optimistic', 1.10, 5, 0.95, 'ADR 10% higher, occupancy 5 points higher, development cost 5% lower'),
    (p_org, 'Base case', 1.00, 0, 1.00, 'As entered'),
    (p_org, 'Conservative', 0.90, -10, 1.10, 'ADR 10% lower, occupancy 10 points lower, development cost 10% higher')
  on conflict do nothing;
$$;
select app.seed_feasibility_scenarios(id) from organizations;

-- the model: one place for every formula, so the screen, reports and AI show the same numbers
create or replace function app.feasibility_model(f feasibility_studies, p_adr_factor numeric default 1, p_occ_delta numeric default 0, p_cost_factor numeric default 1)
returns jsonb language plpgsql immutable as $$
declare v_build numeric; v_cont numeric; v_inv numeric; v_occ numeric; v_rooms numeric; v_rev numeric; v_opex numeric; v_fee numeric; v_ebitda numeric;
begin
  v_build := (f.built_up_sqft * f.build_cost_per_sqft + f.infra_cost + f.keys * f.ffe_per_key) * p_cost_factor;
  v_cont := round(v_build * f.contingency_pct / 100, 2);
  v_inv := round(f.land_cost + v_build + v_cont + f.preopening_cost, 2);
  v_occ := least(greatest(f.occupancy_pct + p_occ_delta, 0), 100);
  v_rooms := round(f.keys * f.adr * p_adr_factor * 365 * v_occ / 100, 2);
  v_rev := round(v_rooms * (1 + f.other_revenue_pct / 100), 2);
  v_opex := round(v_rev * f.opex_pct / 100, 2); v_fee := round(v_rev * f.mgmt_fee_pct / 100, 2);
  v_ebitda := v_rev - v_opex - v_fee - f.lease_annual;
  return jsonb_build_object('investment', v_inv, 'construction', round(v_build, 2), 'contingency', v_cont, 'cost_per_key', round(v_inv / f.keys, 2),
    'occupancy_pct', v_occ, 'adr', round(f.adr * p_adr_factor, 2), 'rooms_revenue', v_rooms, 'total_revenue', v_rev, 'opex', v_opex, 'management_fee', v_fee,
    'lease', f.lease_annual, 'ebitda', v_ebitda, 'ebitda_margin_pct', case when v_rev > 0 then round(v_ebitda * 100 / v_rev, 1) end,
    'roi_pct', case when v_inv > 0 then round(v_ebitda * 100 / v_inv, 2) end,
    'payback_years', case when v_ebitda > 0 then round(v_inv / v_ebitda, 1) end);
end $$;

create or replace function api.save_feasibility(p jsonb, p_expected_version integer default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_id text := p ->> 'id'; f feasibility_studies; v_proj text := nullif(p ->> 'project_id', '');
begin
  if v_proj is not null then perform app.require(v_proj, 'projects', 'edit'); else perform app.require_perm('projects', 'create'); end if;
  if v_id is null then
    v_id := app.next_no(app.org(), 'FS');
    insert into feasibility_studies (id, org_id, project_id, name, location, land_area_acres, ownership, land_cost, lease_annual, keys, built_up_sqft, build_cost_per_sqft, infra_cost,
      ffe_per_key, preopening_cost, contingency_pct, adr, occupancy_pct, other_revenue_pct, opex_pct, mgmt_fee_pct, regulatory_note)
    values (v_id, app.org(), v_proj, p ->> 'name', p ->> 'location', (p ->> 'land_area_acres')::numeric, p ->> 'ownership', coalesce((p ->> 'land_cost')::numeric, 0),
      coalesce((p ->> 'lease_annual')::numeric, 0), (p ->> 'keys')::integer, (p ->> 'built_up_sqft')::numeric, (p ->> 'build_cost_per_sqft')::numeric, coalesce((p ->> 'infra_cost')::numeric, 0),
      coalesce((p ->> 'ffe_per_key')::numeric, 0), coalesce((p ->> 'preopening_cost')::numeric, 0), coalesce((p ->> 'contingency_pct')::numeric, 7.5), (p ->> 'adr')::numeric,
      (p ->> 'occupancy_pct')::numeric, coalesce((p ->> 'other_revenue_pct')::numeric, 35), coalesce((p ->> 'opex_pct')::numeric, 55), coalesce((p ->> 'mgmt_fee_pct')::numeric, 0), p ->> 'regulatory_note');
    return v_id;
  end if;
  select * into f from feasibility_studies where id = v_id and org_id = app.org() for update;
  if not found then raise exception 'feasibility study % not found', v_id; end if;
  if f.status <> 'Draft' then raise exception 'study % is %; only drafts can be changed', v_id, lower(f.status); end if;
  if p_expected_version is distinct from f.version then raise exception 'someone else changed this study; refresh and try again' using errcode = 'P0003'; end if;
  update feasibility_studies set name = coalesce(p ->> 'name', name), location = coalesce(p ->> 'location', location),
    land_area_acres = coalesce((p ->> 'land_area_acres')::numeric, land_area_acres), land_cost = coalesce((p ->> 'land_cost')::numeric, land_cost),
    lease_annual = coalesce((p ->> 'lease_annual')::numeric, lease_annual), keys = coalesce((p ->> 'keys')::integer, keys), built_up_sqft = coalesce((p ->> 'built_up_sqft')::numeric, built_up_sqft),
    build_cost_per_sqft = coalesce((p ->> 'build_cost_per_sqft')::numeric, build_cost_per_sqft), infra_cost = coalesce((p ->> 'infra_cost')::numeric, infra_cost),
    ffe_per_key = coalesce((p ->> 'ffe_per_key')::numeric, ffe_per_key), preopening_cost = coalesce((p ->> 'preopening_cost')::numeric, preopening_cost),
    contingency_pct = coalesce((p ->> 'contingency_pct')::numeric, contingency_pct), adr = coalesce((p ->> 'adr')::numeric, adr), occupancy_pct = coalesce((p ->> 'occupancy_pct')::numeric, occupancy_pct),
    other_revenue_pct = coalesce((p ->> 'other_revenue_pct')::numeric, other_revenue_pct), opex_pct = coalesce((p ->> 'opex_pct')::numeric, opex_pct),
    mgmt_fee_pct = coalesce((p ->> 'mgmt_fee_pct')::numeric, mgmt_fee_pct), regulatory_note = coalesce(p ->> 'regulatory_note', regulatory_note),
    version = version + 1, updated_at = now() where id = v_id;
  return v_id;
end $$;

-- recording that a qualified professional validated the regulatory assumptions is a leadership sign-off (project creation rights: MD, PD)
create or replace function api.validate_feasibility_regulatory(p_id text, p_validated_by text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm('projects', 'create');
  if length(trim(coalesce(p_validated_by, ''))) < 5 then raise exception 'name the qualified professional and their registration'; end if;
  update feasibility_studies set regulatory_status = 'Validated by qualified professional', regulatory_validated_by = p_validated_by, updated_at = now(), version = version + 1
   where id = p_id and org_id = app.org();
  if not found then raise exception 'feasibility study % not found', p_id; end if;
end $$;

create or replace function api.feasibility(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare f feasibility_studies; base jsonb;
begin
  select * into f from feasibility_studies where id = p_id and org_id = app.org();
  if not found then raise exception 'feasibility study % not found', p_id; end if;
  if f.project_id is not null then perform app.require(f.project_id, 'projects', 'view'); else perform app.require_perm('projects', 'view'); end if;
  if not app.has_perm('budget', 'view') then raise exception 'feasibility figures need budget rights' using errcode = '42501'; end if;
  base := app.feasibility_model(f);
  return jsonb_build_object('study', to_jsonb(f) - 'org_id', 'base', base,
    'scenarios', (select jsonb_agg(jsonb_build_object('name', s.name, 'note', s.note, 'result', app.feasibility_model(f, s.adr_factor, s.occupancy_delta_pp, s.cost_factor))
                   order by s.adr_factor) from feasibility_scenarios s where s.org_id = f.org_id),
    'sensitivity', jsonb_build_array(
      jsonb_build_object('driver', 'ADR ±10%', 'low', app.feasibility_model(f, 0.9, 0, 1) -> 'payback_years', 'high', app.feasibility_model(f, 1.1, 0, 1) -> 'payback_years'),
      jsonb_build_object('driver', 'Occupancy ±10 points', 'low', app.feasibility_model(f, 1, -10, 1) -> 'payback_years', 'high', app.feasibility_model(f, 1, 10, 1) -> 'payback_years'),
      jsonb_build_object('driver', 'Development cost ±10%', 'low', app.feasibility_model(f, 1, 0, 1.1) -> 'payback_years', 'high', app.feasibility_model(f, 1, 0, 0.9) -> 'payback_years')),
    'assumptions', jsonb_build_array(
      'Stabilised year: rooms revenue = keys × ADR × 365 × occupancy',
      format('Other revenue (food & beverage, spa, events) = %s%% of rooms revenue', f.other_revenue_pct),
      format('Operating expenses = %s%% of total revenue; management fee %s%%; lease %s a year', f.opex_pct, f.mgmt_fee_pct, f.lease_annual),
      format('Contingency %s%% of construction, infrastructure and FF&E', f.contingency_pct),
      'ROI = stabilised EBITDA ÷ total investment; payback = investment ÷ EBITDA (simple, before tax, financing and ramp-up)',
      'Regulatory figures: ' || f.regulatory_status));
end $$;

create or replace function api.feasibility_list() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_perm('projects', 'view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'location', f.location, 'keys', f.keys, 'status', f.status, 'regulatory_status', f.regulatory_status,
      'version', f.version, 'project_id', f.project_id,
      'investment', case when app.has_perm('budget', 'view') then app.feasibility_model(f) -> 'investment' end,
      'payback_years', case when app.has_perm('budget', 'view') then app.feasibility_model(f) -> 'payback_years' end) order by f.created_at desc)
    from feasibility_studies f where f.org_id = app.org() and (f.project_id is null or f.project_id in (select app.visible_projects()))), '[]');
end $$;

-- =========================== warranty and defect liability ===========================
alter table public.warranties add column if not exists kind text not null default 'Equipment' check (kind in ('Equipment','Contractor workmanship','Defect liability period')),
  add column if not exists response_hours integer not null default 48 check (response_hours between 1 and 720);
create table public.warranty_claims (
  id text primary key, org_id uuid not null references public.organizations(id), project_id text not null references public.projects(id),
  warranty_id uuid not null, unit_id uuid references public.units(id), title text not null check (length(trim(title)) >= 5), description text,
  in_warranty boolean not null, reported_by uuid not null default auth.uid(), reported_at timestamptz not null default now(), response_due_at timestamptz not null,
  status text not null default 'Open' check (status in ('Open','Acknowledged','Resolved','Rejected')),
  responded_at timestamptz, responded_by uuid, response_note text, resolved_at timestamptz, resolved_by uuid, resolution text, evidence_document text references public.documents(id)
);
create index on public.warranty_claims (project_id, status); create index on public.warranty_claims (warranty_id);
create index on public.warranty_claims (org_id); create index on public.warranty_claims (unit_id); create index on public.warranty_claims (evidence_document);

create or replace function api.raise_warranty_claim(p_warranty uuid, p_title text, p_description text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare w warranties; v_id text;
begin
  select * into w from warranties where id = p_warranty;
  if not found then raise exception 'warranty not found'; end if;
  perform app.require(w.project_id, 'handover', 'create');
  v_id := app.next_no(app.org(), 'WC');
  insert into warranty_claims (id, org_id, project_id, warranty_id, unit_id, title, description, in_warranty, response_due_at)
  values (v_id, app.org(), w.project_id, w.id, w.unit_id, p_title, p_description, app.today(app.org()) between w.start_date and w.end_date, now() + make_interval(hours => w.response_hours));
  return v_id;
end $$;

create or replace function api.respond_warranty_claim(p_claim text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare c warranty_claims;
begin
  select * into c from warranty_claims where id = p_claim for update;
  if not found then raise exception 'claim % not found', p_claim; end if;
  perform app.require(c.project_id, 'handover', 'edit');
  if c.status <> 'Open' then raise exception 'claim % is already %', p_claim, lower(c.status) using errcode = 'P0003'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'say what will be done and when'; end if;
  update warranty_claims set status = 'Acknowledged', responded_at = now(), responded_by = auth.uid(), response_note = p_note where id = p_claim;
end $$;

-- resolution needs evidence: a document of the same project (photo, service report, test certificate)
create or replace function api.resolve_warranty_claim(p_claim text, p_resolution text, p_evidence_document text) returns void
language plpgsql security definer set search_path = public, app as $$
declare c warranty_claims;
begin
  select * into c from warranty_claims where id = p_claim for update;
  if not found then raise exception 'claim % not found', p_claim; end if;
  perform app.require(c.project_id, 'handover', 'edit');
  if c.status not in ('Open','Acknowledged') then raise exception 'claim % is already %', p_claim, lower(c.status) using errcode = 'P0003'; end if;
  if length(trim(coalesce(p_resolution, ''))) < 5 then raise exception 'describe the repair'; end if;
  if not exists (select 1 from documents d where d.id = p_evidence_document and d.project_id = c.project_id) then
    raise exception 'attach the evidence (photo, service report or test certificate) as a project document first'; end if;
  update warranty_claims set status = 'Resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = p_resolution, evidence_document = p_evidence_document,
         responded_at = coalesce(responded_at, now()), responded_by = coalesce(responded_by, auth.uid()) where id = p_claim;
end $$;

create or replace function api.warranty_register(p_project text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_today date;
begin
  perform app.require(p_project, 'handover', 'view');
  v_today := app.today(app.org());
  return jsonb_build_object(
    'warranties', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'item', w.item, 'kind', w.kind, 'vendor', v.name, 'unit', u.code, 'start', w.start_date, 'end', w.end_date,
        'days_left', w.end_date - v_today, 'active', v_today between w.start_date and w.end_date, 'response_hours', w.response_hours,
        'open_claims', (select count(*) from warranty_claims c where c.warranty_id = w.id and c.status in ('Open','Acknowledged'))) order by w.end_date)
      from warranties w left join vendors v on v.id = w.vendor_id left join units u on u.id = w.unit_id where w.project_id = p_project), '[]'),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status, 'in_warranty', c.in_warranty, 'reported_at', c.reported_at,
        'response_due_at', c.response_due_at, 'responded_at', c.responded_at, 'resolved_at', c.resolved_at, 'evidence_document', c.evidence_document,
        'response_overdue', c.responded_at is null and c.status = 'Open' and c.response_due_at < now(),
        'response_hours', case when c.responded_at is not null then round(extract(epoch from c.responded_at - c.reported_at) / 3600, 1) end) order by c.reported_at desc)
      from warranty_claims c where c.project_id = p_project), '[]'),
    'average_response_hours', (select round(avg(extract(epoch from responded_at - reported_at) / 3600)::numeric, 1) from warranty_claims where project_id = p_project and responded_at is not null),
    'overdue_responses', (select count(*) from warranty_claims where project_id = p_project and status = 'Open' and response_due_at < now()));
end $$;

-- =========================== security ===========================
alter table public.feasibility_studies enable row level security; alter table public.feasibility_scenarios enable row level security; alter table public.warranty_claims enable row level security;
create policy feasibility_scope on public.feasibility_studies for select to authenticated
  using (org_id = (select app.org()) and (select app.has_perm('projects', 'view')) and (project_id is null or project_id in (select app.visible_projects())));
create policy feasibility_scenarios_org on public.feasibility_scenarios for select to authenticated using (org_id = (select app.org()));
create policy warranty_claims_scope on public.warranty_claims for select to authenticated
  using (project_id in (select app.visible_projects()) and (select app.has_perm('handover', 'view')));
revoke all on public.feasibility_studies, public.feasibility_scenarios, public.warranty_claims from anon, authenticated;
grant select on public.feasibility_studies, public.feasibility_scenarios, public.warranty_claims to authenticated;
create trigger audit_feasibility_studies after insert or update or delete on public.feasibility_studies for each row execute function app.audit_row();
create trigger audit_feasibility_scenarios after insert or update or delete on public.feasibility_scenarios for each row execute function app.audit_row();
create trigger audit_warranty_claims after insert or update or delete on public.warranty_claims for each row execute function app.audit_row();
grant execute on function api.save_feasibility(jsonb, integer), api.validate_feasibility_regulatory(text, text), api.feasibility(text), api.feasibility_list(),
  api.raise_warranty_claim(uuid, text, text), api.respond_warranty_claim(text, text), api.resolve_warranty_claim(text, text, text), api.warranty_register(text) to authenticated;

-- new organisations get the feasibility scenarios too
create or replace function app.bootstrap_org(p_org uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.bootstrap_org_base(p_org); perform app.apply_permission_defaults(p_org); perform app.seed_playbook_rules(p_org); perform app.seed_scenarios(p_org);
  perform app.seed_score_weights(p_org); perform app.seed_retention(p_org); perform app.seed_feasibility_scenarios(p_org);
end $$;
