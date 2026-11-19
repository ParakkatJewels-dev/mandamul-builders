# Database schema

Generated from the migrated test database (Postgres 16, Supabase-compatible) by `scripts/schema-doc.py`. Do not edit by hand; regenerate after a migration.

Conventions: money is `numeric(18,2)` rupees in the database (whole paise in the app prototype) — never floating point; quantities are `numeric`; ids for business documents are readable numbers from `doc_counters` (e.g. `PO-26-0012`); every business table has row-level security; writes go only through `api.*` functions; tables marked *audited* have an append-only audit trigger; `version` columns give optimistic locking. A `?` after a type means the column may be empty.

**80 tables · 99 API functions · row-level security on 80 of 80 tables**

## Organisation, people and access

**app_modules** — 1 RLS policy  
`id text, label text, sensitive boolean`

**channel_config** — 1 RLS policy  
`org_id uuid, channel text, provider text?, enabled boolean`

**doc_counters** — 1 RLS policy  
`org_id uuid, prefix text, yy integer, last_no integer`

**org_settings** — 1 RLS policy · audited  
`org_id uuid, po_pm_limit numeric, po_pd_limit numeric, warn_pct numeric, flag_pct numeric, report_cutoff time without time zone, max_upload_mb integer, allowed_mime ARRAY, invoice_due_days integer, rabill_due_days integer, version integer, time_zone text, mfa_actions ARRAY`

**organizations** — 1 RLS policy  
`id uuid, name text, created_at timestamp with time zone`

**permission_defaults** — 1 RLS policy  
`role_id text, module text, action text`

**profiles** — 1 RLS policy · audited  
`user_id uuid, org_id uuid, full_name text, email text, role_id text, all_projects boolean, active boolean, version integer, vendor_id uuid?`

**project_members** — 1 RLS policy · audited  
`project_id text, user_id uuid, responsibility text`

**role_permissions** — 1 RLS policy · audited  
`org_id uuid, role_id text, module text, action text`

**roles** — 1 RLS policy · audited  
`org_id uuid, id text, name text, active boolean`

## Projects, land, units and schedule

**buildings** — 1 RLS policy  
`id uuid, project_id text, code text, name text, zone_id uuid?`

**clients** — 1 RLS policy  
`id uuid, org_id uuid, name text`

**floors** — 1 RLS policy · audited  
`id uuid, building_id uuid, level integer, name text`

**land_parcels** — 1 RLS policy  
`id uuid, project_id text, survey_no text?, area_acres numeric?, ownership text?, classification text?, coastal_zone text?, regulatory_note text?, regulatory_status text, validated_by text?`

**plan_templates** — 1 RLS policy  
`profile text, key text, seq integer, phase text, name text, duration_days integer, preds ARRAY, is_milestone boolean`

**progress_photos** — 1 RLS policy · audited  
`id uuid, project_id text, unit_id uuid?, work_package_id uuid?, task_id uuid?, storage_path text, thumb_path text?, caption text?, taken_on date, uploaded_by uuid?, created_at timestamp with time zone`

**projects** — 1 RLS policy · audited  
`id text, org_id uuid, name text, property_type text, location text, district text?, state text?, client_id uuid?, keys integer, built_up_sqft numeric?, start_date date, stage text, pm_id uuid?, contract_value numeric?, contingency_pct numeric, document_folders ARRAY, handed_over_at timestamp with time zone?, created_by uuid?, created_at timestamp with time zone, version integer`

**stage_templates** — 1 RLS policy  
`org_id uuid, id text, name text`

**task_dependencies** — 1 RLS policy  
`task_id uuid, pred_id uuid`

**tasks** — 1 RLS policy · audited  
`id uuid, project_id text, wbs text, phase text, name text, duration_days integer, is_milestone boolean, base_start date, base_finish date, act_start date?, act_finish date?, progress integer, owner_id uuid?, contractor_id uuid?, unit_id uuid?, delay_reason text?, recovery_plan text?, version integer, work_package_id uuid?`

**template_stages** — 1 RLS policy  
`org_id uuid, template_id text, seq integer, stage_key text, label text`

**unit_commissioning** — 1 RLS policy · audited  
`unit_id uuid, system text, status text, passed_inspection_id text?`

