-- M Andamul Development OS · database test suite
-- Runs the 12 required business workflows and the negative cases (unauthorised actions, duplicates,
-- over-receipt, overpayment, segregation of duties, stale updates, audit immutability, retries).
-- Each check writes a row to tests.results; the runner prints a pass/fail table and exits non-zero on failure.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;

create schema tests;
create table tests.results (n serial primary key, workflow text not null, name text not null, ok boolean not null, detail text);
grant usage on schema tests to authenticated; grant select, insert on tests.results to authenticated; grant usage on sequence tests.results_n_seq to authenticated;
create function tests.ok(p_wf text, p_cond boolean, p_name text, p_detail text default null) returns void language sql as $$
  insert into tests.results (workflow, name, ok, detail) values (p_wf, p_name, coalesce(p_cond, false), p_detail) $$;
create function tests.throws(p_wf text, p_sql text, p_pattern text, p_name text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into tests.results (workflow, name, ok, detail) values (p_wf, p_name, false, 'expected an error, none raised');
exception when others then
  insert into tests.results (workflow, name, ok, detail) values (p_wf, p_name, sqlerrm ~* p_pattern, sqlerrm);
end $$;
create function tests.login(p_email text) returns text language plpgsql as $$
declare v uuid;
begin
  perform set_config('role', 'none', false);
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'unknown test user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal2')::text, false);   -- signed in with MFA
  perform set_config('role', 'authenticated', false);
  return p_email;
end $$;
create function tests.login_password_only(p_email text) returns text language plpgsql as $$
declare v uuid;
begin
  perform set_config('role', 'none', false);
  select id into v from auth.users where email = p_email;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  perform set_config('role', 'authenticated', false);
  return p_email;
end $$;
create function tests.as_system() returns void language plpgsql as $$
begin perform set_config('role', 'none', false); perform set_config('request.jwt.claims', '', false); end $$;
grant execute on all functions in schema tests to authenticated;

-- ---------- fixtures: two organisations, users per role, vendors ----------
insert into organizations (id, name) values ('00000000-0000-0000-0000-00000000000a', 'M Andamul (test)'), ('00000000-0000-0000-0000-00000000000b', 'Other company (test)');
select app.bootstrap_org('00000000-0000-0000-0000-00000000000a'); select app.bootstrap_org('00000000-0000-0000-0000-00000000000b');
insert into auth.users (email) select e from unnest(array['admin@a','md@a','pd@a','pm@a','pm2@a','sup@a','qs@a','proc@a','fin@a','fin2@a','qe@a','md@b']) e;
insert into profiles (user_id, org_id, full_name, email, role_id, all_projects)
select u.id, case when u.email like '%@b' then '00000000-0000-0000-0000-00000000000b'::uuid else '00000000-0000-0000-0000-00000000000a'::uuid end,
       split_part(u.email, '@', 1), u.email,
       case split_part(u.email, '@', 1) when 'admin' then 'super_admin' when 'md' then 'md' when 'pd' then 'pd' when 'pm' then 'pm' when 'pm2' then 'pm'
         when 'sup' then 'site_sup' when 'qs' then 'qs' when 'proc' then 'proc' when 'fin' then 'finance' when 'fin2' then 'finance' when 'qe' then 'quality' end,
       split_part(u.email, '@', 1) in ('admin','md','pd','qs','proc','fin','fin2','qe')
from auth.users u;
insert into vendors (org_id, name, category, city, approved, credit_days) values
  ('00000000-0000-0000-0000-00000000000a', 'Sahyadri Steel & Cement', 'Steel & cement', 'Kottayam', true, 30),
  ('00000000-0000-0000-0000-00000000000a', 'Hilltop Tiles (unapproved)', 'Roofing', 'Kattappana', false, 30),
  ('00000000-0000-0000-0000-00000000000a', 'Western Ghats Builders', 'Civil contractor', 'Kottayam', true, 15),
  ('00000000-0000-0000-0000-00000000000a', 'Bluewave Pools', 'Pools', 'Kochi', true, 30);
select (select id from auth.users where email = 'pm@a') pm, (select id from auth.users where email = 'sup@a') sup,
       (select id from vendors where name like 'Sahyadri%') v_steel, (select id from vendors where name like 'Hilltop%') v_bad,
       (select id from vendors where name like 'Western%') v_civil, (select id from vendors where name like 'Bluewave%') v_pool \gset

-- ===== W1 · new resort project =====
select tests.login('pd@a');
select api.create_project(jsonb_build_object('name','Kovalam Boutique Hotel','property_type','Boutique hotel','location','Kovalam, Thiruvananthapuram, Kerala',
  'district','Thiruvananthapuram','state','Kerala','client_name','Coastline Leisure LLP','keys',2,'built_up_sqft',42000,'start_date',(current_date - 200)::text,
  'pm_id',:'pm','contract_value',300000000,'contingency_pct',5,'budget_total',250000000,'profile','resort',
  'land', jsonb_build_object('survey_no','112/4','area_acres',3.2,'classification','Garden land','coastal_zone','CRZ-III (estimate)'),
  'members', jsonb_build_array(jsonb_build_object('user_id',:'sup','responsibility','Site supervisor')),
  'units', jsonb_build_array(
     jsonb_build_object('code','V-01','name','Pool villa 1','unit_type','Pool villa','template_id','villa','budget',20000000,'systems',jsonb_build_array('Electrical','HVAC','Plumbing','Fire','Pool')),
     jsonb_build_object('code','V-02','name','Pool villa 2','unit_type','Pool villa','template_id','villa','budget',20000000,'systems',jsonb_build_array('Electrical','HVAC'))))) as pid \gset
