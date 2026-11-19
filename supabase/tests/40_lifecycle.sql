-- Phase 3 batch 8: a complete resort lifecycle on SYNTHETIC data, through the API as the real roles.
-- 20 villas, restaurant, reception, pool, spa, landscaping, internal roads, utilities. Runs after 30_operating_engine.sql.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select tests.as_system();
select (select id from auth.users where email = 'pm@a') pm, (select id from auth.users where email = 'sup@a') sup,
       (select id from vendors where name like 'Sahyadri%') v_steel, (select id from vendors where name like 'Western%') v_civil \gset
insert into vendors (org_id, name, category, city, approved, credit_days, gstin) values
  ('00000000-0000-0000-0000-00000000000a', 'Malabar Constructions (synthetic)', 'Civil contractor', 'Kozhikode', true, 15, null),
  ('00000000-0000-0000-0000-00000000000a', 'Green Canopy Landscapes (synthetic)', 'Landscape contractor', 'Alappuzha', true, 15, null),
  ('00000000-0000-0000-0000-00000000000a', 'Kerala Cement Traders (synthetic)', 'Cement', 'Kochi', true, 30, null),
  ('00000000-0000-0000-0000-00000000000a', 'Coastal Tiles (synthetic)', 'Tiles', 'Kochi', true, 30, null);
select (select id from vendors where name like 'Malabar%') v_malabar, (select id from vendors where name like 'Green Canopy%') v_green,
       (select id from vendors where name like 'Kerala Cement%') v_kct, (select id from vendors where name like 'Coastal Tiles%') v_tiles \gset

-- ===== L01 project creation =====
select tests.login('pd@a');
select api.create_project(jsonb_build_object('name','Vembanad Lake Resort (SYNTHETIC TEST DATA)','property_type','Luxury resort','location','Kumarakom, Kottayam, Kerala',
  'district','Kottayam','state','Kerala','client_name','Backwater Hospitality (synthetic)','keys',20,'built_up_sqft',120000,'start_date',(current_date - 200)::text,
  'pm_id',:'pm','contract_value',720000000,'contingency_pct',5,'budget_total',600000000,'profile','resort',
  'land', jsonb_build_object('survey_no','45/2','area_acres',8.5,'classification','Wet land converted (estimate)','coastal_zone','CRZ-II (estimate)'),
  'members', jsonb_build_array(jsonb_build_object('user_id',:'sup','responsibility','Site supervisor')),
  'units', (select jsonb_agg(u) from (
     select jsonb_build_object('code','V-' || lpad(g::text, 2, '0'),'name','Lake villa ' || g,'unit_type','Pool villa','template_id','villa','budget',12000000,'systems',jsonb_build_array('Electrical','Plumbing')) u from generate_series(1, 20) g
     union all select jsonb_build_object('code','R-01','name','Restaurant','unit_type','Restaurant','template_id','amenity','budget',30000000,'systems',jsonb_build_array('Electrical','HVAC','Kitchen'))
     union all select jsonb_build_object('code','RC-01','name','Reception','unit_type','Reception','template_id','amenity','budget',20000000,'systems',jsonb_build_array('Electrical','HVAC','Fire'))
     union all select jsonb_build_object('code','P-01','name','Swimming pool','unit_type','Pool','template_id','amenity','budget',15000000,'systems',jsonb_build_array('Pool','Electrical'))
     union all select jsonb_build_object('code','S-01','name','Spa','unit_type','Spa','template_id','amenity','budget',25000000,'systems',jsonb_build_array('Electrical','HVAC','Plumbing'))) x))) as lp \gset
select tests.as_system();
select tests.ok('L01 Project creation', (select count(*) = 24 from units where project_id = :'lp') and (select count(*) = 264 from unit_stages s join units u on u.id = s.unit_id where u.project_id = :'lp'),
  '24 units (20 villas, restaurant, reception, pool, spa) with 11 readiness stages each');
select tests.ok('L01 Project creation', (select regulatory_status = 'Estimate' from land_parcels where project_id = :'lp'), 'land and coastal-zone data held as estimates');
-- twin structure: zones, buildings, floors, work packages for landscaping, roads and utilities
select tests.login('pd@a');
select api.set_twin_structure(:'lp', jsonb_build_object(
  'zones', jsonb_build_array(jsonb_build_object('code','Z-VN','name','Villas — north shore','kind','Villas'), jsonb_build_object('code','Z-VS','name','Villas — south shore','kind','Villas'),
     jsonb_build_object('code','Z-AM','name','Guest amenities','kind','Amenities'), jsonb_build_object('code','Z-LS','name','Landscape','kind','Landscape'),
     jsonb_build_object('code','Z-RD','name','Internal roads','kind','Infrastructure'), jsonb_build_object('code','Z-UT','name','Utilities (STP, WTP, power)','kind','Utilities')),
  'buildings', (select jsonb_agg(jsonb_build_object('code','B-V' || lpad(g::text, 2, '0'),'name','Villa block ' || g,'zone', case when g <= 10 then 'Z-VN' else 'Z-VS' end)) from generate_series(1, 20) g)
     || jsonb_build_array(jsonb_build_object('code','B-REST','name','Restaurant building','zone','Z-AM'), jsonb_build_object('code','B-RECP','name','Reception building','zone','Z-AM'), jsonb_build_object('code','B-SPA','name','Spa building','zone','Z-AM')),
  'floors', (select jsonb_agg(jsonb_build_object('building','B-V' || lpad(g::text, 2, '0'),'level',0,'name','Ground')) from generate_series(1, 20) g)
     || jsonb_build_array(jsonb_build_object('building','B-REST','level',0,'name','Ground'), jsonb_build_object('building','B-RECP','level',0,'name','Ground'), jsonb_build_object('building','B-SPA','level',0,'name','Ground')),
  'units', (select jsonb_agg(jsonb_build_object('code','V-' || lpad(g::text, 2, '0'),'zone', case when g <= 10 then 'Z-VN' else 'Z-VS' end,'building','B-V' || lpad(g::text, 2, '0'),'level',0)) from generate_series(1, 20) g)
     || jsonb_build_array(jsonb_build_object('code','R-01','zone','Z-AM','building','B-REST','level',0), jsonb_build_object('code','RC-01','zone','Z-AM','building','B-RECP','level',0),
        jsonb_build_object('code','S-01','zone','Z-AM','building','B-SPA','level',0), jsonb_build_object('code','P-01','zone','Z-AM')),
  'work_packages', jsonb_build_array(
     jsonb_build_object('code','WP-VN-CIV','name','Civil works — north villas','zone','Z-VN','cost_code','03','budget',140000000),
     jsonb_build_object('code','WP-VS-CIV','name','Civil works — south villas','zone','Z-VS','cost_code','03','budget',140000000),
     jsonb_build_object('code','WP-LS','name','Landscaping and softscape','zone','Z-LS','cost_code','10','budget',40000000),
     jsonb_build_object('code','WP-RD','name','Internal roads and pathways','zone','Z-RD','cost_code','10','budget',18000000),
     jsonb_build_object('code','WP-UT','name','STP, WTP and power distribution','zone','Z-UT','cost_code','07','budget',30000000)))) as twin_res \gset
