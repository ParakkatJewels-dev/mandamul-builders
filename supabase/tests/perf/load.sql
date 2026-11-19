-- SYNTHETIC LOAD for performance measurement only (never production).
-- One organisation, 30 projects, roughly three years of activity: ~9,000 purchase orders, ~36,000 measurements,
-- ~12,000 daily reports, ~12,000 inspections, ~9,000 defects, 200,000 notifications, and the audit rows the triggers write.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\set org '\'00000000-0000-0000-0000-0000000000aa\''
insert into organizations (id, name) values (:org, 'Perf organisation (synthetic)');
select app.bootstrap_org(:org);
insert into auth.users (email) select 'u' || g || '@perf' from generate_series(1, 40) g;
insert into profiles (user_id, org_id, full_name, email, role_id, all_projects)
select id, :org, 'Perf user ' || n, email,
  case n when 1 then 'md' when 2 then 'pd' when 3 then 'finance' when 4 then 'super_admin' when 5 then 'qs' when 6 then 'proc' when 7 then 'quality' when 8 then 'finance'
         else case when n % 2 = 0 then 'pm' else 'site_sup' end end, n <= 4
from (select id, email, substring(email from 2 for position('@' in email) - 2)::int n from auth.users where email like '%@perf') x;
create temp table u as select substring(email from 2 for position('@' in email) - 2)::int n, user_id id from profiles where email like '%@perf';
insert into vendors (org_id, name, category, approved) select :org, 'Synthetic vendor ' || g, (array['Materials','Civil','MEP','Interiors'])[1 + g % 4], true from generate_series(1, 120) g;
create temp table v as select row_number() over (order by name) n, id from vendors where org_id = :org;

insert into projects (id, org_id, name, property_type, location, keys, built_up_sqft, start_date, pm_id, contingency_pct)
select 'MA-2025-' || lpad(g::text, 3, '0'), :org, 'Synthetic resort ' || g, 'Luxury resort', 'Kerala', 20, 90000, current_date - (300 + g * 20), (select id from u where n = 10 + 2 * (g % 16)), 5
from generate_series(1, 30) g;
create temp table p as select row_number() over (order by id) n, id, start_date, pm_id from projects where org_id = :org;
insert into project_members (project_id, user_id, responsibility)
select p.id, x.uid, x.r from p cross join lateral (values (p.pm_id, 'Project manager'), ((select id from u where n = 9 + 2 * (p.n % 16)), 'Site supervisor'),
  ((select id from u where n = 5), 'QS'), ((select id from u where n = 6), 'Procurement'), ((select id from u where n = 7), 'Quality')) x(uid, r) on conflict do nothing;

insert into budget_versions (project_id, v, status, reason) select id, 1, 'Pending', 'Initial (synthetic)' from p;
insert into budget_lines (version_id, code, amount) select bv.id, bp.code, round(250000000 * bp.pct / 100, 2) from budget_versions bv join p on p.id = bv.project_id join budget_profiles bp on bp.profile = 'resort';
update budget_versions set status = 'Approved', decided_at = now() where project_id in (select id from p);

insert into tasks (project_id, wbs, phase, name, duration_days, is_milestone, base_start, base_finish, act_start, act_finish, progress, owner_id)
select p.id, lpad(g::text, 3, '0'), 'Phase ' || (g / 20), 'Activity ' || g, 12, g % 25 = 0, p.start_date + g * 4, p.start_date + g * 4 + 12,
  case when p.start_date + g * 4 < current_date then p.start_date + g * 4 end,
  case when p.start_date + g * 4 + 12 < current_date - 20 then p.start_date + g * 4 + 12 end,
  case when p.start_date + g * 4 + 12 < current_date - 20 then 100 when p.start_date + g * 4 < current_date then 50 else 0 end, p.pm_id
from p, generate_series(1, 150) g;
insert into task_dependencies (task_id, pred_id) select t.id, t0.id from tasks t join tasks t0 on t0.project_id = t.project_id and t0.wbs = lpad((t.wbs::int - 1)::text, 3, '0') where t.project_id in (select id from p);

insert into units (project_id, code, name, unit_type, template_id, budget) select p.id, 'V-' || lpad(g::text, 2, '0'), 'Villa ' || g, 'Pool villa', 'villa', 6000000 from p, generate_series(1, 70) g;
insert into unit_stages (unit_id, stage_key, seq, label, status) select un.id, ts.stage_key, ts.seq, ts.label, case when ts.seq < 5 then 'In progress' else 'Not started' end
from units un join p on p.id = un.project_id join template_stages ts on ts.org_id = :org and ts.template_id = 'villa';

