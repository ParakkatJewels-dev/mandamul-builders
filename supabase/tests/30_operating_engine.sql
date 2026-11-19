-- Phase 3 batch 2: the operating engine. Runs after 20_phase3.sql in the same database.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select id as p3 from projects where name = 'Phase 3 controls test' \gset
select (select id from auth.users where email = 'pm@a') pm, (select id from auth.users where email = 'sup@a') sup,
       (select id from vendors where name like 'Sahyadri%') v_steel, (select id from vendors where name like 'Western%') v_civil, (select id from vendors where name like 'Bluewave%') v_pool \gset
select tests.as_system();

-- ===== delay playbook =====
select count(*) as overdue from tasks where project_id = :'p3' and act_finish is null and base_finish < app.today('00000000-0000-0000-0000-00000000000a') \gset
select api.scan_exceptions() as s1 \gset
select api.process_events(500);
select tests.ok('B2 Operating engine', (select count(*) from automation_events where project_id = :'p3' and event = 'activity_overdue') = :overdue and :overdue > 0,
  'every overdue activity of the project produced one delay event', format('%s overdue', :overdue));
select tests.ok('B2 Operating engine', (select count(distinct step) = 8 from automation_actions a join automation_events e on e.id = a.event_id where e.project_id = :'p3' and a.playbook = 'delay'),
  'delay playbook ran all 8 steps: schedule, dependents, milestone impact, alert, PM, recovery plan, escalation, risk');
select count(*) as driven from automation_actions a join automation_events e on e.id = a.event_id
 where e.project_id = :'p3' and a.playbook = 'delay' and a.step = 1 and a.status = 'skipped' and a.result ? 'driven_by' \gset
select tests.ok('B2 Operating engine', (select count(*) from alerts where project_id = :'p3' and dedupe_key like 'delay:%') = :overdue - :driven
  and not exists (select 1 from alerts where project_id = :'p3' and dedupe_key like 'delay:%' and owner_id <> :'pm'),
  'one delay alert per activity that drives a delay, owned by the project manager', format('%s overdue, %s carried in from a late predecessor', :overdue, :driven));
select tests.ok('B9 Alert precision', :driven > 0 and not exists (
    select 1 from automation_actions a join automation_events e on e.id = a.event_id join tasks t on t.id = (e.payload ->> 'task_id')::uuid
     where e.project_id = :'p3' and a.playbook = 'delay' and a.step = 1 and a.result ? 'driven_by'
       and not exists (select 1 from task_dependencies d join tasks pr on pr.id = d.pred_id where d.task_id = t.id and pr.act_finish is null and pr.name = a.result ->> 'driven_by')),
  'a delay carried in from an open, late predecessor is not alerted again; the step names the predecessor that drives it');
select tests.ok('B9 Alert precision', not exists (
    select 1 from automation_actions a join automation_events e on e.id = a.event_id, jsonb_array_elements(a.result -> 'milestones') m
     where e.project_id = :'p3' and a.playbook = 'delay' and a.step = 3
       and not exists (select 1 from tasks x where x.project_id = :'p3' and x.name = m ->> 'milestone' and (x.id = (e.payload ->> 'task_id')::uuid or x.id in (select task_id from app.successors((e.payload ->> 'task_id')::uuid))))),
  'milestone impact counts only milestones that depend on the late activity');
select tests.ok('B2 Operating engine', exists (select 1 from alerts where project_id = :'p3' and dedupe_key like 'delay:%' and severity = 'Critical') and
  exists (select 1 from automation_actions where playbook = 'delay' and step = 3 and (result ->> 'max_milestone_slip_days')::int > 0), 'milestone impact calculated; slipping milestones raise the severity');
select count(*) as pm_notes from notifications where user_id = :'pm' and link = 'alerts' \gset
select tests.ok('B2 Operating engine', exists (select 1 from risks where dedupe_key like 'delay:%' and project_id = :'p3'), 'risk register updated from the delay');
select api.scan_exceptions() as s2 \gset
select api.process_events(500);
select tests.ok('B2 Operating engine', (select count(*) from automation_events where project_id = :'p3' and event = 'activity_overdue') = :overdue
  and (select count(*) from notifications where user_id = :'pm' and link = 'alerts') = :pm_notes, 'a second scan repeats nothing: no new events, no new notifications');
