-- M Andamul Development OS · 0700 financial engine, cash requirement, automation processing

-- Financial engine. Formulas (all incl. GST, per project and cost code):
--   original_budget   = budget v1 line
--   current_budget    = latest approved version line;  approved_changes = current − original
--   committed         = approved POs + active contracts + approved variations
--   actual            = QC-passed goods receipts + approved/paid running bills (gross + GST)
--   paid_against_cost = invoice payments + bill payments (cash + TDS) + advance recovered on approved/paid bills
--   retention_held    = retention on approved/paid bills
--   accrued_unpaid    = actual − paid_against_cost − retention_held
--   uncommitted_forecast (ETC) = quantity surveyor's estimate for scope not yet committed
--   forecast (FAC)    = committed + ETC      (actual is inside committed: never added twice)
--   variance          = current_budget − FAC;  uncommitted_budget = current_budget − committed
create or replace function api.cost_position(p_project text)
returns table (code text, name text, original_budget numeric, approved_changes numeric, current_budget numeric, committed numeric, pending numeric,
               actual numeric, paid_against_cost numeric, retention_held numeric, accrued_unpaid numeric, uncommitted_forecast numeric,
               forecast numeric, variance numeric, uncommitted_budget numeric)
language plpgsql stable security definer set search_path = public, app as $$
declare v_orig uuid; v_cur uuid;
begin
  perform app.require(p_project, 'budget', 'view');
  select id into v_orig from budget_versions where project_id = p_project and v = 1 and status = 'Approved';
  v_cur := app.current_budget(p_project);
  return query
  with cc as (select c.code, c.name from cost_codes c join projects p on p.org_id = c.org_id where p.id = p_project),
  com as (select x.code, (app.code_commitments(p_project, x.code)).* from cc x),
  grn as (select po.code, sum(g.accepted_value) v from goods_receipts g join purchase_orders po on po.id = g.po_id where po.project_id = p_project group by po.code),
  bills as (select c.code, sum(b.gross + b.gst) v, sum(b.retention) ret, sum(b.advance_recovery) adv from ra_bills b join contracts c on c.id = b.contract_id
            where c.project_id = p_project and b.status in ('Approved','Paid') group by c.code),
  pinv as (select po.code, sum(pm.amount) v from payments pm join vendor_invoices i on i.id = pm.invoice_id join purchase_orders po on po.id = i.po_id where pm.project_id = p_project group by po.code),
  pbill as (select c.code, sum(pm.amount + pm.tds) v from payments pm join ra_bills b on b.id = pm.ra_bill_id join contracts c on c.id = b.contract_id where pm.project_id = p_project group by c.code)
  select cc.code, cc.name,
    coalesce((select amount from budget_lines where version_id = v_orig and budget_lines.code = cc.code), 0),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0) - coalesce((select amount from budget_lines where version_id = v_orig and budget_lines.code = cc.code), 0),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0),
    com.committed, com.pending,
    coalesce(grn.v, 0) + coalesce(bills.v, 0),
    coalesce(pinv.v, 0) + coalesce(pbill.v, 0) + coalesce(bills.adv, 0),
    coalesce(bills.ret, 0),
    coalesce(grn.v, 0) + coalesce(bills.v, 0) - (coalesce(pinv.v, 0) + coalesce(pbill.v, 0) + coalesce(bills.adv, 0)) - coalesce(bills.ret, 0),
    coalesce(e.amount, 0),
    com.committed + coalesce(e.amount, 0),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0) - (com.committed + coalesce(e.amount, 0)),
    coalesce((select amount from budget_lines where version_id = v_cur and budget_lines.code = cc.code), 0) - com.committed
  from cc join com on com.code = cc.code
  left join grn on grn.code = cc.code left join bills on bills.code = cc.code left join pinv on pinv.code = cc.code left join pbill on pbill.code = cc.code
  left join etc_estimates e on e.project_id = p_project and e.code = cc.code
  order by cc.code;
end $$;

-- available contingency = contingency budget − contingency commitments − overruns on every other code
create or replace function api.contingency(p_project text, out contingency_budget numeric, out overruns numeric, out available numeric)
language sql stable security definer set search_path = public, app as $$
  select sum(current_budget) filter (where c.is_contingency),
         sum(greatest(forecast - current_budget, 0)) filter (where not c.is_contingency),
         sum(current_budget - committed) filter (where c.is_contingency) - coalesce(sum(greatest(forecast - current_budget, 0)) filter (where not c.is_contingency), 0)
  from api.cost_position(p_project) cp join cost_codes c on c.code = cp.code and c.org_id = (select org_id from projects where id = p_project)
$$;

