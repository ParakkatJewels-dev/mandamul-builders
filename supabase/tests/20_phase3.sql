-- M Andamul Development OS · Phase 3 tests. Runs after 10_workflows.sql in the same database (reuses its fixtures and tests schema).
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select (select id from auth.users where email = 'pm@a') pm, (select id from auth.users where email = 'sup@a') sup, (select id from auth.users where email = 'admin@a') admin,
       (select id from vendors where name like 'Sahyadri%') v_steel, (select id from vendors where name like 'Western%') v_civil, (select id from vendors where name like 'Bluewave%') v_pool \gset

-- a fresh project for the controls tests
select tests.login('pd@a');
select api.create_project(jsonb_build_object('name','Phase 3 controls test','property_type','Luxury resort','location','Munnar, Idukki, Kerala','keys',2,'built_up_sqft',30000,
  'start_date',(current_date - 120)::text,'pm_id',:'pm','budget_total',120000000,'profile','resort',
  'members', jsonb_build_array(jsonb_build_object('user_id',:'sup','responsibility','Site supervisor')),
  'units', jsonb_build_array(jsonb_build_object('code','C-01','name','Cottage 1','unit_type','Cottage','template_id','villa','budget',8000000,'systems',jsonb_build_array('Electrical'))))) as p3 \gset
select tests.login('fin@a'); select api.decide((select id from approvals where project_id = :'p3' and kind = 'BUDGET'), 'approve', 'ok');
select tests.login('md@a'); select api.decide((select id from approvals where project_id = :'p3' and kind = 'BUDGET'), 'approve', 'ok');

-- ===== B01 multi-factor level =====
select tests.login('sup@a'); select api.raise_mr(:'p3', '06', 'Copper cable 4 sq mm', 2000, 'm', current_date + 20) as mra \gset
select tests.login('proc@a'); select api.add_quotation(:'mra', :'v_steel', 95, 18, 7); select api.raise_po(:'mra', :'v_steel') as poa \gset
select tests.login_password_only('pm@a');
select tests.throws('B1 Critical fixes', format($$select api.decide(%L, 'approve', 'ok')$$, (select approval_id from purchase_orders where id = :'poa')), 'multi-factor', 'PO approval refused on a password-only session');
select tests.login('pm@a');
select tests.ok('B1 Critical fixes', api.decide((select approval_id from purchase_orders where id = :'poa'), 'approve', 'ok') = 'approved', 'same approval accepted after the MFA step');
select tests.login_password_only('fin@a');
select tests.throws('B1 Critical fixes', $$select api.set_org_settings('{"warn_pct":85}', 1)$$, 'permission denied|multi-factor', 'settings change refused without MFA');
select tests.login_password_only('pm@a');
select tests.ok('B1 Critical fixes', (select count(*) > 0 from api.cost_position(:'p3')), 'reading the cost report needs no MFA step');

-- ===== B02 one permission matrix =====
select tests.as_system();
select tests.ok('B1 Critical fixes', (select count(*) = 277 from permission_defaults), 'canonical matrix holds 277 grants (same as the app)');
select tests.ok('B1 Critical fixes', not exists (select role_id, module, action from permission_defaults except select role_id, module, action from role_permissions where org_id = '00000000-0000-0000-0000-00000000000a'),
  'every default grant present in the organisation');
select tests.ok('B1 Critical fixes', exists (select 1 from role_permissions where org_id = '00000000-0000-0000-0000-00000000000a' and role_id = 'civil' and module = 'site' and action = 'create'), 'civil engineer can now record site reports in the database too');

-- ===== B03/B04 cancel, short-close and commitments =====
select tests.login('sup@a'); select api.raise_mr(:'p3', '08', 'Vitrified tiles 600x600', 400, 'sqm', current_date + 25) as mrb \gset
select tests.login('proc@a'); select api.add_quotation(:'mrb', :'v_steel', 900, 18, 10); select api.raise_po(:'mrb', :'v_steel') as pob \gset
select tests.as_system();
select (select pending from app.code_commitments(:'p3', '08')) pend_before \gset
select tests.login('sup@a');
select tests.throws('B1 Critical fixes', format($$select api.cancel_po(%L, 'not needed')$$, :'pob'), 'permission denied', 'site supervisor cannot cancel an order');
select tests.login('pm@a');
select tests.throws('B1 Critical fixes', format($$select api.cancel_po(%L, 'no')$$, :'pob'), 'reason', 'cancellation needs a reason');
select api.cancel_po(:'pob', 'Design changed to wooden flooring');
select tests.as_system();
select tests.ok('B1 Critical fixes', (select status = 'Cancelled' from purchase_orders where id = :'pob') and (select status = 'Withdrawn' from approvals where kind = 'PO' and ref = :'pob')
  and (select status = 'Quotes received' from material_requests where id = :'mrb'), 'pending PO cancelled: approval withdrawn, request reopened');
