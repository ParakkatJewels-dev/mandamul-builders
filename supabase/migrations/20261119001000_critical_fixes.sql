-- M Andamul Development OS · 1000 Phase 3, batch 1: critical security, financial and data-integrity fixes
-- B01 multi-factor level on financial approvals, payments and settings · B02 one permission matrix · B03/B04 cancel and
-- short-close with commitment release · B05 last receipt takes the remainder · B06 rejected PO reopens its request ·
-- B07 organisation time zone · B12 administration API · B21 contingency checks its own permission.

-- ---------- B07 time zone ----------
alter table public.org_settings add column if not exists time_zone text not null default 'Asia/Kolkata';
do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'Asia/Kolkata'); end $$;
set timezone = 'Asia/Kolkata';
create or replace function app.today(p_org uuid default null) returns date language sql stable security definer set search_path = public, app as $$
  select (now() at time zone coalesce((select time_zone from org_settings where org_id = coalesce(p_org, app.org())), 'Asia/Kolkata'))::date
$$;
create or replace function app.local_time(p_org uuid default null) returns time language sql stable security definer set search_path = public, app as $$
  select (now() at time zone coalesce((select time_zone from org_settings where org_id = coalesce(p_org, app.org())), 'Asia/Kolkata'))::time
$$;

-- ---------- B01 multi-factor level ----------
alter table public.org_settings add column if not exists mfa_actions text[] not null
  default '{procurement:approve,contracts:approve,budget:approve,payments:approve,payments:create,payments:edit,handover:approve,settings:create,settings:edit}';
create or replace function app.require_perm(p_module text, p_action text) returns void language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.has_perm(p_module, p_action) then
    raise exception 'permission denied: % on %', p_action, p_module using errcode = '42501';
  end if;
  -- financial approvals, payments and settings need a multi-factor session (Supabase sets aal2 after a TOTP challenge)
  if auth.uid() is not null and (p_module || ':' || p_action) = any (coalesce((select mfa_actions from org_settings where org_id = app.org()), '{}'))
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'multi-factor sign-in required for % on %', p_action, p_module using errcode = '42501', hint = 'verify with your authenticator app and try again';
  end if;
end $$;

-- ---------- B02 one permission matrix ----------
create table if not exists public.permission_defaults (role_id text not null, module text not null references public.app_modules(id), action text not null,
  primary key (role_id, module, action));