select tests.as_system();
select tests.ok('L01 Project creation', (select count(*) = 6 from zones where project_id = :'lp') and (select count(*) = 23 from buildings where project_id = :'lp') and (select count(*) = 5 from work_packages where project_id = :'lp')
  and (select count(*) = 24 from units where project_id = :'lp' and zone_id is not null), 'property → 6 zones → 23 buildings → floors → 24 units, plus 5 zone work packages');

-- ===== L02 budget preparation =====
select tests.login('fin@a'); select api.decide((select id from approvals where project_id = :'lp' and kind = 'BUDGET'), 'approve', 'Matches feasibility');
select tests.login('md@a'); select api.decide((select id from approvals where project_id = :'lp' and kind = 'BUDGET'), 'approve', 'Approved');
select tests.login('qs@a'); select api.request_budget_revision(:'lp', '[{"code":"13","delta":-5000000},{"code":"10","delta":5000000}]', 'Lake-edge landscaping enlarged; ₹50 L from contingency');
select tests.login('fin@a'); select api.decide((select id from approvals where project_id = :'lp' and kind = 'BUDGET' and status = 'Pending'), 'approve', 'ok');
select tests.login('md@a'); select api.decide((select id from approvals where project_id = :'lp' and kind = 'BUDGET' and status = 'Pending'), 'approve', 'ok');
select tests.as_system();
select tests.ok('L02 Budget', (select count(*) = 2 from budget_versions where project_id = :'lp' and status = 'Approved') and (select sum(current_budget) = 600000000 from app.cost_position_internal(:'lp'))
  and (select approved_changes = 5000000 from app.cost_position_internal(:'lp') where code = '10'), 'baseline and one approved revision; total unchanged, landscape +₹50 L');

-- ===== L03 design approvals =====
select tests.login('pm@a'); select api.register_document(:'lp', 'Villa type A — GFC drawings', 'Drawing', '02 Drawings') as doc1 \gset
select api.add_document_version(:'doc1', 'R0', :'lp' || '/drawings/villa-a-r0.pdf', 'villa-a-r0.pdf', 'application/pdf', 2400000, 'Good for construction', true);
select tests.login('pd@a');
select api.decide((select id from approvals where kind = 'DOC' and project_id = :'lp' and status = 'Pending'), 'approve', 'Approved for construction');
select tests.login('pd@a'); select api.link_document(:'doc1', 'unit', (select id::text from units where project_id = :'lp' and code = 'V-01'));
select tests.as_system();
select tests.ok('L03 Design approvals', (select status = 'Approved' from document_versions where document_id = :'doc1' and rev = 'R0') and exists (select 1 from document_links where document_id = :'doc1' and link_kind = 'unit'),
  'drawing approved and linked to villa V-01 (appears as a design reference in the twin)');

-- ===== L04 BOQ creation =====
select tests.login('proc@a'); select api.add_material('TMT-FE550', 'TMT steel Fe 550D', 'MT', 'Steel', '03', 7) as steel;
select tests.as_system(); select id as cem from materials where code = 'CEM-OPC53' \gset
select id as steel from materials where code = 'TMT-FE550' \gset
select tests.login('qs@a');
select api.add_boq_items(:'lp', jsonb_build_array(
  jsonb_build_object('code','03','ref','03.01','description','RCC M30 frame — villas','unit','cum','qty',2000,'rate',9400,'material_id',:'cem','material_factor',7.5),
  jsonb_build_object('code','03','ref','03.02','description','Reinforcement — villas','unit','MT','qty',220,'rate',72000,'material_id',:'steel','material_factor',1),
  jsonb_build_object('code','04','ref','04.01','description','Block masonry — villas','unit','sqm','qty',6000,'rate',950),
  jsonb_build_object('code','10','ref','10.01','description','Softscape and lawns','unit','sqm','qty',8000,'rate',700)));
select tests.throws('L04 BOQ', format($$select api.add_boq_items(%L, '[{"code":"99","ref":"x","description":"x","unit":"no","qty":1,"rate":1}]')$$, :'lp'), 'unknown cost code', 'BOQ line with an unknown cost code is refused');
select tests.login('sup@a');
select tests.throws('L04 BOQ', format($$select api.add_boq_items(%L, '[{"code":"03","ref":"x","description":"x","unit":"no","qty":1,"rate":1}]')$$, :'lp'), 'permission denied', 'site supervisor cannot write the BOQ');
select tests.as_system();
select tests.ok('L04 BOQ', (select count(*) = 4 from boq_items where project_id = :'lp'), '4 BOQ lines, two linked to catalogue materials');