select task_id as t_first from app.schedule_forecast(:'p3') f join tasks t on t.id = f.task_id where not f.finished order by t.base_start, t.wbs limit 1 \gset
select tests.login('pm@a');
select tests.ok('B2 Operating engine', (select max(extra_slip_days) = 15 from api.simulate_delay(:'t_first', 15)), 'what-if: delaying the first open activity by 15 days moves the handover milestone by 15 days');
select api.submit_recovery_plan(:'t_first', 'Second crew from Monday; night shift for slab works', current_date + 20);
select tests.as_system();
select tests.ok('B2 Operating engine', (select status = 'Acknowledged' from alerts where dedupe_key = 'delay:' || :'t_first'), 'recovery plan acknowledges the delay alert');
-- escalation of an unacknowledged critical alert, once (the only critical delay is acknowledged above, so a test alert stands in)
select app.raise_alert('00000000-0000-0000-0000-00000000000a', :'p3', 'Safety', 'Critical', 'quality', 'TEST: unacknowledged critical alert', null, :'pm', 'pm', null, '[]', 'Make the area safe', 'test:escalation');
update alerts set created_at = now() - interval '5 hours' where project_id = :'p3' and severity = 'Critical' and status = 'Open';
select count(*) as md_before from notifications where user_id = (select id from auth.users where email = 'md@a') \gset
select api.scan_exceptions();
select tests.ok('B2 Operating engine', (select count(*) from alerts where project_id = :'p3' and severity = 'Critical' and status = 'Open' and escalated_at is null) = 0
  and (select count(*) from notifications where user_id = (select id from auth.users where email = 'md@a')) > :md_before, 'unacknowledged critical alerts escalate to the MD after 4 hours');
select count(*) as md_after from notifications where user_id = (select id from auth.users where email = 'md@a') \gset
select api.scan_exceptions();
select tests.ok('B2 Operating engine', (select count(*) from notifications where user_id = (select id from auth.users where email = 'md@a')) = :md_after, 'escalation happens once');
-- finishing the activity resolves its alert
select tests.login('pm@a');
select api.update_task(:'t_first', (select version from tasks where id = :'t_first'), 100, current_date - 10, current_date, 'Finished with second crew', null);
select tests.as_system(); select api.scan_exceptions();
select tests.ok('B2 Operating engine', (select status = 'Resolved' and resolution = 'Activity finished' from alerts where dedupe_key = 'delay:' || :'t_first'), 'finished activity resolves its delay alert');
select api.process_events(500);
select tests.ok('B9 Alert precision', exists (select 1 from alerts a join task_dependencies d on a.dedupe_key = 'delay:' || d.task_id join tasks x on x.id = d.task_id
    where d.pred_id = :'t_first' and x.act_finish is null and a.status = 'Open'),
  'when the driving activity finishes, its overdue successor is re-checked at once and carries the delay alert',
  (select string_agg(x.name, ', ') from task_dependencies d join tasks x on x.id = d.task_id where d.pred_id = :'t_first'));
-- configurable: tolerance and on/off
select tests.login('admin@a'); select api.set_automation_rule('activity_overdue', '{"params": {"min_days_late": 10000}}');
select tests.as_system();
select app.emit(:'p3', 'activity_overdue', 'test:tolerance', jsonb_build_object('task_id', (select id from tasks where project_id = :'p3' and act_finish is null and base_finish < current_date order by wbs desc limit 1))) as ev_tol \gset
select api.process_events(10);
select tests.ok('B2 Operating engine', (select status = 'skipped' from automation_actions where event_id = :ev_tol and step = 1) and not exists (select 1 from automation_actions where event_id = :ev_tol and step > 1),
  'tolerance is a rule parameter: within tolerance the playbook stops after step 1');
select tests.login('admin@a'); select api.set_automation_rule('activity_overdue', '{"enabled": false, "params": {"min_days_late": 2}}');
select tests.as_system();
select app.emit(:'p3', 'activity_overdue', 'test:disabled', jsonb_build_object('task_id', :'t_first')) as ev_off \gset
select api.process_events(10);
select tests.ok('B2 Operating engine', (select status = 'processed' from automation_events where id = :ev_off) and not exists (select 1 from automation_actions where event_id = :ev_off),
  'a disabled rule runs no playbook');