insert into public.permission_defaults (role_id, module, action) values
  ('architect','approvals','view'),
  ('architect','documents','create'),
  ('architect','documents','edit'),
  ('architect','documents','export'),
  ('architect','documents','view'),
  ('architect','projects','view'),
  ('architect','quality','view'),
  ('architect','schedule','view'),
  ('civil','projects','view'),
  ('civil','quality','create'),
  ('civil','quality','view'),
  ('civil','schedule','view'),
  ('civil','site','create'),
  ('civil','site','view'),
  ('client','projects','view'),
  ('finance','approvals','approve'),
  ('finance','approvals','view'),
  ('finance','audit','export'),
  ('finance','audit','view'),
  ('finance','boq','view'),
  ('finance','budget','approve'),
  ('finance','budget','export'),
  ('finance','budget','view'),
  ('finance','contracts','view'),
  ('finance','dashboard','export'),
  ('finance','dashboard','view'),
  ('finance','documents','view'),
  ('finance','payments','approve'),
  ('finance','payments','create'),
  ('finance','payments','edit'),
  ('finance','payments','export'),
  ('finance','payments','view'),
  ('finance','procurement','view'),
  ('finance','projects','view'),
  ('hr','projects','view'),
  ('hr','site','view'),
  ('interior','documents','create'),
  ('interior','documents','edit'),
  ('interior','documents','view'),
  ('interior','handover','create'),
  ('interior','handover','edit'),
  ('interior','handover','view'),
  ('interior','projects','view'),
  ('md','approvals','approve'),
  ('md','approvals','export'),
  ('md','approvals','view'),
  ('md','audit','export'),
  ('md','audit','view'),
  ('md','boq','export'),
  ('md','boq','view'),
  ('md','budget','approve'),
  ('md','budget','export'),
  ('md','budget','view'),
  ('md','contracts','approve'),
  ('md','contracts','export'),
  ('md','contracts','view'),
  ('md','dashboard','export'),
  ('md','dashboard','view'),
  ('md','documents','approve'),
  ('md','documents','export'),
  ('md','documents','view'),
  ('md','handover','approve'),
  ('md','handover','export'),
  ('md','handover','view'),
  ('md','payments','approve'),
  ('md','payments','export'),
  ('md','payments','view'),
  ('md','procurement','approve'),
  ('md','procurement','export'),
  ('md','procurement','view'),
  ('md','projects','create'),
  ('md','projects','export'),
  ('md','projects','view'),
  ('md','quality','export'),
  ('md','quality','view'),
  ('md','schedule','export'),
  ('md','schedule','view'),
  ('md','site','export'),
  ('md','site','view'),
  ('pd','approvals','approve'),
  ('pd','approvals','export'),
  ('pd','approvals','view'),
  ('pd','audit','export'),
  ('pd','audit','view'),
  ('pd','boq','export'),
  ('pd','boq','view'),
  ('pd','budget','create'),
  ('pd','budget','export'),
  ('pd','budget','view'),
  ('pd','contracts','approve'),
  ('pd','contracts','create'),
  ('pd','contracts','edit'),
  ('pd','contracts','export'),
  ('pd','contracts','view'),
  ('pd','dashboard','export'),
  ('pd','dashboard','view'),
  ('pd','documents','approve'),
  ('pd','documents','create'),
  ('pd','documents','edit'),
  ('pd','documents','export'),
  ('pd','documents','view'),
  ('pd','handover','approve'),
  ('pd','handover','export'),
  ('pd','handover','view'),
  ('pd','payments','approve'),
  ('pd','payments','export'),
  ('pd','payments','view'),
  ('pd','procurement','approve'),
  ('pd','procurement','export'),
  ('pd','procurement','view'),
  ('pd','projects','create'),
  ('pd','projects','edit'),
  ('pd','projects','export'),
  ('pd','projects','view'),
  ('pd','quality','approve'),
  ('pd','quality','export'),
  ('pd','quality','view'),
  ('pd','schedule','approve'),
  ('pd','schedule','create'),
  ('pd','schedule','edit'),
  ('pd','schedule','export'),
  ('pd','schedule','view'),
  ('pd','site','approve'),
  ('pd','site','export'),
  ('pd','site','view'),
  ('pm','approvals','approve'),
  ('pm','approvals','view'),
  ('pm','boq','view'),
  ('pm','budget','create'),
  ('pm','budget','view'),
  ('pm','contracts','approve'),
  ('pm','contracts','create'),
  ('pm','contracts','edit'),
  ('pm','contracts','view'),
  ('pm','dashboard','view'),
  ('pm','documents','create'),
  ('pm','documents','edit'),
  ('pm','documents','view'),
  ('pm','handover','create'),
  ('pm','handover','edit'),
  ('pm','handover','view'),
  ('pm','procurement','approve'),
  ('pm','procurement','create'),
  ('pm','procurement','edit'),
  ('pm','procurement','view'),
  ('pm','projects','edit'),
  ('pm','projects','view'),
  ('pm','quality','approve'),
  ('pm','quality','create'),
  ('pm','quality','edit'),
  ('pm','quality','view'),
  ('pm','schedule','create'),
  ('pm','schedule','edit'),
  ('pm','schedule','view'),
  ('pm','site','approve'),
  ('pm','site','create'),
  ('pm','site','edit'),
  ('pm','site','view'),
  ('proc','approvals','view'),
  ('proc','boq','view'),
  ('proc','budget','view'),
  ('proc','dashboard','view'),
  ('proc','documents','create'),
  ('proc','documents','view'),
  ('proc','procurement','create'),
  ('proc','procurement','edit'),
  ('proc','procurement','export'),
  ('proc','procurement','view'),
  ('proc','projects','view'),
  ('qs','approvals','approve'),
  ('qs','approvals','view'),
  ('qs','boq','approve'),
  ('qs','boq','create'),
  ('qs','boq','edit'),
  ('qs','boq','export'),
  ('qs','boq','view'),
  ('qs','budget','create'),
  ('qs','budget','edit'),
  ('qs','budget','export'),
  ('qs','budget','view'),
  ('qs','contracts','create'),
  ('qs','contracts','edit'),
  ('qs','contracts','export'),
  ('qs','contracts','view'),
  ('qs','dashboard','view'),
  ('qs','documents','view'),
  ('qs','procurement','view'),
  ('qs','projects','view'),
  ('qs','schedule','view'),
  ('qs','site','view'),
  ('quality','approvals','approve'),
  ('quality','approvals','view'),
  ('quality','documents','view'),
  ('quality','handover','approve'),
  ('quality','handover','create'),
  ('quality','handover','edit'),
  ('quality','handover','view'),
  ('quality','projects','view'),
  ('quality','quality','approve'),
  ('quality','quality','create'),
  ('quality','quality','edit'),
  ('quality','quality','view'),
  ('quality','schedule','view'),
  ('quality','site','view'),
  ('site_sup','documents','view'),
  ('site_sup','handover','view'),
  ('site_sup','procurement','create'),
  ('site_sup','procurement','edit'),
  ('site_sup','procurement','view'),
  ('site_sup','projects','view'),
  ('site_sup','quality','create'),
  ('site_sup','quality','view'),
  ('site_sup','schedule','view'),
  ('site_sup','site','create'),
  ('site_sup','site','edit'),
  ('site_sup','site','view'),
  ('store','procurement','edit'),
  ('store','procurement','view'),
  ('store','projects','view'),
  ('super_admin','approvals','view'),
  ('super_admin','audit','create'),
  ('super_admin','audit','edit'),
  ('super_admin','audit','export'),
  ('super_admin','audit','view'),
  ('super_admin','boq','create'),
  ('super_admin','boq','edit'),
  ('super_admin','boq','export'),
  ('super_admin','boq','view'),
  ('super_admin','budget','create'),
  ('super_admin','budget','edit'),
  ('super_admin','budget','export'),
  ('super_admin','budget','view'),
  ('super_admin','contracts','create'),
  ('super_admin','contracts','edit'),
  ('super_admin','contracts','export'),
  ('super_admin','contracts','view'),
  ('super_admin','dashboard','create'),
  ('super_admin','dashboard','edit'),
  ('super_admin','dashboard','export'),
  ('super_admin','dashboard','view'),
  ('super_admin','documents','create'),
  ('super_admin','documents','edit'),
  ('super_admin','documents','export'),
  ('super_admin','documents','view'),
  ('super_admin','handover','create'),
  ('super_admin','handover','edit'),
  ('super_admin','handover','export'),
  ('super_admin','handover','view'),
  ('super_admin','payments','create'),
  ('super_admin','payments','edit'),
  ('super_admin','payments','export'),
  ('super_admin','payments','view'),
  ('super_admin','procurement','create'),
  ('super_admin','procurement','edit'),
  ('super_admin','procurement','export'),
  ('super_admin','procurement','view'),
  ('super_admin','projects','create'),
  ('super_admin','projects','edit'),
  ('super_admin','projects','export'),
  ('super_admin','projects','view'),
  ('super_admin','quality','create'),
  ('super_admin','quality','edit'),
  ('super_admin','quality','export'),
  ('super_admin','quality','view'),
  ('super_admin','schedule','create'),
  ('super_admin','schedule','edit'),
  ('super_admin','schedule','export'),
  ('super_admin','schedule','view'),
  ('super_admin','settings','create'),
  ('super_admin','settings','edit'),
  ('super_admin','settings','export'),
  ('super_admin','settings','view'),
  ('super_admin','site','create'),
  ('super_admin','site','edit'),
  ('super_admin','site','export'),
  ('super_admin','site','view'),
  ('vendor','documents','view')