-- ===== L05 contractor allocation =====
select tests.login('qs@a');
select api.create_contract(jsonb_build_object('project_id', :'lp', 'vendor_id', :'v_civil', 'code', '03', 'title', 'Civil works — north villas', 'retention_pct', 5, 'advance_amount', 1000000,
  'advance_recovery_pct', 10, 'tds_pct', 2, 'gst_pct', 18, 'start_date', current_date - 150, 'end_date', current_date + 150,
  'items', jsonb_build_array(jsonb_build_object('description','RCC frame villas V-01–V-10','uom','cum','qty',1000,'rate',9000), jsonb_build_object('description','Block masonry V-01–V-10','uom','sqm','qty',3000,'rate',900)))) as c1 \gset
select api.create_contract(jsonb_build_object('project_id', :'lp', 'vendor_id', :'v_malabar', 'code', '03', 'title', 'Civil works — south villas', 'retention_pct', 5, 'advance_amount', 0,
  'advance_recovery_pct', 0, 'tds_pct', 2, 'gst_pct', 18, 'start_date', current_date - 150, 'end_date', current_date + 150,
  'items', jsonb_build_array(jsonb_build_object('description','RCC frame villas V-11–V-20','uom','cum','qty',1000,'rate',9100)))) as c2 \gset
select api.create_contract(jsonb_build_object('project_id', :'lp', 'vendor_id', :'v_green', 'code', '10', 'title', 'Landscaping and softscape', 'retention_pct', 5, 'advance_amount', 0,
  'advance_recovery_pct', 0, 'tds_pct', 2, 'gst_pct', 18, 'start_date', current_date - 30, 'end_date', current_date + 120,
  'items', jsonb_build_array(jsonb_build_object('description','Softscape and lawns','uom','sqm','qty',8000,'rate',650)))) as c3 \gset
select format('select tests.login(''%s''); select api.decide((select approval_id from contracts where id = %L), ''approve'', ''ok'');', r, c) from (values (:'c1'), (:'c2'), (:'c3')) cc(c), (values ('pm@a'), ('pd@a'), ('md@a')) rr(r)
  where exists (select 1 from approval_steps s join contracts k on k.approval_id = s.approval_id where k.id = cc.c and s.role_id = split_part(rr.r, '@', 1)) \gexec
select tests.login('qs@a');
select api.assign_contract(:'c1', (select id from work_packages where project_id = :'lp' and code = 'WP-VN-CIV'));
select api.assign_contract(:'c2', (select id from work_packages where project_id = :'lp' and code = 'WP-VS-CIV'));
select api.assign_contract(:'c3', (select id from work_packages where project_id = :'lp' and code = 'WP-LS'));
select tests.login('pm@a');
select api.assign_task((select id from tasks where project_id = :'lp' and wbs = 'T13'), (select id from work_packages where project_id = :'lp' and code = 'WP-LS'), :'v_green');
select api.assign_task((select id from tasks where project_id = :'lp' and wbs = 'T07'), (select id from work_packages where project_id = :'lp' and code = 'WP-VN-CIV'), :'v_civil');
select tests.as_system();
select tests.ok('L05 Contractor allocation', (select count(*) = 3 from contracts where project_id = :'lp' and status = 'Active' and work_package_id is not null)
  and (select string_agg(role_id, '>' order by seq) = 'pm>pd>md' from approval_steps where approval_id = (select approval_id from contracts where id = :'c1')), 'three work orders approved by value (PM → PD → MD) and attached to work packages');
insert into project_members (project_id, user_id, responsibility) select :'lp', id, 'Contractor' from auth.users where email = 'vend@a';
select tests.login('fin@a'); select api.record_payment('advance', :'c1', 1000000, 0, current_date - 140, 'UTR-L-ADV1');

-- ===== L06 procurement (with a rejected approval, a cancelled order and an over-budget order) =====
select tests.login('proc@a');
select tests.throws('L06 Procurement', format($$select api.set_vendor_price(%L, %L, 1, 18, 0, 1, current_date, null)$$, :'cem', :'v_steel'), 'permission denied', 'procurement cannot approve its own price list');
select tests.login('pd@a');
select api.set_vendor_price(:'cem', :'v_steel', 380, 28, 0, 4, current_date - 60, null);
select api.set_vendor_price(:'cem', :'v_kct', 365, 28, 1000, 6, current_date - 60, null);
select api.set_vendor_price(:'steel', :'v_steel', 62000, 18, 0, 7, current_date - 60, null);
select tests.login('proc@a');
select api.raise_mr(:'lp', '03', 'OPC 53 cement — villa slabs', 2000, 'bag', current_date + 15) as mr_cem \gset
select api.set_request_material(:'mr_cem', :'cem');
select api.add_quotation(:'mr_cem', :'v_steel', 380, 28, 4); select api.add_quotation(:'mr_cem', :'v_kct', 365, 28, 6);
select api.raise_po(:'mr_cem', :'v_kct', null, current_date + 6) as po_cem \gset
select api.raise_mr(:'lp', '03', 'TMT steel Fe 550D — villas', 40, 'MT', current_date + 20) as mr_st \gset
select api.set_request_material(:'mr_st', :'steel');
select api.add_quotation(:'mr_st', :'v_steel', 62000, 18, 7); select api.raise_po(:'mr_st', :'v_steel', null, current_date + 7) as po_st \gset
select api.raise_mr(:'lp', '08', 'Vitrified tiles 800x800 — villas', 3000, 'sqm', current_date + 40) as mr_tl \gset
select api.add_quotation(:'mr_tl', :'v_tiles', 1450, 18, 15); select api.raise_po(:'mr_tl', :'v_tiles', null, current_date + 30) as po_tl \gset
select api.raise_mr(:'lp', '09', 'Teak doors — villas', 40, 'nos', current_date + 45) as mr_dr \gset
select api.add_quotation(:'mr_dr', :'v_steel', 48000, 18, 20); select api.raise_po(:'mr_dr', :'v_steel', null, current_date + 25) as po_dr \gset
select api.raise_mr(:'lp', '12', 'Loose furniture package — all villas', 1, 'lot', current_date + 90) as mr_ff \gset
select api.add_quotation(:'mr_ff', :'v_tiles', 61000000, 18, 60); select api.raise_po(:'mr_ff', :'v_tiles', null, current_date + 80) as po_ff \gset
select tests.as_system();
select tests.ok('L06 Procurement', (select string_agg(role_id, '>' order by seq) = 'pm>pd' from approval_steps where approval_id = (select approval_id from purchase_orders where id = :'po_cem'))
  and (select string_agg(role_id, '>' order by seq) = 'pm>pd>md' from approval_steps where approval_id = (select approval_id from purchase_orders where id = :'po_st')), 'orders route by value: ₹9.3 L PM→PD; ₹29.3 L PM→PD→MD');