select tests.ok('B1 Critical fixes', (select pending from app.code_commitments(:'p3', '08')) = :pend_before - (select total from purchase_orders where id = :'pob'), 'its pending commitment is released');
select tests.login('proc@a');
select tests.ok('B1 Critical fixes', api.raise_po(:'mrb', :'v_steel') is not null, 'the reopened request can be ordered again');
select tests.as_system(); select approval_id as ap_b2 from purchase_orders where mr_id = :'mrb' and status = 'Pending approval' \gset
select tests.login('pm@a'); select api.decide(:'ap_b2', 'approve', 'ok');
select tests.as_system(); select id as pob2 from purchase_orders where mr_id = :'mrb' and status = 'Approved' \gset
select tests.login('sup@a'); select api.record_grn(:'pob2', 150, 'Pass');
select tests.login('pm@a');
select tests.throws('B1 Critical fixes', format($$select api.cancel_po(%L, 'too late now')$$, :'pob2'), 'short-close', 'part-delivered order cannot be cancelled');
select api.short_close_po(:'pob2', 'Balance not needed after redesign') as released \gset
select tests.as_system();
select tests.ok('B1 Critical fixes', (select committed from app.code_commitments(:'p3', '08')) = (select sum(accepted_value) from goods_receipts where po_id = :'pob2')
  and :released = (select total from purchase_orders where id = :'pob2') - (select sum(accepted_value) from goods_receipts where po_id = :'pob2'),
  'short-closed order commits only what was accepted; the balance is released', format('released %s', :released));
select tests.ok('B1 Critical fixes', exists (select 1 from automation_events where event = 'commitment_released' and dedupe_key = 'release:' || :'pob2'), 'release queued for the QS to restate the estimate');

-- ===== B05 the completing receipt takes the remainder =====
select tests.login('sup@a'); select api.raise_mr(:'p3', '09', 'Door hinges', 2, 'nos', current_date + 5) as mrc \gset
select tests.login('proc@a'); select api.add_quotation(:'mrc', :'v_steel', 10.25, 18, 2); select api.raise_po(:'mrc', :'v_steel') as poc \gset
select tests.login('pm@a'); select api.decide((select approval_id from purchase_orders where id = :'poc'), 'approve', 'ok');
select tests.login('sup@a'); select api.record_grn(:'poc', 1, 'Pass'); select api.record_grn(:'poc', 1, 'Pass');
select tests.as_system();
select tests.ok('B1 Critical fixes', (select sum(accepted_value) from goods_receipts where po_id = :'poc') = (select total from purchase_orders where id = :'poc'),
  'two receipts of 1 at ₹10.25 + 18% add up to the order total exactly (₹24.19, not ₹24.20)', (select sum(accepted_value)::text from goods_receipts where po_id = :'poc'));

-- ===== B06 rejected PO reopens its request =====
select tests.login('sup@a'); select api.raise_mr(:'p3', '07', 'PVC conduits 25 mm', 300, 'nos', current_date + 15) as mrd \gset
select tests.login('proc@a'); select api.add_quotation(:'mrd', :'v_steel', 60, 18, 3); select api.raise_po(:'mrd', :'v_steel') as pod \gset
select tests.login('pm@a'); select api.decide((select approval_id from purchase_orders where id = :'pod'), 'reject', 'Rate is above the market');
select tests.as_system();
select tests.ok('B1 Critical fixes', (select status = 'Quotes received' from material_requests where id = :'mrd'), 'rejected PO sends the request back for a new quotation');

-- ===== B07 time zone =====
select tests.ok('B1 Critical fixes', current_setting('TimeZone') = 'Asia/Kolkata', 'database sessions run in Asia/Kolkata', current_setting('TimeZone'));
select tests.ok('B1 Critical fixes', app.today('00000000-0000-0000-0000-00000000000a') = (now() at time zone 'Asia/Kolkata')::date, 'business date follows the organisation time zone');