on conflict do nothing;
alter table public.permission_defaults enable row level security;
create policy permission_defaults_read on public.permission_defaults for select to authenticated using (true);
grant select on public.permission_defaults to authenticated;
-- new organisations take the canonical matrix; existing organisations gain the missing defaults (nothing is removed)
create or replace function app.apply_permission_defaults(p_org uuid) returns integer language sql security definer set search_path = public, app as $$
  with ins as (insert into role_permissions (org_id, role_id, module, action)
               select p_org, d.role_id, d.module, d.action from permission_defaults d join roles r on r.org_id = p_org and r.id = d.role_id
               on conflict do nothing returning 1)
  select count(*)::integer from ins
$$;
select app.apply_permission_defaults(id) from organizations;

-- ---------- B03/B04 cancel and short-close ----------
alter table public.purchase_orders drop constraint purchase_orders_status_check,
  add constraint purchase_orders_status_check check (status in ('Pending approval','Approved','Part received','Received','Rejected','Closed','Cancelled'));
alter table public.purchase_orders add column if not exists closed_reason text, add column if not exists closed_by uuid, add column if not exists closed_at timestamptz;
alter table public.contracts add column if not exists closed_reason text, add column if not exists closed_by uuid, add column if not exists closed_at timestamptz;
alter table public.approvals drop constraint approvals_status_check, add constraint approvals_status_check check (status in ('Pending','Approved','Rejected','Withdrawn'));

