-- M Andamul Development OS · 0800 row-level security and grants
-- Reads: project-scoped and permission-scoped policies. Writes: only through api.* functions (no direct DML).

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke all on all functions in schema app from public;
revoke all on all functions in schema api from public;
-- helpers RLS needs at query time
grant execute on function app.uid(), app.org(), app.role(), app.has_perm(text, text), app.has_project(text), app.can(text, text, text) to authenticated;
grant execute on all functions in schema api to authenticated;
revoke execute on function api.process_events(integer), api.scan_exceptions() from authenticated;   -- scheduler only (service role), see docs
grant execute on all functions in schema api to service_role;
grant usage on schema public to authenticated;

-- organisation-level reference data
create policy org_read on public.organizations for select to authenticated using (id = app.org());
create policy modules_read on public.app_modules for select to authenticated using (true);
create policy plan_templates_read on public.plan_templates for select to authenticated using (true);
create policy budget_profiles_read on public.budget_profiles for select to authenticated using (true);
do $$ declare t text; begin
  foreach t in array array['roles','role_permissions','org_settings','cost_codes','stage_templates','template_stages','automation_rules','channel_config','clients','profiles'] loop
    execute format('create policy %1$s_org on public.%1$s for select to authenticated using (org_id = app.org())', t);
  end loop;
end $$;
create policy vendors_read on public.vendors for select to authenticated using (org_id = app.org() and app.has_perm('procurement','view'));
create policy doc_counters_none on public.doc_counters for select to authenticated using (false);

-- project-scoped tables: (table, module) pairs
do $$ declare r record; begin
  for r in select * from (values
    ('project_members','projects'),('land_parcels','projects'),('buildings','projects'),('units','projects'),('risks','projects'),
    ('budget_versions','budget'),('etc_estimates','budget'),('boq_items','boq'),('tasks','schedule'),
    ('material_requests','procurement'),('vendor_invoices','payments'),('payments','payments'),('contracts','contracts'),
    ('documents','documents'),('inspections','quality'),('snags','quality'),('ffe_items','handover'),('handover_items','handover'),
    ('warranties','handover'),('assets','handover'),('approvals','approvals')) t(tbl, module) loop
    execute format('create policy %1$s_scope on public.%1$s for select to authenticated using (app.can(project_id, %2$L, ''view''))', r.tbl, r.module);
  end loop;
end $$;
create policy projects_scope on public.projects for select to authenticated using (org_id = app.org() and app.can(id, 'projects', 'view'));
-- commercial rows need procurement AND cost visibility (site teams use api.po_tracking, which has no prices)
create policy purchase_orders_scope on public.purchase_orders for select to authenticated using (app.can(project_id, 'procurement', 'view') and app.has_perm('budget', 'view'));
create policy quotations_scope on public.quotations for select to authenticated using (exists (select 1 from material_requests m where m.id = mr_id and app.can(m.project_id, 'procurement', 'view')) and app.has_perm('budget', 'view'));
create policy grn_scope on public.goods_receipts for select to authenticated using (exists (select 1 from purchase_orders p where p.id = po_id and app.can(p.project_id, 'procurement', 'view')) and app.has_perm('budget', 'view'));
create policy budget_lines_scope on public.budget_lines for select to authenticated using (exists (select 1 from budget_versions v where v.id = version_id and app.can(v.project_id, 'budget', 'view')));
create policy task_deps_scope on public.task_dependencies for select to authenticated using (exists (select 1 from tasks t where t.id = task_id and app.can(t.project_id, 'schedule', 'view')));
create policy contract_items_scope on public.contract_items for select to authenticated using (exists (select 1 from contracts c where c.id = contract_id and app.can(c.project_id, 'contracts', 'view')));
create policy variations_scope on public.contract_variations for select to authenticated using (exists (select 1 from contracts c where c.id = contract_id and app.can(c.project_id, 'contracts', 'view')));
create policy ra_bills_scope on public.ra_bills for select to authenticated using (exists (select 1 from contracts c where c.id = contract_id and app.can(c.project_id, 'contracts', 'view')));
create policy ra_lines_scope on public.ra_bill_lines for select to authenticated using (exists (select 1 from ra_bills b join contracts c on c.id = b.contract_id where b.id = bill_id and app.can(c.project_id, 'contracts', 'view')));
create policy measurements_scope on public.measurements for select to authenticated using (exists (select 1 from contract_items ci join contracts c on c.id = ci.contract_id where ci.id = contract_item_id and (app.can(c.project_id, 'site', 'view') or app.can(c.project_id, 'contracts', 'view'))));
create policy reports_scope on public.daily_reports for select to authenticated using (app.can(project_id, 'site', 'view') and (status <> 'Draft' or submitted_by = auth.uid()));
create policy report_lines_scope on public.report_work_lines for select to authenticated using (exists (select 1 from daily_reports r where r.id = report_id and app.can(r.project_id, 'site', 'view')));
create policy doc_versions_scope on public.document_versions for select to authenticated using (exists (select 1 from documents d where d.id = document_id and app.can(d.project_id, 'documents', 'view')));
create policy doc_links_scope on public.document_links for select to authenticated using (exists (select 1 from documents d where d.id = document_id and app.can(d.project_id, 'documents', 'view')));
create policy unit_stages_scope on public.unit_stages for select to authenticated using (exists (select 1 from units u where u.id = unit_id and app.can(u.project_id, 'projects', 'view')));
create policy unit_comm_scope on public.unit_commissioning for select to authenticated using (exists (select 1 from units u where u.id = unit_id and app.can(u.project_id, 'projects', 'view')));
create policy approval_steps_scope on public.approval_steps for select to authenticated using (exists (select 1 from approvals a where a.id = approval_id and app.can(a.project_id, 'approvals', 'view')));
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy events_admin on public.automation_events for select to authenticated using (org_id = app.org() and app.has_perm('settings', 'view'));
create policy audit_read on public.audit_log for select to authenticated using (org_id = app.org() and app.has_perm('audit', 'view') and (project_id is null or app.has_project(project_id)));