-- Cash requirement: obligations due (approved, unpaid) and forecast outflows, by 30-day bucket
create or replace function api.cash_requirement(p_project text, p_days integer default 90)
returns table (bucket text, due numeric, forecast numeric)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'payments', 'view');
  return query
  with lines as (
    -- approved invoices not yet fully paid
    select i.due_date d, i.total - coalesce((select sum(amount) from payments where invoice_id = i.id), 0) amt, 'due' k
      from vendor_invoices i where i.project_id = p_project and i.status = 'Approved'
    union all
    -- approved running bills not yet fully paid (net payable)
    select b.due_date, b.net_payable - coalesce((select sum(amount) from payments where ra_bill_id = b.id), 0), 'due'
      from ra_bills b join contracts c on c.id = b.contract_id where c.project_id = p_project and b.status = 'Approved'
    union all
    -- forecast: undelivered PO balance at expected delivery + vendor credit days
    select coalesce(po.expected_delivery, current_date) + v.credit_days,
           app.incl_gst((po.qty - coalesce((select sum(qty) from goods_receipts where po_id = po.id and qc = 'Pass'), 0)) * po.rate, po.gst_pct), 'forecast'
      from purchase_orders po join vendors v on v.id = po.vendor_id where po.project_id = p_project and po.status in ('Approved','Part received')
    union all
    -- forecast: unbilled contract value spread evenly to the contract end date (one point per remaining month)
    select current_date + 30 * g, (app.incl_gst(app.contract_value(c.id), c.gst_pct) - coalesce((select sum(gross + gst) from ra_bills where contract_id = c.id and status <> 'Rejected'), 0))
           / greatest(1, ceil((c.end_date - current_date) / 30.0)), 'forecast'
      from contracts c, generate_series(1, greatest(1, ceil((c.end_date - current_date) / 30.0)::integer)) g
      where c.project_id = p_project and c.status = 'Active' and c.end_date > current_date
  )
  select b.label, coalesce(sum(l.amt) filter (where l.k = 'due'), 0), coalesce(sum(l.amt) filter (where l.k = 'forecast'), 0)
  from (values (0, 30, '0–30 days'), (31, 60, '31–60 days'), (61, 90, '61–90 days')) b(lo, hi, label)
  left join lines l on greatest(l.d - current_date, 0) between b.lo and b.hi and l.amt > 0
  where b.lo < p_days
  group by b.lo, b.label order by b.lo;
end $$;

create or replace function api.unit_readiness(p_project text)
returns table (unit_id uuid, code text, name text, readiness jsonb)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'handover', 'view');
  return query select u.id, u.code, u.name, app.unit_readiness(u.id) from units u where u.project_id = p_project order by u.code;
end $$;

-- Delivery tracking for site teams: no prices
create or replace function api.po_tracking(p_project text)
returns table (id text, item text, uom text, qty numeric, accepted numeric, status text, expected_delivery date)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require(p_project, 'procurement', 'view');
  return query select po.id, po.item, po.uom, po.qty, coalesce((select sum(g.qty) from goods_receipts g where g.po_id = po.id and g.qc = 'Pass'), 0), po.status, po.expected_delivery
  from purchase_orders po where po.project_id = p_project order by po.created_at desc;
end $$;

-- ---------- automation ----------
-- Scan for exceptions and queue events. Dedupe keys make repeated scans safe.
create or replace function api.scan_exceptions() returns integer
language plpgsql security definer set search_path = public, app as $$
declare n integer := 0; r record; s org_settings; v_week text := to_char(now(), 'IYYY-IW');
begin
  if auth.uid() is not null then perform app.require_perm('settings', 'view'); end if;   -- callable by the scheduler (service role) or an admin
  for r in select p.id project_id, p.org_id from projects p where p.stage in ('Pre-construction','Construction','Pre-opening') and (auth.uid() is null or p.org_id = app.org()) loop
    select * into s from org_settings where org_id = r.org_id;
    -- budget overrun per cost code (approved budgets only)
    if app.current_budget(r.project_id) is not null then
      n := n + coalesce((select count(app.emit(r.project_id, 'budget_overrun', format('overrun:%s:%s:%s', r.project_id, x.code, v_week), jsonb_build_object('code', x.code, 'forecast', x.forecast, 'budget', x.cb)))
        from (select cp.code, cp.forecast, cp.cb from (select l.code, l.amount cb, coalesce(e.amount,0) + (app.code_commitments(r.project_id, l.code)).committed forecast
              from budget_lines l left join etc_estimates e on e.project_id = r.project_id and e.code = l.code where l.version_id = app.current_budget(r.project_id)) cp
              where cp.cb > 0 and cp.forecast * 100 > cp.cb * s.flag_pct) x), 0);
    end if;
    -- late activities (not finished after baseline finish)
    n := n + coalesce((select count(app.emit(r.project_id, 'critical_delay', format('delay:%s:%s', t.id, v_week), jsonb_build_object('task', t.name, 'days_late', current_date - t.base_finish)))
      from tasks t where t.project_id = r.project_id and t.act_finish is null and t.base_finish < current_date), 0);
    -- missing daily report after cutoff
    if (select stage from projects where id = r.project_id) = 'Construction' and localtime > s.report_cutoff
       and not exists (select 1 from daily_reports where project_id = r.project_id and report_date = current_date and status in ('Submitted','Approved')) then
      n := n + case when app.emit(r.project_id, 'missing_report', format('missing:%s:%s', r.project_id, current_date), '{}'::jsonb) is null then 0 else 1 end;
    end if;
  end loop;
  return n;