select tests.as_system();
select tests.ok('W1 New project', :'pid' ~ '^MA-[0-9]{4}-[0-9]{3}$', 'unique project ID generated', :'pid');
select tests.ok('W1 New project', (select count(*) = 13 and sum(amount) = 250000000 from budget_lines l join budget_versions v on v.id = l.version_id where v.project_id = :'pid'), 'budget split into 13 cost codes, totals exactly ₹25 Cr');
select tests.ok('W1 New project', (select amount = 12500000 from budget_lines l join budget_versions v on v.id = l.version_id where v.project_id = :'pid' and code = '13'), 'contingency line = 5%');
select tests.ok('W1 New project', (select count(*) = 18 from tasks where project_id = :'pid') and (select count(*) = 22 from task_dependencies d join tasks t on t.id = d.task_id where t.project_id = :'pid'), '18 activities and 22 dependencies from the plan template');
select tests.ok('W1 New project', (select base_finish - (current_date - 200) = 390 from tasks where project_id = :'pid' and wbs = 'M03'), 'baseline handover = start + 390 days (forward pass)');
select tests.ok('W1 New project', (select count(*) = 22 from unit_stages s join units u on u.id = s.unit_id where u.project_id = :'pid'), 'two villas with 11 readiness stages each');
select tests.ok('W1 New project', (select count(*) = 7 from unit_commissioning c join units u on u.id = c.unit_id where u.project_id = :'pid'), 'commissioning systems created per unit');
select tests.ok('W1 New project', (select cardinality(document_folders) = 10 from projects where id = :'pid') and (select count(*) = 11 from handover_items where project_id = :'pid'), 'document folders and handover checklist created');
select tests.ok('W1 New project', (select count(*) = 3 from project_members where project_id = :'pid'), 'team assigned (creator, PM, supervisor)');
select tests.ok('W1 New project', (select status = 'Pending' from approvals where project_id = :'pid' and kind = 'BUDGET'), 'initial budget sent for approval');
select tests.ok('W1 New project', (select regulatory_status = 'Estimate' from land_parcels where project_id = :'pid'), 'regulatory data marked as estimate until validated');
select tests.login('sup@a');
select tests.throws('W1 New project', $$select api.create_project('{"name":"X","property_type":"Resort","location":"Y","keys":1,"start_date":"2026-01-01","budget_total":1000000}')$$, 'permission denied', 'site supervisor cannot create a project');

-- ===== W2 · budget preparation and approval =====
select tests.as_system();
select id as bap from approvals where project_id = :'pid' and kind = 'BUDGET' \gset
select tests.login('pd@a');
select tests.throws('W2 Budget', format($$select api.decide(%L,'approve','ok')$$, :'bap'), 'needs finance', 'Project Director cannot take the Finance step');
select tests.login('fin@a');
select tests.ok('W2 Budget', api.decide(:'bap', 'approve', 'Checked against feasibility') = 'next:md', 'Finance review passes to MD');
select tests.throws('W2 Budget', format($$select api.decide(%L,'approve','again', 1)$$, :'bap'), 'already decided', 'stale or repeated decision is refused');
select tests.login('md@a');
select tests.throws('W2 Budget', format($$select api.decide(%L,'reject','')$$, :'bap'), 'comment is required', 'rejection needs a comment');
select tests.ok('W2 Budget', api.decide(:'bap', 'approve', 'Approved') = 'approved', 'MD approves; budget v1 in force');
select tests.as_system();
select tests.ok('W2 Budget', app.current_budget(:'pid') is not null, 'current approved budget is v1');
select tests.throws('W2 Budget', format($$update budget_lines set amount = amount + 1 where version_id = %L and code = '01'$$, app.current_budget(:'pid')), 'cannot be changed', 'approved budget lines cannot be modified silently (even directly)');
select tests.login('qs@a');
select api.request_budget_revision(:'pid', '[{"code":"13","delta":-1000000},{"code":"11","delta":1000000}]', 'Pool redesign after setback review; move ₹10 L from contingency') as bv2 \gset
select tests.throws('W2 Budget', format($$select api.request_budget_revision(%L, '[{"code":"01","delta":1}]', 'second revision while one is open')$$, :'pid'), 'duplicate key|budget_one_pending', 'only one revision in approval at a time');
select tests.login('fin@a'); select api.decide((select id from approvals where ref = :'bv2'), 'approve', 'ok');
select tests.login('md@a'); select api.decide((select id from approvals where ref = :'bv2'), 'approve', 'ok');
select tests.as_system();
select tests.ok('W2 Budget', (select v = 2 from budget_versions where id = app.current_budget(:'pid')), 'revision v2 now in force, v1 retained');
select tests.ok('W2 Budget', (select sum(amount) = 250000000 from budget_lines where version_id = app.current_budget(:'pid')), 'transfer kept the total unchanged');

-- ===== W3 · construction schedule =====
select tests.as_system();
select id as t01, version as t01v from tasks where project_id = :'pid' and wbs = 'T01' \gset
select id as t07 from tasks where project_id = :'pid' and wbs = 'T07' \gset
select tests.login('pm@a');
select tests.throws('W3 Schedule', format($$select api.update_task(%L, %s, 50, null, null, '', '')$$, :'t01', :'t01v'), 'delay reason', 'late activity needs a delay reason');
select tests.ok('W3 Schedule', api.update_task(:'t01', :t01v, 100, current_date - 190, current_date - 168, 'Soil test re-done after rain', null) = :t01v + 1, 'PM completes T01; version bumps');
select tests.throws('W3 Schedule', format($$select api.update_task(%L, %s, 100, null, null, 'x', '')$$, :'t01', :'t01v'), 'changed by someone else', 'stale version is refused (optimistic concurrency)');
select tests.login('pm2@a');
select tests.throws('W3 Schedule', format($$select api.update_task(%L, %s, 10, null, null, 'x', '')$$, :'t07', 1), 'no access', 'PM of another project cannot touch this schedule');
select tests.as_system();
select tests.throws('W3 Schedule', format($$insert into task_dependencies values ((select id from tasks where project_id=%1$L and wbs='T01'), (select id from tasks where project_id=%1$L and wbs='T03'))$$, :'pid'), 'cycle', 'dependency cycles are rejected');
select tests.ok('W3 Schedule', (select act_finish is not null and progress = 100 from tasks where id = :'t01'), 'actual finish recorded with 100% progress');

