-- M Andamul Development OS · 1300 Phase 3, batch 7: performance and data retention
-- Measured against the synthetic volume set in supabase/tests/perf (see docs/perf/before.txt and after.txt).
-- 1. index every single-column foreign key that had none (61 found by the audit) and the list orders people use
-- 2. row-level security evaluated once per query instead of once per row
-- 3. the cost engine computed set-based (one pass per table instead of several sub-queries per cost code)
-- 4. paged, server-filtered list functions
-- 5. retention policy for notifications, processed events and automation traces

-- ---------- 1. indexes ----------
do $$ declare r record; begin
  for r in select c.conrelid::regclass::text tbl, a.attname col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
             and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]) loop
    execute format('create index if not exists %I on %s (%I)', 'fk_' || replace(r.tbl, '.', '_') || '_' || r.col, r.tbl, r.col);
  end loop;
end $$;
create index if not exists purchase_orders_recent on public.purchase_orders (created_at desc);
create index if not exists purchase_orders_project_status on public.purchase_orders (project_id, status);
create index if not exists vendor_invoices_status_due on public.vendor_invoices (status, due_date);
create index if not exists approvals_pending on public.approvals (status, requested_at) where status = 'Pending';
create index if not exists approval_steps_pending on public.approval_steps (role_id, status) where status = 'pending';
create index if not exists notifications_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists audit_log_project_at on public.audit_log (project_id, at desc);
create index if not exists snags_project_status on public.snags (project_id, status, created_at desc);
create index if not exists daily_reports_project_date on public.daily_reports (project_id, report_date desc);
create index if not exists tasks_project_open on public.tasks (project_id, base_finish) where act_finish is null;
create index if not exists inspections_unit_kind on public.inspections (unit_id, kind, status);
create index if not exists automation_events_queue on public.automation_events (status, next_attempt_at) where status in ('queued','failed');
create index if not exists goods_receipts_po_pass on public.goods_receipts (po_id) where qc = 'Pass';
create index if not exists payments_invoice on public.payments (invoice_id) where invoice_id is not null;
create index if not exists payments_bill on public.payments (ra_bill_id) where ra_bill_id is not null;

-- ---------- 2. row-level security: the visible projects and the permission are computed once per query ----------
create or replace function app.visible_projects() returns setof text language sql stable security definer set search_path = public as $$
  select pr.id from projects pr join profiles p on p.org_id = pr.org_id and p.user_id = auth.uid() and p.active
  where p.all_projects or exists (select 1 from project_members m where m.project_id = pr.id and m.user_id = p.user_id)