end $$;

-- Process queued events: rules → notifications on each channel; retries with backoff; escalation of stale approvals.
create or replace function api.process_events(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = public, app as $$
declare e automation_events; rl automation_rules; ch text; v_role text; n integer := 0; v_text text; cfg channel_config; a approvals;
begin
  if auth.uid() is not null then perform app.require_perm('settings', 'edit'); end if;
  for e in select * from automation_events where status in ('queued','failed') and next_attempt_at <= now() order by id limit p_limit for update skip locked loop
    begin
      select * into rl from automation_rules where org_id = e.org_id and event = e.event and enabled;
      if found then
        v_text := rl.name || coalesce(' — ' || (select name from projects where id = e.project_id), '') || coalesce(': ' || coalesce(e.payload ->> 'title', e.payload ->> 'task', e.payload ->> 'item', e.payload ->> 'code'), '');
        foreach v_role in array rl.notify_roles loop
          foreach ch in array rl.channels loop
            if ch = 'in_app' then
              insert into notifications (org_id, user_id, channel, delivery, text, link, event_id)
              select e.org_id, p.user_id, 'in_app', 'delivered', v_text, coalesce(e.project_id, ''), e.id from profiles p
              where p.org_id = e.org_id and p.role_id = v_role and p.active and (e.project_id is null or p.all_projects or exists (select 1 from project_members m where m.project_id = e.project_id and m.user_id = p.user_id));
            else
              select * into cfg from channel_config where org_id = e.org_id and channel = ch;
              -- external channels are queued for the delivery worker only when a provider is configured; never reported as sent
              insert into notifications (org_id, user_id, channel, delivery, text, link, event_id)
              select e.org_id, p.user_id, ch, case when cfg.enabled then 'queued' else 'not_configured' end, v_text, coalesce(e.project_id, ''), e.id from profiles p
              where p.org_id = e.org_id and p.role_id = v_role and p.active and (e.project_id is null or p.all_projects or exists (select 1 from project_members m where m.project_id = e.project_id and m.user_id = p.user_id));
            end if;
          end loop;
        end loop;
        if rl.creates_risk and e.project_id is not null then
          insert into risks (id, project_id, title, source, severity, dedupe_key)
          values (app.next_no(e.org_id, 'RK'), e.project_id, v_text, e.event, case when e.event in ('safety_defect','budget_overrun') then 'High' else 'Medium' end, 'risk:' || e.dedupe_key)
          on conflict (dedupe_key) do nothing;
        end if;
      end if;
      update automation_events set status = 'processed', processed_at = now(), attempts = attempts + 1 where id = e.id;
      n := n + 1;
    exception when others then
      update automation_events set attempts = attempts + 1, last_error = sqlerrm,
        status = case when attempts + 1 >= 5 then 'dead' else 'failed' end,
        next_attempt_at = now() + make_interval(mins => power(2, attempts + 1)::integer) where id = e.id;
    end;
  end loop;
  -- escalation: approval steps still pending past the rule's window, escalated once
  for e in select ev.* from automation_events ev join automation_rules r on r.org_id = ev.org_id and r.event = ev.event and r.escalate_role is not null
           where ev.event = 'approval_requested' and ev.escalated_at is null and ev.created_at < now() - make_interval(hours => r.escalate_after_hours) loop
    select * into a from approvals where id = e.payload ->> 'approval_id';
    if a.status = 'Pending' then
      perform app.notify_role(a.project_id, (select escalate_role from automation_rules where org_id = e.org_id and event = e.event), 'Escalation: ' || a.kind || ' ' || a.ref || ' has waited too long for approval', 'approvals', e.id);
    end if;
    update automation_events set escalated_at = now() where id = e.id;
  end loop;
  return n;
end $$;

create or replace function api.mark_notifications_read(p_ids bigint[] default null) returns integer
language sql security definer set search_path = public as $$
  with u as (update notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids)) returning 1) select count(*)::integer from u
$$;