select tests.ok('L06 Procurement', (select over_budget > 0 from purchase_orders where id = :'po_ff') and (select bool_or(label ilike '%override%') from approval_steps where approval_id = (select approval_id from purchase_orders where id = :'po_ff')),
  'furniture order above the FF&E budget line needs the MD''s budget override');
select format('select tests.login(''%s''); select api.decide((select approval_id from purchase_orders where id = %L), ''approve'', ''ok'');', r, po) from (values (:'po_cem'), (:'po_st'), (:'po_ff')) pp(po), (values ('pm@a'), ('pd@a'), ('md@a')) rr(r)
  where exists (select 1 from approval_steps s join purchase_orders k on k.approval_id = s.approval_id where k.id = pp.po and s.role_id = split_part(rr.r, '@', 1)) \gexec
select tests.login('pm@a'); select api.decide((select approval_id from purchase_orders where id = :'po_tl'), 'reject', 'Rate above market; re-quote');
select api.cancel_po(:'po_dr', 'Door specification changed to engineered wood');
select tests.as_system();
select tests.ok('L06 Procurement', (select status = 'Rejected' from purchase_orders where id = :'po_tl') and (select status = 'Quotes received' from material_requests where id = :'mr_tl')
  and (select status = 'Cancelled' from purchase_orders where id = :'po_dr') and (select status = 'Quotes received' from material_requests where id = :'mr_dr'), 'rejected and cancelled orders send their requests back');
select tests.login('proc@a'); select api.add_quotation(:'mr_tl', :'v_steel', 1320, 18, 12); select api.raise_po(:'mr_tl', :'v_steel', null, current_date + 25) as po_tl2 \gset
select tests.login('pm@a'); select api.decide((select approval_id from purchase_orders where id = :'po_tl2'), 'approve', 'ok');
select tests.login('pd@a'); select api.decide((select approval_id from purchase_orders where id = :'po_tl2'), 'approve', 'ok');
select tests.login('md@a'); select api.decide((select approval_id from purchase_orders where id = :'po_tl2'), 'approve', 'ok');
select tests.as_system();
select tests.ok('L06 Procurement', (select status = 'Approved' from purchase_orders where id = :'po_tl2'), 'tiles re-ordered at the lower quote and approved');

-- ===== L07 material receipt (partial deliveries, short-close) =====
select tests.login('sup@a'); select api.record_grn(:'po_cem', 1200, 'Pass', current_date - 1); select api.record_grn(:'po_st', 25, 'Pass', current_date - 1);
select tests.throws('L07 Receipt', format($$select api.record_grn(%L, 900, 'Pass')$$, :'po_cem'), 'over-receipt', 'receiving more than ordered is refused');
select api.record_grn(:'po_cem', 800, 'Pass');
select tests.login('pm@a'); select api.short_close_po(:'po_st', 'Steel requirement reduced after value engineering');
select tests.as_system();
select tests.ok('L07 Receipt', (select status = 'Received' from purchase_orders where id = :'po_cem') and (select sum(accepted_value) = (select total from purchase_orders where id = :'po_cem') from goods_receipts where po_id = :'po_cem'),
  'cement received in two lots; receipts add up exactly to the order');
select tests.ok('L07 Receipt', app.stock_on_hand(:'lp', :'cem') = 2000 and app.stock_on_hand(:'lp', :'steel') = 25, 'site stock: 2,000 bags cement and 25 MT steel, from the receipts alone');
select tests.ok('L07 Receipt', (select committed from app.code_commitments(:'lp', '03')) =
   (select total from purchase_orders where id = :'po_cem') + (select sum(accepted_value) from goods_receipts where po_id = :'po_st')
   + (select sum(app.incl_gst(app.contract_value(id), gst_pct)) from contracts where project_id = :'lp' and code = '03' and status = 'Active'), 'code 03 commitment = cement order + steel actually accepted + both civil contracts');

-- ===== L08 site progress =====
select tests.login('pm@a');
select format('select api.update_task(%L, %s, 100, %L, %L, %L, null);', id, version, base_start, base_finish, case when base_finish < current_date then 'Completed (synthetic history)' end)
  from tasks where project_id = :'lp' and wbs in ('T01','T02','M01','T03','T04','T05') order by base_start \gexec
select tests.as_system(); select (select id from tasks where project_id = :'lp' and wbs = 'T07') t07, (select id from boq_items where project_id = :'lp' and ref = '03.01') boq_rcc \gset
select tests.login('sup@a');
select api.submit_daily_report(:'lp', current_date - 1, 'Clear', '[{"trade":"Mason","count":40},{"trade":"Bar bender","count":18}]', null, 'Toolbox talk on working at height',
  jsonb_build_array(jsonb_build_object('task_id', :'t07', 'progress_to', 40, 'boq_item_id', :'boq_rcc', 'qty', 300))) as dr_l \gset
