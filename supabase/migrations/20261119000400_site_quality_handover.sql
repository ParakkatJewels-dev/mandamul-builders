-- M Andamul Development OS · 0400 site reports, documents, quality, readiness, handover, approvals, automation

create table public.daily_reports (
  id text primary key,
  project_id text not null references public.projects(id),
  report_date date not null check (report_date <= current_date),
  submitted_by uuid not null,
  weather text,
  labour jsonb not null default '[]'::jsonb check (jsonb_typeof(labour) = 'array'),
  issues text, safety text,
  status text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Returned')),
  review_note text,
  verified_by uuid,
  approval_id text,
  created_at timestamptz not null default now(),
  check (verified_by is null or verified_by <> submitted_by)
);
-- one live report per site per day (drafts and returned reports excluded)
create unique index daily_reports_one_per_day on public.daily_reports (project_id, report_date) where status in ('Submitted','Approved');

create table public.report_work_lines (
  report_id text not null references public.daily_reports(id) on delete cascade,
  task_id uuid not null references public.tasks(id),
  progress_to integer check (progress_to between 0 and 100),
  boq_item_id uuid references public.boq_items(id),
  qty numeric(16,3) check (qty is null or qty > 0),
  note text,
  primary key (report_id, task_id),
  check (qty is null or boq_item_id is not null)
);

create table public.documents (
  id text primary key,
  project_id text not null references public.projects(id),
  title text not null,
  doc_type text not null,
  folder text,
  tags text[] not null default '{}',
  expiry date,
  created_at timestamptz not null default now()
);
create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.documents(id) on delete cascade,
  rev text not null,
  storage_path text not null,               -- private bucket path; served only through signed URLs
  file_name text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null check (status in ('Draft','Pending','Approved','Superseded','Rejected')),
  note text,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  unique (document_id, rev)
);
create unique index document_one_approved on public.document_versions (document_id) where status = 'Approved';
create table public.document_links (
  document_id text not null references public.documents(id) on delete cascade,
  link_kind text not null check (link_kind in ('task','boq_item','cost_code','unit')),
  link_id text not null,
  primary key (document_id, link_kind, link_id)
);

create table public.inspections (
  id text primary key,
  project_id text not null references public.projects(id),
  unit_id uuid references public.units(id),
  kind text not null check (kind in ('Stage','Commissioning','Safety','Final','Material')),
  stage_key text,
  system text check (system is null or system in ('Electrical','HVAC','Plumbing','Fire','ELV','Pool','Kitchen')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  status text not null default 'Requested' check (status in ('Requested','Passed','Failed')),
  inspector_id uuid,
  decided_at timestamptz,
  notes text,
  check (kind <> 'Stage' or stage_key is not null),
  check (kind <> 'Commissioning' or system is not null),
  check (inspector_id is null or inspector_id <> requested_by),
  check ((status = 'Requested') = (inspector_id is null))
);

create table public.unit_stages (
  unit_id uuid not null references public.units(id) on delete cascade,
  stage_key text not null,
  seq integer not null,
  label text not null,
  status text not null default 'Not started' check (status in ('Not started','In progress','Awaiting inspection','Passed')),
  passed_inspection_id text references public.inspections(id),
  updated_at timestamptz not null default now(),
  primary key (unit_id, stage_key),
  check (status <> 'Passed' or passed_inspection_id is not null)   -- readiness comes from verified inspections, not typed percentages
);

create table public.unit_commissioning (
  unit_id uuid not null references public.units(id) on delete cascade,
  system text not null,
  status text not null default 'Pending' check (status in ('Pending','Passed')),
  passed_inspection_id text references public.inspections(id),
  primary key (unit_id, system),
  check (status <> 'Passed' or passed_inspection_id is not null)
);

create table public.snags (
  id text primary key,
  project_id text not null references public.projects(id),
  unit_id uuid references public.units(id),
  inspection_id text references public.inspections(id),
  title text not null,
  severity text not null check (severity in ('Safety-critical','Major','Minor')),
  category text not null default 'Workmanship',
  assignee_vendor_id uuid references public.vendors(id),
  due_date date,
  status text not null default 'Open' check (status in ('Open','Fixed','Closed')),
  raised_by uuid not null,
  fixed_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'Closed') = (closed_by is not null))
);