-- ===== W4 · purchase request → quotations → PO approval =====
select tests.login('sup@a');
select api.raise_mr(:'pid', '03', 'TMT steel Fe 550D', 10, 'MT', current_date + 10) as mr1 \gset
select tests.throws('W4 Purchase', format($$select api.raise_mr(%L,'03','TMT steel Fe 550D 12mm',5,'MT',current_date+12)$$, :'pid'), 'possible duplicate', 'duplicate material request detected');
select tests.ok('W4 Purchase', api.raise_mr(:'pid', '03', 'TMT steel Fe 550D 12mm', 5, 'MT', current_date + 12, 'Normal', null, 'Separate lot for the clubhouse lift core') is not null, 'duplicate allowed only with a written reason');
select tests.throws('W4 Purchase', format($$select api.add_quotation(%L, %L, 70000, 18, 5)$$, :'mr1', :'v_steel'), 'permission denied', 'site supervisor cannot enter commercial quotations');
select tests.login('proc@a');
select api.add_quotation(:'mr1', :'v_steel', 70000, 18, 5);
select tests.throws('W4 Purchase', format($$select api.add_quotation(%L, %L, 65000, 18, 9)$$, :'mr1', :'v_bad'), 'approved list', 'unapproved vendor cannot quote');
select api.raise_po(:'mr1', :'v_steel') as po1 \gset
select tests.throws('W4 Purchase', format($$select api.raise_po(%L, %L)$$, :'mr1', :'v_steel'), 'already exists', 'second PO for the same request is blocked');
select tests.as_system();
select tests.ok('W4 Purchase', (select total = 826000.00 and amount = 700000.00 and tax = 126000.00 from purchase_orders where id = :'po1'), 'PO maths: 10 MT × ₹70,000 + 18% GST = ₹8,26,000');
select tests.ok('W4 Purchase', (select string_agg(role_id, '>' order by seq) = 'pm>pd' from approval_steps where approval_id = (select approval_id from purchase_orders where id = :'po1')), 'above ₹5 L routes PM → PD');
select coalesce(amount, 0) as etc03_before from etc_estimates where project_id = :'pid' and code = '03' \gset
select tests.login('pm@a'); select api.decide((select approval_id from purchase_orders where id = :'po1'), 'approve', 'Rate checked');
select tests.login('pd@a'); select api.decide((select approval_id from purchase_orders where id = :'po1'), 'approve', 'ok');
select tests.as_system();
select tests.ok('W4 Purchase', (select status = 'Approved' from purchase_orders where id = :'po1'), 'PO approved after full chain');
select tests.ok('W4 Purchase', (select amount = :etc03_before - 826000 from etc_estimates where project_id = :'pid' and code = '03'), 'estimate-to-complete reduced by the commitment');
-- over-budget order must add an MD budget override
select tests.login('sup@a'); select api.raise_mr(:'pid', '11', 'Pool heat pumps and filtration', 1, 'set', current_date + 30, 'Urgent', null) as mr2 \gset
select tests.login('proc@a'); select api.add_quotation(:'mr2', :'v_pool', 9000000, 18, 30); select api.raise_po(:'mr2', :'v_pool') as po2 \gset
select tests.as_system();
select tests.ok('W4 Purchase', (select over_budget > 0 from purchase_orders where id = :'po2'), 'order above available cost-code budget is flagged', (select over_budget::text from purchase_orders where id = :'po2'));
select tests.ok('W4 Purchase', (select string_agg(role_id || ':' || module, '>' order by seq) = 'pm:procurement>pd:procurement>md:budget' from approval_steps where approval_id = (select approval_id from purchase_orders where id = :'po2')), 'over-budget order adds MD budget override step');
select tests.ok('W4 Purchase', exists (select 1 from automation_events where event = 'material_shortage' and payload ->> 'mr' = :'mr2'), 'urgent request raises a material-shortage event');

-- ===== W5 · receive purchased materials =====
select tests.login('sup@a');
select tests.ok('W5 Receipt', api.record_grn(:'po1', 6, 'Pass', current_date, 'Challan 4411') is not null, 'partial receipt of 6 MT accepted');
select api.record_grn(:'po1', 2, 'Fail', current_date, 'Rusted bundles rejected at gate');
select tests.throws('W5 Receipt', format($$select api.record_grn(%L, 5, 'Pass')$$, :'po1'), 'over-receipt', 'receiving more than ordered is blocked');
select tests.throws('W5 Receipt', format($$select api.record_grn(%L, 1, 'Pass')$$, :'po2'), 'need an approved order', 'no receipt against an unapproved order');
select tests.as_system();
select tests.ok('W5 Receipt', (select status = 'Part received' from purchase_orders where id = :'po1'), 'PO shows part received');
select tests.ok('W5 Receipt', (select sum(accepted_value) = 495600 from goods_receipts where po_id = :'po1'), 'only QC-passed goods count as cost (6 MT = ₹4,95,600)');
select tests.login('sup@a'); select api.record_grn(:'po1', 4, 'Pass', current_date, 'Balance');
select tests.as_system();
select tests.ok('W5 Receipt', (select status = 'Received' from purchase_orders where id = :'po1'), 'PO fully received');
select tests.login('sup@a');
select tests.ok('W5 Receipt', (select count(*) = 0 from purchase_orders), 'site supervisor cannot read PO prices');
select tests.ok('W5 Receipt', (select accepted = 10 from api.po_tracking(:'pid') where id = :'po1'), 'site supervisor tracks deliveries without prices');