-- commitment: a closed order counts what was accepted; a closed contract counts what was certified; cancelled counts nothing
create or replace function app.code_commitments(p_project text, p_code text, out committed numeric, out pending numeric)
language sql stable security definer set search_path = public, app as $$
  select
    coalesce((select sum(total) from purchase_orders where project_id = p_project and code = p_code and status in ('Approved','Part received','Received')), 0)
  + coalesce((select sum(g.accepted_value) from goods_receipts g join purchase_orders po on po.id = g.po_id where po.project_id = p_project and po.code = p_code and po.status = 'Closed'), 0)
  + coalesce((select sum(app.incl_gst(app.contract_value(c.id), c.gst_pct)) from contracts c where c.project_id = p_project and c.code = p_code and c.status = 'Active'), 0)
  + coalesce((select sum(app.incl_gst(v.amount, c.gst_pct)) from contract_variations v join contracts c on c.id = v.contract_id where c.project_id = p_project and c.code = p_code and v.status = 'Approved' and c.status = 'Active'), 0)
  + coalesce((select sum(b.gross + b.gst) from ra_bills b join contracts c on c.id = b.contract_id where c.project_id = p_project and c.code = p_code and c.status = 'Closed' and b.status in ('Approved','Paid')), 0),
    coalesce((select sum(total) from purchase_orders where project_id = p_project and code = p_code and status = 'Pending approval'), 0)
  + coalesce((select sum(app.incl_gst(app.contract_value(c.id), c.gst_pct)) from contracts c where c.project_id = p_project and c.code = p_code and c.status = 'Pending approval'), 0)
  + coalesce((select sum(app.incl_gst(greatest(v.amount, 0), c.gst_pct)) from contract_variations v join contracts c on c.id = v.contract_id where c.project_id = p_project and c.code = p_code and v.status = 'Pending approval'), 0)
$$;

create or replace function api.cancel_po(p_po text, p_reason text, p_reopen_request boolean default true) returns text
language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders; v_ap approvals;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order % not found', p_po; end if;
  perform app.require(po.project_id, 'procurement', 'approve');
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
  if po.status not in ('Pending approval','Approved') then raise exception 'purchase order % is %; only unapproved or undelivered orders can be cancelled (part-delivered orders are short-closed)', p_po, po.status using errcode = '42501'; end if;
  if exists (select 1 from goods_receipts where po_id = p_po and qc = 'Pass') then raise exception 'purchase order % has accepted receipts; short-close it instead', p_po using errcode = '42501'; end if;
  if exists (select 1 from vendor_invoices where po_id = p_po and status <> 'Rejected') then raise exception 'purchase order % has an invoice; reject the invoice first', p_po using errcode = '42501'; end if;
  update purchase_orders set status = 'Cancelled', closed_reason = p_reason, closed_by = auth.uid(), closed_at = now() where id = p_po;
  select * into v_ap from approvals where kind = 'PO' and ref = p_po and status = 'Pending';
  if found then
    update approval_steps set status = 'skipped' where approval_id = v_ap.id and status in ('pending','waiting');
    update approvals set status = 'Withdrawn', closed_at = now() where id = v_ap.id;
  end if;
  if po.mr_id is not null then update material_requests set status = case when p_reopen_request then 'Quotes received' else 'Cancelled' end where id = po.mr_id; end if;
  perform app.emit(po.project_id, 'commitment_released', 'release:' || p_po, jsonb_build_object('ref', p_po, 'code', po.code, 'amount', case when po.status = 'Approved' then po.total else 0 end, 'reason', p_reason));
  return 'cancelled';
