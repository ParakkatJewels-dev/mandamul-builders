-- M Andamul Development OS · 0600 connected workflows (all writes go through these functions)

-- ---------- cost helpers ----------
create or replace function app.incl_gst(p numeric, p_gst numeric) returns numeric language sql immutable as $$ select round(p, 2) + round(round(p, 2) * p_gst / 100, 2) $$;
create or replace function app.contract_value(p_contract text) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(round(qty * rate, 2)), 0) from contract_items where contract_id = p_contract
$$;
create or replace function app.current_budget(p_project text) returns uuid language sql stable security definer set search_path = public as $$
  select id from budget_versions where project_id = p_project and status = 'Approved' order by v desc limit 1
$$;
-- committed / pending for one cost code, incl. GST: approved POs + active contracts + approved variations
create or replace function app.code_commitments(p_project text, p_code text, out committed numeric, out pending numeric)
language sql stable security definer set search_path = public, app as $$
  select
    coalesce((select sum(total) from purchase_orders where project_id = p_project and code = p_code and status in ('Approved','Part received','Received','Closed')), 0)
  + coalesce((select sum(app.incl_gst(app.contract_value(c.id), c.gst_pct)) from contracts c where c.project_id = p_project and c.code = p_code and c.status in ('Active','Closed')), 0)
  + coalesce((select sum(app.incl_gst(v.amount, c.gst_pct)) from contract_variations v join contracts c on c.id = v.contract_id where c.project_id = p_project and c.code = p_code and v.status = 'Approved'), 0),
    coalesce((select sum(total) from purchase_orders where project_id = p_project and code = p_code and status = 'Pending approval'), 0)
  + coalesce((select sum(app.incl_gst(app.contract_value(c.id), c.gst_pct)) from contracts c where c.project_id = p_project and c.code = p_code and c.status = 'Pending approval'), 0)
  + coalesce((select sum(app.incl_gst(greatest(v.amount, 0), c.gst_pct)) from contract_variations v join contracts c on c.id = v.contract_id where c.project_id = p_project and c.code = p_code and v.status = 'Pending approval'), 0)
$$;
create or replace function app.code_available(p_project text, p_code text) returns numeric language sql stable security definer set search_path = public, app as $$
  select coalesce((select amount from budget_lines where version_id = app.current_budget(p_project) and code = p_code), 0) - c.committed - c.pending
  from app.code_commitments(p_project, p_code) c
$$;

-- ---------- approval outcomes ----------
create or replace function app.on_decided(a approvals, p_ok boolean, p_comment text) returns void
language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders; c contracts; r daily_reports; w record; v_doc text; v_rev text; inv vendor_invoices; vend vendors; s org_settings;
begin
  select * into s from org_settings where org_id = a.org_id;
  case a.kind
  when 'PO' then
    select * into po from purchase_orders where id = a.ref for update;
    if p_ok then update purchase_orders set status = 'Approved', approved_at = now() where id = po.id; perform app.consume_etc(po.project_id, po.code, po.total, po.id);
    else update purchase_orders set status = 'Rejected' where id = po.id; end if;
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

-- ---------- workflow 1: new project ----------
create or replace function api.create_project(p jsonb) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_org uuid := app.org(); v_year integer := extract(year from (p ->> 'start_date')::date)::integer; v_no integer; v_id text;
  v_budget numeric := (p ->> 'budget_total')::numeric; v_cont numeric; v_rest numeric; v_profile text := coalesce(p ->> 'profile', 'resort');
  v_ver uuid; v_client uuid; t record; v_start date := (p ->> 'start_date')::date; v_bs date; v_task uuid; v_keys jsonb := '{}'::jsonb;
  u jsonb; v_unit uuid; v_sum numeric; v_largest text;