$$;
revoke all on function app.visible_projects() from public;
grant execute on function app.visible_projects() to authenticated;
-- same rules as before (membership AND role permission), rewritten so the planner evaluates them once:
alter policy alerts_scope on public.alerts using (((org_id = ( SELECT app.org() AS org)) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR ((project_id IS NOT NULL) AND ((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND app.has_perm(module, 'view'::text))) OR ((project_id IS NULL) AND app.has_perm(module, 'view'::text)))));
alter policy approval_steps_scope on public.approval_steps using ((EXISTS ( SELECT 1 FROM approvals a WHERE ((a.id = approval_steps.approval_id) AND ((a.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('approvals'::text, 'view'::text) AS has_perm))))));
alter policy approvals_scope on public.approvals using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('approvals'::text, 'view'::text) AS has_perm)));
alter policy assets_scope on public.assets using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('handover'::text, 'view'::text) AS has_perm)));
alter policy audit_read on public.audit_log using (((org_id = ( SELECT app.org() AS org)) AND ( SELECT app.has_perm('audit'::text, 'view'::text) AS has_perm) AND ((project_id IS NULL) OR (project_id IN ( SELECT app.visible_projects() AS visible_projects)))));
alter policy actions_scope on public.automation_actions using (((org_id = ( SELECT app.org() AS org)) AND ( SELECT app.has_perm('settings'::text, 'view'::text) AS has_perm)));
alter policy events_admin on public.automation_events using (((org_id = ( SELECT app.org() AS org)) AND ( SELECT app.has_perm('settings'::text, 'view'::text) AS has_perm)));
alter policy automation_rules_org on public.automation_rules using ((org_id = ( SELECT app.org() AS org)));
alter policy boq_items_scope on public.boq_items using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('boq'::text, 'view'::text) AS has_perm)));
alter policy budget_lines_scope on public.budget_lines using ((EXISTS ( SELECT 1 FROM budget_versions v WHERE ((v.id = budget_lines.version_id) AND ((v.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('budget'::text, 'view'::text) AS has_perm))))));
alter policy budget_versions_scope on public.budget_versions using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('budget'::text, 'view'::text) AS has_perm)));
alter policy buildings_scope on public.buildings using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm)));
alter policy channel_config_org on public.channel_config using ((org_id = ( SELECT app.org() AS org)));
alter policy claim_lines_scope on public.claim_lines using ((EXISTS ( SELECT 1 FROM contractor_claims c WHERE ((c.id = claim_lines.claim_id) AND (((c.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm)) OR (c.submitted_by = ( SELECT auth.uid() AS uid)))))));
alter policy clients_org on public.clients using ((org_id = ( SELECT app.org() AS org)));
alter policy contract_items_scope on public.contract_items using ((EXISTS ( SELECT 1 FROM contracts c WHERE ((c.id = contract_items.contract_id) AND ((c.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm))))));
alter policy variations_scope on public.contract_variations using ((EXISTS ( SELECT 1 FROM contracts c WHERE ((c.id = contract_variations.contract_id) AND ((c.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm))))));
alter policy claims_scope on public.contractor_claims using ((((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm)) OR (submitted_by = ( SELECT auth.uid() AS uid))));
alter policy weights_org on public.contractor_score_weights using ((org_id = ( SELECT app.org() AS org)));
alter policy contracts_scope on public.contracts using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm)));
alter policy cost_codes_org on public.cost_codes using ((org_id = ( SELECT app.org() AS org)));
alter policy reports_scope on public.daily_reports using ((((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('site'::text, 'view'::text) AS has_perm)) AND ((status <> 'Draft'::text) OR (submitted_by = ( SELECT auth.uid() AS uid)))));
alter policy doc_links_scope on public.document_links using ((EXISTS ( SELECT 1 FROM documents d WHERE ((d.id = document_links.document_id) AND ((d.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('documents'::text, 'view'::text) AS has_perm))))));
alter policy doc_versions_scope on public.document_versions using ((EXISTS ( SELECT 1 FROM documents d WHERE ((d.id = document_versions.document_id) AND ((d.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('documents'::text, 'view'::text) AS has_perm))))));
alter policy documents_scope on public.documents using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('documents'::text, 'view'::text) AS has_perm)));
alter policy etc_estimates_scope on public.etc_estimates using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('budget'::text, 'view'::text) AS has_perm)));
alter policy ffe_items_scope on public.ffe_items using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('handover'::text, 'view'::text) AS has_perm)));
alter policy floors_scope on public.floors using ((EXISTS ( SELECT 1 FROM buildings b WHERE ((b.id = floors.building_id) AND ((b.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm))))));
alter policy scenarios_org on public.forecast_scenarios using ((org_id = ( SELECT app.org() AS org)));
alter policy grn_scope on public.goods_receipts using (((EXISTS ( SELECT 1 FROM purchase_orders p WHERE ((p.id = goods_receipts.po_id) AND ((p.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm))))) AND ( SELECT app.has_perm('budget'::text, 'view'::text) AS has_perm)));
alter policy handover_items_scope on public.handover_items using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('handover'::text, 'view'::text) AS has_perm)));
alter policy inspections_scope on public.inspections using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('quality'::text, 'view'::text) AS has_perm)));
alter policy land_parcels_scope on public.land_parcels using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm)));
alter policy material_requests_scope on public.material_requests using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm)));
alter policy reservations_scope on public.material_reservations using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm)));
alter policy shortages_scope on public.material_shortages using ((((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm)) OR ((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('site'::text, 'view'::text) AS has_perm))));
alter policy materials_org on public.materials using ((org_id = ( SELECT app.org() AS org)));
alter policy measurements_scope on public.measurements using ((EXISTS ( SELECT 1 FROM (contract_items ci JOIN contracts c ON ((c.id = ci.contract_id))) WHERE ((ci.id = measurements.contract_item_id) AND (((c.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('site'::text, 'view'::text) AS has_perm)) OR ((c.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm)))))));
alter policy notifications_own on public.notifications using ((user_id = ( SELECT auth.uid() AS uid)));
alter policy org_settings_org on public.org_settings using ((org_id = ( SELECT app.org() AS org)));
alter policy org_read on public.organizations using ((id = ( SELECT app.org() AS org)));
alter policy payment_requests_scope on public.payment_requests using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('payments'::text, 'view'::text) AS has_perm)));
alter policy payments_scope on public.payments using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('payments'::text, 'view'::text) AS has_perm)));
alter policy profiles_org on public.profiles using ((org_id = ( SELECT app.org() AS org)));
alter policy photos_scope on public.progress_photos using ((((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('site'::text, 'view'::text) AS has_perm)) OR ((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm))));
alter policy project_members_scope on public.project_members using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm)));
alter policy projects_scope on public.projects using (((org_id = ( SELECT app.org() AS org)) AND ((id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm))));
alter policy purchase_orders_scope on public.purchase_orders using ((((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm)) AND ( SELECT app.has_perm('budget'::text, 'view'::text) AS has_perm)));
alter policy quotations_scope on public.quotations using (((EXISTS ( SELECT 1 FROM material_requests m WHERE ((m.id = quotations.mr_id) AND ((m.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm))))) AND ( SELECT app.has_perm('budget'::text, 'view'::text) AS has_perm)));
alter policy ra_lines_scope on public.ra_bill_lines using ((EXISTS ( SELECT 1 FROM (ra_bills b JOIN contracts c ON ((c.id = b.contract_id))) WHERE ((b.id = ra_bill_lines.bill_id) AND ((c.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm))))));
alter policy ra_bills_scope on public.ra_bills using ((EXISTS ( SELECT 1 FROM contracts c WHERE ((c.id = ra_bills.contract_id) AND ((c.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('contracts'::text, 'view'::text) AS has_perm))))));
alter policy report_lines_scope on public.report_work_lines using ((EXISTS ( SELECT 1 FROM daily_reports r WHERE ((r.id = report_work_lines.report_id) AND ((r.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('site'::text, 'view'::text) AS has_perm))))));
alter policy rfqs_scope on public.rfqs using (((org_id = ( SELECT app.org() AS org)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm)));
alter policy risks_scope on public.risks using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm)));
alter policy role_permissions_org on public.role_permissions using ((org_id = ( SELECT app.org() AS org)));
alter policy roles_org on public.roles using ((org_id = ( SELECT app.org() AS org)));
alter policy snags_scope on public.snags using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('quality'::text, 'view'::text) AS has_perm)));
alter policy stage_templates_org on public.stage_templates using ((org_id = ( SELECT app.org() AS org)));
alter policy stock_moves_scope on public.stock_moves using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm)));
alter policy task_deps_scope on public.task_dependencies using ((EXISTS ( SELECT 1 FROM tasks t WHERE ((t.id = task_dependencies.task_id) AND ((t.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('schedule'::text, 'view'::text) AS has_perm))))));
alter policy tasks_scope on public.tasks using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('schedule'::text, 'view'::text) AS has_perm)));
alter policy template_stages_org on public.template_stages using ((org_id = ( SELECT app.org() AS org)));
alter policy unit_comm_scope on public.unit_commissioning using ((EXISTS ( SELECT 1 FROM units u WHERE ((u.id = unit_commissioning.unit_id) AND ((u.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm))))));
alter policy unit_stages_scope on public.unit_stages using ((EXISTS ( SELECT 1 FROM units u WHERE ((u.id = unit_stages.unit_id) AND ((u.project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm))))));
alter policy units_scope on public.units using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm)));
alter policy vendor_invoices_scope on public.vendor_invoices using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('payments'::text, 'view'::text) AS has_perm)));
alter policy vendor_prices_scope on public.vendor_prices using (((org_id = ( SELECT app.org() AS org)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm) AND ( SELECT app.has_perm('budget'::text, 'view'::text) AS has_perm)));
alter policy vendors_read on public.vendors using (((org_id = ( SELECT app.org() AS org)) AND ( SELECT app.has_perm('procurement'::text, 'view'::text) AS has_perm)));
alter policy warranties_scope on public.warranties using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('handover'::text, 'view'::text) AS has_perm)));
alter policy wp_scope on public.work_packages using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm)));
alter policy zones_scope on public.zones using (((project_id IN ( SELECT app.visible_projects() AS visible_projects)) AND ( SELECT app.has_perm('projects'::text, 'view'::text) AS has_perm)));