-- ===== W8a · vendor invoice: three-way match, approval, payment, reconciliation =====
select tests.login('fin2@a');
select api.record_invoice(:'po1', 'SSC/2026/118', current_date, 6, 70000, 18) as inv1 \gset
select tests.throws('W8 Invoice', format($$select api.record_invoice(%L, 'ssc/2026/ 118', current_date, 4, 70000, 18)$$, :'po1'), 'duplicate invoice', 'same invoice number cannot be booked twice (case and spaces ignored)');
select api.record_invoice(:'po1', 'SSC/2026/131', current_date, 4, 71000, 18) as inv_bad \gset
select tests.as_system();
select tests.ok('W8 Invoice', (select match_status = 'Matched' and status = 'Pending approval' from vendor_invoices where id = :'inv1'), 'matched invoice goes to approval');
select tests.ok('W8 Invoice', (select status = 'On hold' and match_notes like '%rate 71000 differs from PO rate 70000%' from vendor_invoices where id = :'inv_bad'), 'rate mismatch puts the invoice on hold', (select match_notes from vendor_invoices where id = :'inv_bad'));
select tests.login('fin2@a');
select tests.throws('W8 Invoice', format($$select api.decide((select approval_id from vendor_invoices where id=%L),'approve','x')$$, :'inv1'), 'raised this request', 'booker cannot approve own invoice');
select tests.login('fin@a'); select api.decide((select approval_id from vendor_invoices where id = :'inv1'), 'approve', 'Matched to GRN');
select tests.login('fin2@a');
select tests.throws('W8 Invoice', format($$select api.record_payment('invoice', %L, 495600, 0, current_date, 'UTR0001')$$, :'inv1'), 'cannot also pay', 'person who booked the invoice cannot pay it');
select tests.login('fin@a');
select tests.throws('W8 Invoice', format($$select api.record_payment('invoice', %L, 500000, 0, current_date, 'UTR0002')$$, :'inv1'), 'overpayment', 'overpayment blocked');
select api.record_payment('invoice', :'inv1', 495600, 0, current_date, 'UTR0003') as pay1 \gset
select tests.throws('W8 Invoice', format($$select api.record_payment('invoice', %L, 1, 0, current_date, 'utr0003')$$, :'inv1'), 'already used|not approved|is Paid', 'bank reference reuse / paying a paid invoice blocked');
select tests.login('fin2@a'); select api.reconcile_payment(:'pay1', 'HDFC stmt 2026-11 line 42');
select tests.as_system();
select tests.ok('W8 Invoice', (select status = 'Paid' from vendor_invoices where id = :'inv1') and (select reconciled from payments where id = :'pay1'), 'invoice paid and payment reconciled');

-- ===== W6 · construction progress from daily reports =====
select tests.as_system();
insert into boq_items (project_id, code, ref, description, unit, qty, rate) values (:'pid','03','03.01','RCC M30 columns, beams & slabs','cum',400,9400) returning id as boq1 \gset
select tests.login('sup@a');
select api.submit_daily_report(:'pid', current_date - 1, 'Light rain', '[{"trade":"Mason","count":12},{"trade":"Helper","count":20}]', 'Pump breakdown 1 h', 'Toolbox talk held',
  jsonb_build_array(jsonb_build_object('task_id', :'t07', 'progress_to', 30, 'boq_item_id', :'boq1', 'qty', 12.5))) as dr1 \gset
select tests.throws('W6 Progress', format($$select api.submit_daily_report(%L, current_date - 1, 'Clear', '[]', null, null, '[]')$$, :'pid'), 'already submitted', 'one report per site per day');
select tests.throws('W6 Progress', format($$select api.submit_daily_report(%L, current_date + 1, 'Clear', '[]', null, null, '[]')$$, :'pid'), 'future', 'future-dated report blocked');
select tests.as_system();
select tests.ok('W6 Progress', (select progress = 0 from tasks where id = :'t07'), 'unverified report does not move progress');
select approval_id as dr1ap from daily_reports where id = :'dr1' \gset
select tests.login('pm2@a');
select tests.throws('W6 Progress', format($$select api.decide(%L,'approve','x')$$, :'dr1ap'), 'no access', 'PM without project access cannot verify');
select tests.login('pm@a'); select api.decide((select approval_id from daily_reports where id = :'dr1'), 'approve', 'Checked pour register');
select tests.as_system();
select tests.ok('W6 Progress', (select progress = 30 and act_start = current_date - 1 from tasks where id = :'t07'), 'verified report sets activity progress and actual start');
select tests.ok('W6 Progress', (select executed_qty = 12.5 from boq_items where id = :'boq1'), 'verified quantity updates BOQ executed quantity');
select tests.login('sup@a');
select api.submit_daily_report(:'pid', current_date - 2, 'Clear', '[]', 'Crane idle', null, jsonb_build_array(jsonb_build_object('task_id', :'t07', 'progress_to', 35))) as dr2 \gset
select tests.login('pm@a'); select api.decide((select approval_id from daily_reports where id = :'dr2'), 'reject', 'Progress overstated; recheck slab count');
select tests.as_system();
select tests.ok('W6 Progress', (select status = 'Returned' and review_note like 'Progress overstated%' from daily_reports where id = :'dr2'), 'returned report keeps the reviewer comment');

-- ===== W7 · certify contractor work (contract → measurement → running bill → certification) =====
select tests.login('qs@a');
select api.create_contract(jsonb_build_object('project_id', :'pid', 'vendor_id', :'v_civil', 'code', '03', 'title', 'RCC frame works — villas',
  'retention_pct', 5, 'advance_amount', 200000, 'advance_recovery_pct', 10, 'tds_pct', 2, 'gst_pct', 18, 'start_date', current_date - 60, 'end_date', current_date + 120,
  'items', jsonb_build_array(jsonb_build_object('boq_item_id', :'boq1', 'description', 'RCC M30 labour & formwork', 'uom', 'cum', 'qty', 100, 'rate', 9000),
                             jsonb_build_object('description', 'Shuttering & staging', 'uom', 'sqm', 'qty', 500, 'rate', 700)))) as wo1 \gset