create table public.ffe_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  unit_id uuid not null references public.units(id),
  item text not null, category text not null, qty integer not null check (qty > 0),
  status text not null default 'Specified' check (status in ('Specified','Ordered','Delivered','Installed','Tested','Defective')),
  po_id text references public.purchase_orders(id)
);

create table public.handover_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  item_key text not null, label text not null,
  status text not null default 'Open' check (status in ('Open','Done','Not applicable')),
  evidence_document_id text references public.documents(id),
  done_by uuid, done_at timestamptz,
  unique (project_id, item_key),
  check (status <> 'Done' or evidence_document_id is not null)
);
create table public.warranties (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  unit_id uuid references public.units(id),
  item text not null, vendor_id uuid references public.vendors(id),
  start_date date not null, end_date date not null check (end_date > start_date), terms text
);
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  unit_id uuid references public.units(id),
  name text not null, serial_no text, warranty_id uuid references public.warranties(id)
);

-- generic multi-step approvals
create table public.approvals (
  id text primary key,
  org_id uuid not null references public.organizations(id),
  project_id text not null references public.projects(id),
  kind text not null check (kind in ('PO','BUDGET','REPORT','DOC','INVOICE','RABILL','CONTRACT','VARIATION')),
  ref text not null,
  title text not null,
  amount numeric(18,2),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  closed_at timestamptz,
  ctx jsonb not null default '{}'::jsonb
);
create unique index approvals_one_open_per_ref on public.approvals (kind, ref) where status = 'Pending';
create table public.approval_steps (
  approval_id text not null references public.approvals(id) on delete cascade,
  seq integer not null,
  role_id text not null,
  module text not null references public.app_modules(id),
  label text not null,
  status text not null check (status in ('waiting','pending','approved','rejected','skipped')),
  decided_by uuid, decided_at timestamptz, comment text,
  primary key (approval_id, seq)
);

create table public.notifications (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  user_id uuid not null references public.profiles(user_id),
  channel text not null default 'in_app' check (channel in ('in_app','email','whatsapp')),
  delivery text not null default 'delivered' check (delivery in ('delivered','queued','failed','not_configured')),
  text text not null, link text,
  event_id bigint,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.automation_rules (
  org_id uuid not null references public.organizations(id),
  id text not null, name text not null, event text not null,
  notify_roles text[] not null default '{}',
  escalate_role text, escalate_after_hours integer check (escalate_after_hours is null or escalate_after_hours > 0),
  channels text[] not null default array['in_app'],
  creates_risk boolean not null default false,
  enabled boolean not null default true,
  primary key (org_id, id)
);
create table public.automation_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  project_id text,
  event text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','processed','failed','dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (org_id, dedupe_key)   -- duplicate-event prevention
);
create table public.channel_config (
  org_id uuid not null references public.organizations(id), channel text not null check (channel in ('email','whatsapp')),
  provider text, enabled boolean not null default false, primary key (org_id, channel)
);

create table public.risks (
  id text primary key,
  project_id text not null references public.projects(id),
  title text not null, source text not null,
  severity text not null check (severity in ('High','Medium','Low')),
  status text not null default 'Open' check (status in ('Open','Mitigating','Closed')),
  owner_id uuid, dedupe_key text unique,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['daily_reports','report_work_lines','documents','document_versions','document_links','inspections','unit_stages','unit_commissioning','snags','ffe_items','handover_items','warranties','assets','approvals','approval_steps','automation_rules','risks'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;