**unit_stages** — 1 RLS policy · audited  
`unit_id uuid, stage_key text, seq integer, label text, status text, passed_inspection_id text?, updated_at timestamp with time zone`

**units** — 1 RLS policy · audited  
`id uuid, project_id text, building_id uuid?, code text, name text, unit_type text, floor text?, template_id text, budget numeric, plan_x numeric?, plan_y numeric?, blocked_reason text?, handed_over_at timestamp with time zone?, version integer, zone_id uuid?, floor_id uuid?`

**work_packages** — 1 RLS policy · audited  
`id uuid, project_id text, code text, name text, zone_id uuid?, unit_id uuid?, cost_code text?, budget numeric`

**zones** — 1 RLS policy · audited  
`id uuid, project_id text, code text, name text, kind text, plan_x numeric?, plan_y numeric?`

## Budget and cost

**boq_items** — 1 RLS policy · audited  
`id uuid, project_id text, code text, ref text, description text, unit text, qty numeric, rate numeric, gst_pct numeric, executed_qty numeric, material_id uuid?, material_factor numeric?`

**budget_lines** — 1 RLS policy · audited  
`version_id uuid, code text, amount numeric`

**budget_profiles** — 1 RLS policy  
`profile text, code text, pct numeric`

**budget_versions** — 1 RLS policy · audited  
`id uuid, project_id text, v integer, status text, reason text, created_by uuid?, created_at timestamp with time zone, decided_at timestamp with time zone?, approval_id text?`

**cost_codes** — 1 RLS policy  
`org_id uuid, code text, name text, is_contingency boolean`

**etc_estimates** — 1 RLS policy · audited  
`project_id text, code text, amount numeric, basis text, updated_by uuid?, updated_at timestamp with time zone`

**feasibility_scenarios** — 1 RLS policy · audited  
`org_id uuid, name text, adr_factor numeric, occupancy_delta_pp numeric, cost_factor numeric, note text`

**feasibility_studies** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text?, name text, location text?, land_area_acres numeric?, ownership text?, land_cost numeric, lease_annual numeric, keys integer, built_up_sqft numeric, build_cost_per_sqft numeric, infra_cost numeric, ffe_per_key numeric, preopening_cost numeric, contingency_pct numeric, adr numeric, occupancy_pct numeric, other_revenue_pct numeric, opex_pct numeric, mgmt_fee_pct numeric, regulatory_note text?, regulatory_status text, regulatory_validated_by text?, status text, created_by uuid?, created_at timestamp with time zone, updated_at timestamp with time zone, version integer`

**forecast_scenarios** — 1 RLS policy · audited  
`org_id uuid, scenario text, etc_factor numeric, pending_variation_pct numeric, delay_days_adjust integer, note text`

## Procurement, stock and payables

**goods_receipts** — 1 RLS policy · audited  
`id text, po_id text, received_on date, qty numeric, qc text, accepted_value numeric, note text?, received_by uuid?, created_at timestamp with time zone`

**material_requests** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, code text, unit_id uuid?, item text, qty numeric, uom text, needed_by date, urgency text, requested_by uuid, status text, duplicate_note text?, created_at timestamp with time zone, material_id uuid?, origin text`

**material_reservations** — 1 RLS policy · audited  
`id uuid, project_id text, material_id uuid, task_id uuid?, qty numeric, needed_by date, status text, created_by uuid?, created_at timestamp with time zone`

**material_shortages** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, material_id uuid, qty numeric, needed_by date, task_id uuid?, note text?, reported_by uuid, reported_at timestamp with time zone, status text, assessment jsonb?, mr_id text?`

**materials** — 1 RLS policy · audited  
`id uuid, org_id uuid, code text, name text, uom text, category text, cost_code text?, lead_days integer, active boolean`

**payment_requests** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, kind text, ref text, vendor_id uuid, amount numeric, due_date date?, status text, prepared_at timestamp with time zone`

**payments** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, vendor_id uuid, kind text, invoice_id text?, ra_bill_id text?, contract_id text?, amount numeric, tds numeric, paid_on date, bank_reference text, reconciled boolean, reconciled_at timestamp with time zone?, created_by uuid?, created_at timestamp with time zone`

**purchase_orders** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, code text, vendor_id uuid, mr_id text?, unit_id uuid?, item text, uom text, qty numeric, rate numeric, gst_pct numeric, amount numeric?, tax numeric?, total numeric?, status text, available_at_request numeric?, over_budget numeric, not_lowest_reason text?, expected_delivery date?, approval_id text?, created_by uuid?, created_at timestamp with time zone, approved_at timestamp with time zone?, version integer, closed_reason text?, closed_by uuid?, closed_at timestamp with time zone?, material_id uuid?, work_package_id uuid?`

