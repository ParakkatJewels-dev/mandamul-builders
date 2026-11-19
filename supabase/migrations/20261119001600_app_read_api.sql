-- Batch 10: read functions for the production application.
-- The application talks to the database only through `api` functions (PostgREST RPC), so every screen goes through
-- the same permission checks: project visibility, module rights, and money hidden without budget:view.
-- All functions are security definer with a fixed search path, like the rest of `api`.

-- who am I, what may I do, which projects can I see
create or replace function api.session_info() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from profiles where user_id = auth.uid() and active;
  if not found then raise exception 'this account has no active profile; ask the administrator' using errcode = '42501'; end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', p.user_id, 'name', p.full_name, 'email', p.email, 'role', p.role_id,
                               'role_name', (select name from roles where org_id = p.org_id and id = p.role_id), 'all_projects', p.all_projects),
    'org', (select jsonb_build_object('id', o.id, 'name', o.name) from organizations o where o.id = p.org_id),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'mfa_actions', coalesce((select to_jsonb(mfa_actions) from org_settings where org_id = p.org_id), '[]'),
    'permissions', coalesce((select jsonb_object_agg(module, acts) from (
                     select module, jsonb_agg(action order by action) acts from role_permissions
                      where org_id = p.org_id and role_id = p.role_id group by module) x), '{}'),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'stage', pr.stage, 'location', pr.location,
                     'pm', (select full_name from profiles where user_id = pr.pm_id)) order by pr.name)
                     from projects pr where pr.id in (select app.visible_projects())), '[]'),
    'unread', (select count(*) from notifications where user_id = auth.uid() and read_at is null));
end $$;

-- one row per visible project for the command center; money only where the user may see the budget
create or replace function api.portfolio_summary() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_out jsonb := '[]'; r record; v_fin jsonb; v_today date;
begin
  perform app.require_perm('dashboard', 'view');
  v_today := app.today(app.org());
  for r in select pr.* from projects pr where pr.id in (select app.visible_projects()) order by pr.name loop
    v_fin := null;
    if app.can(r.id, 'budget', 'view') then
      select jsonb_build_object('budget', coalesce(sum(c.current_budget), 0), 'committed', coalesce(sum(c.committed), 0), 'actual', coalesce(sum(c.actual), 0),
                                'forecast', coalesce(sum(c.forecast), 0), 'variance', coalesce(sum(c.variance), 0))
        into v_fin from app.cost_position_internal(r.id) c;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'name', r.name, 'stage', r.stage, 'location', r.location, 'keys', r.keys,
      'pm', (select full_name from profiles where user_id = r.pm_id),
      'finance', v_fin,
      'progress', (select round(coalesce(sum(t.progress * greatest(t.duration_days, 1))::numeric / nullif(sum(greatest(t.duration_days, 1)), 0), 0), 1)
                     from tasks t where t.project_id = r.id and not t.is_milestone),
      'overdue_tasks', (select count(*) from tasks t where t.project_id = r.id and t.act_finish is null and t.base_finish < v_today),
      'alerts', (select jsonb_build_object('critical', count(*) filter (where severity = 'Critical'), 'high', count(*) filter (where severity = 'High'), 'open', count(*))
                   from alerts a where a.project_id = r.id and a.status in ('Open','Acknowledged')),
      'pending_approvals', (select count(*) from approvals a where a.project_id = r.id and a.status = 'Pending'),
      'units', (select jsonb_build_object('total', count(*), 'handed_over', count(*) filter (where handed_over_at is not null)) from units u where u.project_id = r.id)));
  end loop;
  return v_out;
end $$;

-- approvals waiting for me (the current step is my role, I may approve that module, I did not raise it and did not decide an earlier step)
-- and the ones I raised that are still open
create or replace function api.my_approvals() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_role text := app.role();
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return jsonb_build_object(
    'to_decide', coalesce((select jsonb_agg(x order by x ->> 'requested_at') from (
      select jsonb_build_object('id', a.id, 'kind', a.kind, 'ref', a.ref, 'title', a.title, 'project_id', a.project_id,
               'project', (select name from projects where id = a.project_id),
               'amount', case when app.can(a.project_id, 'budget', 'view') then a.amount end,
               'requested_by', (select full_name from profiles where user_id = a.requested_by), 'requested_at', a.requested_at,
               'step', jsonb_build_object('seq', st.seq, 'label', st.label, 'module', st.module, 'role', st.role_id),
               'steps', (select jsonb_agg(jsonb_build_object('seq', s.seq, 'label', s.label, 'role', s.role_id, 'status', s.status,
                               'by', (select full_name from profiles where user_id = s.decided_by), 'at', s.decided_at, 'comment', s.comment) order by s.seq)
                           from approval_steps s where s.approval_id = a.id),
               'ctx', case when app.can(a.project_id, 'budget', 'view') then a.ctx else '{}'::jsonb end) x
        from approvals a join approval_steps st on st.approval_id = a.id and st.status = 'pending'
       where a.status = 'Pending' and a.project_id in (select app.visible_projects()) and st.role_id = v_role
         and app.has_perm(st.module, 'approve') and a.requested_by is distinct from auth.uid()
         and not exists (select 1 from approval_steps d where d.approval_id = a.id and d.decided_by = auth.uid())) q), '[]'),
    'requested', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'ref', a.ref, 'title', a.title, 'status', a.status,
               'project', (select name from projects where id = a.project_id), 'requested_at', a.requested_at,
               'waiting_for', (select label || ' (' || role_id || ')' from approval_steps s where s.approval_id = a.id and s.status = 'pending' limit 1))
               order by a.requested_at desc)
        from approvals a where a.requested_by = auth.uid() and a.requested_at > now() - interval '60 days'), '[]'));