insert into material_requests (id, org_id, project_id, code, item, qty, uom, needed_by, urgency, requested_by, status, created_at)
select 'MR-S' || p.n || '-' || g, :org, p.id, lpad((1 + g % 12)::text, 2, '0'), 'Synthetic material ' || (g % 60), 10 + g % 90, 'nos', current_date + g % 60, 'Normal',
  (select id from u where n = 9 + 2 * (p.n % 16)), 'PO raised', now() - make_interval(days => 700 - g * 2)
from p, generate_series(1, 300) g;
insert into purchase_orders (id, org_id, project_id, code, vendor_id, mr_id, item, uom, qty, rate, gst_pct, status, over_budget, created_at, approved_at)
select 'PO-S' || p.n || '-' || g, :org, p.id, lpad((1 + g % 12)::text, 2, '0'), (select id from v where n = 1 + (p.n * 7 + g) % 120), 'MR-S' || p.n || '-' || g,
  'Synthetic material ' || (g % 60), 'nos', 10 + g % 90, 1000 + (g * 37) % 9000, 18,
  case when g % 20 = 0 then 'Pending approval' when g % 20 = 1 then 'Rejected' when g % 7 = 0 then 'Part received' else 'Received' end, 0,
  now() - make_interval(days => 700 - g * 2), now() - make_interval(days => 699 - g * 2)
from p, generate_series(1, 300) g;
insert into goods_receipts (id, po_id, received_on, qty, qc, accepted_value)
select 'GRN-' || po.id, po.id, least(current_date, po.created_at::date + 10), case when po.status = 'Received' then po.qty else floor(po.qty / 2) end, 'Pass',
  app.incl_gst((case when po.status = 'Received' then po.qty else floor(po.qty / 2) end) * po.rate, po.gst_pct)
from purchase_orders po where po.org_id = :org and po.status in ('Received','Part received');
insert into vendor_invoices (id, org_id, project_id, vendor_id, po_id, invoice_no, invoice_date, qty, rate, gst_pct, match_status, status, due_date, created_at)
select 'INV-' || po.id, :org, po.project_id, po.vendor_id, po.id, 'SI/' || po.id, least(current_date, po.created_at::date + 15), po.qty, po.rate, 18, 'Matched',
  case when right(po.id, 1) in ('1','2','3') then 'Approved' else 'Paid' end, least(current_date, po.created_at::date + 45), po.created_at + interval '15 days'
from purchase_orders po where po.org_id = :org and po.status = 'Received' and right(po.id, 1) <> '9';
insert into payments (id, org_id, project_id, vendor_id, kind, invoice_id, amount, tds, paid_on, bank_reference, reconciled)
select 'PAY-' || i.id, :org, i.project_id, i.vendor_id, 'invoice', i.id, i.total, 0, least(current_date, i.invoice_date + 30), 'UTR' || i.id, true
from vendor_invoices i where i.org_id = :org and i.status = 'Paid';

insert into contracts (id, org_id, project_id, vendor_id, code, title, retention_pct, advance_amount, advance_recovery_pct, tds_pct, gst_pct, start_date, end_date, status, over_budget)
select 'WO-S' || p.n || '-' || g, :org, p.id, (select id from v where n = 1 + (p.n * 11 + g) % 120), lpad((3 + g % 6)::text, 2, '0'), 'Synthetic work order ' || g,
  5, 0, 0, 2, 18, p.start_date + g * 10, p.start_date + g * 10 + 400, 'Pending approval', 0
from p, generate_series(1, 15) g;
insert into contract_items (contract_id, description, uom, qty, rate) select c.id, 'Item ' || g, 'sqm', 100, 1000 + g * 10 from contracts c, generate_series(1, 40) g where c.org_id = :org;
update contracts set status = 'Active' where org_id = :org;
insert into ra_bills (id, contract_id, bill_no, gross, gst, retention, advance_recovery, tds, other_deductions, net_payable, status, due_date, created_at)
select 'RA-' || c.id || '-' || b, c.id, b, 400000, 72000, 20000, 0, 8000, 0, 444000, case when b <= 2 then 'Paid' when b = 3 then 'Approved' else 'In approval' end,
  current_date - (60 - b * 10), now() - make_interval(days => 120 - b * 25)
from contracts c, generate_series(1, 4) b where c.org_id = :org;
insert into measurements (contract_item_id, qty, measured_on, recorded_by, status, verified_by, verified_at, ra_bill_id)
select ci.id, 20, current_date - m * 30, (select id from u where n = 9 + 2 * (p.n % 16)), 'Verified', p.pm_id, now() - make_interval(days => m * 30 - 1), 'RA-' || c.id || '-' || m
from contract_items ci join contracts c on c.id = ci.contract_id join p on p.id = c.project_id, generate_series(1, 2) m;
insert into payments (id, org_id, project_id, vendor_id, kind, ra_bill_id, amount, tds, paid_on, bank_reference, reconciled)
select 'PAY-' || b.id, :org, c.project_id, c.vendor_id, 'ra_bill', b.id, 436000, 8000, current_date - 5, 'UTR' || b.id, b.bill_no = 1
from ra_bills b join contracts c on c.id = b.contract_id where c.org_id = :org and b.status = 'Paid';

