-- Batch 11: the action center shows an action only to someone who may take it (B28).
-- Evidence: in the production app the MD saw "Acknowledge" on a budget alert and the database refused it
-- ("permission denied: edit on budget"): acknowledging is for the owner or someone with edit rights on the alert's module.
-- alert_feed gains a can_act column (same rule as api.ack_alert / snooze / resolve), so the screen hides what would be refused.
drop function if exists api.alert_feed(text, text, text, text, bigint, integer);
create or replace function api.alert_feed(p_severity text default null, p_category text default null, p_project text default null, p_status text default 'Open', p_after_id bigint default null, p_limit integer default 50)
returns table (id bigint, project_id text, category text, severity text, title text, detail text, owner text, due_at timestamptz, next_action text, records jsonb, status text, created_at timestamptz, can_act boolean)
language plpgsql stable security definer set search_path = public, app as $$
begin
  return query select a.id, a.project_id, a.category, a.severity, a.title, a.detail, coalesce(pr.full_name, a.owner_role), a.due_at, a.next_action, a.records, a.status, a.created_at,
    (a.owner_id = auth.uid() or (a.project_id is not null and app.can(a.project_id, a.module, 'edit')))
  from alerts a left join profiles pr on pr.user_id = a.owner_id
  where a.org_id = app.org() and (a.owner_id = auth.uid() or (a.project_id in (select app.visible_projects()) and app.has_perm(a.module, 'view')))
    and (p_status is null or a.status = p_status or (p_status = 'Open' and a.status = 'Acknowledged')) and (p_severity is null or a.severity = p_severity)
    and (p_category is null or a.category = p_category) and (p_project is null or a.project_id = p_project) and (p_after_id is null or a.id < p_after_id)
  order by app.sev_rank(a.severity) desc, a.id desc limit least(greatest(p_limit, 1), 200);
end $$;
grant execute on function api.alert_feed(text, text, text, text, bigint, integer) to authenticated;