select tests.throws('L08 Site progress', format($$select api.submit_daily_report(%L, current_date - 1, 'Clear', '[]', null, null, '[]')$$, :'lp'), 'already submitted', 'second report for the same day is refused');
select tests.as_system(); select tests.ok('L08 Site progress', (select progress = 0 from tasks where project_id = :'lp' and wbs = 'T07'), 'unverified report does not move progress');
select tests.login('pm@a'); select api.decide((select approval_id from daily_reports where id = :'dr_l'), 'approve', 'Verified on site');
select tests.as_system();
select tests.ok('L08 Site progress', (select progress = 40 from tasks where project_id = :'lp' and wbs = 'T07') and (select executed_qty = 300 from boq_items where project_id = :'lp' and ref = '03.01'),
  'verified report moves T07 to 40% and the BOQ executed quantity to 300 cum');
select tests.login('proc@a'); select api.issue_stock(:'lp', :'cem', 1500, :'t07', 'Villa slabs');
select tests.as_system(); select tests.ok('L08 Site progress', app.stock_on_hand(:'lp', :'cem') = 500, 'cement issued to the slab activity: 500 bags left');

-- ===== L09 quality inspections (one failure, one safety-critical defect) =====
select id as v03 from units where project_id = :'lp' and code = 'V-03' \gset
select id as v05 from units where project_id = :'lp' and code = 'V-05' \gset
select tests.login('sup@a'); select api.request_inspection(:'v03', 'Stage', 'foundation') as in_f3 \gset
select tests.login('qe@a'); select api.decide_inspection(:'in_f3', false, 'Cover to reinforcement short on two footings', '[{"title":"Increase cover at footings F3 and F4","severity":"Major","category":"Structure"}]');
select tests.login('sup@a'); select api.raise_snag(:'v05', 'Open excavation without barricade', 'Safety-critical', 'Safety', :'v_civil') as sn_safe \gset
select tests.as_system(); select api.scan_exceptions();
select tests.ok('L09 Quality', exists (select 1 from alerts where dedupe_key = 'inspfail:' || :'in_f3' and category = 'Quality' and status = 'Open')
  and exists (select 1 from alerts where dedupe_key = 'safety:' || :'sn_safe' and severity = 'Critical' and owner_id = :'pm'), 'failed inspection and safety defect appear in the action center with owners');
select tests.login('pm@a'); select api.mark_snag_fixed(id) from snags where unit_id = :'v03' and status = 'Open';
select api.mark_snag_fixed(:'sn_safe');
select tests.login('qe@a'); select api.close_snag(id) from snags where unit_id in (:'v03', :'v05') and status = 'Fixed';
select tests.as_system(); select api.scan_exceptions();
select tests.ok('L09 Quality', (select status = 'Resolved' from alerts where dedupe_key = 'safety:' || :'sn_safe'), 'closing the safety defect resolves its alert');

-- ===== L10 contractor certification (a correct claim and an incorrect one) =====
select tests.as_system(); select id as ci_rcc from contract_items where contract_id = :'c1' and description like 'RCC%' \gset
select id as ci_mas from contract_items where contract_id = :'c1' and description like 'Block%' \gset
select tests.login('sup@a'); select api.record_measurement(:'ci_rcc', 300, current_date - 3) as m_r1 \gset
select api.record_measurement(:'ci_mas', 500, current_date - 3) as m_m1 \gset
select tests.login('pm@a'); select api.verify_measurement(:'m_r1', true); select api.verify_measurement(:'m_m1', true);
select tests.login('vend@a'); select api.submit_claim(:'c1', jsonb_build_array(jsonb_build_object('contract_item_id', :'ci_rcc', 'qty', 300, 'rate', 9000), jsonb_build_object('contract_item_id', :'ci_mas', 'qty', 500, 'rate', 900)), 'RA 1') as lc1 \gset
select tests.as_system(); select api.process_events(200);
select ra_bill_id as lb1 from contractor_claims where id = :'lc1' \gset
select tests.ok('L10 Certification', (select gross = 3150000 and gst = 567000 and retention = 157500 and advance_recovery = 315000 and tds = 63000 and net_payable = 3181500 from ra_bills where id = :'lb1'),
  'RA 1: 31,50,000 + GST 5,67,000 − retention 1,57,500 − advance 3,15,000 − TDS 63,000 = 31,81,500');
select format('select tests.login(''%s''); select api.decide((select approval_id from ra_bills where id = %L), ''approve'', ''ok'');', r, :'lb1') from (values ('pm@a',1), ('qs@a',2), ('fin@a',3), ('pd@a',4), ('md@a',5)) rr(r, o)
  where exists (select 1 from approval_steps s join ra_bills b on b.approval_id = s.approval_id where b.id = :'lb1' and s.role_id = case split_part(rr.r, '@', 1) when 'fin' then 'finance' else split_part(rr.r, '@', 1) end) order by o \gexec
select tests.as_system();
select tests.ok('L10 Certification', (select status = 'Approved' from ra_bills where id = :'lb1') and (select status = 'Ready' and amount = 3181500 from payment_requests where ref = :'lb1'), 'certified through the chain; payment request ready for finance');
select tests.login('sup@a'); select api.record_measurement(:'ci_rcc', 100, current_date - 1) as m_r2 \gset
select tests.login('pm@a'); select api.verify_measurement(:'m_r2', true);
select tests.login('vend@a'); select api.submit_claim(:'c1', jsonb_build_array(jsonb_build_object('contract_item_id', :'ci_rcc', 'qty', 150, 'rate', 9500)), 'RA 2') as lc2 \gset
select tests.as_system(); select api.process_events(200);
select tests.ok('L10 Certification', (select status = 'Discrepancies' and (assessment ->> 'gross')::numeric = 900000 and (assessment ->> 'difference')::numeric = 525000 from contractor_claims where id = :'lc2'),
  'incorrect claim (150 at ₹9,500) assessed at the verified 100 at ₹9,000; ₹5,25,000 difference flagged');
select tests.login('qs@a'); select api.decide_claim(:'lc2', 'bill_assessed', 'Bill verified 100 cum at the contract rate') as lb2 \gset

