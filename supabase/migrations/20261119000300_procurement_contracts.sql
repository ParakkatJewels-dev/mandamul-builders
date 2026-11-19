-- M Andamul Development OS · 0300 procurement (MR → RFQ → PO → GRN → invoice → payment) and contractor billing
-- (contract → work order items → verified measurements → running-account bill → certification → payment)

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  category text not null,
  city text,
  gstin text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  approved boolean not null default false,
  credit_days integer not null default 30 check (credit_days between 0 and 180),
  created_at timestamptz not null default now()
);
create unique index vendors_unique_name on public.vendors (org_id, lower(name));

create table public.material_requests (
  id text primary key,
  org_id uuid not null references public.organizations(id),
  project_id text not null references public.projects(id),
  code text not null,
  unit_id uuid references public.units(id),
  item text not null check (length(trim(item)) >= 2),
  qty numeric(16,3) not null check (qty > 0),
  uom text not null,
  needed_by date not null,
  urgency text not null default 'Normal' check (urgency in ('Normal','Urgent — work stopped','Urgent')),
  requested_by uuid not null,
  status text not null default 'Submitted' check (status in ('Submitted','Quoting','Quotes received','PO raised','Cancelled')),
  duplicate_note text,
  created_at timestamptz not null default now()
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  mr_id text not null references public.material_requests(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  rate numeric(18,2) not null check (rate > 0),
  gst_pct numeric(5,2) not null default 18 check (gst_pct between 0 and 28),
  lead_days integer not null default 7 check (lead_days >= 0),
  note text,
  unique (mr_id, vendor_id)
);

create table public.purchase_orders (
  id text primary key,
  org_id uuid not null references public.organizations(id),
  project_id text not null references public.projects(id),
  code text not null,
  vendor_id uuid not null references public.vendors(id),
  mr_id text unique references public.material_requests(id),     -- one PO per request: no duplicate orders
  unit_id uuid references public.units(id),
  item text not null,
  uom text not null,
  qty numeric(16,3) not null check (qty > 0),
  rate numeric(18,2) not null check (rate > 0),
  gst_pct numeric(5,2) not null check (gst_pct between 0 and 28),
  amount numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  tax numeric(18,2) generated always as (round(round(qty * rate, 2) * gst_pct / 100, 2)) stored,
  total numeric(18,2) generated always as (round(qty * rate, 2) + round(round(qty * rate, 2) * gst_pct / 100, 2)) stored,
  status text not null default 'Pending approval' check (status in ('Pending approval','Approved','Part received','Received','Rejected','Closed')),
  available_at_request numeric(18,2),
  over_budget numeric(18,2) not null default 0 check (over_budget >= 0),
  not_lowest_reason text,
  expected_delivery date,
  approval_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  version integer not null default 1
);
create index on public.purchase_orders (project_id, code);

create table public.goods_receipts (
  id text primary key,
  po_id text not null references public.purchase_orders(id),
  received_on date not null check (received_on <= current_date),
  qty numeric(16,3) not null check (qty > 0),
  qc text not null check (qc in ('Pass','Fail')),
  accepted_value numeric(18,2) not null check (accepted_value >= 0),
  note text,
  received_by uuid,
  created_at timestamptz not null default now(),
  check (qc = 'Pass' or accepted_value = 0)
);

create table public.vendor_invoices (
  id text primary key,
  org_id uuid not null references public.organizations(id),
  project_id text not null references public.projects(id),
  vendor_id uuid not null references public.vendors(id),
  po_id text not null references public.purchase_orders(id),
  invoice_no text not null,
  invoice_date date not null check (invoice_date <= current_date),
  qty numeric(16,3) not null check (qty > 0),
  rate numeric(18,2) not null check (rate > 0),
  gst_pct numeric(5,2) not null,
  amount numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  tax numeric(18,2) generated always as (round(round(qty * rate, 2) * gst_pct / 100, 2)) stored,
  total numeric(18,2) generated always as (round(qty * rate, 2) + round(round(qty * rate, 2) * gst_pct / 100, 2)) stored,
  match_status text not null check (match_status in ('Matched','On hold')),
  match_notes text,
  status text not null check (status in ('On hold','Pending approval','Approved','Paid','Rejected')),
  due_date date,
  approval_id text,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- the same vendor invoice number can never be booked twice
create unique index vendor_invoices_no_dup on public.vendor_invoices (vendor_id, lower(regexp_replace(invoice_no, '\s', '', 'g')));

create table public.contracts (
  id text primary key,
  org_id uuid not null references public.organizations(id),
  project_id text not null references public.projects(id),
  vendor_id uuid not null references public.vendors(id),
  code text not null,
  unit_id uuid references public.units(id),
  title text not null,
  retention_pct numeric(5,2) not null default 5 check (retention_pct between 0 and 20),
  advance_amount numeric(18,2) not null default 0 check (advance_amount >= 0),
  advance_recovery_pct numeric(5,2) not null default 10 check (advance_recovery_pct between 0 and 100),
  tds_pct numeric(5,2) not null default 2 check (tds_pct between 0 and 10),
  gst_pct numeric(5,2) not null default 18 check (gst_pct between 0 and 28),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'Pending approval' check (status in ('Pending approval','Active','Rejected','Closed')),
  over_budget numeric(18,2) not null default 0,
  approval_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.contract_items (
  id uuid primary key default gen_random_uuid(),
  contract_id text not null references public.contracts(id) on delete cascade,
  boq_item_id uuid references public.boq_items(id),
  description text not null,
  uom text not null,
  qty numeric(16,3) not null check (qty > 0),
  rate numeric(18,2) not null check (rate > 0)
);
create or replace function app.freeze_contract_items() returns trigger language plpgsql as $$
begin
  if exists (select 1 from contracts where id = coalesce(new.contract_id, old.contract_id) and status <> 'Pending approval') then
    raise exception 'contract items are frozen once approved; raise a variation' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger contract_items_frozen before insert or update or delete on public.contract_items for each row execute function app.freeze_contract_items();

create table public.contract_variations (
  id text primary key,
  contract_id text not null references public.contracts(id),
  description text not null,
  amount numeric(18,2) not null check (amount <> 0),        -- excl. GST, may be negative
  status text not null default 'Pending approval' check (status in ('Pending approval','Approved','Rejected')),
  approval_id text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.ra_bills (
  id text primary key,
  contract_id text not null references public.contracts(id),
  bill_no integer not null check (bill_no >= 1),
  gross numeric(18,2) not null check (gross > 0),
  gst numeric(18,2) not null check (gst >= 0),
  retention numeric(18,2) not null check (retention >= 0),
  advance_recovery numeric(18,2) not null check (advance_recovery >= 0),
  tds numeric(18,2) not null check (tds >= 0),
  other_deductions numeric(18,2) not null default 0 check (other_deductions >= 0),
  net_payable numeric(18,2) not null check (net_payable >= 0),
  status text not null default 'In approval' check (status in ('In approval','Approved','Paid','Rejected')),
  approval_id text,
  due_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (contract_id, bill_no),
  check (net_payable = gross + gst - retention - advance_recovery - tds - other_deductions)
);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  contract_item_id uuid not null references public.contract_items(id),
  qty numeric(16,3) not null check (qty > 0),
  measured_on date not null check (measured_on <= current_date),
  unit_id uuid references public.units(id),
  location_note text,
  recorded_by uuid not null,
  status text not null default 'Recorded' check (status in ('Recorded','Verified','Rejected')),
  verified_by uuid,
  verified_at timestamptz,
  ra_bill_id text references public.ra_bills(id),
  check (verified_by is null or verified_by <> recorded_by),
  check (ra_bill_id is null or status = 'Verified')
);

create table public.ra_bill_lines (
  bill_id text not null references public.ra_bills(id) on delete cascade,
  contract_item_id uuid not null references public.contract_items(id),
  prev_qty numeric(16,3) not null, this_qty numeric(16,3) not null check (this_qty > 0), cum_qty numeric(16,3) not null,
  rate numeric(18,2) not null, amount numeric(18,2) not null,
  primary key (bill_id, contract_item_id),
  check (cum_qty = prev_qty + this_qty), check (amount = round(this_qty * rate, 2))
);

create table public.payments (
  id text primary key,
  org_id uuid not null references public.organizations(id),
  project_id text not null references public.projects(id),
  vendor_id uuid not null references public.vendors(id),
  kind text not null check (kind in ('invoice','ra_bill','advance')),
  invoice_id text references public.vendor_invoices(id),
  ra_bill_id text references public.ra_bills(id),
  contract_id text references public.contracts(id),
  amount numeric(18,2) not null check (amount > 0),      -- cash to the vendor
  tds numeric(18,2) not null default 0 check (tds >= 0), -- deducted and deposited with the government
  paid_on date not null check (paid_on <= current_date),
  bank_reference text not null check (length(bank_reference) >= 4),
  reconciled boolean not null default false,
  reconciled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'invoice') = (invoice_id is not null)),
  check ((kind = 'ra_bill') = (ra_bill_id is not null)),
  check ((kind = 'advance') = (contract_id is not null and invoice_id is null and ra_bill_id is null))
);
create unique index payments_no_dup_ref on public.payments (vendor_id, lower(bank_reference));

create trigger purchase_orders_version before update on public.purchase_orders for each row execute function app.bump_version();
create trigger contracts_version before update on public.contracts for each row execute function app.bump_version();
do $$ declare t text; begin
  foreach t in array array['vendors','material_requests','quotations','purchase_orders','goods_receipts','vendor_invoices','contracts','contract_items','contract_variations','measurements','ra_bills','payments'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;