select tests.as_system();
select tests.ok('W7 Contractor', (select string_agg(role_id, '>' order by seq) = 'pm>pd' from approval_steps where approval_id = (select approval_id from contracts where id = :'wo1')), 'contract ₹14.75 L incl. GST routes PM → PD');
select tests.login('pm@a'); select api.decide((select approval_id from contracts where id = :'wo1'), 'approve', 'ok');
select tests.login('pd@a'); select api.decide((select approval_id from contracts where id = :'wo1'), 'approve', 'ok');
select tests.as_system();
select tests.throws('W7 Contractor', format($$insert into contract_items (contract_id, description, uom, qty, rate) values (%L,'extra','nos',1,1)$$, :'wo1'), 'frozen', 'approved contract items cannot be edited; variations only');
select id as ci1 from contract_items where contract_id = :'wo1' and description like 'RCC%' \gset
select tests.login('fin@a'); select api.record_payment('advance', :'wo1', 200000, 0, current_date - 50, 'UTR-ADV-1');
select tests.login('sup@a');
select api.record_measurement(:'ci1', 40, current_date - 10, null, 'Villa slabs V1') as m1 \gset
select tests.throws('W7 Contractor', format($$select api.record_measurement(%L, 70, current_date)$$, :'ci1'), 'exceed the contract quantity', 'measurement beyond contract quantity needs a variation');
select tests.throws('W7 Contractor', format($$select api.verify_measurement(%L, true)$$, :'m1'), 'permission denied|cannot verify', 'supervisor cannot verify own measurement');
select tests.login('pm@a'); select api.verify_measurement(:'m1', true);
select tests.login('pd@a'); select api.create_ra_bill(:'wo1', 0) as ra1 \gset
select tests.as_system();
select tests.ok('W7 Contractor', (select gross = 360000 and gst = 64800 and retention = 18000 and advance_recovery = 36000 and tds = 7200 and net_payable = 363600 from ra_bills where id = :'ra1'),
  'RA bill 1: gross 3,60,000 + GST 64,800 − retention 18,000 − advance 36,000 − TDS 7,200 = net 3,63,600',
  (select format('gross %s gst %s ret %s adv %s tds %s net %s', gross, gst, retention, advance_recovery, tds, net_payable) from ra_bills where id = :'ra1'));
select tests.ok('W7 Contractor', (select string_agg(role_id, '>' order by seq) = 'pm>qs>finance' from approval_steps where approval_id = (select approval_id from ra_bills where id = :'ra1')), 'certification chain: engineer → QS → finance');
select tests.login('pm@a'); select api.decide((select approval_id from ra_bills where id = :'ra1'), 'approve', 'Work certified');
select tests.login('qs@a'); select api.decide((select approval_id from ra_bills where id = :'ra1'), 'approve', 'Quantities verified');

-- ===== W8b · approve the contractor bill and pay it =====
select tests.login('fin@a');
select tests.throws('W8 Invoice', format($$select api.record_payment('ra_bill', %L, 363600, 7200, current_date, 'UTR-RA-1')$$, :'ra1'), 'only approved bills', 'no payment before finance approval');
select api.decide((select approval_id from ra_bills where id = :'ra1'), 'approve', 'Finance review done');
select tests.throws('W8 Invoice', format($$select api.record_payment('ra_bill', %L, 363600, 9000, current_date, 'UTR-RA-1')$$, :'ra1'), 'TDS exceeds', 'TDS cannot exceed the bill deduction');
select api.record_payment('ra_bill', :'ra1', 363600, 7200, current_date, 'UTR-RA-1');
select tests.as_system();
select tests.ok('W8 Invoice', (select status = 'Paid' from ra_bills where id = :'ra1'), 'contractor bill approved and paid');
select tests.login('sup@a'); select api.record_measurement(:'ci1', 30, current_date - 3) as m2 \gset
select tests.login('pm@a'); select api.verify_measurement(:'m2', true);
select tests.login('pd@a'); select api.create_ra_bill(:'wo1', 0) as ra2 \gset
select tests.as_system();
select tests.ok('W7 Contractor', (select prev_qty = 40 and this_qty = 30 and cum_qty = 70 from ra_bill_lines where bill_id = :'ra2'), 'RA bill 2 carries previous quantity 40 + this 30 = 70');
select tests.ok('W7 Contractor', (select advance_recovery = 27000 from ra_bills where id = :'ra2'), 'advance recovery continues on bill 2 (10% of 2,70,000)');
select tests.ok('W7 Contractor', (select executed_qty = 82.5 from boq_items where id = :'boq1'), 'verified measurements update BOQ executed quantity');