select tests.login('admin@a'); select api.set_automation_rule('activity_overdue', '{"enabled": true}'); select tests.as_system();

-- ===== material shortage playbook =====
select tests.login('proc@a'); select api.add_material('CEM-OPC53', 'OPC 53 grade cement', 'bag', 'Cement', '03', 5) as cem \gset
select tests.as_system(); select id as t_slab from tasks where project_id = :'p3' and act_finish is null order by base_start desc limit 1 \gset
select tests.login('sup@a'); select api.report_shortage(:'p3', :'cem', 200, current_date + 10, :'t_slab', 'Slab casting on Friday') as sh1 \gset
select tests.throws('B2 Operating engine', format($$select api.report_shortage(%L, %L, 50, current_date + 10)$$, :'p3', :'cem'), 'already reported', 'the same shortage cannot be reported twice');
select tests.as_system(); select api.process_events(50);
select tests.ok('B2 Operating engine', (select count(distinct step) = 7 from automation_actions a join automation_events e on e.id = a.event_id where e.payload ->> 'shortage' = :'sh1'),
  'shortage playbook ran all 7 steps: stock, orders, activities, quantity, request, routing, tracking');
select mr_id as sh_mr from material_shortages where id = :'sh1' \gset
select tests.ok('B2 Operating engine', (select qty = 200 and status = 'Submitted' and origin = 'automation' and material_id = :'cem' and requested_by = :'sup' from material_requests where id = :'sh_mr'),
  'material request raised for the full 200 bags (nothing in stock or on order), in the reporter''s name');
select tests.ok('B2 Operating engine', exists (select 1 from material_reservations where task_id = :'t_slab' and material_id = :'cem' and qty = 200 and status = 'Active'), 'incoming cement reserved for the slab');
select tests.ok('B2 Operating engine', exists (select 1 from alerts where dedupe_key = 'shortage:' || :'sh1' and owner_role = 'proc' and category = 'Material' and status = 'Open'), 'procurement alerted with the next action');
select tests.login('proc@a'); select api.add_quotation(:'sh_mr', :'v_steel', 400, 28, 4); select api.raise_po(:'sh_mr', :'v_steel', null, current_date + 6) as sh_po \gset
select tests.login('pm@a'); select api.decide((select approval_id from purchase_orders where id = :'sh_po'), 'approve', 'ok');
select tests.as_system(); select api.scan_exceptions();
select tests.ok('B2 Operating engine', (select status = 'Ordered' from material_shortages where id = :'sh1') and (select next_action like 'Track delivery of ' || :'sh_po' || '%' from alerts where dedupe_key = 'shortage:' || :'sh1'),
  'shortage tracked to the approved order');
select tests.login('sup@a'); select api.record_grn(:'sh_po', 120, 'Pass');
select tests.as_system();
select tests.ok('B2 Operating engine', app.stock_on_hand(:'p3', :'cem') = 120, 'accepted cement entered site stock without a second entry');
select api.scan_exceptions();
select tests.ok('B2 Operating engine', (select status = 'Ordered' from material_shortages where id = :'sh1'), 'part delivery keeps the shortage open');
select tests.login('sup@a'); select api.record_grn(:'sh_po', 80, 'Pass');
select tests.as_system(); select api.scan_exceptions();
select tests.ok('B2 Operating engine', (select status = 'Delivered' from material_shortages where id = :'sh1') and (select status = 'Resolved' from alerts where dedupe_key = 'shortage:' || :'sh1'),
  'full delivery closes the shortage and resolves its alert');
