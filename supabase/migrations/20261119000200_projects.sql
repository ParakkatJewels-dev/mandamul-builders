-- M Andamul Development OS · 0200 projects, units, budgets, BOQ, schedule

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  unique (org_id, name)
);

create table public.projects (
  id text primary key check (id ~ '^MA-[0-9]{4}-[0-9]{3}$'),
  org_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 2 and 120),
  property_type text not null,
  location text not null,
  district text,
  state text,
  client_id uuid references public.clients(id),
  keys integer not null check (keys > 0),
  built_up_sqft numeric(12,2) check (built_up_sqft is null or built_up_sqft > 0),
  start_date date not null,
  stage text not null default 'Pre-construction' check (stage in ('Pre-construction','Construction','Pre-opening','Handed over','On hold')),
  pm_id uuid references public.profiles(user_id),
  contract_value numeric(18,2) check (contract_value is null or contract_value >= 0),
  contingency_pct numeric(5,2) not null default 5 check (contingency_pct between 0 and 30),
  document_folders text[] not null default array['01 Contracts','02 Drawings','03 BOQ & estimates','04 Permits & approvals','05 Purchase orders','06 Invoices & bills','07 Site photographs','08 Meeting minutes','09 Inspections & quality','10 Handover & warranties'],
  handed_over_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  version integer not null default 1
);
create index on public.projects (org_id);

create table public.project_members (
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id),
  responsibility text not null default 'Member',
  primary key (project_id, user_id)
);

-- project access: org-wide users, or members
create or replace function app.has_project(p_project text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects pr join profiles p on p.org_id = pr.org_id and p.user_id = auth.uid() and p.active
                 where pr.id = p_project and (p.all_projects or exists (select 1 from project_members m where m.project_id = pr.id and m.user_id = p.user_id)))
$$;
create or replace function app.can(p_project text, p_module text, p_action text) returns boolean
language sql stable as $$ select app.has_project(p_project) and app.has_perm(p_module, p_action) $$;
create or replace function app.require(p_project text, p_module text, p_action text) returns void language plpgsql stable as $$
begin
  if not app.has_project(p_project) then raise exception 'no access to project %', p_project using errcode = '42501'; end if;
  perform app.require_perm(p_module, p_action);
end $$;

create table public.land_parcels (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  survey_no text,
  area_acres numeric(10,3) check (area_acres > 0),
  ownership text,
  classification text,
  coastal_zone text,
  regulatory_note text,
  regulatory_status text not null default 'Estimate' check (regulatory_status in ('Estimate','Validated')),
  validated_by text
);

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  code text not null, name text not null,
  unique (project_id, code)
);

-- configurable readiness stages per property type
create table public.stage_templates (org_id uuid not null references public.organizations(id), id text not null, name text not null, primary key (org_id, id));
create table public.template_stages (
  org_id uuid not null, template_id text not null, seq integer not null, stage_key text not null, label text not null,
  primary key (org_id, template_id, stage_key), unique (org_id, template_id, seq),
  foreign key (org_id, template_id) references public.stage_templates(org_id, id) on delete cascade
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  building_id uuid references public.buildings(id),
  code text not null,
  name text not null,
  unit_type text not null,
  floor text,
  template_id text not null,
  budget numeric(18,2) not null default 0 check (budget >= 0),
  plan_x numeric(6,3) check (plan_x between 0 and 100),
  plan_y numeric(6,3) check (plan_y between 0 and 100),
  blocked_reason text,
  handed_over_at timestamptz,
  version integer not null default 1,
  unique (project_id, code)
);

create table public.cost_codes (org_id uuid not null references public.organizations(id), code text not null check (code ~ '^[0-9]{2}$'), name text not null, is_contingency boolean not null default false, primary key (org_id, code));