-- ===== L11 invoice approval =====
select tests.login('fin@a');
select api.record_invoice(:'po_cem', 'KCT/2026/0441', current_date, 2000, 365, 28) as inv_cem \gset
select tests.throws('L11 Invoices', format($$select api.record_invoice(%L, 'kct/2026/ 0441', current_date, 1, 365, 28)$$, :'po_cem'), 'duplicate invoice', 'duplicate invoice number refused');
select api.record_invoice(:'po_st', 'SSC/2026/0912', current_date, 25, 64000, 18) as inv_st \gset
select tests.as_system();
select tests.ok('L11 Invoices', (select status = 'Pending approval' and match_status = 'Matched' from vendor_invoices where id = :'inv_cem') and (select status = 'On hold' and match_status = 'On hold' from vendor_invoices where id = :'inv_st'),
  'cement invoice matched; steel invoice at a higher rate held');
select format('select tests.login(''%s''); select api.decide((select approval_id from vendor_invoices where id = %L), ''approve'', ''ok'');', r, :'inv_cem') from (values ('fin2@a',1), ('pd@a',2), ('md@a',3)) rr(r, o)
  where exists (select 1 from approval_steps s join vendor_invoices i on i.approval_id = s.approval_id where i.id = :'inv_cem' and s.role_id = case split_part(rr.r, '@', 1) when 'fin2' then 'finance' else split_part(rr.r, '@', 1) end) order by o \gexec
select tests.as_system();
select tests.ok('L11 Invoices', (select status = 'Approved' from vendor_invoices where id = :'inv_cem') and exists (select 1 from payment_requests where ref = :'inv_cem' and status = 'Ready'), 'invoice approved and queued for payment');

-- ===== L12 payment recording =====
select tests.login('fin@a');
select tests.throws('L12 Payments', format($$select api.record_payment('invoice', %L, 10, 0, current_date, 'UTR-L-X1')$$, :'inv_cem'), 'cannot also pay', 'the person who booked the invoice cannot pay it');
select tests.login('fin2@a');
select tests.throws('L12 Payments', format($$select api.record_payment('invoice', %L, 99999999, 0, current_date, 'UTR-L-X2')$$, :'inv_cem'), 'overpayment', 'overpayment refused');
select api.record_payment('invoice', :'inv_cem', (select total from vendor_invoices where id = :'inv_cem'), 0, current_date, 'UTR-L-CEM');
select api.record_payment('ra_bill', :'lb1', 3181500, 63000, current_date, 'UTR-L-RA1');
select tests.as_system();
select tests.ok('L12 Payments', (select status = 'Paid' from vendor_invoices where id = :'inv_cem') and (select status = 'Paid' from ra_bills where id = :'lb1')
  and (select count(*) = 2 from payment_requests where ref in (:'inv_cem', :'lb1') and status = 'Paid'), 'invoice and bill paid; their payment requests closed');

-- ===== L13 cost forecasting =====
select tests.login('qs@a');
select format('select api.set_estimate(%L, %L, %s, ''QS estimate (synthetic)'');', :'lp', code, amt) from (values ('01', 15000000), ('02', 20000000), ('04', 30000000), ('05', 18000000), ('06', 25000000),
  ('07', 32000000), ('08', 35000000), ('09', 15000000), ('10', 20000000), ('11', 12000000)) e(code, amt) \gexec
select tests.login('md@a'); select api.financial_intelligence(:'lp') as fi \gset
select tests.as_system();
select tests.ok('L13 Cost forecasting', (:'fi'::jsonb -> 'recorded' ->> 'committed')::numeric = (select sum(committed) from app.cost_position_internal(:'lp'))
  and (:'fi'::jsonb -> 'projected' ->> 'forecast_final_cost')::numeric = (select sum(committed) + sum(uncommitted_forecast) from app.cost_position_internal(:'lp')),
  'forecast final cost = committed + estimate to complete (recorded and projected kept apart)');
select tests.ok('L13 Cost forecasting', not exists (select 1 from app.cost_position_internal(:'lp') where actual <> paid_against_cost + accrued_unpaid + retention_held or actual > committed + 0.01),
  'no double counting on any cost code: actual = paid + accrued + retention, actual ≤ committed');
select tests.ok('L13 Cost forecasting', (select (s -> 0 ->> 'final_cost')::numeric <= (s -> 1 ->> 'final_cost')::numeric and (s -> 1 ->> 'final_cost')::numeric <= (s -> 2 ->> 'final_cost')::numeric
  and s -> 0 ->> 'scenario' = 'Best' and s -> 2 ->> 'scenario' = 'Worst' from (select :'fi'::jsonb -> 'scenarios' s) x), 'best ≤ base ≤ worst final cost, each with its stated assumptions');
select tests.ok('L13 Cost forecasting', (:'fi'::jsonb -> 'kpis' ->> 'forecast_cost_per_key')::numeric = round((:'fi'::jsonb -> 'projected' ->> 'forecast_final_cost')::numeric / 20, 2)
  and (:'fi'::jsonb -> 'kpis' ->> 'forecast_cost_per_sqft')::numeric = round((:'fi'::jsonb -> 'projected' ->> 'forecast_final_cost')::numeric / 120000, 2), 'cost per key and per sq ft computed from the forecast');
select tests.ok('L13 Cost forecasting', jsonb_array_length(:'fi'::jsonb -> 'price_variance') >= 1 and (:'fi'::jsonb -> 'profitability' ->> 'margin')::numeric = 720000000 - (:'fi'::jsonb -> 'projected' ->> 'forecast_final_cost')::numeric,
  'price variance against the price list and margin = contract value − forecast');
select tests.login('sup@a');
select tests.throws('L13 Cost forecasting', format($$select api.financial_intelligence(%L)$$, :'lp'), 'permission denied', 'site supervisor cannot read the financial intelligence');