end $$;

create or replace function api.short_close_po(p_po text, p_reason text) returns numeric
language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders; v_acc numeric;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order % not found', p_po; end if;
  perform app.require(po.project_id, 'procurement', 'approve');
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
  if po.status <> 'Part received' then raise exception 'only part-received orders can be short-closed (this one is %)', po.status using errcode = '42501'; end if;
  select coalesce(sum(accepted_value), 0) into v_acc from goods_receipts where po_id = p_po and qc = 'Pass';
  update purchase_orders set status = 'Closed', closed_reason = p_reason, closed_by = auth.uid(), closed_at = now() where id = p_po;
  perform app.emit(po.project_id, 'commitment_released', 'release:' || p_po, jsonb_build_object('ref', p_po, 'code', po.code, 'amount', po.total - v_acc, 'reason', p_reason));
  return po.total - v_acc;   -- commitment released
end $$;

create or replace function api.close_contract(p_contract text, p_reason text) returns numeric
language plpgsql security definer set search_path = public, app as $$
declare c contracts; v_full numeric; v_cert numeric;
begin
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'contract % not found', p_contract; end if;
  perform app.require(c.project_id, 'contracts', 'approve');
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
  if c.status <> 'Active' then raise exception 'contract % is %', p_contract, c.status using errcode = '42501'; end if;
  if exists (select 1 from ra_bills where contract_id = p_contract and status = 'In approval') then raise exception 'a running bill is still in certification' using errcode = '42501'; end if;
  if exists (select 1 from contract_variations where contract_id = p_contract and status = 'Pending approval') then raise exception 'a variation is still pending' using errcode = '42501'; end if;
  v_full := app.incl_gst(app.contract_value(c.id), c.gst_pct) + coalesce((select sum(app.incl_gst(amount, c.gst_pct)) from contract_variations where contract_id = c.id and status = 'Approved'), 0);
  select coalesce(sum(gross + gst), 0) into v_cert from ra_bills where contract_id = c.id and status in ('Approved','Paid');
  update contracts set status = 'Closed', closed_reason = p_reason, closed_by = auth.uid(), closed_at = now() where id = p_contract;
  perform app.emit(c.project_id, 'commitment_released', 'release:' || p_contract, jsonb_build_object('ref', p_contract, 'code', c.code, 'amount', v_full - v_cert, 'reason', p_reason));
  return v_full - v_cert;
end $$;