create table public.budget_versions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  v integer not null check (v >= 1),
  status text not null check (status in ('Pending','Approved','Rejected')),
  reason text not null check (length(reason) >= 5),
  created_by uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  approval_id text,
  unique (project_id, v)
);
-- only one revision may be in approval at a time
create unique index budget_one_pending on public.budget_versions (project_id) where status = 'Pending';

create table public.budget_lines (
  version_id uuid not null references public.budget_versions(id) on delete cascade,
  code text not null,
  amount numeric(18,2) not null check (amount >= 0),
  primary key (version_id, code)
);
-- approved versions are frozen: no silent modification of an approved budget
create or replace function app.freeze_budget_lines() returns trigger language plpgsql as $$
begin
  if exists (select 1 from budget_versions where id = coalesce(old.version_id, new.version_id) and status <> 'Pending') then
    raise exception 'budget version is % and cannot be changed', (select status from budget_versions where id = coalesce(old.version_id, new.version_id)) using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger budget_lines_frozen before insert or update or delete on public.budget_lines for each row execute function app.freeze_budget_lines();

create table public.etc_estimates (
  project_id text not null references public.projects(id) on delete cascade,
  code text not null,
  amount numeric(18,2) not null check (amount >= 0),
  basis text not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (project_id, code)
);

create table public.boq_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  code text not null,
  ref text not null,
  description text not null,
  unit text not null check (unit in ('cum','sqm','rmt','MT','kg','nos','set','point','TR','key','bag','month','LS','%')),
  qty numeric(16,3) not null check (qty > 0),
  rate numeric(18,2) not null check (rate >= 0),
  gst_pct numeric(5,2) not null default 18 check (gst_pct between 0 and 28),
  executed_qty numeric(16,3) not null default 0 check (executed_qty >= 0),
  unique (project_id, ref)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  wbs text not null,
  phase text not null,
  name text not null,
  duration_days integer not null check (duration_days >= 0),
  is_milestone boolean not null default false,
  base_start date not null,
  base_finish date not null,
  act_start date,
  act_finish date,
  progress integer not null default 0 check (progress between 0 and 100),
  owner_id uuid references public.profiles(user_id),
  contractor_id uuid,
  unit_id uuid references public.units(id),
  delay_reason text,
  recovery_plan text,
  version integer not null default 1,
  check (base_finish >= base_start),
  check (act_finish is null or (act_start is not null and act_finish >= act_start)),
  check ((progress = 100) = (act_finish is not null)),
  unique (project_id, wbs)
);
create table public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  pred_id uuid not null references public.tasks(id) on delete cascade,
  primary key (task_id, pred_id),
  check (task_id <> pred_id)
);
create or replace function app.no_dependency_cycle() returns trigger language plpgsql as $$
begin
  if exists (with recursive up(id) as (select new.pred_id union select d.pred_id from task_dependencies d join up on d.task_id = up.id)
             select 1 from up where id = new.task_id) then
    raise exception 'dependency would create a cycle' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger task_dependencies_acyclic before insert or update on public.task_dependencies for each row execute function app.no_dependency_cycle();

create trigger projects_version before update on public.projects for each row execute function app.bump_version();
create trigger units_version before update on public.units for each row execute function app.bump_version();
create trigger tasks_version before update on public.tasks for each row execute function app.bump_version();

create trigger audit_projects after insert or update or delete on public.projects for each row execute function app.audit_row();
create trigger audit_units after insert or update or delete on public.units for each row execute function app.audit_row();
create trigger audit_budget_versions after insert or update or delete on public.budget_versions for each row execute function app.audit_row();
create trigger audit_budget_lines after insert or update or delete on public.budget_lines for each row execute function app.audit_row();
create trigger audit_etc after insert or update or delete on public.etc_estimates for each row execute function app.audit_row();
create trigger audit_boq after insert or update or delete on public.boq_items for each row execute function app.audit_row();
create trigger audit_tasks after insert or update or delete on public.tasks for each row execute function app.audit_row();
create trigger audit_members after insert or update or delete on public.project_members for each row execute function app.audit_row();