select tests.login('sup@a'); select api.report_shortage(:'p3', :'cem', 150, current_date + 3, :'t_slab') as sh2 \gset
select tests.as_system();
select api.process_events(50);
select tests.ok('B2 Operating engine', (select status = 'Covered' and (assessment ->> 'to_buy')::numeric = 0 from material_shortages where id = :'sh2'), 'a shortage covered by stock reserved for the same activity buys nothing');
select tests.login('proc@a');
select tests.throws('B2 Operating engine', format($$select api.issue_stock(%L, %L, 500, %L)$$, :'p3', :'cem', :'t_slab'), 'only 200', 'cannot issue more than is in stock');
select api.issue_stock(:'p3', :'cem', 200, :'t_slab', 'Slab C1');
select tests.as_system();
select tests.ok('B2 Operating engine', app.stock_on_hand(:'p3', :'cem') = 0 and (select status = 'Issued' from material_reservations where task_id = :'t_slab' and material_id = :'cem' order by created_at limit 1), 'issue to the activity empties stock and fulfils the reservation');

-- ===== contractor claim playbook =====
select tests.login('qs@a');
select api.create_contract(jsonb_build_object('project_id', :'p3', 'vendor_id', :'v_civil', 'code', '05', 'title', 'Roof waterproofing — cottages', 'retention_pct', 5, 'advance_amount', 0,
  'advance_recovery_pct', 0, 'tds_pct', 2, 'gst_pct', 18, 'start_date', current_date - 20, 'end_date', current_date + 60,
  'items', jsonb_build_array(jsonb_build_object('description', 'Membrane waterproofing', 'uom', 'sqm', 'qty', 100, 'rate', 900)))) as wo5 \gset
select tests.login('pm@a'); select api.decide((select approval_id from contracts where id = :'wo5'), 'approve', 'ok');
select tests.as_system(); select id as ci5 from contract_items where contract_id = :'wo5' \gset
insert into auth.users (email) values ('vend@a'), ('vend2@a');
insert into profiles (user_id, org_id, full_name, email, role_id, all_projects, vendor_id)
select id, '00000000-0000-0000-0000-00000000000a', split_part(email, '@', 1), email, 'vendor', false, case when email = 'vend@a' then :'v_civil'::uuid else :'v_pool'::uuid end from auth.users where email in ('vend@a','vend2@a');
insert into project_members (project_id, user_id, responsibility) select :'p3', id, 'Contractor' from auth.users where email in ('vend@a','vend2@a');
select tests.login('sup@a'); select api.record_measurement(:'ci5', 40, current_date - 2, null, 'Roofs C-01') as m5 \gset
select tests.login('pm@a'); select api.verify_measurement(:'m5', true);
select tests.login('vend2@a');
select tests.throws('B2 Operating engine', format($$select api.submit_claim(%L, jsonb_build_array(jsonb_build_object('contract_item_id', %L, 'qty', 40, 'rate', 900)))$$, :'wo5', :'ci5'), 'own contracts', 'a contractor cannot claim on another contractor''s work order');
select tests.login('vend@a'); select api.submit_claim(:'wo5', jsonb_build_array(jsonb_build_object('contract_item_id', :'ci5', 'qty', 40, 'rate', 900)), 'RA 1') as cl1 \gset
select tests.as_system(); select api.process_events(50);
select tests.ok('B2 Operating engine', (select status = 'Billed' and ra_bill_id is not null from contractor_claims where id = :'cl1'), 'a claim that matches verified measurements becomes a running bill');
select ra_bill_id as cl1_bill from contractor_claims where id = :'cl1' \gset
select tests.ok('B2 Operating engine', (select gross = 36000 and gst = 6480 and retention = 1800 and tds = 720 and net_payable = 39960 from ra_bills where id = :'cl1_bill')
  and (select (assessment ->> 'net')::numeric = 39960 from contractor_claims where id = :'cl1'), 'claim assessment and the bill agree: 36,000 + 6,480 − 1,800 − 720 = 39,960');
select tests.ok('B2 Operating engine', (select requested_by = (select id from auth.users where email = 'vend@a') from approvals where id = (select approval_id from ra_bills where id = :'cl1_bill'))
  and (select string_agg(role_id, '>' order by seq) = 'pm>qs>finance' from approval_steps where approval_id = (select approval_id from ra_bills where id = :'cl1_bill')), 'bill routed engineer → QS → finance in the contractor''s name');