-- ===== W9 · project financial report =====
select tests.login('fin@a');
create temp table cp as select * from api.cost_position(:'pid');
select tests.as_system();
select tests.ok('W9 Financial report', (select committed = 826000 + 1475000 from cp where code = '03'), 'committed = PO 8,26,000 + contract 14,75,000', (select committed::text from cp where code = '03'));
select tests.ok('W9 Financial report', (select actual = 826000 + 424800 from cp where code = '03'), 'actual = accepted goods 8,26,000 + approved bill 4,24,800', (select actual::text from cp where code = '03'));
select tests.ok('W9 Financial report', (select paid_against_cost = 495600 + 370800 + 36000 from cp where code = '03'), 'paid = invoice 4,95,600 + bill 3,70,800 (cash + TDS) + advance recovered 36,000', (select paid_against_cost::text from cp where code = '03'));
select tests.ok('W9 Financial report', (select retention_held = 18000 and accrued_unpaid = 330400 from cp where code = '03'), 'retention 18,000 held; accrued unpaid 3,30,400 = 4 MT received, not yet invoiced', (select accrued_unpaid::text from cp where code = '03'));
select tests.ok('W9 Financial report', (select bool_and(actual = paid_against_cost + accrued_unpaid + retention_held) from cp), 'no double counting: actual = paid + accrued + retention on every code');
select tests.ok('W9 Financial report', (select bool_and(forecast = committed + uncommitted_forecast and actual <= committed) from cp), 'forecast = committed + estimate; actual never exceeds committed');
select tests.ok('W9 Financial report', (select approved_changes = 1000000 from cp where code = '11') and (select approved_changes = -1000000 from cp where code = '13'), 'original budget and approved changes reported separately');
select tests.login('fin@a');
select tests.ok('W9 Financial report', (select available is not null from api.contingency(:'pid')), 'available contingency reported', (select format('budget %s overruns %s available %s', contingency_budget, overruns, available) from api.contingency(:'pid')));
select tests.ok('W9 Financial report', (select sum(due) = 0 and sum(forecast) > 0 from api.cash_requirement(:'pid')), 'cash requirement separates obligations due from forecast outflows', (select string_agg(bucket || ' due ' || due || ' fc ' || round(forecast), '; ') from api.cash_requirement(:'pid')));
select tests.login('pm@a'); select api.decide((select approval_id from ra_bills where id = :'ra2'), 'approve', 'x');
select tests.login('qs@a'); select api.decide((select approval_id from ra_bills where id = :'ra2'), 'approve', 'x');
select tests.login('fin@a'); select api.decide((select approval_id from ra_bills where id = :'ra2'), 'approve', 'x');
select tests.ok('W9 Financial report', (select due > 0 from api.cash_requirement(:'pid') where bucket like '0%'), 'approved unpaid bill appears as cash due in 0–30 days');
select tests.login('qs@a');
select tests.throws('W9 Financial report', format($$select api.request_budget_revision(%L, '[{"code":"03","delta":-%s}]', 'cut superstructure below commitments')$$, :'pid', 46000000), 'cannot fall below committed', 'budget cannot be cut below commitments');

-- ===== W10 · villa inspection =====
select tests.as_system();
select id as v1 from units where project_id = :'pid' and code = 'V-01' \gset
select id as v2 from units where project_id = :'pid' and code = 'V-02' \gset
select tests.login('sup@a');
select api.request_inspection(:'v1', 'Stage', 'foundation') as in1 \gset
select tests.throws('W10 Inspection', format($$select api.request_inspection(%L, 'Stage', 'foundation')$$, :'v1'), 'already requested', 'duplicate inspection request blocked');
select tests.throws('W10 Inspection', format($$select api.decide_inspection(%L, true, 'self check')$$, :'in1'), 'permission denied', 'supervisor cannot pass own work');
select tests.login('qe@a'); select api.decide_inspection(:'in1', true, 'Footings as per drawing R1');
select tests.as_system();
select tests.ok('W10 Inspection', (select status = 'Passed' and passed_inspection_id = :'in1' from unit_stages where unit_id = :'v1' and stage_key = 'foundation'), 'passed inspection marks the stage verified');
select tests.throws('W10 Inspection', format($$update unit_stages set status = 'Passed' where unit_id = %L and stage_key = 'roofing'$$, :'v1'), 'check constraint', 'a stage cannot be marked passed without an inspection');

-- ===== W11 · defect creation and resolution =====
select tests.login('sup@a'); select api.request_inspection(:'v1', 'Stage', 'structure') as in2 \gset
select tests.login('qe@a');
select api.decide_inspection(:'in2', false, 'Guardrail missing at balcony; honeycombing at column C2',
  '[{"title":"Balcony guardrail missing","severity":"Safety-critical","category":"Safety"},{"title":"Honeycombing at column C2","severity":"Major"}]');
select tests.as_system();
select id as sn_safe from snags where unit_id = :'v1' and severity = 'Safety-critical' \gset
select id as sn_major from snags where unit_id = :'v1' and severity = 'Major' \gset
select tests.ok('W11 Defects', (select app.unit_readiness(:'v1') ->> 'status' = 'Blocked'), 'open safety-critical defect blocks the unit');
select tests.ok('W11 Defects', exists (select 1 from automation_events where event = 'safety_defect' and payload ->> 'snag' = :'sn_safe'), 'safety-critical defect raises an event');
select tests.login('pm@a');
select tests.throws('W11 Defects', format($$select api.close_snag(%L)$$, :'sn_safe'), 'only a fixed snag', 'cannot close before it is fixed');
select api.mark_snag_fixed(:'sn_safe'); select api.mark_snag_fixed(:'sn_major');
select tests.throws('W11 Defects', format($$select api.close_snag(%L)$$, :'sn_safe'), 'safety-critical', 'PM cannot close a safety-critical defect');
select api.close_snag(:'sn_major');
select tests.login('qe@a'); select api.close_snag(:'sn_safe');
select tests.as_system();
select tests.ok('W11 Defects', (select count(*) = 0 from snags where unit_id = :'v1' and status <> 'Closed'), 'both defects closed by authorised people');

-- ===== W12 · unit readiness and final property handover =====
select tests.login('pm@a');
select api.add_ffe_item(:'v2', 'King bed with mattress', 'Furniture', 1) as f1 \gset
select api.add_ffe_item(:'v2', 'Smart room controller', 'Electronics', 1) as f2 \gset
select tests.throws('W12 Handover', format($$select api.set_ffe_status(%L, 'Installed')$$, :'f1'), 'one step at a time', 'FF&E cannot jump from specified to installed');
select tests.as_system();
do $$ declare s text; u uuid := (select id from units where code = 'V-02'); i text; f uuid; begin
  for s in select stage_key from unit_stages where unit_id = u order by seq loop
    perform tests.login('sup@a'); i := api.request_inspection(u, 'Stage', s);
    perform tests.login('qe@a'); perform api.decide_inspection(i, true, 'ok');
  end loop;
  perform tests.login('sup@a'); i := api.request_inspection(u, 'Commissioning', null, 'Electrical'); perform tests.login('qe@a'); perform api.decide_inspection(i, true, 'IR test ok');
  perform tests.login('pm@a');
  for f in select id from ffe_items where unit_id = u loop
    perform api.set_ffe_status(f, 'Ordered'); perform api.set_ffe_status(f, 'Delivered'); perform api.set_ffe_status(f, 'Installed');
  end loop;
  perform tests.as_system();
