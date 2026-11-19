-- Batch 13: feasibility (acceptance item 2) and warranty & defect liability (item 24). Runs last. Synthetic data only.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select tests.as_system();
select id as lp from projects where name like 'Vembanad Lake Resort%' \gset

-- ---------- feasibility ----------
select tests.login('md@a');
select api.save_feasibility('{"name": "Vagamon ridge site (SYNTHETIC)", "location": "Vagamon, Idukki", "land_area_acres": 6.5, "ownership": "Freehold purchase",
  "land_cost": 80000000, "keys": 24, "built_up_sqft": 60000, "build_cost_per_sqft": 4500, "infra_cost": 30000000, "ffe_per_key": 1200000, "preopening_cost": 15000000,
  "contingency_pct": 7.5, "adr": 18000, "occupancy_pct": 62, "other_revenue_pct": 35, "opex_pct": 55, "regulatory_note": "Hill-area building rules to be confirmed"}'::jsonb) as fs \gset
select api.feasibility(:'fs') as f \gset
select tests.ok('B13 Feasibility', (:'f'::jsonb -> 'base' ->> 'investment')::numeric = 448460000 and (:'f'::jsonb -> 'base' ->> 'ebitda')::numeric = 59390172
    and (:'f'::jsonb -> 'base' ->> 'roi_pct')::numeric = 13.24 and (:'f'::jsonb -> 'base' ->> 'payback_years')::numeric = 7.6,
  'investment, EBITDA, ROI and payback match the hand calculation exactly (₹44.85 Cr, ₹5.94 Cr, 13.24%, 7.6 years)', :'f'::jsonb ->> 'base');
select tests.ok('B13 Feasibility', (select bool_and(a.v < b.v) from (select (x -> 'result' ->> 'payback_years')::numeric v, row_number() over () n from jsonb_array_elements(:'f'::jsonb -> 'scenarios') x) a
    join (select (x -> 'result' ->> 'payback_years')::numeric v, row_number() over () n from jsonb_array_elements(:'f'::jsonb -> 'scenarios') x) b on b.n = a.n + 1) is false
    and jsonb_array_length(:'f'::jsonb -> 'scenarios') = 3,
  'three scenarios: conservative pays back slowest, optimistic fastest', (select string_agg((x ->> 'name') || ' ' || (x -> 'result' ->> 'payback_years'), ', ') from jsonb_array_elements(:'f'::jsonb -> 'scenarios') x));
select tests.ok('B13 Feasibility', jsonb_array_length(:'f'::jsonb -> 'sensitivity') = 3 and jsonb_array_length(:'f'::jsonb -> 'assumptions') >= 5
    and (:'f'::jsonb -> 'study' ->> 'regulatory_status') = 'Estimate — not validated',
  'sensitivity on ADR, occupancy and cost; assumptions listed; regulatory data stays an estimate until validated');
select tests.throws('B13 Feasibility', format('select api.save_feasibility(%L::jsonb, 99)', json_build_object('id', :'fs', 'adr', 20000)), 'someone else changed', 'a stale edit is refused');
select tests.throws('B13 Feasibility', format('select api.validate_feasibility_regulatory(%L, %L)', :'fs', 'x'), 'qualified professional', 'validating the regulatory data needs the professional named');
select api.validate_feasibility_regulatory(:'fs', 'Ar. S. Menon, Council of Architecture reg. CA/2011/00000 (synthetic)');
select tests.ok('B13 Feasibility', (select regulatory_status = 'Validated by qualified professional' from feasibility_studies where id = :'fs'), 'the MD records who validated the regulatory assumptions; it is audited',
  (select count(*)::text || ' audit rows' from audit_log where table_name = 'feasibility_studies' and record_id = :'fs'));
select tests.login('sup@a');
select tests.throws('B13 Feasibility', format('select api.feasibility(%L)', :'fs'), 'budget rights|permission', 'a site supervisor cannot read investment figures');
select tests.login('md@b');
select tests.throws('B13 Feasibility', format('select api.feasibility(%L)', :'fs'), 'not found', 'another organisation cannot see the study');

-- ---------- warranty and defect liability ----------
select tests.as_system();
insert into warranties (project_id, unit_id, item, vendor_id, start_date, end_date, terms, kind, response_hours)
select :'lp', (select id from units where project_id = :'lp' order by code limit 1), 'Pool filtration pump (SYNTHETIC)', (select id from vendors where name like 'Bluewave%'),
       current_date - 30, current_date + 700, '24 months parts and labour', 'Equipment', 48 returning id as w_ok \gset
insert into warranties (project_id, item, vendor_id, start_date, end_date, terms, kind, response_hours)
select :'lp', 'Waterproofing, roof terrace (SYNTHETIC)', (select id from vendors where name like 'Western%'), current_date - 800, current_date - 70, '24 months workmanship', 'Defect liability period', 72 returning id as w_old \gset
select tests.login('sup@a');
select tests.throws('B13 Warranty', format('select api.raise_warranty_claim(%L, %L)', :'w_ok', 'Pump tripping every hour'), 'permission|no access', 'a site supervisor cannot raise a warranty claim (handover view only)');
select tests.login('pm@a');
select api.raise_warranty_claim(:'w_ok', 'Pump tripping every hour', 'Villa pool pump trips on overload') as wc \gset
select api.raise_warranty_claim(:'w_old', 'Seepage at terrace edge') as wc_old \gset
select tests.ok('B13 Warranty', (select in_warranty and response_due_at between now() + interval '47 hours' and now() + interval '49 hours' from warranty_claims where id = :'wc')
    and (select not in_warranty from warranty_claims where id = :'wc_old'),
  'a claim records whether the item is still in warranty and its response deadline (48 h for the pump)');
select tests.throws('B13 Warranty', format('select api.respond_warranty_claim(%L, %L)', :'wc', 'ok'), 'say what', 'a response must say what will be done');
select api.respond_warranty_claim(:'wc', 'Vendor technician visiting tomorrow 10:00');
select tests.throws('B13 Warranty', format('select api.resolve_warranty_claim(%L, %L, %L)', :'wc', 'Replaced the capacitor', 'DOC-NONE'), 'evidence', 'a claim cannot be closed without evidence');
select tests.as_system(); select id as doc from documents where project_id = :'lp' order by created_at limit 1 \gset
select tests.login('pm@a');
select api.resolve_warranty_claim(:'wc', 'Replaced the starter capacitor; tested for 2 hours', :'doc');
select api.warranty_register(:'lp') as reg \gset
select tests.ok('B13 Warranty', (select status = 'Resolved' and evidence_document = :'doc' from warranty_claims where id = :'wc')
    and (:'reg'::jsonb ->> 'average_response_hours') is not null and jsonb_array_length(:'reg'::jsonb -> 'warranties') >= 2,
  'resolved with evidence; the register shows warranties, days left, open claims and the average response time', :'reg'::jsonb ->> 'average_response_hours');
select tests.login('md@b');
select tests.throws('B13 Warranty', format('select api.warranty_register(%L)', :'lp'), 'no access', 'another organisation cannot read the warranty register');