begin
  perform app.require_perm('projects', 'create');
  if v_budget is null or v_budget < 100000 then raise exception 'budget_total must be at least 100000'; end if;
  if v_profile not in (select distinct profile from plan_templates) then raise exception 'unknown plan profile %', v_profile; end if;
  insert into doc_counters (org_id, prefix, yy, last_no) values (v_org, 'MA', v_year, 1)
    on conflict (org_id, prefix, yy) do update set last_no = doc_counters.last_no + 1 returning last_no into v_no;
  v_id := format('MA-%s-%s', v_year, lpad(v_no::text, 3, '0'));
  if p ? 'client_name' then
    insert into clients (org_id, name) values (v_org, p ->> 'client_name') on conflict (org_id, name) do update set name = excluded.name returning id into v_client;
  end if;
  insert into projects (id, org_id, name, property_type, location, district, state, client_id, keys, built_up_sqft, start_date, pm_id, contract_value, contingency_pct, created_by)
  values (v_id, v_org, p ->> 'name', p ->> 'property_type', p ->> 'location', p ->> 'district', p ->> 'state', v_client, (p ->> 'keys')::integer,
          (p ->> 'built_up_sqft')::numeric, v_start, (p ->> 'pm_id')::uuid, (p ->> 'contract_value')::numeric, coalesce((p ->> 'contingency_pct')::numeric, 5), auth.uid());
  insert into project_members (project_id, user_id, responsibility) values (v_id, auth.uid(), 'Creator') on conflict do nothing;
  if p ? 'pm_id' then insert into project_members values (v_id, (p ->> 'pm_id')::uuid, 'Project manager') on conflict do nothing; end if;
  insert into project_members (project_id, user_id, responsibility)
    select v_id, (m ->> 'user_id')::uuid, coalesce(m ->> 'responsibility', 'Member') from jsonb_array_elements(coalesce(p -> 'members', '[]')) m on conflict do nothing;
  if p ? 'land' then
    insert into land_parcels (project_id, survey_no, area_acres, ownership, classification, coastal_zone, regulatory_note)
    values (v_id, p -> 'land' ->> 'survey_no', (p -> 'land' ->> 'area_acres')::numeric, p -> 'land' ->> 'ownership', p -> 'land' ->> 'classification', p -> 'land' ->> 'coastal_zone', p -> 'land' ->> 'regulatory_note');
  end if;
  -- budget v1 (pending approval): contingency first, the rest by profile; rounding remainder to the largest line
  v_cont := round(v_budget * coalesce((p ->> 'contingency_pct')::numeric, 5) / 100, 2); v_rest := v_budget - v_cont;
  insert into budget_versions (project_id, v, status, reason, created_by) values (v_id, 1, 'Pending', 'Initial project budget', auth.uid()) returning id into v_ver;
  insert into budget_lines (version_id, code, amount)
    select v_ver, bp.code, round(v_rest * bp.pct / (select sum(pct) from budget_profiles where profile = v_profile), 2) from budget_profiles bp where bp.profile = v_profile;
  insert into budget_lines (version_id, code, amount) values (v_ver, '13', v_cont);
  select sum(amount) into v_sum from budget_lines where version_id = v_ver;
  select code into v_largest from budget_lines where version_id = v_ver and code <> '13' order by amount desc limit 1;
  update budget_lines set amount = amount + (v_budget - v_sum) where version_id = v_ver and code = v_largest;
  insert into etc_estimates (project_id, code, amount, basis, updated_by) select v_id, code, amount, 'Initial budget', auth.uid() from budget_lines where version_id = v_ver;
  -- schedule from the plan template: forward pass sets the baseline
  for t in select * from plan_templates where profile = v_profile order by seq loop
    select coalesce(max(tk.base_finish), v_start) into v_bs from tasks tk where tk.id in (select (v_keys ->> k)::uuid from unnest(t.preds) k);
    insert into tasks (project_id, wbs, phase, name, duration_days, is_milestone, base_start, base_finish, owner_id)
    values (v_id, t.key, t.phase, t.name, t.duration_days, t.is_milestone, v_bs, v_bs + t.duration_days, (p ->> 'pm_id')::uuid) returning id into v_task;
    insert into task_dependencies (task_id, pred_id) select v_task, (v_keys ->> k)::uuid from unnest(t.preds) k;
    v_keys := v_keys || jsonb_build_object(t.key, v_task);
  end loop;
  -- units with their readiness stages and commissioning systems
  for u in select * from jsonb_array_elements(coalesce(p -> 'units', '[]')) loop
    insert into units (project_id, code, name, unit_type, template_id, budget)
    values (v_id, u ->> 'code', u ->> 'name', u ->> 'unit_type', coalesce(u ->> 'template_id', 'villa'), coalesce((u ->> 'budget')::numeric, 0)) returning id into v_unit;
    insert into unit_stages (unit_id, stage_key, seq, label) select v_unit, stage_key, seq, label from template_stages where org_id = v_org and template_id = coalesce(u ->> 'template_id', 'villa');
    insert into unit_commissioning (unit_id, system) select v_unit, s from unnest(coalesce(array(select jsonb_array_elements_text(u -> 'systems')), array['Electrical','HVAC','Plumbing','Fire'])) s;
  end loop;
  insert into handover_items (project_id, item_key, label) values
    (v_id,'fire_noc','Fire safety NOC'),(v_id,'occupancy','Occupancy / completion certificate'),(v_id,'utilities','Power, water and sewer connections'),
    (v_id,'wtp_stp','Water and sewage treatment commissioned'),(v_id,'it','Internet, Wi-Fi and IT infrastructure'),(v_id,'pms_pos','PMS and POS ready'),
    (v_id,'staff','Staff facilities complete'),(v_id,'asbuilt','As-built drawings'),(v_id,'om','O&M manuals'),(v_id,'warranty_register','Warranty and asset registers'),(v_id,'walkthrough','Owner walkthrough signed');
  perform app.create_approval('BUDGET', v_ver::text, v_id, (p ->> 'name') || ' — initial budget', v_budget,
    jsonb_build_array(jsonb_build_object('role','finance','module','budget','label','Finance review'), jsonb_build_object('role','md','module','budget','label','Approve budget')));
  perform app.log(v_id, 'Project created', format('%s %s · budget %s sent for approval', v_id, p ->> 'name', v_budget), v_id);
  return v_id;
end $$;