-- ---------- B05 the receipt that completes an order takes the remainder of its total ----------
create or replace function api.record_grn(p_po text, p_qty numeric, p_qc text, p_received_on date default null, p_note text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders; v_acc numeric; v_acc_val numeric; v_id text; v_val numeric := 0; v_date date := coalesce(p_received_on, app.today());
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order % not found', p_po; end if;
  perform app.require(po.project_id, 'procurement', 'edit');
  if po.status not in ('Approved','Part received') then raise exception 'purchase order % is %; receipts need an approved order', p_po, po.status using errcode = '42501'; end if;
  if v_date > app.today() then raise exception 'a receipt cannot be dated in the future'; end if;
  select coalesce(sum(qty), 0), coalesce(sum(accepted_value), 0) into v_acc, v_acc_val from goods_receipts where po_id = p_po and qc = 'Pass';
  if p_qc = 'Pass' then
    if v_acc + p_qty > po.qty then raise exception 'over-receipt: % ordered, % already accepted', po.qty, v_acc using errcode = '23514'; end if;
    v_val := case when v_acc + p_qty = po.qty then po.total - v_acc_val else app.incl_gst(p_qty * po.rate, po.gst_pct) end;
  end if;
  v_id := app.next_no(app.org(), 'GRN');
  insert into goods_receipts (id, po_id, received_on, qty, qc, accepted_value, note, received_by) values (v_id, p_po, v_date, p_qty, p_qc, v_val, p_note, auth.uid());
  if p_qc = 'Pass' then update purchase_orders set status = case when v_acc + p_qty >= qty then 'Received' else 'Part received' end where id = p_po; end if;
  return v_id;
end $$;

-- ---------- B06 a rejected PO sends its request back for re-ordering ----------
create or replace function app.on_decided(a approvals, p_ok boolean, p_comment text) returns void
language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders; c contracts; r daily_reports; w record; v_doc text; v_rev text; inv vendor_invoices; vend vendors; s org_settings;
begin
  select * into s from org_settings where org_id = a.org_id;
  case a.kind
  when 'PO' then
    select * into po from purchase_orders where id = a.ref for update;
    if p_ok then update purchase_orders set status = 'Approved', approved_at = now() where id = po.id; perform app.consume_etc(po.project_id, po.code, po.total, po.id);
    else update purchase_orders set status = 'Rejected' where id = po.id;
      if po.mr_id is not null then update material_requests set status = 'Quotes received' where id = po.mr_id and status = 'PO raised'; end if; end if;
  when 'CONTRACT' then
    select * into c from contracts where id = a.ref for update;
    if p_ok then update contracts set status = 'Active' where id = c.id; perform app.consume_etc(c.project_id, c.code, app.incl_gst(app.contract_value(c.id), c.gst_pct), c.id);
    else update contracts set status = 'Rejected' where id = c.id; end if;
  when 'VARIATION' then
    update contract_variations set status = case when p_ok then 'Approved' else 'Rejected' end where id = a.ref;
    if p_ok and a.amount > 0 then select c2.* into c from contracts c2 join contract_variations v on v.contract_id = c2.id where v.id = a.ref;
      perform app.consume_etc(c.project_id, c.code, app.incl_gst(a.amount, c.gst_pct), a.ref); end if;
  when 'BUDGET' then
    update budget_versions set status = case when p_ok then 'Approved' else 'Rejected' end, decided_at = now() where id = a.ref::uuid;
  when 'REPORT' then
    select * into r from daily_reports where id = a.ref for update;
    if not p_ok then update daily_reports set status = 'Returned', review_note = p_comment where id = r.id; return; end if;
    update daily_reports set status = 'Approved', verified_by = auth.uid() where id = r.id;
    -- verified progress and quantities flow into the schedule and the BOQ
    for w in select * from report_work_lines where report_id = r.id loop
      if w.progress_to is not null then
        update tasks set progress = greatest(progress, w.progress_to),
          act_start = coalesce(act_start, r.report_date),
          act_finish = case when greatest(progress, w.progress_to) = 100 then coalesce(act_finish, r.report_date) else act_finish end
        where id = w.task_id and w.progress_to > progress;
      end if;
      if w.boq_item_id is not null and w.qty is not null then update boq_items set executed_qty = executed_qty + w.qty where id = w.boq_item_id; end if;
    end loop;
  when 'DOC' then
    v_doc := a.ctx ->> 'document_id'; v_rev := a.ctx ->> 'rev';
    if p_ok then
      update document_versions set status = 'Superseded' where document_id = v_doc and status = 'Approved';
      update document_versions set status = 'Approved' where document_id = v_doc and rev = v_rev;
      perform app.emit(a.project_id, 'drawing_revision', 'docrev:' || v_doc || ':' || v_rev,
        jsonb_build_object('document_id', v_doc, 'rev', v_rev,
          'tasks', (select coalesce(jsonb_agg(link_id), '[]') from document_links where document_id = v_doc and link_kind = 'task'),
          'boq_items', (select coalesce(jsonb_agg(link_id), '[]') from document_links where document_id = v_doc and link_kind = 'boq_item'),
          'open_orders', (select coalesce(jsonb_agg(po2.id), '[]') from purchase_orders po2 join document_links l on l.document_id = v_doc and l.link_kind = 'cost_code' and l.link_id = po2.code
                          where po2.project_id = a.project_id and po2.status in ('Pending approval','Approved','Part received'))));
    else update document_versions set status = 'Rejected' where document_id = v_doc and rev = v_rev; end if;
  when 'INVOICE' then
    select * into inv from vendor_invoices where id = a.ref; select * into vend from vendors where id = inv.vendor_id;
    update vendor_invoices set status = case when p_ok then 'Approved' else 'Rejected' end,
      due_date = case when p_ok then inv.invoice_date + vend.credit_days end where id = a.ref;
  when 'RABILL' then
    if p_ok then update ra_bills set status = 'Approved', due_date = current_date + s.rabill_due_days where id = a.ref;
    else update ra_bills set status = 'Rejected' where id = a.ref; update measurements set ra_bill_id = null where ra_bill_id = a.ref; end if;
  end case;
end $$;

-- a request back at "Quotes received" may get a new PO: a rejected or cancelled one no longer blocks it
alter table public.purchase_orders drop constraint if exists purchase_orders_mr_id_key;
create unique index if not exists purchase_orders_one_live_per_mr on public.purchase_orders (mr_id) where status not in ('Rejected','Cancelled');

-- ---------- B21 ----------
create or replace function api.contingency(p_project text, out contingency_budget numeric, out overruns numeric, out available numeric)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'budget', 'view');
  select sum(cp.current_budget) filter (where c.is_contingency),
         sum(greatest(cp.forecast - cp.current_budget, 0)) filter (where not c.is_contingency),
         sum(cp.current_budget - cp.committed) filter (where c.is_contingency) - coalesce(sum(greatest(cp.forecast - cp.current_budget, 0)) filter (where not c.is_contingency), 0)
    into contingency_budget, overruns, available
  from api.cost_position(p_project) cp join cost_codes c on c.code = cp.code and c.org_id = (select org_id from projects where id = p_project);