select tests.login('vend@a');
select tests.throws('B2 Operating engine', format($$select api.submit_claim(%L, jsonb_build_array(jsonb_build_object('contract_item_id', %L, 'qty', 5, 'rate', 900)))$$, :'wo5', :'ci5'), 'still in certification', 'a second claim is refused while the first bill is in certification');
select tests.login('pm@a'); select api.decide((select approval_id from ra_bills where id = :'cl1_bill'), 'approve', 'certified');
select tests.login('qs@a'); select api.decide((select approval_id from ra_bills where id = :'cl1_bill'), 'approve', 'verified');
select tests.login('fin@a'); select api.decide((select approval_id from ra_bills where id = :'cl1_bill'), 'approve', 'ok');
select tests.as_system();
select tests.ok('B2 Operating engine', (select status = 'Ready' and amount = 39960 from payment_requests where ref = :'cl1_bill'), 'certified bill becomes a payment request for finance (not a payment)');
select tests.login('sup@a'); select api.record_measurement(:'ci5', 20, current_date - 1, null, 'Roofs C-01 balance') as m6 \gset
select tests.login('pm@a'); select api.verify_measurement(:'m6', true);
select tests.login('vend@a'); select api.submit_claim(:'wo5', jsonb_build_array(jsonb_build_object('contract_item_id', :'ci5', 'qty', 30, 'rate', 950), jsonb_build_object('description', 'Extra parapet coping', 'qty', 10, 'rate', 500)), 'RA 2') as cl2 \gset
select tests.as_system(); select api.process_events(50);
select tests.ok('B2 Operating engine', (select status = 'Discrepancies' and jsonb_array_length(assessment -> 'discrepancies') = 3 and (assessment ->> 'gross')::numeric = 18000 from contractor_claims where id = :'cl2'),
  'over-claimed quantity, wrong rate and an item outside the contract are flagged; assessable gross is 20 × 900 = 18,000');
select tests.ok('B2 Operating engine', exists (select 1 from alerts where dedupe_key = 'claim:' || :'cl2' and owner_role = 'qs') and not exists (select 1 from ra_bills where contract_id = :'wo5' and bill_no = 2),
  'no bill is created while discrepancies are open; the QS is alerted');
select tests.login('qs@a'); select api.decide_claim(:'cl2', 'bill_assessed', 'Bill verified 20 sqm at contract rate; coping needs a variation') as cl2_bill \gset
select tests.as_system();
select tests.ok('B2 Operating engine', (select gross = 18000 from ra_bills where id = :'cl2_bill') and (select status = 'Billed' from contractor_claims where id = :'cl2'), 'QS bills only the assessed, verified quantity');
select tests.login('fin2@a'); select api.record_payment('ra_bill', :'cl1_bill', 39960, 720, current_date, 'UTR-CL1');
select tests.as_system();
select tests.ok('B2 Operating engine', (select status = 'Paid' from payment_requests where ref = :'cl1_bill'), 'payment request closes when finance records the payment');

-- ===== unit completion playbook =====
select id as u1 from units where project_id = :'p3' and code = 'C-01' \gset
select format('select tests.login(''sup@a''); select api.request_inspection(%L, ''Stage'', %L); select tests.login(''qe@a''); select api.decide_inspection((select id from inspections where unit_id = %L and stage_key = %L and status = ''Requested''), true, ''OK'');',
  :'u1', stage_key, :'u1', stage_key) from unit_stages where unit_id = :'u1' and status <> 'Passed' order by seq \gexec
select tests.as_system(); select api.process_events(50);
select tests.ok('B2 Operating engine', exists (select 1 from automation_events where event = 'unit_works_complete' and payload ->> 'unit' = :'u1'), 'the last stage inspection started the completion check');
select tests.ok('B2 Operating engine', (select severity = 'Medium' and status = 'Open' from alerts where dedupe_key = 'handover:' || :'u1') and not exists (select 1 from inspections where unit_id = :'u1' and kind = 'Final'),
  'open defect and pending commissioning block handover: alert raised, no final inspection requested');
