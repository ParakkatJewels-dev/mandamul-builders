-- Batch 11: the contingency line is not a cost code "over budget" (B29).
-- Evidence: the production app's action center showed "2 cost codes forecast over budget (worst 13 at 120%)", where 13 is
-- the contingency line. Drawing on contingency is covered by its own alert (contingency exhausted, app.scan_finance);
-- counting it again as an overrun double-reports the same money. Same function as batch 9, contingency codes excluded.

create or replace function api.scan_exceptions() returns integer
language plpgsql security definer set search_path = public, app as $$
declare n integer := 0; r record; s org_settings; v_week text := to_char(now(), 'IYYY-IW'); v_today date; v_t time; x record; v_h numeric;
  v_codes jsonb; v_nc integer; v_worst numeric; v_over numeric;
begin
  if auth.uid() is not null then perform app.require_perm('settings', 'view'); end if;
  for r in select p.id project_id, p.org_id, p.stage, p.pm_id from projects p where p.stage in ('Pre-construction','Construction','Pre-opening') and (auth.uid() is null or p.org_id = app.org()) loop
    select * into s from org_settings where org_id = r.org_id;
    v_today := app.today(r.org_id); v_t := app.local_time(r.org_id);
    -- budget: ONE alert per project listing every cost code forecast above the flag threshold (B24: one per code was noise),
    -- graded by the worst code, and resolved when every code is back within the threshold (B25: it never cleared before)
    if app.current_budget(r.project_id) is not null then
      v_codes := '[]'; v_nc := 0; v_worst := 0; v_over := 0;
      for x in select cp.code, cp.forecast, cp.cb from (select l.code, l.amount cb, coalesce(e.amount, 0) + (app.code_commitments(r.project_id, l.code)).committed forecast
               from budget_lines l left join etc_estimates e on e.project_id = r.project_id and e.code = l.code
               where l.version_id = app.current_budget(r.project_id)
                 and not exists (select 1 from cost_codes cc where cc.org_id = r.org_id and cc.code = l.code and cc.is_contingency)) cp
               where cp.cb > 0 and cp.forecast * 100 > cp.cb * s.flag_pct order by cp.forecast / cp.cb desc loop
        n := n + case when app.emit(r.project_id, 'budget_overrun', format('overrun:%s:%s:%s', r.project_id, x.code, v_week), jsonb_build_object('code', x.code, 'forecast', x.forecast, 'budget', x.cb)) is null then 0 else 1 end;
        v_codes := v_codes || jsonb_build_array(jsonb_build_object('kind', 'cost_code', 'id', x.code, 'label', format('%s at %s%%', x.code, round(x.forecast * 100 / x.cb))));
        v_nc := v_nc + 1; v_worst := greatest(v_worst, x.forecast / x.cb); v_over := v_over + greatest(x.forecast - x.cb, 0);
      end loop;
      if v_nc > 0 then
        perform app.raise_alert(r.org_id, r.project_id, 'Budget', case when v_worst > 1.10 then 'Critical' when v_worst > 1.05 then 'High' else 'Medium' end, 'budget',
          format('%s cost code%s forecast over budget (worst %s at %s%%)', v_nc, case when v_nc = 1 then '' else 's' end, v_codes -> 0 ->> 'id', round(v_worst * 100)),
          format('Forecast overrun %s across the listed codes.', v_over), r.pm_id, 'pm', null, v_codes,
          'Review commitments and the estimate for the listed codes; request a budget revision or a transfer from contingency', 'budget:' || r.project_id);
      else
        perform app.clear_alert(r.org_id, 'budget:' || r.project_id, 'Every cost code is back within the threshold');
      end if;
      -- retire the per-code alerts raised by the earlier version of this scan
      update alerts set status = 'Resolved', resolved_at = now(), resolution = 'Replaced by the project budget alert', updated_at = now()
       where org_id = r.org_id and project_id = r.project_id and dedupe_key like 'budget:' || r.project_id || ':%' and status <> 'Resolved';
    end if;
    -- overdue activities go to the delay playbook (weekly re-check; the alert itself notifies only when new or worse)
    n := n + coalesce((select count(app.emit(r.project_id, 'activity_overdue', format('overdue:%s:%s', t.id, v_week), jsonb_build_object('task_id', t.id, 'task', t.name)))
      from tasks t where t.project_id = r.project_id and t.act_finish is null and t.base_finish < v_today), 0);
    -- missing daily report after the local cut-off
    if r.stage = 'Construction' and v_t > s.report_cutoff and not exists (select 1 from daily_reports where project_id = r.project_id and report_date = v_today and status in ('Submitted','Approved')) then
      n := n + case when app.emit(r.project_id, 'missing_report', format('missing:%s:%s', r.project_id, v_today), '{}'::jsonb) is null then 0 else 1 end;
    end if;
    -- units with every stage passed and no final inspection yet: re-check daily until blockers clear
    -- the key carries the blocker count, so clearing a blocker triggers a fresh check the same day
    n := n + coalesce((select count(app.emit(r.project_id, 'unit_works_complete', format('complete:%s:%s:b%s', u.id, v_today,
          (select count(*) from snags sn where sn.unit_id = u.id and sn.status <> 'Closed') + (select count(*) from ffe_items f where f.unit_id = u.id and f.status not in ('Installed','Tested'))
          + (select count(*) from unit_commissioning cm where cm.unit_id = u.id and cm.status <> 'Passed')), jsonb_build_object('unit', u.id)))
      from units u where u.project_id = r.project_id and u.handed_over_at is null and exists (select 1 from unit_stages st where st.unit_id = u.id)
        and not exists (select 1 from unit_stages st where st.unit_id = u.id and st.status <> 'Passed')
        and not exists (select 1 from inspections i where i.unit_id = u.id and i.kind = 'Final' and i.status in ('Requested','Passed'))), 0);
    -- safety-critical defects, failed inspections, permits, payment approvals
    for x in select id, title, unit_id from snags where project_id = r.project_id and severity = 'Safety-critical' and status <> 'Closed' loop
      perform app.raise_alert(r.org_id, r.project_id, 'Safety', 'Critical', 'quality', 'Safety-critical defect: ' || x.title, null, r.pm_id, 'pm', now() + interval '1 day',
        jsonb_build_array(jsonb_build_object('kind', 'snag', 'id', x.id)), 'Make the area safe and fix it; a quality engineer closes it after re-inspection', 'safety:' || x.id);
    end loop;
    for x in select i.id, i.kind, coalesce(i.stage_key, i.system, '') what, u.code from inspections i left join units u on u.id = i.unit_id
             where i.project_id = r.project_id and i.status = 'Failed' and i.decided_at > now() - interval '30 days'
               and not exists (select 1 from inspections j where j.unit_id is not distinct from i.unit_id and j.kind = i.kind and coalesce(j.stage_key, j.system, '') = coalesce(i.stage_key, i.system, '') and j.status = 'Passed' and j.decided_at > i.decided_at) loop
      perform app.raise_alert(r.org_id, r.project_id, 'Quality', 'High', 'quality', format('%s inspection failed: %s %s', x.kind, x.code, x.what), null, null, 'quality', null,
        jsonb_build_array(jsonb_build_object('kind', 'inspection', 'id', x.id)), 'Agree the corrective action with the contractor and re-inspect', 'inspfail:' || x.id);
    end loop;
    for x in select id, title, expiry from documents where project_id = r.project_id and expiry is not null and expiry <= v_today + 30 loop
      perform app.raise_alert(r.org_id, r.project_id, 'Permit', case when x.expiry < v_today then 'Critical' when x.expiry <= v_today + 7 then 'High' else 'Medium' end, 'documents',
        format('%s %s %s', x.title, case when x.expiry < v_today then 'expired on' else 'expires on' end, to_char(x.expiry, 'DD Mon YYYY')), null, null, 'pd', x.expiry::timestamptz,
        jsonb_build_array(jsonb_build_object('kind', 'document', 'id', x.id)), 'Start the renewal and upload the renewed document', 'permit:' || x.id);
    end loop;
    for x in select a.id, a.kind, a.ref, a.requested_at, st.role_id from approvals a join approval_steps st on st.approval_id = a.id and st.status = 'pending'
             where a.project_id = r.project_id and a.status = 'Pending' and a.kind in ('INVOICE','RABILL') and a.requested_at < now() - interval '3 days' loop
      perform app.raise_alert(r.org_id, r.project_id, 'Payment', 'Medium', 'approvals', format('%s %s waiting %s days for %s', case x.kind when 'INVOICE' then 'Invoice' else 'Running bill' end, x.ref,
        extract(day from now() - x.requested_at)::integer, x.role_id), null, null, x.role_id, null, jsonb_build_array(jsonb_build_object('kind', 'approval', 'id', x.id)), 'Decide the approval', 'approval:' || x.id);
    end loop;
    perform app.scan_finance(r.project_id, r.org_id, r.pm_id);   -- financial exceptions (defined with the financial intelligence)
    -- shortages: follow the request to its order and receipt
    for x in select sh.id, sh.mr_id, (sh.assessment ->> 'to_buy')::numeric to_buy, po.id po_id, po.status po_status, po.expected_delivery,
                    coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0) accepted
             from material_shortages sh left join purchase_orders po on po.mr_id = sh.mr_id and po.status not in ('Rejected','Cancelled')
             where sh.project_id = r.project_id and sh.status in ('Open','Ordered') and sh.mr_id is not null loop
      if x.po_id is not null and x.accepted >= x.to_buy then
        update material_shortages set status = 'Delivered' where id = x.id;
        perform app.clear_alert(r.org_id, 'shortage:' || x.id, format('Delivered on %s', x.po_id));
      elsif x.po_id is not null and x.po_status <> 'Pending approval' then
        update material_shortages set status = 'Ordered' where id = x.id and status = 'Open';
        update alerts set next_action = format('Track delivery of %s%s', x.po_id, coalesce(', expected ' || to_char(x.expected_delivery, 'DD Mon'), '')), updated_at = now()
         where org_id = r.org_id and dedupe_key = 'shortage:' || x.id and status <> 'Resolved';
      end if;
    end loop;
  end loop;
  -- resolve alerts whose condition has cleared
  -- B24: when the activity that drove a delay finishes, its overdue successors are re-checked at once (their delay is no longer carried in)
  with fin as (
    update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Activity finished', updated_at = now()
      from tasks t where a.dedupe_key = 'delay:' || t.id and t.act_finish is not null and a.status <> 'Resolved' and (auth.uid() is null or a.org_id = app.org())
    returning t.id, t.project_id, a.org_id)
  select n + coalesce(count(app.emit(f.project_id, 'activity_overdue', format('overdue:%s:after:%s', nx.id, f.id), jsonb_build_object('task_id', nx.id, 'task', nx.name))), 0) into n
    from fin f join task_dependencies d on d.pred_id = f.id join tasks nx on nx.id = d.task_id where nx.act_finish is null and nx.base_finish < app.today(f.org_id);
  update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Defect closed', updated_at = now()
   from snags sn where a.dedupe_key = 'safety:' || sn.id and sn.status = 'Closed' and a.status <> 'Resolved';
  update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Approval decided', updated_at = now()
   from approvals ap where a.dedupe_key = 'approval:' || ap.id and ap.status <> 'Pending' and a.status <> 'Resolved';
  update alerts a set status = 'Resolved', resolved_at = now(), resolution = 'Final inspection decided', updated_at = now()
   from inspections i where a.dedupe_key = 'final:' || i.unit_id and i.kind = 'Final' and i.status <> 'Requested' and a.status <> 'Resolved';
  update alerts set status = 'Open', updated_at = now() where status = 'Suppressed' and suppressed_until < now();
  -- escalate unacknowledged critical and high alerts, once
  for x in select a.*, r2.escalate_role, (r2.params ->> (a.severity || '_hours'))::numeric hrs from alerts a
           join automation_rules r2 on r2.org_id = a.org_id and r2.id = 'alert_escalation' and r2.enabled
           where a.status = 'Open' and a.escalated_at is null and a.severity in ('Critical','High') and (auth.uid() is null or a.org_id = app.org()) loop
    if x.hrs is not null and x.created_at < now() - make_interval(hours => x.hrs::integer) then
      if x.project_id is not null then perform app.notify_role(x.project_id, x.escalate_role, format('Escalation [%s]: %s — %s', x.severity, x.title, x.next_action), 'alerts'); end if;
      update alerts set escalated_at = now() where id = x.id;
    end if;
  end loop;
  return n;
end $$;