end $$;

-- ---------- B12 administration API (every change audited by the table triggers; settings need a multi-factor session) ----------
create or replace function api.set_permission(p_role text, p_module text, p_action text, p_granted boolean) returns boolean
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm('settings', 'edit');
  if p_action not in ('view','create','edit','approve','export') then raise exception 'unknown action %', p_action; end if;
  if not exists (select 1 from roles where org_id = app.org() and id = p_role) then raise exception 'unknown role %', p_role; end if;
  if not p_granted and p_role = app.role() and p_module = 'settings' then raise exception 'you cannot remove your own settings access' using errcode = '42501'; end if;
  if p_granted then insert into role_permissions (org_id, role_id, module, action) values (app.org(), p_role, p_module, p_action) on conflict do nothing;
  else delete from role_permissions where org_id = app.org() and role_id = p_role and module = p_module and action = p_action; end if;
  return p_granted;
end $$;

create or replace function api.set_user_access(p_user uuid, p_role text, p_all_projects boolean, p_active boolean, p_expected_version integer) returns integer
language plpgsql security definer set search_path = public, app as $$
declare pr profiles;
begin
  perform app.require_perm('settings', 'edit');
  select * into pr from profiles where user_id = p_user and org_id = app.org() for update;
  if not found then raise exception 'user not found in this organisation'; end if;
  if pr.version <> p_expected_version then raise exception 'this user was changed by someone else; refresh and try again' using errcode = 'P0003'; end if;
  if p_user = auth.uid() and (not p_active or p_role <> pr.role_id) then raise exception 'you cannot deactivate yourself or change your own role' using errcode = '42501'; end if;
  update profiles set role_id = p_role, all_projects = p_all_projects, active = p_active where user_id = p_user;
  return pr.version + 1;
end $$;

create or replace function api.set_project_member(p_project text, p_user uuid, p_responsibility text, p_member boolean) returns boolean
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'projects', 'edit');
  if not exists (select 1 from profiles where user_id = p_user and org_id = app.org() and active) then raise exception 'user not found in this organisation'; end if;
  if p_member then insert into project_members (project_id, user_id, responsibility) values (p_project, p_user, coalesce(p_responsibility, 'Member'))
    on conflict (project_id, user_id) do update set responsibility = excluded.responsibility;
  else delete from project_members where project_id = p_project and user_id = p_user; end if;
  return p_member;
end $$;

create or replace function api.set_org_settings(p jsonb, p_expected_version integer) returns integer
language plpgsql security definer set search_path = public, app as $$
declare s org_settings;
begin
  perform app.require_perm('settings', 'edit');
  select * into s from org_settings where org_id = app.org() for update;
  if s.version <> p_expected_version then raise exception 'settings were changed by someone else; refresh and try again' using errcode = 'P0003'; end if;
  update org_settings set
    po_pm_limit = coalesce((p ->> 'po_pm_limit')::numeric, po_pm_limit), po_pd_limit = coalesce((p ->> 'po_pd_limit')::numeric, po_pd_limit),
    warn_pct = coalesce((p ->> 'warn_pct')::numeric, warn_pct), flag_pct = coalesce((p ->> 'flag_pct')::numeric, flag_pct),
    report_cutoff = coalesce((p ->> 'report_cutoff')::time, report_cutoff), max_upload_mb = coalesce((p ->> 'max_upload_mb')::integer, max_upload_mb),
    invoice_due_days = coalesce((p ->> 'invoice_due_days')::integer, invoice_due_days), rabill_due_days = coalesce((p ->> 'rabill_due_days')::integer, rabill_due_days),
    time_zone = coalesce(p ->> 'time_zone', time_zone)
  where org_id = app.org();
  return s.version + 1;