end $$;
select tests.login('sup@a'); select api.request_inspection(:'v2', 'Final') as fin_early \gset
select tests.login('qe@a');
select tests.throws('W12 Handover', format($$select api.decide_inspection(%L, true, 'final')$$, :'fin_early'), 'cannot pass: .*commissioning 1/2', 'final inspection refused while HVAC commissioning is pending');
select tests.login('pd@a');
select tests.throws('W12 Handover', format($$select api.hand_over_unit(%L)$$, :'v2'), 'cannot be handed over', 'unit with civil works done but gates open cannot be handed over');
select tests.login('sup@a'); select api.request_inspection(:'v2', 'Commissioning', null, 'HVAC') as hv \gset
select tests.login('qe@a'); select api.decide_inspection(:'hv', true, 'Airflow and refrigerant ok'); select api.decide_inspection(:'fin_early', true, 'Final walkthrough clean');
select tests.ok('W12 Handover', (select readiness ->> 'status' = 'Ready' from api.unit_readiness(:'pid') where code = 'V-02'), 'readiness API (quality role) reports V-02 Ready');
select tests.as_system();
select tests.ok('W12 Handover', (select app.unit_readiness(:'v2') ->> 'status' = 'Ready'), 'unit Ready only after stages, defects, FF&E, commissioning and final inspection pass');
select tests.login('pd@a'); select api.hand_over_unit(:'v2');
select tests.throws('W12 Handover', format($$select api.final_property_handover(%L)$$, :'pid'), '1 unit.*11 checklist', 'property handover blocked while a unit and checklist items are open');
select tests.as_system();
do $$ declare s text; u uuid := (select id from units where code = 'V-01'); i text; sys text; begin
  for s in select stage_key from unit_stages where unit_id = u and status <> 'Passed' order by seq loop
    perform tests.login('sup@a'); i := api.request_inspection(u, 'Stage', s); perform tests.login('qe@a'); perform api.decide_inspection(i, true, 'ok');
  end loop;
  for sys in select system from unit_commissioning where unit_id = u loop
    perform tests.login('sup@a'); i := api.request_inspection(u, 'Commissioning', null, sys); perform tests.login('qe@a'); perform api.decide_inspection(i, true, 'ok');
  end loop;
  perform tests.login('sup@a'); i := api.request_inspection(u, 'Final'); perform tests.login('qe@a'); perform api.decide_inspection(i, true, 'ok');
  perform tests.login('pd@a'); perform api.hand_over_unit(u);
  perform tests.as_system();
end $$;
select tests.login('pd@a');
select api.register_document(:'pid', 'Handover evidence pack', 'Handover', '10 Handover & warranties') as hdoc \gset
select tests.throws('W12 Handover', format($$select api.add_document_version(%L, 'R0', 'other-project/x.exe', 'x.exe', 'application/x-msdownload', 1000, null, false)$$, :'hdoc'), 'not allowed', 'disallowed file type rejected');
select tests.throws('W12 Handover', format($$select api.add_document_version(%L, 'R0', %L, 'pack.pdf', 'application/pdf', 99999999999, null, false)$$, :'hdoc', :'pid' || '/handover/pack.pdf'), 'larger than', 'oversized file rejected');
select api.add_document_version(:'hdoc', 'R0', :'pid' || '/handover/pack.pdf', 'pack.pdf', 'application/pdf', 2400000, 'Signed pack', false);
select tests.as_system();
do $$ declare k text; p text := (select id from projects where name = 'Kovalam Boutique Hotel'); d text := (select id from documents where title = 'Handover evidence pack'); begin
  perform tests.login('qe@a');
  for k in select item_key from handover_items where project_id = p loop perform api.complete_handover_item(p, k, 'Done', d); end loop;
  perform tests.as_system();
end $$;
select tests.login('pd@a'); select api.final_property_handover(:'pid');
select tests.as_system();
select tests.ok('W12 Handover', (select stage = 'Handed over' and handed_over_at is not null from projects where id = :'pid'), 'final property handover recorded');

-- ===== S · security, integrity, audit, automation =====
select tests.login('md@b');
select tests.ok('S Security', (select count(*) = 0 from projects), 'another organisation sees no projects');
select tests.throws('S Security', format($$select * from api.cost_position(%L)$$, :'pid'), 'no access', 'another organisation cannot read the cost report');
select tests.login('pm2@a');
select tests.ok('S Security', (select count(*) = 0 from projects where id = :'pid'), 'PM without membership cannot see the project');
select tests.login('sup@a');
select tests.ok('S Security', (select count(*) = 0 from budget_versions), 'site supervisor cannot read budgets');
select tests.throws('S Security', format($$insert into purchase_orders (id, org_id, project_id, code, vendor_id, item, uom, qty, rate, gst_pct) values ('PO-X', '00000000-0000-0000-0000-00000000000a', %L, '03', %L, 'x', 'nos', 1, 1, 18)$$, :'pid', :'v_steel'), 'permission denied', 'direct insert into purchase orders is refused');
select tests.throws('S Security', format($$update tasks set progress = 100 where project_id = %L$$, :'pid'), 'permission denied', 'direct update of tasks is refused');
select tests.throws('S Security', $$select app.log(null, 'forged', 'forged entry')$$, 'permission denied', 'clients cannot write forged audit entries');
select tests.login('admin@a');
select tests.throws('S Security', format($$select api.decide((select approval_id from purchase_orders where id = %L), 'approve', 'admin')$$, :'po2'), 'needs pm', 'Super Admin holds no approval rights by default');
select tests.as_system();
select tests.throws('S Security', $$update audit_log set note = 'tampered' where id = (select min(id) from audit_log)$$, 'append-only', 'audit log cannot be edited, even by the database owner');
select tests.throws('S Security', $$delete from audit_log$$, 'append-only', 'audit log cannot be deleted');
select tests.ok('S Security', (select count(*) > 100 from audit_log), 'audit trail captured', (select count(*)::text from audit_log));
select tests.ok('S Security', exists (select 1 from audit_log where table_name = 'approval_steps' and action = 'update' and new_row ->> 'decided_by' is not null), 'every approval decision is in the audit trail with its reviewer');
select tests.ok('S Security', exists (select 1 from audit_log where table_name = 'inspections' and new_row ->> 'inspector_id' is not null and new_row ->> 'decided_at' is not null), 'completed inspections keep reviewer and timestamp');
select tests.ok('S Security', (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and not p.prosecdef), 'every api function is security definer with checks inside');