-- ===== B3 digital twin (live data) =====
select tests.login('md@a'); select api.twin(:'lp') as tw \gset
select tests.as_system();
select tests.ok('B3 Digital twin', jsonb_array_length(:'tw'::jsonb -> 'children') = 6 and (:'tw'::jsonb -> 'metrics' ->> 'units')::int = 24, 'twin shows 6 zones and 24 units under the property');
select tests.ok('B3 Digital twin', (select (z -> 'metrics' ->> 'committed')::numeric = (select app.incl_gst(app.contract_value(:'c1'), 18)) from jsonb_array_elements(:'tw'::jsonb -> 'children') z where z ->> 'code' = 'Z-VN'),
  'north villa zone carries exactly the north civil work order as its commitment');
select tests.ok('B3 Digital twin', (select (z -> 'metrics' -> 'contractors') ? 'Green Canopy Landscapes (synthetic)' from jsonb_array_elements(:'tw'::jsonb -> 'children') z where z ->> 'code' = 'Z-LS'),
  'landscape zone names its contractor');
select tests.ok('B3 Digital twin', (:'tw'::jsonb -> 'metrics' ->> 'completion_pct')::numeric = round((select count(*) filter (where s.status = 'Passed') * 100.0 / count(*) from unit_stages s join units u on u.id = s.unit_id where u.project_id = :'lp'), 1),
  'property completion = verified stages passed ÷ all stages');
select tests.ok('B3 Digital twin', (select (b -> 'children' -> 0 -> 'children' -> 0 -> 'metrics' ->> 'design_refs')::int = 1 from jsonb_array_elements(:'tw'::jsonb -> 'children') z, jsonb_array_elements(z -> 'children') b where b ->> 'code' = 'B-V01'),
  'villa V-01 shows its approved drawing as a design reference (zone → building → floor → villa)');
select tests.login('sup@a'); select api.twin(:'lp') as tw_sup \gset
select tests.as_system();
select tests.ok('B3 Digital twin', (:'tw_sup'::jsonb -> 'metrics' -> 'committed') = 'null'::jsonb and (:'tw_sup'::jsonb -> 'metrics' ->> 'units')::int = 24, 'site supervisor sees the twin without any cost figures');
select tests.login('pm@a');
select tests.ok('B3 Digital twin', (select count(*) = 18 from api.twin_tasks(:'lp')) and exists (select 1 from api.twin_tasks(:'lp', null, (select id from work_packages where project_id = :'lp' and code = 'WP-LS')) where contractor like 'Green Canopy%'),
  'down to individual tasks with planned, actual and forecast dates; landscaping tasks under their package and contractor');
select tests.as_system();
select f.task_id as pred_last from app.schedule_forecast(:'lp') f join task_dependencies d on d.pred_id = f.task_id join tasks m on m.id = d.task_id and m.wbs = 'M03' order by f.forecast_finish desc limit 1 \gset
select tests.login('pm@a');
select tests.ok('B3 Digital twin', (select extra_slip_days = 15 from api.simulate_delay(:'pred_last', 15) where milestone = 'Ready for handover'), 'what-if: 15 days on the driving activity moves handover by 15 days');
select tests.ok('B3 Digital twin', (select extra_slip_days between 0 and 15 from api.simulate_delay((select id from tasks where project_id = :'lp' and wbs = 'T13'), 15) where milestone = 'Ready for handover'),
  'what-if: a 15-day landscaping delay moves handover by 15 days less its float, never more');

-- ===== B5 contractors and procurement intelligence =====
select tests.login('md@a');
select tests.ok('B5 Contractors & procurement', (select count(*) = 3 from api.contractor_scores(:'lp')) and (select bool_and(jsonb_array_length(components) = 9) from api.contractor_scores(:'lp')),
  'each contractor gets a score with all nine components, their samples and formulas');
select tests.ok('B5 Contractors & procurement', (select (c ->> 'value')::numeric between 0 and 100 and (c ->> 'sample')::int = 2 from api.contractor_scores(:'lp') s, jsonb_array_elements(s.components) c where s.vendor_id = :'v_civil' and c ->> 'metric' = 'claim_accuracy'),
  'claim accuracy counts both claims of the north civil contractor');
select tests.ok('B5 Contractors & procurement', (select bool_and(not comparable or metrics_used >= 4) from api.contractor_scores(:'lp')), 'a score is marked comparable only with at least four measured components');
select tests.as_system(); select id as t10 from tasks where project_id = :'lp' and wbs = 'T10' \gset
select tests.login('proc@a'); select api.reserve_material(:'lp', :'cem', :'t10', 1800, current_date + 20);
select tests.login('proc@a'); select api.reserve_material((select id from projects where name = 'Phase 3 controls test'), :'cem', null, 600, current_date + 25);
select tests.ok('B5 Contractors & procurement', (select consolidation ->> 'advice' like 'Combine 2 projects%' and projects @> jsonb_build_array(jsonb_build_object('project', :'lp')) from api.procurement_plan(60) where code = 'CEM-OPC53'),
  'cement needed by two projects inside the window: one combined RFQ advised, lead time respected');
select tests.ok('B5 Contractors & procurement', (select count(*) = 2 and min(price) = 365 from api.vendor_comparison(:'cem')), 'vendor comparison lists both cement vendors with prices, lead times and delivery record');
select api.draft_rfq(:'cem', jsonb_build_array(jsonb_build_object('project', :'lp', 'qty', 1800, 'needed_by', current_date + 20), jsonb_build_object('project', (select id from projects where name = 'Phase 3 controls test'), 'qty', 600, 'needed_by', current_date + 25))) as rfq1 \gset
select tests.as_system();
select tests.ok('B5 Contractors & procurement', (select status = 'Draft' and qty = 2400 and cardinality(vendors) = 2 from rfqs where id = :'rfq1') and not exists (select 1 from purchase_orders where created_at > now() - interval '1 minute' and mr_id is null),
  'draft RFQ for 2,400 bags to both price-list vendors; nothing is ordered without approval');