**quotations** — 1 RLS policy · audited  
`id uuid, mr_id text, vendor_id uuid, rate numeric, gst_pct numeric, lead_days integer, note text?`

**rfqs** — 1 RLS policy · audited  
`id text, org_id uuid, material_id uuid, qty numeric, needed_by date, lines jsonb, vendors ARRAY, status text, note text?, created_by uuid?, created_at timestamp with time zone`

**stock_moves** — 1 RLS policy · audited  
`id bigint, org_id uuid, project_id text, material_id uuid, kind text, qty numeric, ref_kind text?, ref_id text?, task_id uuid?, moved_on date, by_user uuid?, note text?, created_at timestamp with time zone`

**vendor_invoices** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, vendor_id uuid, po_id text, invoice_no text, invoice_date date, qty numeric, rate numeric, gst_pct numeric, amount numeric?, tax numeric?, total numeric?, match_status text, match_notes text?, status text, due_date date?, approval_id text?, created_by uuid?, created_at timestamp with time zone`

**vendor_prices** — 1 RLS policy · audited  
`id uuid, org_id uuid, material_id uuid, vendor_id uuid, rate numeric, gst_pct numeric, min_qty numeric, lead_days integer, valid_from date, valid_to date?, approved_by uuid?, approved_at timestamp with time zone`

**vendors** — 1 RLS policy · audited  
`id uuid, org_id uuid, name text, category text, city text?, gstin text?, approved boolean, credit_days integer, created_at timestamp with time zone`

## Contracts and contractor billing

**claim_lines** — 1 RLS policy · audited  
`claim_id text, line_no integer, contract_item_id uuid?, description text, claimed_qty numeric, claimed_rate numeric`

**contract_items** — 1 RLS policy · audited  
`id uuid, contract_id text, boq_item_id uuid?, description text, uom text, qty numeric, rate numeric`

**contract_variations** — 1 RLS policy · audited  
`id text, contract_id text, description text, amount numeric, status text, approval_id text?, created_by uuid?, created_at timestamp with time zone`

**contractor_claims** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, contract_id text, claim_no integer, submitted_by uuid, submitted_at timestamp with time zone, note text?, status text, claimed_gross numeric, assessment jsonb?, ra_bill_id text?`

**contractor_score_weights** — 1 RLS policy · audited  
`org_id uuid, metric text, weight numeric, min_sample integer, formula text`