-- ---------- 3. set-based cost engine (same formulas as 0700/1000; tests assert identical figures) ----------
create or replace function app.cost_position_internal(p_project text)
returns table (code text, name text, original_budget numeric, approved_changes numeric, current_budget numeric, committed numeric, pending numeric,
               actual numeric, paid_against_cost numeric, retention_held numeric, accrued_unpaid numeric, uncommitted_forecast numeric,
               forecast numeric, variance numeric, uncommitted_budget numeric)
language sql stable security definer set search_path = public, app as $$
  with v as (select (select id from budget_versions where project_id = p_project and v = 1 and status = 'Approved') v_orig, app.current_budget(p_project) v_cur),
  cc as (select c.code, c.name from cost_codes c join projects p on p.org_id = c.org_id where p.id = p_project),
  bo as (select l.code, l.amount from budget_lines l where l.version_id = (select v_orig from v)),
  bc as (select l.code, l.amount from budget_lines l where l.version_id = (select v_cur from v)),
  po as (select x.code, sum(x.total) filter (where x.status in ('Approved','Part received','Received')) live, sum(x.total) filter (where x.status = 'Pending approval') pend
         from purchase_orders x where x.project_id = p_project group by x.code),
  rcv as (select x.code, sum(g.accepted_value) acc, sum(g.accepted_value) filter (where x.status = 'Closed') closed_acc
          from goods_receipts g join purchase_orders x on x.id = g.po_id where x.project_id = p_project group by x.code),
  ct as (select c.id, c.code, c.status, c.gst_pct, app.incl_gst(app.contract_value(c.id), c.gst_pct) val from contracts c where c.project_id = p_project),
  con as (select ct.code, sum(ct.val) filter (where ct.status = 'Active') live, sum(ct.val) filter (where ct.status = 'Pending approval') pend from ct group by ct.code),
  var as (select ct.code, sum(app.incl_gst(x.amount, ct.gst_pct)) filter (where x.status = 'Approved' and ct.status = 'Active') live,
                 sum(app.incl_gst(greatest(x.amount, 0), ct.gst_pct)) filter (where x.status = 'Pending approval') pend
          from contract_variations x join ct on ct.id = x.contract_id group by ct.code),
  bills as (select ct.code, sum(b.gross + b.gst) v, sum(b.gross + b.gst) filter (where ct.status = 'Closed') closed_v, sum(b.retention) ret, sum(b.advance_recovery) adv
            from ra_bills b join ct on ct.id = b.contract_id where b.status in ('Approved','Paid') group by ct.code),
  pinv as (select x.code, sum(pm.amount) v from payments pm join vendor_invoices i on i.id = pm.invoice_id join purchase_orders x on x.id = i.po_id where pm.project_id = p_project group by x.code),
  pbill as (select ct.code, sum(pm.amount + pm.tds) v from payments pm join ra_bills b on b.id = pm.ra_bill_id join ct on ct.id = b.contract_id where pm.project_id = p_project group by ct.code),
  f as (select cc.code, cc.name, coalesce(bo.amount, 0) ob, coalesce(bc.amount, 0) cb,
          coalesce(po.live, 0) + coalesce(rcv.closed_acc, 0) + coalesce(con.live, 0) + coalesce(var.live, 0) + coalesce(bills.closed_v, 0) com,
          coalesce(po.pend, 0) + coalesce(con.pend, 0) + coalesce(var.pend, 0) pend,
          coalesce(rcv.acc, 0) + coalesce(bills.v, 0) act, coalesce(pinv.v, 0) + coalesce(pbill.v, 0) + coalesce(bills.adv, 0) paid, coalesce(bills.ret, 0) ret, coalesce(e.amount, 0) etc
        from cc left join bo on bo.code = cc.code left join bc on bc.code = cc.code left join po on po.code = cc.code left join rcv on rcv.code = cc.code
        left join con on con.code = cc.code left join var on var.code = cc.code left join bills on bills.code = cc.code left join pinv on pinv.code = cc.code
        left join pbill on pbill.code = cc.code left join etc_estimates e on e.project_id = p_project and e.code = cc.code)
  select f.code, f.name, f.ob, f.cb - f.ob, f.cb, f.com, f.pend, f.act, f.paid, f.ret, f.act - f.paid - f.ret, f.etc, f.com + f.etc, f.cb - (f.com + f.etc), f.cb - f.com
  from f order by f.code