insert into approvals (id, org_id, project_id, kind, ref, title, amount, requested_by, requested_at, status, closed_at)
select 'AP-' || po.id, :org, po.project_id, 'PO', po.id, po.item, po.total, (select id from u where n = 6), po.created_at,
  case po.status when 'Pending approval' then 'Pending' when 'Rejected' then 'Rejected' else 'Approved' end, case when po.status <> 'Pending approval' then po.approved_at end
from purchase_orders po where po.org_id = :org;
insert into approvals (id, org_id, project_id, kind, ref, title, amount, requested_by, requested_at, status)
select 'AP-' || b.id, :org, c.project_id, 'RABILL', b.id, 'Running bill ' || b.bill_no, b.gross + b.gst, (select id from u where n = 5), b.created_at, case when b.status = 'In approval' then 'Pending' else 'Approved' end
from ra_bills b join contracts c on c.id = b.contract_id where c.org_id = :org;
insert into approval_steps (approval_id, seq, role_id, module, label, status, decided_by, decided_at)
select a.id, s, case s when 1 then 'pm' else 'md' end, 'procurement', 'Review', case when a.status = 'Approved' then 'approved' when a.status = 'Rejected' then 'rejected' when s = 1 then 'pending' else 'waiting' end,
  case when a.status <> 'Pending' then (select id from u where n = case s when 1 then 10 else 1 end) end, case when a.status <> 'Pending' then a.requested_at + interval '1 day' end
from approvals a, generate_series(1, 2) s where a.org_id = :org;

insert into daily_reports (id, project_id, report_date, submitted_by, labour, status, verified_by)
select 'DR-' || p.n || '-' || g, p.id, current_date - g, (select id from u where n = 9 + 2 * (p.n % 16)), '[]', 'Approved', p.pm_id from p, generate_series(1, 400) g;
insert into inspections (id, project_id, unit_id, kind, stage_key, requested_by, requested_at, status, inspector_id, decided_at)
select 'IN-' || p.n || '-' || g, p.id, (select id from units where project_id = p.id and code = 'V-' || lpad((1 + g % 70)::text, 2, '0')), 'Stage', 'structure',
  (select id from u where n = 9 + 2 * (p.n % 16)), now() - make_interval(days => 400 - g), case when g % 5 = 0 then 'Requested' else 'Passed' end,
  case when g % 5 <> 0 then (select id from u where n = 7) end, case when g % 5 <> 0 then now() - make_interval(days => 399 - g) end
from p, generate_series(1, 400) g;
insert into snags (id, project_id, unit_id, title, severity, category, assignee_vendor_id, status, raised_by, closed_by, closed_at, created_at)
select 'SN-' || p.n || '-' || g, p.id, (select id from units where project_id = p.id and code = 'V-' || lpad((1 + g % 70)::text, 2, '0')), 'Synthetic defect ' || g,
  case when g % 40 = 0 then 'Safety-critical' when g % 3 = 0 then 'Major' else 'Minor' end, 'Finishing', (select id from v where n = 1 + g % 120),
  case when g % 10 < 3 then 'Open' when g % 10 = 3 then 'Fixed' else 'Closed' end, (select id from u where n = 7),
  case when g % 10 > 3 then (select id from u where n = 7) end, case when g % 10 > 3 then now() - make_interval(days => 300 - g) end, now() - make_interval(days => 330 - g)
from p, generate_series(1, 300) g;

insert into notifications (org_id, user_id, channel, delivery, text, link, read_at, created_at)
select :org, (select id from u where n = 1 + g % 40), 'in_app', 'delivered', 'Synthetic notification ' || g, '', case when g % 5 <> 0 then now() end, now() - make_interval(mins => g)
from generate_series(1, 200000) g;
insert into automation_events (org_id, project_id, event, dedupe_key, payload, status, attempts, processed_at, created_at)
select :org, (select id from p where n = 1 + g % 30), 'contractor_bill', 'synthetic:' || g, '{}', 'processed', 1, now() - make_interval(mins => g), now() - make_interval(mins => g) from generate_series(1, 30000) g;
analyze;
select (select count(*) from purchase_orders) pos, (select count(*) from measurements) measurements, (select count(*) from daily_reports) reports,
       (select count(*) from inspections) inspections, (select count(*) from snags) snags, (select count(*) from notifications) notifications, (select count(*) from audit_log) audit_rows;