-- automation: scan twice (de-duplicated), process, retry with backoff. A second, late-running project gives the scan work to do.
select tests.login('pd@a');
select api.create_project(jsonb_build_object('name','Thekkady Glamping Test','property_type','Glamping property','location','Kumily','keys',10,'start_date',(current_date - 100)::text,'budget_total',46000000,'profile','glamp','pm_id',:'pm')) as pid2 \gset
select tests.as_system();
select api.scan_exceptions() as scan1 \gset
select api.scan_exceptions() as scan2 \gset
select tests.ok('S Automation', :scan1 > 0 and :scan2 = 0, 'repeat scans do not duplicate events', format('first %s, second %s', :scan1, :scan2));
select api.process_events(500) as processed \gset
select tests.ok('S Automation', :processed > 0 and (select count(*) = 0 from automation_events where status = 'queued'), 'queued events processed', :'processed');
select tests.ok('S Automation', exists (select 1 from notifications n join profiles p on p.user_id = n.user_id where p.role_id = 'quality' and n.channel = 'in_app' and n.text like 'Safety-critical defect%'), 'safety defect notified in-app to quality');
select tests.ok('S Automation', exists (select 1 from notifications where channel = 'whatsapp' and delivery = 'not_configured'), 'WhatsApp shown as not configured — never reported as sent');
select tests.ok('S Automation', exists (select 1 from risks where source = 'safety_defect'), 'safety defect created a risk record');
insert into automation_events (org_id, project_id, event, dedupe_key) values ('00000000-0000-0000-0000-00000000000a', 'MA-1999-999', 'budget_overrun', 'test:failing');
select api.process_events(10);
select tests.ok('S Automation', (select status = 'failed' and attempts = 1 and next_attempt_at > now() from automation_events where dedupe_key = 'test:failing'), 'failing event retried later with backoff');
update automation_events set next_attempt_at = now() where dedupe_key = 'test:failing'; select api.process_events(10);
update automation_events set next_attempt_at = now() where dedupe_key = 'test:failing'; select api.process_events(10);
update automation_events set next_attempt_at = now() where dedupe_key = 'test:failing'; select api.process_events(10);
update automation_events set next_attempt_at = now() where dedupe_key = 'test:failing'; select api.process_events(10);
select tests.ok('S Automation', (select status = 'dead' and attempts = 5 from automation_events where dedupe_key = 'test:failing'), 'after 5 attempts the event is parked as dead for review');
update automation_events set created_at = now() - interval '3 days' where event = 'approval_requested' and payload ->> 'approval_id' = (select approval_id from purchase_orders where id = :'po2');
select api.process_events(10);
select tests.ok('S Automation', exists (select 1 from notifications n join profiles p on p.user_id = n.user_id where p.role_id = 'md' and n.text like 'Escalation:%' || :'po2' || '%'), 'stale approval escalated to the MD once');
select tests.login('md@a');
select tests.ok('S Automation', api.mark_notifications_read() > 0, 'user can mark own notifications read');
select tests.as_system();

-- storage: private bucket, project-scoped read and upload, no overwrite or delete
select tests.ok('S Storage', (select not public and file_size_limit = 52428800 and 'application/pdf' = any (allowed_mime_types) and not ('text/html' = any (allowed_mime_types)) from storage.buckets where id = 'project-files'), 'bucket is private, capped at 50 MB, and accepts only listed file types');
select tests.login('pm@a');
insert into storage.objects (bucket_id, name) values ('project-files', :'pid' || '/drawings/DOC-T-1/R0/site-plan.pdf');
select tests.ok('S Storage', (select count(*) = 1 from storage.objects where name like :'pid' || '/drawings/%'), 'project member uploads a drawing into the project folder');
select tests.login('sup@a');
insert into storage.objects (bucket_id, name) values ('project-files', :'pid' || '/site/DR-T/photo-1.jpg');
select tests.ok('S Storage', (select count(*) = 1 from storage.objects where name like :'pid' || '/site/%'), 'site supervisor uploads a site photo');
select tests.throws('S Storage', format($$insert into storage.objects (bucket_id, name) values ('project-files', %L)$$, :'pid' || '/contracts/x.pdf'), 'row-level security', 'site supervisor cannot upload into the contracts folder');
select tests.login('pm2@a');
select tests.ok('S Storage', (select count(*) = 0 from storage.objects), 'PM without membership sees no files of that project');
select tests.throws('S Storage', format($$insert into storage.objects (bucket_id, name) values ('project-files', %L)$$, :'pid' || '/drawings/x.pdf'), 'row-level security', 'PM without membership cannot upload into it');
select tests.login('md@b');
select tests.ok('S Storage', (select count(*) = 0 from storage.objects), 'another organisation sees no files');
select tests.login('pm@a');
delete from storage.objects where name like :'pid' || '/drawings/%';
update storage.objects set name = name || '.old' where name like :'pid' || '/%';
select tests.as_system();
select tests.ok('S Storage', (select count(*) = 2 from storage.objects where name not like '%.old'), 'files cannot be deleted or overwritten by users');
