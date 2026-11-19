-- Batch 14: read functions for the contracts, billing and payment screens of the production application.
-- A contractor (role vendor) sees only their own contracts on projects they belong to, with their own rates and bills,
-- the same rule api.submit_claim applies. Everyone else needs contracts:view on the project, or site:create to record measurements;
-- money needs budget:view (contractors see their own).

create or replace function app.contract_visible(c contracts) returns boolean
language sql stable security definer set search_path = public, app as $$
  select (app.role() = 'vendor' and app.has_project(c.project_id)
          and exists (select 1 from profiles p where p.user_id = auth.uid() and p.active and p.vendor_id = c.vendor_id))
      or (app.role() <> 'vendor' and (app.can(c.project_id, 'contracts', 'view') or app.can(c.project_id, 'site', 'create')))   -- site staff record measurements (no money shown)
$$;
create or replace function app.contract_money(c contracts) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.role() = 'vendor' or app.can(c.project_id, 'budget', 'view')
$$;

create or replace function api.contract_list(p_project text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not app.has_project(p_project) then raise exception 'no access to project %', p_project using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'id') from (
    select jsonb_build_object('id', c.id, 'title', c.title, 'vendor', v.name, 'status', c.status, 'start_date', c.start_date, 'end_date', c.end_date,
      'value', case when app.contract_money(c) then (select coalesce(sum(round(i.qty * i.rate, 2)), 0) from contract_items i where i.contract_id = c.id)
                 + (select coalesce(sum(amount), 0) from contract_variations w where w.contract_id = c.id and w.status = 'Approved') end,
      'certified', case when app.contract_money(c) then (select coalesce(sum(gross), 0) from ra_bills b where b.contract_id = c.id and b.status in ('Approved','Paid')) end,
      'paid', case when app.contract_money(c) then (select coalesce(sum(p.amount), 0) from payments p join ra_bills b on b.id = p.ra_bill_id where b.contract_id = c.id) end,
      'pending_measurements', (select count(*) from measurements m join contract_items i on i.id = m.contract_item_id where i.contract_id = c.id and m.status = 'Recorded'),
      'open_claim', (select status from contractor_claims k where k.contract_id = c.id and k.status in ('Submitted','Discrepancies') limit 1),
      'bill_in_approval', exists (select 1 from ra_bills b where b.contract_id = c.id and b.status = 'In approval')) x
    from contracts c join vendors v on v.id = c.vendor_id where c.project_id = p_project and app.contract_visible(c)) q), '[]');
end $$;