select tests.login('proc@a'); select api.raise_mr(:'lp', '03', 'OPC 53 cement — top-up', 300, 'bag', current_date + 12) as mr_c2 \gset
select api.set_request_material(:'mr_c2', :'cem'); select api.add_quotation(:'mr_c2', :'v_steel', 450, 28, 2); select api.raise_po(:'mr_c2', :'v_steel', null, current_date + 3) as po_c2 \gset
select tests.as_system(); select api.scan_exceptions();
select tests.ok('B5 Contractors & procurement', exists (select 1 from alerts where dedupe_key = 'price:' || :'po_c2' and owner_role = 'proc'), 'an order 23% above the price list raises a price-variance alert before approval');

-- ===== L14 villa completion (every unit) and L15 final handover =====
select format('select tests.login(''sup@a''); select api.request_inspection(%L, ''Stage'', %L); select tests.login(''qe@a''); select api.decide_inspection((select id from inspections where unit_id = %L and stage_key = %L and status = ''Requested''), true, ''OK'');',
  u.id, s.stage_key, u.id, s.stage_key) from units u join unit_stages s on s.unit_id = u.id where u.project_id = :'lp' and s.status <> 'Passed' order by u.code, s.seq \gexec
select format('select tests.login(''sup@a''); select api.request_inspection(%L, ''Commissioning'', null, %L); select tests.login(''qe@a''); select api.decide_inspection((select id from inspections where unit_id = %L and system = %L and status = ''Requested''), true, ''Certificate on file'');',
  u.id, c.system, u.id, c.system) from units u join unit_commissioning c on c.unit_id = u.id where u.project_id = :'lp' and c.status <> 'Passed' and u.code <> 'V-02' order by u.code \gexec
select tests.as_system(); select api.process_events(500); select api.scan_exceptions(); select api.process_events(500);
select tests.ok('L14 Villa completion', (select count(*) = 23 from inspections i join units u on u.id = i.unit_id where u.project_id = :'lp' and i.kind = 'Final' and i.status = 'Requested'),
  'final inspections requested automatically for the 23 units with every gate clear');
select tests.ok('L14 Villa completion', (select status = 'Open' and records @> '[{"kind":"unit"}]' from alerts where dedupe_key = 'handover:' || (select id from units where project_id = :'lp' and code = 'V-02')),
  'V-02 (commissioning pending) is held back with a handover-blocker alert');
select format('select tests.login(''sup@a''); select api.request_inspection(%L, ''Commissioning'', null, %L); select tests.login(''qe@a''); select api.decide_inspection((select id from inspections where unit_id = %L and system = %L and status = ''Requested''), true, ''Certificate on file'');',
  u.id, c.system, u.id, c.system) from units u join unit_commissioning c on c.unit_id = u.id where u.project_id = :'lp' and c.status <> 'Passed' \gexec
select tests.as_system(); select api.scan_exceptions(); select api.process_events(500);
select tests.ok('L14 Villa completion', (select count(*) = 24 from inspections i join units u on u.id = i.unit_id where u.project_id = :'lp' and i.kind = 'Final' and i.status = 'Requested'), 'V-02 follows once commissioning passes');
select tests.login('pd@a');
select tests.throws('L15 Final handover', format($$select api.hand_over_unit(%L)$$, (select id from units where project_id = :'lp' and code = 'V-01')), 'cannot be handed over', 'no unit is handed over before its final inspection passes');
select format('select tests.login(''qe@a''); select api.decide_inspection(%L, true, ''Final walk-through clear'');', i.id) from inspections i join units u on u.id = i.unit_id
  where u.project_id = :'lp' and i.kind = 'Final' and i.status = 'Requested' order by u.code \gexec
select tests.as_system();
select tests.ok('L14 Villa completion', (select bool_and(app.unit_readiness(id) ->> 'status' = 'Ready') from units where project_id = :'lp'), 'all 24 units Ready');
select tests.login('pd@a'); select format('select api.hand_over_unit(%L);', id) from units where project_id = :'lp' order by code \gexec
select tests.throws('L15 Final handover', format($$select api.final_property_handover(%L)$$, :'lp'), 'checklist item', 'property handover refused while the checklist is open');
select tests.login('pm@a');
select format('select api.complete_handover_item(%L, %L, %L, %s);', :'lp', item_key, case when item_key = 'pms_pos' then 'Not applicable' else 'Done' end,
  case when item_key = 'pms_pos' then 'null' else format('api.register_document(%L, %L, ''Certificate'', ''10 Handover & warranties'')', :'lp', 'Evidence: ' || label) end)
  from handover_items where project_id = :'lp' \gexec
select tests.login('pd@a'); select api.final_property_handover(:'lp');
select tests.as_system(); select api.scan_exceptions();
select tests.ok('L15 Final handover', (select stage = 'Handed over' and handed_over_at is not null from projects where id = :'lp'), 'property handed over after every unit and checklist item');
select tests.login('md@a'); select api.twin(:'lp') as tw_end \gset
select tests.as_system();
select tests.ok('L15 Final handover', (:'tw_end'::jsonb -> 'metrics' ->> 'units_handed_over')::int = 24 and :'tw_end'::jsonb -> 'metrics' ->> 'status' = 'Handed over' and (:'tw_end'::jsonb -> 'metrics' ->> 'completion_pct')::numeric = 100,
  'the twin reports 24/24 handed over and 100% verified completion');

-- ===== consistency across modules at the end =====
select tests.ok('L Consistency', not exists (select 1 from alerts where project_id = :'lp' and category in ('Safety','Handover') and status in ('Open','Acknowledged')), 'no open safety or handover alerts after handover');
select tests.ok('L Consistency', not exists (select 1 from automation_events where project_id = :'lp' and status in ('failed','dead')), 'no failed or dead automation events for the project');
select tests.ok('L Consistency', (select count(distinct table_name) >= 20 from audit_log where project_id = :'lp' or (new_row ->> 'project_id') = :'lp'), 'the audit trail covers every module the lifecycle touched');
select tests.ok('L Consistency', not exists (select 1 from app.cost_position_internal(:'lp') where actual <> paid_against_cost + accrued_unpaid + retention_held), 'cost identities still hold after handover');