-- ===== B12 administration API =====
select tests.login('md@a');
select tests.throws('B1 Critical fixes', $$select api.set_permission('qs', 'payments', 'view', true)$$, 'permission denied', 'MD cannot change permissions (not an administrator)');
select tests.login('admin@a');
select tests.ok('B1 Critical fixes', api.set_permission('qs', 'payments', 'view', true), 'administrator grants a permission');
select tests.throws('B1 Critical fixes', $$select api.set_permission('super_admin', 'settings', 'edit', false)$$, 'own settings', 'administrator cannot lock themselves out');
select tests.throws('B1 Critical fixes', $$select api.set_org_settings('{"warn_pct":85}', 99)$$, 'changed by someone else', 'stale settings change refused');
select api.set_org_settings('{"warn_pct":85}', (select version from org_settings where org_id = app.org()));
select tests.ok('B1 Critical fixes', (select warn_pct = 85 from org_settings where org_id = app.org()), 'threshold changed through the API');
select tests.ok('B1 Critical fixes', api.set_automation_rule('missing_report', '{"escalate_after_hours":12}'), 'automation rule changed through the API');
select tests.as_system();
select tests.ok('B1 Critical fixes', exists (select 1 from audit_log where table_name = 'role_permissions' and action = 'insert' and new_row ->> 'role_id' = 'qs' and new_row ->> 'module' = 'payments')
  and exists (select 1 from audit_log where table_name = 'org_settings' and action = 'update' and new_row ->> 'warn_pct' = '85.00'), 'permission and settings changes are in the audit log');

-- ===== B20 functions that had no test =====
select tests.login('qs@a'); select api.set_estimate(:'p3', '10', 4500000, 'Landscape BOQ rev A');
select tests.as_system();
select tests.ok('B1 Critical fixes', (select amount = 4500000 from etc_estimates where project_id = :'p3' and code = '10'), 'QS sets an estimate to complete');
select tests.login('qs@a');
select api.create_contract(jsonb_build_object('project_id', :'p3', 'vendor_id', :'v_civil', 'code', '04', 'title', 'Masonry — cottages', 'retention_pct', 5, 'advance_amount', 0,
  'advance_recovery_pct', 0, 'tds_pct', 2, 'gst_pct', 18, 'start_date', current_date - 30, 'end_date', current_date + 90,
  'items', jsonb_build_array(jsonb_build_object('description', 'Block masonry', 'uom', 'sqm', 'qty', 300, 'rate', 900)))) as wo3 \gset
select tests.login('pm@a'); select api.decide((select approval_id from contracts where id = :'wo3'), 'approve', 'ok');
select tests.login('qs@a'); select api.request_variation(:'wo3', 'Extra parapet walls', 30000) as var3 \gset
select tests.as_system();
select tests.ok('B1 Critical fixes', (select status = 'Pending approval' from contract_variations where id = :'var3'), 'variation raised and routed for approval');
select tests.login('pm@a');
select tests.throws('B1 Critical fixes', format($$select api.close_contract(%L, 'Scope complete')$$, :'wo3'), 'variation is still pending', 'contract with a pending variation cannot be closed');
select api.decide((select approval_id from contract_variations where id = :'var3'), 'reject', 'Not in scope');
select api.close_contract(:'wo3', 'Scope moved to another contractor') as wo3_released \gset
select tests.as_system();
select tests.ok('B1 Critical fixes', (select committed from app.code_commitments(:'p3', '04')) = 0 and :wo3_released = 318600, 'closed contract with nothing certified releases its whole value (₹3,18,600 incl. GST)', :'wo3_released');
select tests.login('sup@a'); select api.raise_snag((select id from units where project_id = :'p3' and code = 'C-01'), 'Cracked window pane', 'Minor', 'Glazing') as sn3 \gset
select tests.as_system();
select tests.ok('B1 Critical fixes', (select status = 'Open' from snags where id = :'sn3'), 'defect raised directly from site');
select tests.login('pd@a'); select api.register_document(:'p3', 'Cottage electrical layout', 'Drawing', '02 Drawings') as d3 \gset
select api.link_document(:'d3', 'cost_code', '06');
select tests.as_system();
select tests.ok('B1 Critical fixes', exists (select 1 from document_links where document_id = :'d3' and link_kind = 'cost_code' and link_id = '06'), 'drawing linked to a cost code');
select tests.login('md@b');
select tests.throws('B1 Critical fixes', format($$select * from api.contingency(%L)$$, :'p3'), 'no access', 'another organisation cannot read contingency');
select tests.as_system();
