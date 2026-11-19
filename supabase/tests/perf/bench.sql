-- Times the reads people wait for, as the people who make them (row-level security on). Median of N runs.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
drop schema if exists perf cascade;
create schema perf;
create table perf.results (label text, who text, run int, ms numeric);
grant usage on schema perf to authenticated; grant insert, select on perf.results to authenticated;
create function perf.login(p_email text) returns void language plpgsql as $$
declare v uuid; begin
  perform set_config('role', 'none', false); select id into v from auth.users where email = p_email;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal2')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function perf.t(p_label text, p_sql text, p_n int default 7) returns void language plpgsql as $$
declare t0 timestamptz; i int; begin
  execute 'select count(*) from (' || p_sql || ') x';   -- warm-up, not recorded
  for i in 1..p_n loop
    t0 := clock_timestamp(); execute 'select count(*) from (' || p_sql || ') x';
    insert into perf.results values (p_label, coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', 'system'), i, extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
end $$;
grant execute on all functions in schema perf to authenticated;

select perf.login('u1@perf');   -- MD, all projects
select perf.t('cost report, one project', $$select * from api.cost_position('MA-2025-001')$$);
select perf.t('portfolio cost, 30 projects', $$select c.* from projects p, lateral api.cost_position(p.id) c$$, 3);
select perf.t('cash requirement, 90 days', $$select * from api.cash_requirement('MA-2025-001', 90)$$);
select perf.t('unit readiness, 70 units', $$select * from api.unit_readiness('MA-2025-001')$$);
select perf.t('approvals waiting for MD', $$select a.id from approvals a join approval_steps s on s.approval_id = a.id and s.status = 'pending' and s.role_id = 'md' where a.status = 'Pending' order by a.requested_at limit 50$$);
select perf.t('unread notifications', $$select id, text from notifications where user_id = auth.uid() and read_at is null order by created_at desc limit 20$$);
-- the same read as the app sends it: row-level security supplies the user filter once (a bare auth.uid() in the query is evaluated per row)
select perf.t('unread notifications, app query form', $$select id, text from notifications where read_at is null order by created_at desc limit 20$$);
select perf.login('u10@perf');  -- a project manager
select perf.t('open defects, one project', $$select id, title from snags where project_id = 'MA-2025-016' and status <> 'Closed' order by created_at desc limit 50$$);
select perf.t('latest site reports', $$select id, report_date from daily_reports where project_id = 'MA-2025-016' order by report_date desc limit 30$$);
select perf.t('PM approvals queue', $$select a.id from approvals a join approval_steps s on s.approval_id = a.id and s.status = 'pending' and s.role_id = 'pm' where a.status = 'Pending' order by a.requested_at limit 50$$);
select perf.login('u4@perf');   -- super admin
select perf.t('audit trail page, one project', $$select id, at, action from audit_log where project_id = 'MA-2025-001' order by at desc limit 50$$);
select perf.login('u3@perf');   -- finance
select perf.t('latest purchase orders (all projects)', $$select id, item, total, status from purchase_orders order by created_at desc limit 50$$);
select perf.t('payables: approved unpaid invoices', $$select id, total, due_date from vendor_invoices where status = 'Approved' order by due_date limit 100$$);
select perf.login('u9@perf');   -- a site supervisor
select perf.t('order tracking (no prices)', $$select * from api.po_tracking('MA-2025-016')$$);
select perf.login('u1@perf'); select set_config('role', 'none', false); select set_config('request.jwt.claims', '', false);
select perf.t('exception scan (scheduler)', $$select api.scan_exceptions()$$, 3);

\pset footer off
select label, round(percentile_cont(0.5) within group (order by ms)::numeric, 1) as median_ms, round(max(ms), 1) as max_ms, count(*) runs
from perf.results group by label order by min(ctid::text);