**contracts** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, vendor_id uuid, code text, unit_id uuid?, title text, retention_pct numeric, advance_amount numeric, advance_recovery_pct numeric, tds_pct numeric, gst_pct numeric, start_date date, end_date date, status text, over_budget numeric, approval_id text?, created_by uuid?, created_at timestamp with time zone, version integer, closed_reason text?, closed_by uuid?, closed_at timestamp with time zone?, work_package_id uuid?`

**measurements** — 1 RLS policy · audited  
`id uuid, contract_item_id uuid, qty numeric, measured_on date, unit_id uuid?, location_note text?, recorded_by uuid, status text, verified_by uuid?, verified_at timestamp with time zone?, ra_bill_id text?`

**ra_bill_lines** — 1 RLS policy  
`bill_id text, contract_item_id uuid, prev_qty numeric, this_qty numeric, cum_qty numeric, rate numeric, amount numeric`

**ra_bills** — 1 RLS policy · audited  
`id text, contract_id text, bill_no integer, gross numeric, gst numeric, retention numeric, advance_recovery numeric, tds numeric, other_deductions numeric, net_payable numeric, status text, approval_id text?, due_date date?, created_by uuid?, created_at timestamp with time zone`

## Site, quality and documents

**daily_reports** — 1 RLS policy · audited  
`id text, project_id text, report_date date, submitted_by uuid, weather text?, labour jsonb, issues text?, safety text?, status text, review_note text?, verified_by uuid?, approval_id text?, created_at timestamp with time zone`

**document_links** — 1 RLS policy · audited  
`document_id text, link_kind text, link_id text`

**document_versions** — 1 RLS policy · audited  
`id uuid, document_id text, rev text, storage_path text, file_name text, mime text, size_bytes bigint, status text, note text?, uploaded_by uuid?, uploaded_at timestamp with time zone`

**documents** — 1 RLS policy · audited  
`id text, project_id text, title text, doc_type text, folder text?, tags ARRAY, expiry date?, created_at timestamp with time zone`

**inspections** — 1 RLS policy · audited  
`id text, project_id text, unit_id uuid?, kind text, stage_key text?, system text?, requested_by uuid, requested_at timestamp with time zone, status text, inspector_id uuid?, decided_at timestamp with time zone?, notes text?`

**report_work_lines** — 1 RLS policy · audited  
`report_id text, task_id uuid, progress_to integer?, boq_item_id uuid?, qty numeric?, note text?`

**risks** — 1 RLS policy · audited  
`id text, project_id text, title text, source text, severity text, status text, owner_id uuid?, dedupe_key text?, created_at timestamp with time zone`

**snags** — 1 RLS policy · audited  
`id text, project_id text, unit_id uuid?, inspection_id text?, title text, severity text, category text, assignee_vendor_id uuid?, due_date date?, status text, raised_by uuid, fixed_at timestamp with time zone?, closed_by uuid?, closed_at timestamp with time zone?, created_at timestamp with time zone`

## Handover and assets

**assets** — 1 RLS policy · audited  
`id uuid, project_id text, unit_id uuid?, name text, serial_no text?, warranty_id uuid?`

**ffe_items** — 1 RLS policy · audited  
`id uuid, project_id text, unit_id uuid, item text, category text, qty integer, status text, po_id text?`

**handover_items** — 1 RLS policy · audited  
`id uuid, project_id text, item_key text, label text, status text, evidence_document_id text?, done_by uuid?, done_at timestamp with time zone?`

**warranties** — 1 RLS policy · audited  
`id uuid, project_id text, unit_id uuid?, item text, vendor_id uuid?, start_date date, end_date date, terms text?, kind text, response_hours integer`

**warranty_claims** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, warranty_id uuid, unit_id uuid?, title text, description text?, in_warranty boolean, reported_by uuid, reported_at timestamp with time zone, response_due_at timestamp with time zone, status text, responded_at timestamp with time zone?, responded_by uuid?, response_note text?, resolved_at timestamp with time zone?, resolved_by uuid?, resolution text?, evidence_document text?`

## Approvals, automation, alerts and audit

**alerts** — 1 RLS policy · audited  
`id bigint, org_id uuid, project_id text?, category text, severity text, module text, title text, detail text?, owner_id uuid?, owner_role text?, due_at timestamp with time zone?, records jsonb, next_action text, dedupe_key text, status text, suppressed_until timestamp with time zone?, source_event bigint?, notified_severity text?, acknowledged_by uuid?, acknowledged_at timestamp with time zone?, resolved_by uuid?, resolved_at timestamp with time zone?, resolution text?, escalated_at timestamp with time zone?, created_at timestamp with time zone, updated_at timestamp with time zone`

**approval_steps** — 1 RLS policy · audited  
`approval_id text, seq integer, role_id text, module text, label text, status text, decided_by uuid?, decided_at timestamp with time zone?, comment text?`

**approvals** — 1 RLS policy · audited  
`id text, org_id uuid, project_id text, kind text, ref text, title text, amount numeric?, requested_by uuid, requested_at timestamp with time zone, status text, closed_at timestamp with time zone?, ctx jsonb`

**audit_log** — 1 RLS policy · audited  
`id bigint, org_id uuid?, at timestamp with time zone, user_id uuid?, role_id text?, table_name text, record_id text?, project_id text?, action text, old_row jsonb?, new_row jsonb?, note text?`

**automation_actions** — 1 RLS policy  
`id bigint, org_id uuid, project_id text?, event_id bigint?, playbook text, step integer, action text, idem_key text, status text, result jsonb, created_at timestamp with time zone`

**automation_events** — 1 RLS policy  
`id bigint, org_id uuid, project_id text?, event text, dedupe_key text, payload jsonb, status text, attempts integer, next_attempt_at timestamp with time zone, last_error text?, escalated_at timestamp with time zone?, created_at timestamp with time zone, processed_at timestamp with time zone?`