-- ---------- workflow 2: budgets ----------
create or replace function api.request_budget_revision(p_project text, p_changes jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_cur uuid := app.current_budget(p_project); v_new uuid; v_v integer; ch jsonb; v_line numeric; c record;
begin
  perform app.require(p_project, 'budget', 'create');
  if v_cur is null then raise exception 'no approved budget to revise'; end if;
  if coalesce(length(p_reason), 0) < 15 then raise exception 'give a reason of at least 15 characters'; end if;
  select max(v) + 1 into v_v from budget_versions where project_id = p_project;
  insert into budget_versions (project_id, v, status, reason, created_by) values (p_project, v_v, 'Pending', p_reason, auth.uid()) returning id into v_new;
  insert into budget_lines (version_id, code, amount) select v_new, code, amount from budget_lines where version_id = v_cur;
  for ch in select * from jsonb_array_elements(p_changes) loop
    update budget_lines set amount = amount + (ch ->> 'delta')::numeric where version_id = v_new and code = ch ->> 'code' returning amount into v_line;
    if v_line is null then raise exception 'unknown cost code %', ch ->> 'code'; end if;
    select * into c from app.code_commitments(p_project, ch ->> 'code');
    if v_line < c.committed + c.pending then raise exception 'cost code % cannot fall below committed + pending (%)', ch ->> 'code', c.committed + c.pending; end if;
  end loop;
  perform app.create_approval('BUDGET', v_new::text, p_project, format('Budget v%s', v_v), (select sum(abs((x ->> 'delta')::numeric)) from jsonb_array_elements(p_changes) x),
    jsonb_build_array(jsonb_build_object('role','finance','module','budget','label','Finance review'), jsonb_build_object('role','md','module','budget','label','Approve budget')), jsonb_build_object('changes', p_changes));
  return v_new;
end $$;

create or replace function api.set_estimate(p_project text, p_code text, p_amount numeric, p_basis text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'budget', 'edit');
  if p_amount < 0 or coalesce(length(p_basis), 0) < 10 then raise exception 'estimate must be ≥ 0 with a basis of at least 10 characters'; end if;
  update etc_estimates set amount = p_amount, basis = p_basis, updated_by = auth.uid(), updated_at = now() where project_id = p_project and code = p_code;
  if not found then insert into etc_estimates values (p_project, p_code, p_amount, p_basis, auth.uid(), now()); end if;
end $$;

-- ---------- workflow 3 (schedule) ----------
create or replace function api.update_task(p_task uuid, p_expected_version integer, p_progress integer, p_act_start date, p_act_finish date, p_delay_reason text, p_recovery text) returns integer
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  perform app.require(t.project_id, 'schedule', 'edit');
  if t.version <> p_expected_version then raise exception 'this activity was changed by someone else (version % ≠ %); reload it', t.version, p_expected_version using errcode = '40001'; end if;
  if p_progress < 100 and current_date > t.base_finish and coalesce(trim(p_delay_reason), '') = '' then raise exception 'a delay reason is required for late work'; end if;
  update tasks set progress = p_progress, act_start = case when p_progress > 0 then coalesce(p_act_start, act_start, current_date) else p_act_start end,
    act_finish = case when p_progress = 100 then coalesce(p_act_finish, current_date) end, delay_reason = p_delay_reason, recovery_plan = p_recovery
  where id = p_task returning version into t.version;
  if p_progress = 100 and t.is_milestone then perform app.emit(t.project_id, 'milestone_done', 'milestone:' || p_task, jsonb_build_object('task', t.name)); end if;
  return t.version;
end $$;

-- ---------- workflow 3: purchase to payment ----------
create or replace function api.raise_mr(p_project text, p_code text, p_item text, p_qty numeric, p_uom text, p_needed_by date, p_urgency text default 'Normal', p_unit uuid default null, p_duplicate_note text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_id text; v_dup text;
begin
  perform app.require(p_project, 'procurement', 'create');
  select id into v_dup from (
    select id, item, created_at from material_requests where project_id = p_project and status <> 'Cancelled'
    union all select id, item, created_at from purchase_orders where project_id = p_project and status <> 'Rejected') x
  where created_at > now() - interval '30 days' and (lower(item) like '%' || lower(p_item) || '%' or lower(p_item) like '%' || lower(item) || '%') limit 1;
  if v_dup is not null and coalesce(length(trim(p_duplicate_note)), 0) < 10 then
    raise exception 'possible duplicate of %; give a reason of at least 10 characters to continue', v_dup using errcode = 'P0002';
  end if;
  v_id := app.next_no(app.org(), 'MR');
  insert into material_requests (id, org_id, project_id, code, unit_id, item, qty, uom, needed_by, urgency, requested_by, duplicate_note)
  values (v_id, app.org(), p_project, p_code, p_unit, p_item, p_qty, p_uom, p_needed_by, p_urgency, auth.uid(), case when v_dup is not null then p_duplicate_note end);
  if p_urgency <> 'Normal' then perform app.emit(p_project, 'material_shortage', 'shortage:' || v_id, jsonb_build_object('mr', v_id, 'item', p_item, 'urgency', p_urgency)); end if;
  return v_id;
end $$;

create or replace function api.add_quotation(p_mr text, p_vendor uuid, p_rate numeric, p_gst numeric, p_lead integer, p_note text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare m material_requests;
begin
  select * into m from material_requests where id = p_mr for update;
  perform app.require(m.project_id, 'procurement', 'edit'); perform app.require_perm('budget', 'view');
  if m.status not in ('Submitted','Quoting','Quotes received') then raise exception 'request % is %', p_mr, m.status; end if;
  if not (select approved from vendors where id = p_vendor) then raise exception 'vendor is not on the approved list' using errcode = '42501'; end if;
  insert into quotations (mr_id, vendor_id, rate, gst_pct, lead_days, note) values (p_mr, p_vendor, p_rate, p_gst, p_lead, p_note)
    on conflict (mr_id, vendor_id) do update set rate = excluded.rate, gst_pct = excluded.gst_pct, lead_days = excluded.lead_days, note = excluded.note;
  update material_requests set status = 'Quotes received' where id = p_mr;
end $$;

create or replace function api.raise_po(p_mr text, p_vendor uuid, p_not_lowest_reason text default null, p_expected_delivery date default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare m material_requests; q quotations; v_lowest uuid; v_total numeric; v_avail numeric; v_over numeric; v_id text; v_ap text;
begin
  select * into m from material_requests where id = p_mr for update;
  perform app.require(m.project_id, 'procurement', 'edit'); perform app.require_perm('budget', 'view');
  if app.current_budget(m.project_id) is null then raise exception 'project has no approved budget; purchase orders are blocked' using errcode = '42501'; end if;
  if m.status = 'PO raised' then raise exception 'a purchase order already exists for %', p_mr using errcode = '23505'; end if;
  select * into q from quotations where mr_id = p_mr and vendor_id = p_vendor;
  if not found then raise exception 'no quotation from this vendor'; end if;
  if not (select approved from vendors where id = p_vendor) then raise exception 'vendor is not on the approved list' using errcode = '42501'; end if;
  select qq.vendor_id into v_lowest from quotations qq join vendors vv on vv.id = qq.vendor_id and vv.approved
    where qq.mr_id = p_mr order by app.incl_gst(m.qty * qq.rate, qq.gst_pct), qq.lead_days limit 1;
  if v_lowest <> p_vendor and coalesce(length(trim(p_not_lowest_reason)), 0) < 5 then raise exception 'give a reason for not choosing the lowest approved quotation'; end if;
  v_total := app.incl_gst(m.qty * q.rate, q.gst_pct);
  v_avail := app.code_available(m.project_id, m.code); v_over := greatest(0, v_total - v_avail);
  v_id := app.next_no(app.org(), 'PO');
  insert into purchase_orders (id, org_id, project_id, code, vendor_id, mr_id, unit_id, item, uom, qty, rate, gst_pct, available_at_request, over_budget, not_lowest_reason, expected_delivery, created_by)
  values (v_id, app.org(), m.project_id, m.code, p_vendor, p_mr, m.unit_id, m.item, m.uom, m.qty, q.rate, q.gst_pct, v_avail, v_over, p_not_lowest_reason, coalesce(p_expected_delivery, current_date + q.lead_days), auth.uid());
  update material_requests set status = 'PO raised' where id = p_mr;
  v_ap := app.create_approval('PO', v_id, m.project_id, m.item, v_total, app.po_steps(app.org(), v_total, v_over), jsonb_build_object('over_budget', v_over));
  update purchase_orders set approval_id = v_ap where id = v_id;
  return v_id;
end $$;

create or replace function api.record_grn(p_po text, p_qty numeric, p_qc text, p_received_on date default current_date, p_note text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders; v_acc numeric; v_id text; v_val numeric := 0;
begin
  select * into po from purchase_orders where id = p_po for update;
  perform app.require(po.project_id, 'procurement', 'edit');
  if po.status not in ('Approved','Part received') then raise exception 'purchase order % is %; receipts need an approved order', p_po, po.status using errcode = '42501'; end if;
  select coalesce(sum(qty), 0) into v_acc from goods_receipts where po_id = p_po and qc = 'Pass';
  if p_qc = 'Pass' then
    if v_acc + p_qty > po.qty then raise exception 'over-receipt: % ordered, % already accepted', po.qty, v_acc using errcode = '23514'; end if;
    v_val := app.incl_gst(p_qty * po.rate, po.gst_pct);
  end if;
  v_id := app.next_no(app.org(), 'GRN');
  insert into goods_receipts (id, po_id, received_on, qty, qc, accepted_value, note, received_by) values (v_id, p_po, p_received_on, p_qty, p_qc, v_val, p_note, auth.uid());
  if p_qc = 'Pass' then update purchase_orders set status = case when v_acc + p_qty >= qty then 'Received' else 'Part received' end where id = p_po; end if;
  return v_id;
end $$;

create or replace function api.record_invoice(p_po text, p_invoice_no text, p_invoice_date date, p_qty numeric, p_rate numeric, p_gst numeric) returns text
language plpgsql security definer set search_path = public, app as $$
declare po purchase_orders; v_acc numeric; v_inv numeric; v_notes text[] := '{}'; v_id text; v_total numeric; v_ap text;
begin
  select * into po from purchase_orders where id = p_po;
  perform app.require(po.project_id, 'payments', 'create');
  select coalesce(sum(qty), 0) into v_acc from goods_receipts where po_id = p_po and qc = 'Pass';
  select coalesce(sum(qty), 0) into v_inv from vendor_invoices where po_id = p_po and status <> 'Rejected';
  -- three-way match: order (rate, GST) · receipt (accepted quantity) · invoice
  if v_inv + p_qty > v_acc then v_notes := v_notes || format('invoiced quantity %s exceeds accepted %s', v_inv + p_qty, v_acc); end if;
  if p_rate <> po.rate then v_notes := v_notes || format('rate %s differs from PO rate %s', p_rate, po.rate); end if;
  if p_gst <> po.gst_pct then v_notes := v_notes || format('GST %s%% differs from PO %s%%', p_gst, po.gst_pct); end if;
  v_id := app.next_no(app.org(), 'INV');
  begin
    insert into vendor_invoices (id, org_id, project_id, vendor_id, po_id, invoice_no, invoice_date, qty, rate, gst_pct, match_status, match_notes, status, created_by)
    values (v_id, app.org(), po.project_id, po.vendor_id, p_po, p_invoice_no, p_invoice_date, p_qty, p_rate, p_gst,
            case when cardinality(v_notes) = 0 then 'Matched' else 'On hold' end, array_to_string(v_notes, '; '),
            case when cardinality(v_notes) = 0 then 'Pending approval' else 'On hold' end, auth.uid());
  exception when unique_violation then
    raise exception 'duplicate invoice: % from this vendor is already booked', p_invoice_no using errcode = '23505';
  end;
  if cardinality(v_notes) = 0 then
    select total into v_total from vendor_invoices where id = v_id;
    v_ap := app.create_approval('INVOICE', v_id, po.project_id, 'Invoice ' || p_invoice_no || ' on ' || p_po, v_total,
      jsonb_build_array(jsonb_build_object('role','finance','module','payments','label','Finance review')) ||
      case when v_total > (select po_pm_limit from org_settings where org_id = app.org()) then jsonb_build_array(jsonb_build_object('role','pd','module','payments','label','Approve payment')) else '[]'::jsonb end ||
      case when v_total > (select po_pd_limit from org_settings where org_id = app.org()) then jsonb_build_array(jsonb_build_object('role','md','module','payments','label','Approve payment')) else '[]'::jsonb end);
    update vendor_invoices set approval_id = v_ap where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function api.record_payment(p_kind text, p_ref text, p_amount numeric, p_tds numeric, p_paid_on date, p_bank_ref text) returns text
language plpgsql security definer set search_path = public, app as $$
declare inv vendor_invoices; b ra_bills; c contracts; v_paid numeric; v_tds_paid numeric; v_id text; v_project text; v_vendor uuid;
begin
  if p_kind = 'invoice' then
    select * into inv from vendor_invoices where id = p_ref for update; v_project := inv.project_id; v_vendor := inv.vendor_id;
    perform app.require(v_project, 'payments', 'create');
    if inv.status <> 'Approved' then raise exception 'invoice % is %; only approved invoices can be paid', p_ref, inv.status using errcode = '42501'; end if;
    if inv.created_by = auth.uid() then raise exception 'the person who booked the invoice cannot also pay it' using errcode = '42501'; end if;
    select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_ref;
    if p_tds <> 0 then raise exception 'TDS on material invoices is not handled here'; end if;
    if v_paid + p_amount > inv.total then raise exception 'overpayment: % approved, % already paid', inv.total, v_paid using errcode = '23514'; end if;
  elsif p_kind = 'ra_bill' then
    select * into b from ra_bills where id = p_ref for update; select * into c from contracts where id = b.contract_id; v_project := c.project_id; v_vendor := c.vendor_id;
    perform app.require(v_project, 'payments', 'create');
    if b.status <> 'Approved' then raise exception 'bill % is %; only approved bills can be paid', p_ref, b.status using errcode = '42501'; end if;
    select coalesce(sum(amount), 0), coalesce(sum(tds), 0) into v_paid, v_tds_paid from payments where ra_bill_id = p_ref;
    if v_paid + p_amount > b.net_payable then raise exception 'overpayment: net payable %, % already paid', b.net_payable, v_paid using errcode = '23514'; end if;
    if v_tds_paid + p_tds > b.tds then raise exception 'TDS exceeds the bill''s deduction of %', b.tds using errcode = '23514'; end if;
  elsif p_kind = 'advance' then
    select * into c from contracts where id = p_ref for update; v_project := c.project_id; v_vendor := c.vendor_id;
    perform app.require(v_project, 'payments', 'create');
    if c.status <> 'Active' then raise exception 'contract % is not active', p_ref; end if;
    select coalesce(sum(amount), 0) into v_paid from payments where contract_id = p_ref and kind = 'advance';
    if v_paid + p_amount > c.advance_amount then raise exception 'advance exceeds the approved % ', c.advance_amount using errcode = '23514'; end if;
  else raise exception 'unknown payment kind %', p_kind; end if;
  v_id := app.next_no(app.org(), 'PAY');
  begin
    insert into payments (id, org_id, project_id, vendor_id, kind, invoice_id, ra_bill_id, contract_id, amount, tds, paid_on, bank_reference, created_by)
    values (v_id, app.org(), v_project, v_vendor, p_kind, case when p_kind = 'invoice' then p_ref end, case when p_kind = 'ra_bill' then p_ref end,
            case when p_kind = 'advance' then p_ref end, p_amount, p_tds, p_paid_on, p_bank_ref, auth.uid());
  exception when unique_violation then raise exception 'bank reference % is already used for this vendor', p_bank_ref using errcode = '23505'; end;
  if p_kind = 'invoice' and v_paid + p_amount = inv.total then update vendor_invoices set status = 'Paid' where id = p_ref; end if;
  if p_kind = 'ra_bill' and v_paid + p_amount = b.net_payable then update ra_bills set status = 'Paid' where id = p_ref; end if;
  return v_id;
end $$;

create or replace function api.reconcile_payment(p_payment text, p_statement_ref text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_project text;
begin
  select project_id into v_project from payments where id = p_payment for update;
  perform app.require(v_project, 'payments', 'edit');
  update payments set reconciled = true, reconciled_at = now() where id = p_payment and not reconciled;
  if not found then raise exception 'payment % is already reconciled', p_payment; end if;
  perform app.log(v_project, 'Payment reconciled', p_payment || ' matched to bank statement ' || p_statement_ref, p_payment);
end $$;

-- ---------- workflow 5: contractor billing ----------
create or replace function api.create_contract(p jsonb) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_project text := p ->> 'project_id'; v_id text; it jsonb; v_total numeric; v_avail numeric; v_over numeric; v_ap text;
begin
  perform app.require(v_project, 'contracts', 'create'); perform app.require_perm('budget', 'view');
  if app.current_budget(v_project) is null then raise exception 'project has no approved budget; contracts are blocked' using errcode = '42501'; end if;
  if not (select approved from vendors where id = (p ->> 'vendor_id')::uuid) then raise exception 'contractor is not on the approved list' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]')) = 0 then raise exception 'a contract needs at least one item'; end if;
  v_id := app.next_no(app.org(), 'WO');
  insert into contracts (id, org_id, project_id, vendor_id, code, unit_id, title, retention_pct, advance_amount, advance_recovery_pct, tds_pct, gst_pct, start_date, end_date, created_by)
  values (v_id, app.org(), v_project, (p ->> 'vendor_id')::uuid, p ->> 'code', (p ->> 'unit_id')::uuid, p ->> 'title',
          coalesce((p ->> 'retention_pct')::numeric, 5), coalesce((p ->> 'advance_amount')::numeric, 0), coalesce((p ->> 'advance_recovery_pct')::numeric, 10),
          coalesce((p ->> 'tds_pct')::numeric, 2), coalesce((p ->> 'gst_pct')::numeric, 18), (p ->> 'start_date')::date, (p ->> 'end_date')::date, auth.uid());
  for it in select * from jsonb_array_elements(p -> 'items') loop
    insert into contract_items (contract_id, boq_item_id, description, uom, qty, rate)
    values (v_id, (it ->> 'boq_item_id')::uuid, it ->> 'description', it ->> 'uom', (it ->> 'qty')::numeric, (it ->> 'rate')::numeric);
  end loop;
  v_total := app.incl_gst(app.contract_value(v_id), coalesce((p ->> 'gst_pct')::numeric, 18));
  v_avail := app.code_available(v_project, p ->> 'code') + v_total;     -- available excludes this pending contract
  v_over := greatest(0, v_total - v_avail);
  update contracts set over_budget = v_over where id = v_id;
  v_ap := app.create_approval('CONTRACT', v_id, v_project, p ->> 'title', v_total, app.po_steps(app.org(), v_total, v_over, 'contracts'), jsonb_build_object('over_budget', v_over));
  update contracts set approval_id = v_ap where id = v_id;
  return v_id;
end $$;

create or replace function api.request_variation(p_contract text, p_description text, p_amount numeric) returns text
language plpgsql security definer set search_path = public, app as $$
declare c contracts; v_id text; v_incl numeric;
begin
  select * into c from contracts where id = p_contract;
  perform app.require(c.project_id, 'contracts', 'create');
  if c.status <> 'Active' then raise exception 'variations need an active contract'; end if;
  v_id := app.next_no(app.org(), 'VO'); v_incl := app.incl_gst(abs(p_amount), c.gst_pct);
  insert into contract_variations (id, contract_id, description, amount, created_by) values (v_id, p_contract, p_description, p_amount, auth.uid());
  perform app.create_approval('VARIATION', v_id, c.project_id, p_description, p_amount,
    app.po_steps(app.org(), v_incl, greatest(0, case when p_amount > 0 then v_incl - app.code_available(c.project_id, c.code) - v_incl else 0 end), 'contracts'));
  return v_id;
end $$;

create or replace function api.record_measurement(p_item uuid, p_qty numeric, p_measured_on date, p_unit uuid default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare ci contract_items; c contracts; v_done numeric; v_id uuid;
begin
  select * into ci from contract_items where id = p_item for update; select * into c from contracts where id = ci.contract_id;
  perform app.require(c.project_id, 'site', 'create');
  if c.status <> 'Active' then raise exception 'contract % is not active', c.id; end if;
  select coalesce(sum(qty), 0) into v_done from measurements where contract_item_id = p_item and status <> 'Rejected';
  if v_done + p_qty > ci.qty then raise exception 'measured quantity would exceed the contract quantity % (already %); raise a variation', ci.qty, v_done using errcode = '23514'; end if;
  insert into measurements (contract_item_id, qty, measured_on, unit_id, location_note, recorded_by) values (p_item, p_qty, p_measured_on, p_unit, p_note, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function api.verify_measurement(p_measurement uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare m measurements; ci contract_items; c contracts;
begin
  select * into m from measurements where id = p_measurement for update; select * into ci from contract_items where id = m.contract_item_id; select * into c from contracts where id = ci.contract_id;
  perform app.require(c.project_id, 'site', 'approve');
  if m.status <> 'Recorded' then raise exception 'measurement is already %', m.status; end if;
  if m.recorded_by = auth.uid() then raise exception 'the person who recorded a measurement cannot verify it' using errcode = '42501'; end if;
  update measurements set status = case when p_accept then 'Verified' else 'Rejected' end, verified_by = auth.uid(), verified_at = now() where id = p_measurement;
  if p_accept and ci.boq_item_id is not null then update boq_items set executed_qty = executed_qty + m.qty where id = ci.boq_item_id; end if;
end $$;

create or replace function api.create_ra_bill(p_contract text, p_other_deductions numeric default 0) returns text
language plpgsql security definer set search_path = public, app as $$
declare c contracts; v_id text; v_no integer; v_gross numeric; v_gst numeric; v_ret numeric; v_adv_out numeric; v_adv numeric; v_tds numeric; v_net numeric; r record; v_ap text; s org_settings; v_steps jsonb;
begin
  select * into c from contracts where id = p_contract for update;
  perform app.require(c.project_id, 'contracts', 'create');
  if c.status <> 'Active' then raise exception 'contract % is not active', p_contract; end if;
  if exists (select 1 from ra_bills where contract_id = p_contract and status = 'In approval') then raise exception 'a bill for this contract is already in approval' using errcode = '23505'; end if;
  if not exists (select 1 from measurements m join contract_items ci on ci.id = m.contract_item_id where ci.contract_id = p_contract and m.status = 'Verified' and m.ra_bill_id is null) then
    raise exception 'no verified, unbilled measurements on %', p_contract; end if;
  select coalesce(max(bill_no), 0) + 1 into v_no from ra_bills where contract_id = p_contract;
  v_id := app.next_no(app.org(), 'RA');
  insert into ra_bills (id, contract_id, bill_no, gross, gst, retention, advance_recovery, tds, other_deductions, net_payable, created_by)
  values (v_id, p_contract, v_no, 0.01, 0, 0, 0, 0, 0, 0.01, auth.uid());   -- placeholder row, totals set below
  for r in select ci.id, ci.rate, sum(m.qty) as this_qty,
                  coalesce((select sum(l.this_qty) from ra_bill_lines l join ra_bills b on b.id = l.bill_id and b.status <> 'Rejected' where l.contract_item_id = ci.id and l.bill_id <> v_id), 0) as prev_qty
           from measurements m join contract_items ci on ci.id = m.contract_item_id
           where ci.contract_id = p_contract and m.status = 'Verified' and m.ra_bill_id is null group by ci.id, ci.rate loop
    insert into ra_bill_lines (bill_id, contract_item_id, prev_qty, this_qty, cum_qty, rate, amount)
    values (v_id, r.id, r.prev_qty, r.this_qty, r.prev_qty + r.this_qty, r.rate, round(r.this_qty * r.rate, 2));
  end loop;
  update measurements m set ra_bill_id = v_id from contract_items ci where ci.id = m.contract_item_id and ci.contract_id = p_contract and m.status = 'Verified' and m.ra_bill_id is null;
  -- formulas: gross = Σ this_qty × rate · GST on gross · retention, advance recovery and TDS on gross (excl. GST)
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
  select * into s from org_settings where org_id = app.org();
  v_steps := jsonb_build_array(jsonb_build_object('role','pm','module','site','label','Engineer certification'),
                               jsonb_build_object('role','qs','module','boq','label','QS verification'),
                               jsonb_build_object('role','finance','module','payments','label','Finance review'));
  if v_gross + v_gst > s.po_pm_limit then v_steps := v_steps || jsonb_build_object('role','pd','module','contracts','label','Approve bill'); end if;
  if v_gross + v_gst > s.po_pd_limit then v_steps := v_steps || jsonb_build_object('role','md','module','contracts','label','Approve bill'); end if;
  v_ap := app.create_approval('RABILL', v_id, c.project_id, format('RA bill %s on %s', v_no, p_contract), v_gross + v_gst, v_steps);
  update ra_bills set approval_id = v_ap where id = v_id;
  perform app.emit(c.project_id, 'contractor_bill', 'rabill:' || v_id, jsonb_build_object('bill', v_id, 'gross', v_gross));
  return v_id;
end $$;

-- ---------- workflow 4: site progress ----------
create or replace function api.submit_daily_report(p_project text, p_date date, p_weather text, p_labour jsonb, p_issues text, p_safety text, p_work jsonb) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_id text; w jsonb; t tasks; v_ap text;
begin
  perform app.require(p_project, 'site', 'create');
  if p_date > current_date then raise exception 'report date cannot be in the future'; end if;
  v_id := app.next_no(app.org(), 'DR');
  begin
    insert into daily_reports (id, project_id, report_date, submitted_by, weather, labour, issues, safety, status)
    values (v_id, p_project, p_date, auth.uid(), p_weather, coalesce(p_labour, '[]'), p_issues, p_safety, 'Submitted');
  exception when unique_violation then raise exception 'a report for % is already submitted for this site', p_date using errcode = '23505'; end;
  for w in select * from jsonb_array_elements(coalesce(p_work, '[]')) loop
    select * into t from tasks where id = (w ->> 'task_id')::uuid;
    if t.project_id is distinct from p_project then raise exception 'activity is not in project %', p_project; end if;
    if (w ->> 'progress_to')::integer < t.progress then raise exception '% is already at %%%', t.name, t.progress; end if;
    insert into report_work_lines (report_id, task_id, progress_to, boq_item_id, qty, note)
    values (v_id, t.id, (w ->> 'progress_to')::integer, (w ->> 'boq_item_id')::uuid, (w ->> 'qty')::numeric, w ->> 'note');
  end loop;
  v_ap := app.create_approval('REPORT', v_id, p_project, 'Daily site report ' || p_date, null, jsonb_build_array(jsonb_build_object('role','pm','module','site','label','Verify site report')));
  update daily_reports set approval_id = v_ap where id = v_id;
  return v_id;
end $$;

-- ---------- workflow 6: quality, readiness, handover ----------
create or replace function api.request_inspection(p_unit uuid, p_kind text, p_stage text default null, p_system text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare u units; v_id text;
begin
  select * into u from units where id = p_unit;
  perform app.require(u.project_id, 'quality', 'create');
  if p_kind = 'Stage' and not exists (select 1 from unit_stages where unit_id = p_unit and stage_key = p_stage) then raise exception 'unknown stage % for this unit', p_stage; end if;
  if exists (select 1 from inspections where unit_id = p_unit and kind = p_kind and coalesce(stage_key, '') = coalesce(p_stage, '') and coalesce(system, '') = coalesce(p_system, '') and status = 'Requested') then
    raise exception 'an inspection for this is already requested' using errcode = '23505'; end if;
  v_id := app.next_no(app.org(), 'IN');
  insert into inspections (id, project_id, unit_id, kind, stage_key, system, requested_by) values (v_id, u.project_id, p_unit, p_kind, p_stage, p_system, auth.uid());
  if p_kind = 'Stage' then update unit_stages set status = 'Awaiting inspection', updated_at = now() where unit_id = p_unit and stage_key = p_stage; end if;
  return v_id;
end $$;

create or replace function app.unit_readiness(p_unit uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select count(*) total, count(*) filter (where status = 'Passed') passed, count(*) filter (where status = 'Awaiting inspection') awaiting,
                    count(*) filter (where status <> 'Not started') started from unit_stages where unit_id = p_unit),
       sn as (select count(*) filter (where status <> 'Closed') open, count(*) filter (where status <> 'Closed' and severity = 'Safety-critical') safety from snags where unit_id = p_unit),
       f as (select count(*) total, count(*) filter (where status in ('Installed','Tested')) ready from ffe_items where unit_id = p_unit),
       cm as (select count(*) total, count(*) filter (where status = 'Passed') passed from unit_commissioning where unit_id = p_unit),
       fi as (select exists (select 1 from inspections where unit_id = p_unit and kind = 'Final' and status = 'Passed') passed),
       u as (select handed_over_at, blocked_reason from units where id = p_unit)
  select jsonb_build_object('stages_total', s.total, 'stages_passed', s.passed, 'open_snags', sn.open, 'open_safety', sn.safety,
    'ffe_total', f.total, 'ffe_ready', f.ready, 'commissioning_total', cm.total, 'commissioning_passed', cm.passed, 'final_passed', fi.passed,
    'gates_ok', s.passed = s.total and sn.open = 0 and f.ready = f.total and cm.passed = cm.total,
    'status', case when u.handed_over_at is not null then 'Handed over'
                   when sn.safety > 0 or u.blocked_reason is not null then 'Blocked'
                   when s.passed = s.total and sn.open = 0 and f.ready = f.total and cm.passed = cm.total and fi.passed then 'Ready'
                   when s.awaiting > 0 then 'Awaiting inspection'
                   when s.started > 0 then 'In progress' else 'Not started' end)
  from s, sn, f, cm, fi, u
$$;

create or replace function api.decide_inspection(p_inspection text, p_passed boolean, p_notes text, p_snags jsonb default '[]'::jsonb) returns text
language plpgsql security definer set search_path = public, app as $$
declare i inspections; s jsonb; v_snag text; r jsonb;
begin
  select * into i from inspections where id = p_inspection for update;
  perform app.require(i.project_id, 'quality', 'approve');
  if i.status <> 'Requested' then raise exception 'inspection is already %', i.status; end if;
  if i.requested_by = auth.uid() then raise exception 'the requester cannot inspect their own work' using errcode = '42501'; end if;
  if p_passed and i.kind = 'Final' then
    r := app.unit_readiness(i.unit_id);
    if not (r ->> 'gates_ok')::boolean then raise exception 'final inspection cannot pass: stages %/%, open snags %, FF&E %/%, commissioning %/%',
      r ->> 'stages_passed', r ->> 'stages_total', r ->> 'open_snags', r ->> 'ffe_ready', r ->> 'ffe_total', r ->> 'commissioning_passed', r ->> 'commissioning_total'; end if;
  end if;
  if p_passed and jsonb_array_length(coalesce(p_snags, '[]')) > 0 then raise exception 'a passed inspection cannot raise snags; fail it instead'; end if;
  update inspections set status = case when p_passed then 'Passed' else 'Failed' end, inspector_id = auth.uid(), decided_at = now(), notes = p_notes where id = p_inspection;
  if i.kind = 'Stage' then
    update unit_stages set status = case when p_passed then 'Passed' else 'In progress' end, passed_inspection_id = case when p_passed then p_inspection end, updated_at = now()
     where unit_id = i.unit_id and stage_key = i.stage_key;
  elsif i.kind = 'Commissioning' and p_passed then
    update unit_commissioning set status = 'Passed', passed_inspection_id = p_inspection where unit_id = i.unit_id and system = i.system;
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_snags, '[]')) loop
    v_snag := app.next_no(app.org(), 'SN');
    insert into snags (id, project_id, unit_id, inspection_id, title, severity, category, raised_by, due_date)
    values (v_snag, i.project_id, i.unit_id, p_inspection, s ->> 'title', coalesce(s ->> 'severity', 'Minor'), coalesce(s ->> 'category', 'Workmanship'), auth.uid(), (s ->> 'due_date')::date);
    if s ->> 'severity' = 'Safety-critical' then perform app.emit(i.project_id, 'safety_defect', 'snag:' || v_snag, jsonb_build_object('snag', v_snag, 'title', s ->> 'title')); end if;
  end loop;
  if p_passed and app.unit_readiness(i.unit_id) ->> 'status' = 'Ready' then perform app.emit(i.project_id, 'unit_ready', 'ready:' || i.unit_id, jsonb_build_object('unit', i.unit_id)); end if;
  return case when p_passed then 'Passed' else 'Failed' end;
end $$;

create or replace function api.raise_snag(p_unit uuid, p_title text, p_severity text, p_category text default 'Workmanship', p_vendor uuid default null, p_due date default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare u units; v_id text;
begin
  select * into u from units where id = p_unit;
  perform app.require(u.project_id, 'quality', 'create');
  v_id := app.next_no(app.org(), 'SN');
  insert into snags (id, project_id, unit_id, title, severity, category, assignee_vendor_id, due_date, raised_by) values (v_id, u.project_id, p_unit, p_title, p_severity, p_category, p_vendor, p_due, auth.uid());
  if p_severity = 'Safety-critical' then perform app.emit(u.project_id, 'safety_defect', 'snag:' || v_id, jsonb_build_object('snag', v_id, 'title', p_title)); end if;
  return v_id;
end $$;

create or replace function api.mark_snag_fixed(p_snag text) returns void
language plpgsql security definer set search_path = public, app as $$
declare s snags;
begin
  select * into s from snags where id = p_snag for update;
  perform app.require(s.project_id, 'quality', 'edit');
  if s.status <> 'Open' then raise exception 'snag is %', s.status; end if;
  update snags set status = 'Fixed', fixed_at = now() where id = p_snag;
end $$;

create or replace function api.close_snag(p_snag text) returns void
language plpgsql security definer set search_path = public, app as $$
declare s snags;
begin
  select * into s from snags where id = p_snag for update;
  perform app.require(s.project_id, 'quality', 'approve');
  if s.status <> 'Fixed' then raise exception 'only a fixed snag can be closed after re-inspection'; end if;
  -- safety-critical issues follow a separate path: closure needs quality AND handover approval rights
  if s.severity = 'Safety-critical' and not app.has_perm('handover', 'approve') then
    raise exception 'safety-critical defects must be closed by someone with handover approval rights' using errcode = '42501'; end if;
  update snags set status = 'Closed', closed_by = auth.uid(), closed_at = now() where id = p_snag;
end $$;

create or replace function api.set_ffe_status(p_item uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
declare f ffe_items; v_order text[] := array['Specified','Ordered','Delivered','Installed','Tested'];
begin
  select * into f from ffe_items where id = p_item for update;
  perform app.require(f.project_id, 'handover', 'edit');
  if p_status <> 'Defective' and array_position(v_order, p_status) > coalesce(array_position(v_order, f.status), 0) + 1 then
    raise exception 'FF&E must move one step at a time (% → %)', f.status, p_status; end if;
  update ffe_items set status = p_status where id = p_item;
end $$;

create or replace function api.hand_over_unit(p_unit uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare u units; r jsonb;
begin
  select * into u from units where id = p_unit for update;
  perform app.require(u.project_id, 'handover', 'approve');
  r := app.unit_readiness(p_unit);
  if r ->> 'status' <> 'Ready' then raise exception 'unit % is % — it cannot be handed over until every gate passes', u.code, r ->> 'status' using errcode = '42501'; end if;
  update units set handed_over_at = now() where id = p_unit;
end $$;

create or replace function api.complete_handover_item(p_project text, p_key text, p_status text, p_evidence text default null) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'handover', 'edit');
  update handover_items set status = p_status, evidence_document_id = p_evidence, done_by = auth.uid(), done_at = now() where project_id = p_project and item_key = p_key;
  if not found then raise exception 'unknown handover item %', p_key; end if;
end $$;

create or replace function api.final_property_handover(p_project text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_units integer; v_items integer; v_safety integer;
begin
  perform app.require(p_project, 'handover', 'approve');
  select count(*) into v_units from units where project_id = p_project and handed_over_at is null;
  select count(*) into v_items from handover_items where project_id = p_project and status = 'Open';
  select count(*) into v_safety from snags where project_id = p_project and severity = 'Safety-critical' and status <> 'Closed';
  if v_units + v_items + v_safety > 0 then raise exception 'handover blocked: % unit(s) not handed over, % checklist item(s) open, % safety-critical defect(s) open', v_units, v_items, v_safety using errcode = '42501'; end if;
  update projects set stage = 'Handed over', handed_over_at = now() where id = p_project;
  perform app.log(p_project, 'Property handed over', 'All units, checklist items and safety defects cleared', p_project);
end $$;

-- ---------- documents ----------
create or replace function api.add_document_version(p_document text, p_rev text, p_storage_path text, p_file_name text, p_mime text, p_size bigint, p_note text, p_submit boolean) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare d documents; s org_settings; v_id uuid;
begin
  select * into d from documents where id = p_document; select * into s from org_settings where org_id = app.org();
  perform app.require(d.project_id, 'documents', 'create');
  if not (p_mime = any (s.allowed_mime)) then raise exception 'file type % is not allowed', p_mime using errcode = '22023'; end if;
  if p_size > s.max_upload_mb::bigint * 1048576 then raise exception 'file is larger than % MB', s.max_upload_mb using errcode = '22023'; end if;
  if p_storage_path !~ ('^' || d.project_id || '/') then raise exception 'storage path must sit under the project folder'; end if;
  insert into document_versions (document_id, rev, storage_path, file_name, mime, size_bytes, status, note, uploaded_by)
  values (p_document, p_rev, p_storage_path, p_file_name, p_mime, p_size, case when p_submit then 'Pending' else 'Draft' end, p_note, auth.uid()) returning id into v_id;
  if p_submit then perform app.create_approval('DOC', p_document || ' ' || p_rev, d.project_id, d.title || ' ' || p_rev, null,
    jsonb_build_array(jsonb_build_object('role','pd','module','documents','label','Approve for construction')), jsonb_build_object('document_id', p_document, 'rev', p_rev)); end if;
  return v_id;
end $$;

create or replace function api.register_document(p_project text, p_title text, p_doc_type text, p_folder text default null, p_tags text[] default '{}', p_expiry date default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_id text;
begin
  perform app.require(p_project, 'documents', 'create');
  if p_folder is not null and not exists (select 1 from projects where id = p_project and p_folder = any (document_folders)) then raise exception 'unknown folder %', p_folder; end if;
  v_id := app.next_no(app.org(), 'DOC');
  insert into documents (id, project_id, title, doc_type, folder, tags, expiry) values (v_id, p_project, p_title, p_doc_type, p_folder, coalesce(p_tags, '{}'), p_expiry);
  return v_id;
end $$;

create or replace function api.link_document(p_document text, p_kind text, p_link text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require((select project_id from documents where id = p_document), 'documents', 'edit');
  insert into document_links values (p_document, p_kind, p_link) on conflict do nothing;
end $$;

create or replace function api.add_ffe_item(p_unit uuid, p_item text, p_category text, p_qty integer) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare u units; v_id uuid;
begin
  select * into u from units where id = p_unit;
  perform app.require(u.project_id, 'handover', 'edit');
  insert into ffe_items (project_id, unit_id, item, category, qty) values (u.project_id, p_unit, p_item, p_category, p_qty) returning id into v_id;
  return v_id;
end $$;