select tests.login('pm@a'); select api.mark_snag_fixed(sn.id) from snags sn where sn.unit_id = :'u1' and sn.status = 'Open';
select tests.login('qe@a'); select api.close_snag(sn.id) from snags sn where sn.unit_id = :'u1' and sn.status = 'Fixed';
select tests.login('sup@a'); select api.request_inspection(:'u1', 'Commissioning', null, 'Electrical') as ci_comm \gset
select tests.login('qe@a'); select api.decide_inspection(:'ci_comm', true, 'Megger and ELCB tests passed');
select tests.as_system(); select api.scan_exceptions(); select api.process_events(50);
select tests.ok('B2 Operating engine', (select count(*) = 1 from inspections where unit_id = :'u1' and kind = 'Final' and status = 'Requested' and requested_by = :'pm'),
  'when the last blocker clears, the handover inspection is requested automatically');
select tests.ok('B2 Operating engine', (select status = 'Resolved' from alerts where dedupe_key = 'handover:' || :'u1') and exists (select 1 from alerts where dedupe_key = 'final:' || :'u1' and owner_role = 'quality' and status = 'Open'),
  'blocker alert resolved; quality alerted to inspect');
select e.* from automation_events e where e.event = 'unit_works_complete' and e.payload ->> 'unit' = :'u1' order by id desc limit 1 \gset ev_
select app.run_playbook(e, 'unit_completion') from automation_events e where e.id = :ev_id;
select tests.ok('B2 Operating engine', (select count(*) = 1 from inspections where unit_id = :'u1' and kind = 'Final'), 'running the playbook again does not request a second inspection');
select tests.ok('B2 Operating engine', (select app.unit_readiness(:'u1') ->> 'status') <> 'Ready', 'readiness is not Ready until the inspector passes the final inspection');
select tests.login('qe@a'); select api.decide_inspection((select id from inspections where unit_id = :'u1' and kind = 'Final'), true, 'Final walk-through clear');
select tests.as_system(); select api.scan_exceptions();
select tests.ok('B2 Operating engine', (select app.unit_readiness(:'u1') ->> 'status') = 'Ready' and (select status = 'Resolved' from alerts where dedupe_key = 'final:' || :'u1'), 'after the pass the unit is Ready and the alert closes');

-- ===== engine guarantees =====
select app.run_playbook(e, 'shortage') from automation_events e where e.event = 'material_shortage' and e.payload ->> 'shortage' = :'sh1';
select app.run_playbook(e, 'claim') from automation_events e where e.event = 'contractor_claim' and e.payload ->> 'claim' = :'cl1';
select tests.ok('B2 Operating engine', (select count(*) = 1 from material_requests where duplicate_note like '%' || :'sh1') and (select count(*) = 2 from ra_bills where contract_id = :'wo5'),
  'replaying playbooks creates no second request and no second bill (idempotency keys)');
select app.emit(:'p3', 'material_shortage', 'test:broken', '{"shortage": "SH-DOES-NOT-EXIST"}') as ev_bad \gset
select api.process_events(10);
select tests.ok('B2 Operating engine', (select status = 'failed' and attempts = 1 and last_error is not null and next_attempt_at > now() from automation_events where id = :ev_bad)
  and not exists (select 1 from automation_actions where event_id = :ev_bad), 'a failing playbook leaves no half-done steps and is retried later');
update automation_events set status = 'dead', attempts = 5 where id = :ev_bad;
select tests.login('admin@a'); select tests.ok('B2 Operating engine', api.replay_event(:ev_bad) = 'queued', 'an administrator can replay a dead event after fixing the cause');
select tests.login('pm@a');
select tests.throws('B2 Operating engine', format($$select api.replay_event(%s)$$, :ev_bad), 'permission denied', 'others cannot replay events');
select tests.ok('B2 Operating engine', (select count(*) = 0 from automation_actions), 'automation trace is visible to administrators only');
select tests.ok('B2 Operating engine', (select count(*) > 0 from alerts where project_id = :'p3'), 'the project manager sees the project''s alerts');
select tests.login('md@b');
select tests.ok('B2 Operating engine', (select count(*) = 0 from alerts), 'another organisation sees no alerts');
select tests.as_system();
select tests.ok('B2 Operating engine', not exists (select 1 from automation_actions a where not exists (select 1 from automation_events e where e.id = a.event_id)), 'every automated step traces back to its event');