**automation_rules** — 1 RLS policy · audited  
`org_id uuid, id text, name text, event text, notify_roles ARRAY, escalate_role text?, escalate_after_hours integer?, channels ARRAY, creates_risk boolean, enabled boolean, playbook text?, params jsonb`

**notifications** — 1 RLS policy  
`id bigint, org_id uuid, user_id uuid, channel text, delivery text, text text, link text?, event_id bigint?, read_at timestamp with time zone?, created_at timestamp with time zone`

**retention_policies** — 1 RLS policy  
`org_id uuid, data text, keep_days integer`

## API functions (schema `api`, security definer, permission-checked inside)

- `api.ack_alert(p_alert bigint, p_note text)`
- `api.add_boq_items(p_project text, p_items jsonb)`
- `api.add_document_version(p_document text, p_rev text, p_storage_path text, p_file_name text, p_mime text, p_size bigint, p_note text, p_submit boolean)`
- `api.add_ffe_item(p_unit uuid, p_item text, p_category text, p_qty integer)`
- `api.add_material(p_code text, p_name text, p_uom text, p_category text, p_cost_code text, p_lead_days integer)`
- `api.add_progress_photo(p_project text, p_storage_path text, p_unit uuid, p_work_package uuid, p_task uuid, p_caption text, p_taken_on date, p_thumb text)`
- `api.add_quotation(p_mr text, p_vendor uuid, p_rate numeric, p_gst numeric, p_lead integer, p_note text)`
- `api.alert_feed(p_severity text, p_category text, p_project text, p_status text, p_after_id bigint, p_limit integer)`
- `api.assign_contract(p_contract text, p_work_package uuid, p_unit uuid)`
- `api.assign_task(p_task uuid, p_work_package uuid, p_contractor uuid, p_unit uuid)`
- `api.audit_page(p_project text, p_before bigint, p_limit integer)`
- `api.cancel_po(p_po text, p_reason text, p_reopen_request boolean)`
- `api.cash_requirement(p_project text, p_days integer)`
- `api.close_contract(p_contract text, p_reason text)`
- `api.close_snag(p_snag text)`
- `api.complete_handover_item(p_project text, p_key text, p_status text, p_evidence text)`
- `api.contingency(p_project text, OUT contingency_budget numeric, OUT overruns numeric, OUT available numeric)`
- `api.contract_detail(p_contract text)`
- `api.contract_list(p_project text)`
- `api.contractor_scores(p_project text)`
- `api.cost_code_list()`
- `api.cost_position(p_project text)`
- `api.create_contract(p jsonb)`
- `api.create_project(p jsonb)`
- `api.create_ra_bill(p_contract text, p_other_deductions numeric)`
- `api.daily_report_list(p_project text, p_limit integer)`
- `api.decide(p_approval text, p_decision text, p_comment text, p_expected_seq integer)`
- `api.decide_claim(p_claim text, p_decision text, p_note text)`
- `api.decide_inspection(p_inspection text, p_passed boolean, p_notes text, p_snags jsonb)`
- `api.delivery_delays(p_project text)`
- `api.draft_rfq(p_material uuid, p_lines jsonb, p_vendors uuid[], p_note text)`
- `api.feasibility(p_id text)`
- `api.feasibility_list()`
- `api.final_property_handover(p_project text)`
- `api.financial_intelligence(p_project text)`
- `api.hand_over_unit(p_unit uuid)`
- `api.issue_stock(p_project text, p_material uuid, p_qty numeric, p_task uuid, p_note text)`
- `api.link_document(p_document text, p_kind text, p_link text)`
- `api.list_purchase_orders(p_project text, p_status text, p_search text, p_before timestamp with time zone, p_limit integer)`
- `api.mark_notifications_read(p_ids bigint[])`
- `api.mark_snag_fixed(p_snag text)`
- `api.mr_list(p_project text)`
- `api.my_approvals()`
- `api.payment_queue(p_project text)`
- `api.po_detail(p_po text)`
- `api.po_tracking(p_project text)`
- `api.portfolio_summary()`
- `api.process_events(p_limit integer)`
- `api.procurement_plan(p_days integer)`
- `api.purge_expired()`
- `api.raise_mr(p_project text, p_code text, p_item text, p_qty numeric, p_uom text, p_needed_by date, p_urgency text, p_unit uuid, p_duplicate_note text)`
- `api.raise_po(p_mr text, p_vendor uuid, p_not_lowest_reason text, p_expected_delivery date)`
- `api.raise_snag(p_unit uuid, p_title text, p_severity text, p_category text, p_vendor uuid, p_due date)`
- `api.raise_warranty_claim(p_warranty uuid, p_title text, p_description text)`
- `api.reconcile_payment(p_payment text, p_statement_ref text)`
- `api.record_grn(p_po text, p_qty numeric, p_qc text, p_received_on date, p_note text)`
- `api.record_invoice(p_po text, p_invoice_no text, p_invoice_date date, p_qty numeric, p_rate numeric, p_gst numeric)`
- `api.record_measurement(p_item uuid, p_qty numeric, p_measured_on date, p_unit uuid, p_note text)`
- `api.record_payment(p_kind text, p_ref text, p_amount numeric, p_tds numeric, p_paid_on date, p_bank_ref text)`
- `api.register_document(p_project text, p_title text, p_doc_type text, p_folder text, p_tags text[], p_expiry date)`
- `api.replay_event(p_event bigint)`
- `api.report_shortage(p_project text, p_material uuid, p_qty numeric, p_needed_by date, p_task uuid, p_note text)`
- `api.request_budget_revision(p_project text, p_changes jsonb, p_reason text)`
- `api.request_inspection(p_unit uuid, p_kind text, p_stage text, p_system text)`
- `api.request_variation(p_contract text, p_description text, p_amount numeric)`
- `api.reserve_material(p_project text, p_material uuid, p_task uuid, p_qty numeric, p_needed_by date)`
- `api.resolve_alert(p_alert bigint, p_resolution text)`
- `api.resolve_warranty_claim(p_claim text, p_resolution text, p_evidence_document text)`
- `api.respond_warranty_claim(p_claim text, p_note text)`
- `api.save_feasibility(p jsonb, p_expected_version integer)`
- `api.scan_exceptions()`
- `api.session_info()`
- `api.set_automation_rule(p_rule text, p jsonb)`
- `api.set_estimate(p_project text, p_code text, p_amount numeric, p_basis text)`
- `api.set_ffe_status(p_item uuid, p_status text)`
- `api.set_org_settings(p jsonb, p_expected_version integer)`
- `api.set_permission(p_role text, p_module text, p_action text, p_granted boolean)`
- `api.set_project_member(p_project text, p_user uuid, p_responsibility text, p_member boolean)`
- `api.set_request_material(p_mr text, p_material uuid)`
- `api.set_twin_structure(p_project text, p jsonb)`
- `api.set_user_access(p_user uuid, p_role text, p_all_projects boolean, p_active boolean, p_expected_version integer)`
- `api.set_vendor_price(p_material uuid, p_vendor uuid, p_rate numeric, p_gst numeric, p_min_qty numeric, p_lead integer, p_from date, p_to date)`
- `api.short_close_po(p_po text, p_reason text)`
- `api.simulate_delay(p_task uuid, p_days integer)`
- `api.snooze_alert(p_alert bigint, p_until timestamp with time zone, p_reason text)`
- `api.stock_position(p_project text)`
- `api.submit_claim(p_contract text, p_lines jsonb, p_note text)`
- `api.submit_daily_report(p_project text, p_date date, p_weather text, p_labour jsonb, p_issues text, p_safety text, p_work jsonb)`
- `api.submit_recovery_plan(p_task uuid, p_plan text, p_expected_finish date)`
- `api.task_list(p_project text)`
- `api.twin(p_project text)`
- `api.twin_tasks(p_project text, p_unit uuid, p_work_package uuid)`
- `api.unit_readiness(p_project text)`
- `api.update_task(p_task uuid, p_expected_version integer, p_progress integer, p_act_start date, p_act_finish date, p_delay_reason text, p_recovery text)`
- `api.validate_feasibility_regulatory(p_id text, p_validated_by text)`
- `api.vendor_comparison(p_material uuid)`
- `api.vendor_list()`
- `api.verify_measurement(p_measurement uuid, p_accept boolean)`
- `api.warranty_register(p_project text)`