end $$;

create or replace function api.set_automation_rule(p_rule text, p jsonb) returns boolean
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm('settings', 'edit');
  update automation_rules set
    enabled = coalesce((p ->> 'enabled')::boolean, enabled),
    notify_roles = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'notify_roles') x), notify_roles),
    channels = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'channels') x), channels),
    escalate_role = case when p ? 'escalate_role' then p ->> 'escalate_role' else escalate_role end,
    escalate_after_hours = coalesce((p ->> 'escalate_after_hours')::integer, escalate_after_hours)
  where org_id = app.org() and id = p_rule;
  if not found then raise exception 'unknown rule %', p_rule; end if;
  return true;
end $$;

revoke all on function api.cancel_po(text, text, boolean), api.short_close_po(text, text), api.close_contract(text, text), api.set_permission(text, text, text, boolean),
  api.set_user_access(uuid, text, boolean, boolean, integer), api.set_project_member(text, uuid, text, boolean), api.set_org_settings(jsonb, integer),
  api.set_automation_rule(text, jsonb), api.record_grn(text, numeric, text, date, text), api.contingency(text) from public;
grant execute on function api.cancel_po(text, text, boolean), api.short_close_po(text, text), api.close_contract(text, text), api.set_permission(text, text, text, boolean),
  api.set_user_access(uuid, text, boolean, boolean, integer), api.set_project_member(text, uuid, text, boolean), api.set_org_settings(jsonb, integer),
  api.set_automation_rule(text, jsonb), api.record_grn(text, numeric, text, date, text), api.contingency(text) to authenticated, service_role;
revoke all on function app.today(uuid), app.local_time(uuid), app.apply_permission_defaults(uuid) from public;
grant execute on function app.today(uuid), app.local_time(uuid) to authenticated, service_role;

-- ---------- found while testing: variations never stored their approval id ----------
create or replace function api.request_variation(p_contract text, p_description text, p_amount numeric) returns text
language plpgsql security definer set search_path = public, app as $$
declare c contracts; v_id text; v_incl numeric; v_ap text;
begin
  select * into c from contracts where id = p_contract;
  if not found then raise exception 'contract % not found', p_contract; end if;
  perform app.require(c.project_id, 'contracts', 'create');
  if c.status <> 'Active' then raise exception 'variations need an active contract'; end if;
  if coalesce(length(trim(p_description)), 0) < 5 then raise exception 'describe the variation (at least 5 characters)'; end if;
  v_id := app.next_no(app.org(), 'VO'); v_incl := app.incl_gst(abs(p_amount), c.gst_pct);
  insert into contract_variations (id, contract_id, description, amount, created_by) values (v_id, p_contract, p_description, p_amount, auth.uid());
  -- the new variation is already in pending commitments, so a negative availability is exactly the overrun it causes
  v_ap := app.create_approval('VARIATION', v_id, c.project_id, p_description, p_amount,
    app.po_steps(app.org(), v_incl, case when p_amount > 0 then greatest(0, -app.code_available(c.project_id, c.code)) else 0 end, 'contracts'));
  update contract_variations set approval_id = v_ap where id = v_id;
  return v_id;
end $$;
update contract_variations v set approval_id = a.id from approvals a where a.kind = 'VARIATION' and a.ref = v.id and v.approval_id is null;

-- new organisations get the canonical matrix as well
alter function app.bootstrap_org(uuid) rename to bootstrap_org_base;
create or replace function app.bootstrap_org(p_org uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.bootstrap_org_base(p_org);
  perform app.apply_permission_defaults(p_org);
end $$;
revoke all on function app.bootstrap_org(uuid), app.bootstrap_org_base(uuid) from public;