end $$;

-- material requests of a project with their quotations and order; rates only with budget:view
create or replace function api.mr_list(p_project text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_money boolean;
begin
  perform app.require(p_project, 'procurement', 'view');
  v_money := app.can(p_project, 'budget', 'view');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'code', m.code, 'item', m.item, 'qty', m.qty, 'uom', m.uom, 'needed_by', m.needed_by, 'urgency', m.urgency, 'status', m.status,
      'requested_by', (select full_name from profiles where user_id = m.requested_by), 'created_at', m.created_at, 'origin', m.origin,
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('vendor_id', q.vendor_id, 'vendor', v.name,
                   'rate', case when v_money then q.rate end, 'gst_pct', q.gst_pct, 'lead_days', q.lead_days, 'note', q.note) order by q.rate)
                   from quotations q join vendors v on v.id = q.vendor_id where q.mr_id = m.id), '[]'),
      'po', (select jsonb_build_object('id', po.id, 'status', po.status) from purchase_orders po where po.mr_id = m.id and po.status not in ('Rejected','Cancelled') limit 1))
      order by m.created_at desc) from material_requests m where m.project_id = p_project), '[]');
end $$;

create or replace function api.vendor_list() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_perm('procurement', 'view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'category', category, 'city', city) order by name)
                     from vendors where org_id = app.org() and approved), '[]');
end $$;

-- one order with its receipts; prices only with budget:view
create or replace function api.po_detail(p_po text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare po purchase_orders; v_money boolean;
begin
  select * into po from purchase_orders where id = p_po;
  if not found then raise exception 'order % not found', p_po; end if;
  perform app.require(po.project_id, 'procurement', 'view');
  v_money := app.can(po.project_id, 'budget', 'view');
  return jsonb_build_object('id', po.id, 'project_id', po.project_id, 'item', po.item, 'uom', po.uom, 'qty', po.qty, 'status', po.status,
    'vendor', (select name from vendors where id = po.vendor_id), 'mr_id', po.mr_id, 'expected_delivery', po.expected_delivery, 'created_at', po.created_at,
    'rate', case when v_money then po.rate end, 'gst_pct', po.gst_pct, 'total', case when v_money then po.total end,
    'approval', (select jsonb_build_object('id', a.id, 'status', a.status) from approvals a where a.id = po.approval_id),
    'accepted_qty', (select coalesce(sum(qty), 0) from goods_receipts where po_id = po.id and qc = 'Pass'),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'received_on', g.received_on, 'qty', g.qty, 'qc', g.qc, 'note', g.note,
                  'value', case when v_money then g.accepted_value end, 'by', (select full_name from profiles where user_id = g.received_by)) order by g.created_at)
                  from goods_receipts g where g.po_id = po.id), '[]'));
end $$;

-- daily reports of a project with their work lines
create or replace function api.daily_report_list(p_project text, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'site', 'view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'date', d.report_date, 'status', d.status, 'weather', d.weather, 'labour', d.labour,
      'issues', d.issues, 'safety', d.safety, 'review_note', d.review_note, 'approval_id', d.approval_id,
      'submitted_by', (select full_name from profiles where user_id = d.submitted_by),
      'verified_by', (select full_name from profiles where user_id = d.verified_by),
      'work', coalesce((select jsonb_agg(jsonb_build_object('task', t.name, 'progress_to', w.progress_to, 'qty', w.qty, 'note', w.note)) from report_work_lines w join tasks t on t.id = w.task_id where w.report_id = d.id), '[]'))
      order by d.report_date desc) from (select * from daily_reports where project_id = p_project order by report_date desc limit greatest(least(p_limit, 200), 1)) d), '[]');
end $$;

-- activities of a project for progress entry
create or replace function api.task_list(p_project text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_today date;
begin
  perform app.require(p_project, 'schedule', 'view');
  v_today := app.today(app.org());
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'wbs', t.wbs, 'name', t.name, 'phase', t.phase, 'milestone', t.is_milestone,
      'base_start', t.base_start, 'base_finish', t.base_finish, 'act_start', t.act_start, 'act_finish', t.act_finish, 'progress', t.progress,
      'version', t.version, 'overdue', t.act_finish is null and t.base_finish < v_today) order by t.base_start, t.wbs)
      from tasks t where t.project_id = p_project), '[]');
end $$;

create or replace function api.cost_code_list() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code) from cost_codes where org_id = app.org() and not is_contingency), '[]');
end $$;

grant execute on function api.cost_code_list(), api.session_info(), api.portfolio_summary(), api.my_approvals(), api.mr_list(text), api.vendor_list(),
  api.po_detail(text), api.daily_report_list(text, integer), api.task_list(text) to authenticated;