$$;

-- ---------- 4. paged, server-filtered lists (keyset pagination: pass the last row's key to get the next page) ----------
create or replace function api.list_purchase_orders(p_project text default null, p_status text default null, p_search text default null, p_before timestamptz default null, p_limit integer default 50)
returns table (id text, project_id text, item text, vendor text, total numeric, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_perm('procurement', 'view');
  return query select po.id, po.project_id, po.item, v.name, case when app.has_perm('budget', 'view') then po.total end, po.status, po.created_at
  from purchase_orders po join vendors v on v.id = po.vendor_id
  where po.project_id in (select app.visible_projects()) and (p_project is null or po.project_id = p_project) and (p_status is null or po.status = p_status)
    and (p_search is null or po.item ilike '%' || p_search || '%' or po.id ilike '%' || p_search || '%') and (p_before is null or po.created_at < p_before)
  order by po.created_at desc limit least(greatest(p_limit, 1), 200);
end $$;
create or replace function api.alert_feed(p_severity text default null, p_category text default null, p_project text default null, p_status text default 'Open', p_after_id bigint default null, p_limit integer default 50)
returns table (id bigint, project_id text, category text, severity text, title text, detail text, owner text, due_at timestamptz, next_action text, records jsonb, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, app as $$
begin
  return query select a.id, a.project_id, a.category, a.severity, a.title, a.detail, coalesce(pr.full_name, a.owner_role), a.due_at, a.next_action, a.records, a.status, a.created_at
  from alerts a left join profiles pr on pr.user_id = a.owner_id
  where a.org_id = app.org() and (a.owner_id = auth.uid() or (a.project_id in (select app.visible_projects()) and app.has_perm(a.module, 'view')))
    and (p_status is null or a.status = p_status or (p_status = 'Open' and a.status = 'Acknowledged')) and (p_severity is null or a.severity = p_severity)
    and (p_category is null or a.category = p_category) and (p_project is null or a.project_id = p_project) and (p_after_id is null or a.id < p_after_id)
  order by app.sev_rank(a.severity) desc, a.id desc limit least(greatest(p_limit, 1), 200);
end $$;
create or replace function api.audit_page(p_project text default null, p_before bigint default null, p_limit integer default 50)
returns table (id bigint, at timestamptz, who text, role_id text, table_name text, record_id text, action text, note text)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_perm('audit', 'view');
  return query select l.id, l.at, p.full_name, l.role_id, l.table_name, l.record_id, l.action, l.note from audit_log l left join profiles p on p.user_id = l.user_id
  where l.org_id = app.org() and (l.project_id is null or l.project_id in (select app.visible_projects())) and (p_project is null or l.project_id = p_project) and (p_before is null or l.id < p_before)
  order by l.id desc limit least(greatest(p_limit, 1), 200);
end $$;

-- ---------- 5. retention ----------
create table public.retention_policies (
  org_id uuid not null references public.organizations(id), data text not null check (data in ('read_notifications','processed_events','automation_actions','resolved_alerts')),
  keep_days integer not null check (keep_days >= 90), primary key (org_id, data)
);
create or replace function app.seed_retention(p_org uuid) returns void language sql security definer set search_path = public as $$
  insert into retention_policies values (p_org, 'read_notifications', 180), (p_org, 'processed_events', 400), (p_org, 'automation_actions', 730), (p_org, 'resolved_alerts', 730) on conflict do nothing;
$$;
select app.seed_retention(id) from organizations;
create or replace function app.bootstrap_org(p_org uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.bootstrap_org_base(p_org); perform app.apply_permission_defaults(p_org); perform app.seed_playbook_rules(p_org); perform app.seed_scenarios(p_org);
  perform app.seed_score_weights(p_org); perform app.seed_retention(p_org);
end $$;
-- never touches business records, approvals, payments or the audit log (kept for statutory periods; archive, do not delete)
create or replace function api.purge_expired() returns jsonb language plpgsql security definer set search_path = public, app as $$
declare n1 integer; n2 integer; n3 integer; n4 integer;
begin
  if auth.uid() is not null then perform app.require_perm('settings', 'edit'); end if;
  delete from notifications n using retention_policies r where r.org_id = n.org_id and r.data = 'read_notifications' and n.read_at is not null and n.read_at < now() - make_interval(days => r.keep_days);
  get diagnostics n1 = row_count;
  delete from automation_actions a using retention_policies r where r.org_id = a.org_id and r.data = 'automation_actions' and a.created_at < now() - make_interval(days => r.keep_days);
  get diagnostics n3 = row_count;
  delete from automation_events e using retention_policies r where r.org_id = e.org_id and r.data = 'processed_events' and e.status = 'processed' and e.processed_at < now() - make_interval(days => r.keep_days)
    and not exists (select 1 from automation_actions a where a.event_id = e.id) and not exists (select 1 from notifications n where n.event_id = e.id);
  get diagnostics n2 = row_count;
  delete from alerts a using retention_policies r where r.org_id = a.org_id and r.data = 'resolved_alerts' and a.status = 'Resolved' and a.resolved_at < now() - make_interval(days => r.keep_days);
  get diagnostics n4 = row_count;
  return jsonb_build_object('notifications', n1, 'events', n2, 'automation_actions', n3, 'alerts', n4);
end $$;
alter table public.retention_policies enable row level security;
create policy retention_org on public.retention_policies for select to authenticated using (org_id = (select app.org()));
revoke all on public.retention_policies from anon, authenticated; grant select on public.retention_policies to authenticated;
revoke all on function api.list_purchase_orders(text, text, text, timestamptz, integer), api.alert_feed(text, text, text, text, bigint, integer), api.audit_page(text, bigint, integer), api.purge_expired() from public;
grant execute on function api.list_purchase_orders(text, text, text, timestamptz, integer), api.alert_feed(text, text, text, text, bigint, integer), api.audit_page(text, bigint, integer) to authenticated, service_role;
grant execute on function api.purge_expired() to service_role;
revoke all on function app.seed_retention(uuid) from public;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then perform cron.schedule('mandamul-purge-expired', '17 3 * * *', 'select api.purge_expired()'); end if;
end $$;
grant execute on function app.sev_rank(text) to authenticated;