create or replace function api.contract_detail(p_contract text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare c contracts; m boolean;
begin
  select * into c from contracts where id = p_contract;
  if not found or not app.contract_visible(c) then raise exception 'contract % not found', p_contract; end if;
  m := app.contract_money(c);
  return jsonb_build_object(
    'contract', jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status, 'project_id', c.project_id, 'vendor', (select name from vendors where id = c.vendor_id),
       'retention_pct', c.retention_pct, 'tds_pct', c.tds_pct, 'gst_pct', c.gst_pct, 'advance', case when m then c.advance_amount end, 'start_date', c.start_date, 'end_date', c.end_date),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'description', i.description, 'uom', i.uom, 'qty', i.qty, 'rate', case when m then i.rate end,
        'verified_qty', (select coalesce(sum(x.qty), 0) from measurements x where x.contract_item_id = i.id and x.status = 'Verified'),
        'pending_qty', (select coalesce(sum(x.qty), 0) from measurements x where x.contract_item_id = i.id and x.status = 'Recorded'),
        'billed_qty', (select coalesce(max(l.cum_qty), 0) from ra_bill_lines l join ra_bills b on b.id = l.bill_id where l.contract_item_id = i.id and b.status <> 'Rejected')) order by i.description)
      from contract_items i where i.contract_id = c.id), '[]'),
    'measurements', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'item', i.description, 'uom', i.uom, 'qty', x.qty, 'measured_on', x.measured_on, 'status', x.status,
        'note', x.location_note, 'recorded_by', (select full_name from profiles where user_id = x.recorded_by), 'recorded_by_me', x.recorded_by = auth.uid(),
        'verified_by', (select full_name from profiles where user_id = x.verified_by)) order by x.measured_on desc, x.id)
      from measurements x join contract_items i on i.id = x.contract_item_id where i.contract_id = c.id), '[]'),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'claim_no', k.claim_no, 'status', k.status, 'submitted_at', k.submitted_at, 'note', k.note,
        'claimed_gross', case when m then k.claimed_gross end, 'assessment', case when m then coalesce(k.assessment, '{}'::jsonb) else '{}'::jsonb end, 'ra_bill_id', k.ra_bill_id,
        'lines', (select jsonb_agg(jsonb_build_object('description', l.description, 'qty', l.claimed_qty, 'rate', case when m then l.claimed_rate end) order by l.line_no) from claim_lines l where l.claim_id = k.id))
        order by k.claim_no desc) from contractor_claims k where k.contract_id = c.id), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'bill_no', b.bill_no, 'status', b.status, 'due_date', b.due_date,
        'gross', case when m then b.gross end, 'gst', case when m then b.gst end, 'retention', case when m then b.retention end, 'advance_recovery', case when m then b.advance_recovery end,
        'tds', case when m then b.tds end, 'other_deductions', case when m then b.other_deductions end, 'net_payable', case when m then b.net_payable end,
        'paid', case when m then (select coalesce(sum(amount), 0) from payments p where p.ra_bill_id = b.id) end) order by b.bill_no desc) from ra_bills b where b.contract_id = c.id), '[]'),
    'variations', coalesce((select jsonb_agg(jsonb_build_object('description', w.description, 'amount', case when m then w.amount end, 'status', w.status) order by w.created_at)
      from contract_variations w where w.contract_id = c.id), '[]'),
    'can', jsonb_build_object('measure', app.can(c.project_id, 'site', 'create'), 'verify', app.can(c.project_id, 'site', 'approve'),
       'claim', (app.role() = 'vendor') or app.can(c.project_id, 'contracts', 'create'), 'assess', app.can(c.project_id, 'contracts', 'edit')));
end $$;

-- approved, unpaid bills and invoices for finance: what to pay, to whom, how much is left, by when
create or replace function api.payment_queue(p_project text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_perm('payments', 'view');
  return coalesce((select jsonb_agg(x order by x ->> 'due_date' nulls last) from (
    select jsonb_build_object('kind', 'ra_bill', 'id', b.id, 'project_id', c.project_id, 'project', pr.name, 'payee', v.name, 'what', format('RA bill %s on %s', b.bill_no, c.id),
      'due_date', b.due_date, 'amount', b.net_payable, 'paid', coalesce(pa.amount, 0), 'balance', b.net_payable - coalesce(pa.amount, 0),
      'tds_left', b.tds - coalesce(pa.tds, 0)) x
    from ra_bills b join contracts c on c.id = b.contract_id join projects pr on pr.id = c.project_id join vendors v on v.id = c.vendor_id
    left join lateral (select sum(amount) amount, sum(tds) tds from payments p where p.ra_bill_id = b.id) pa on true
    where b.status = 'Approved' and b.net_payable - coalesce(pa.amount, 0) > 0 and (p_project is null or c.project_id = p_project) and app.can(c.project_id, 'payments', 'view')
    union all
    select jsonb_build_object('kind', 'invoice', 'id', i.id, 'project_id', i.project_id, 'project', pr.name, 'payee', v.name, 'what', format('Invoice %s on %s', i.invoice_no, i.po_id),
      'due_date', i.due_date, 'amount', i.total, 'paid', coalesce(pa.amount, 0), 'balance', i.total - coalesce(pa.amount, 0), 'tds_left', 0)
    from vendor_invoices i join projects pr on pr.id = i.project_id join vendors v on v.id = i.vendor_id
    left join lateral (select sum(amount) amount from payments p where p.invoice_id = i.id) pa on true
    where i.status = 'Approved' and i.total - coalesce(pa.amount, 0) > 0 and (p_project is null or i.project_id = p_project) and app.can(i.project_id, 'payments', 'view')) q), '[]');
end $$;

grant execute on function api.contract_list(text), api.contract_detail(text), api.payment_queue(text) to authenticated;
