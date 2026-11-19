-- M Andamul Development OS · 0100 foundation
-- Organisations, configurable roles and permissions, profiles, project access, settings,
-- document numbering, and the append-only audit log. Money is numeric(18,2); never float.

create extension if not exists pgcrypto;
create schema if not exists app;   -- private helpers, not exposed through the API
create schema if not exists api;   -- RPC functions the client may call
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
grant usage on schema api to authenticated, service_role;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.app_modules (id text primary key, label text not null, sensitive boolean not null default false);
insert into public.app_modules (id, label, sensitive) values
  ('dashboard','Executive dashboard',false), ('projects','Projects',false), ('schedule','Schedule & tasks',false),
  ('site','Daily site reports',false), ('boq','BOQ & estimates',false), ('budget','Budgets & cost figures',true),
  ('procurement','Procurement & vendors',false), ('contracts','Contracts & contractor billing',true),
  ('payments','Invoices & payments',true), ('quality','Inspections & defects',false), ('handover','Readiness & handover',false),
  ('approvals','Approvals',false), ('documents','Documents',false), ('settings','Users, roles & settings',false), ('audit','Audit log',false);

create table public.roles (
  org_id uuid not null references public.organizations(id) on delete cascade,
  id text not null check (id ~ '^[a-z_]{2,30}$'),
  name text not null,
  active boolean not null default true,
  primary key (org_id, id)
);

create table public.role_permissions (
  org_id uuid not null,
  role_id text not null,
  module text not null references public.app_modules(id),
  action text not null check (action in ('view','create','edit','approve','export')),
  primary key (org_id, role_id, module, action),
  foreign key (org_id, role_id) references public.roles(org_id, id) on delete cascade
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  full_name text not null,
  email text not null,
  role_id text not null,
  all_projects boolean not null default false,
  active boolean not null default true,
  version integer not null default 1,
  foreign key (org_id, role_id) references public.roles(org_id, id)
);
create index on public.profiles (org_id);

create table public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  po_pm_limit numeric(18,2) not null default 500000 check (po_pm_limit > 0),
  po_pd_limit numeric(18,2) not null default 2500000,
  warn_pct numeric(5,2) not null default 90,
  flag_pct numeric(5,2) not null default 100,
  report_cutoff time not null default '19:00',
  max_upload_mb integer not null default 25 check (max_upload_mb between 1 and 50),   -- storage bucket hard cap is 50 MB (0900)
  allowed_mime text[] not null default array['application/pdf','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/vnd.dwg','application/acad'],
  invoice_due_days integer not null default 30,
  rabill_due_days integer not null default 15,
  version integer not null default 1,
  check (po_pd_limit > po_pm_limit)
);

-- Concurrency-safe document numbering: PO-26-0001, MR-26-0001 …
create table public.doc_counters (
  org_id uuid not null references public.organizations(id) on delete cascade,
  prefix text not null,
  yy integer not null,
  last_no integer not null default 0,
  primary key (org_id, prefix, yy)
);
create or replace function app.next_no(p_org uuid, p_prefix text) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_yy integer := extract(year from now())::integer % 100; v_no integer;
begin
  insert into doc_counters (org_id, prefix, yy, last_no) values (p_org, p_prefix, v_yy, 1)
  on conflict (org_id, prefix, yy) do update set last_no = doc_counters.last_no + 1
  returning last_no into v_no;
  return p_prefix || '-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_no::text, 4, '0');
end $$;

-- ---------- identity & permission helpers (used by RLS and every API function) ----------
create or replace function app.uid() returns uuid language sql stable as $$ select auth.uid() $$;
create or replace function app.org() returns uuid language sql stable security definer set search_path = public as $$
  select org_id from profiles where user_id = auth.uid() and active
$$;
create or replace function app.role() returns text language sql stable security definer set search_path = public as $$
  select role_id from profiles where user_id = auth.uid() and active
$$;
create or replace function app.has_perm(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    join roles r on r.org_id = p.org_id and r.id = p.role_id and r.active
    join role_permissions rp on rp.org_id = p.org_id and rp.role_id = p.role_id and rp.module = p_module and rp.action = p_action
    where p.user_id = auth.uid() and p.active)
$$;
create or replace function app.require_perm(p_module text, p_action text) returns void language plpgsql stable as $$
begin
  if not app.has_perm(p_module, p_action) then
    raise exception 'permission denied: % on %', p_action, p_module using errcode = '42501';
  end if;
end $$;

-- ---------- append-only audit log ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  at timestamptz not null default clock_timestamp(),
  user_id uuid,
  role_id text,
  table_name text not null,
  record_id text,
  project_id text,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  note text
);
create index on public.audit_log (org_id, at desc);
create index on public.audit_log (project_id, at desc);

create or replace function app.block_audit_change() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.block_audit_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.block_audit_change();

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        v_row jsonb := coalesce(v_new, v_old);
begin
  insert into audit_log (org_id, user_id, role_id, table_name, record_id, project_id, action, old_row, new_row)
  values (coalesce((v_row ->> 'org_id')::uuid, app.org()), auth.uid(), app.role(), tg_table_name,
          coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'version_id'),
          coalesce(v_row ->> 'project_id', case when tg_table_name = 'projects' then v_row ->> 'id' end),
          lower(tg_op), v_old, v_new);
  return coalesce(new, old);
end $$;

-- free-text note for a business event (e.g. "override approved because …")
create or replace function app.log(p_project text, p_action text, p_note text, p_record text default null) returns void
language sql security definer set search_path = public, app as $$
  insert into audit_log (org_id, user_id, role_id, table_name, record_id, project_id, action, note)
  values (app.org(), auth.uid(), app.role(), 'event', p_record, p_project, p_action, p_note)
$$;

-- optimistic concurrency: every update bumps version
create or replace function app.bump_version() returns trigger language plpgsql as $$
begin new.version := old.version + 1; return new; end $$;

create trigger profiles_version before update on public.profiles for each row execute function app.bump_version();
create trigger org_settings_version before update on public.org_settings for each row execute function app.bump_version();
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function app.audit_row();
create trigger audit_roles after insert or update or delete on public.roles for each row execute function app.audit_row();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions for each row execute function app.audit_row();
create trigger audit_org_settings after insert or update or delete on public.org_settings for each row execute function app.audit_row();
