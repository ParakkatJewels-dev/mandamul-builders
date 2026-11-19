-- Batch 9b: contractor score comparability (B27). Evidence (prototype seed): 5 of 6 contractors were marked comparable
-- while scored on 45% of the weight, without the 25%-weight on-time component; their scores were ranked against one scored on 70%.
-- Same signature; only the comparable flag changes.

create or replace function api.contractor_scores(p_project text default null)
returns table (vendor_id uuid, vendor text, score numeric, comparable boolean, metrics_used integer, components jsonb)
language plpgsql security definer set search_path = public, app as $$
declare v_org uuid := app.org(); v_today date := app.today();
begin
  if p_project is not null then perform app.require(p_project, 'contracts', 'view'); else perform app.require_perm('contracts', 'view'); end if;
  return query
  with ven as (select distinct c.vendor_id from contracts c join projects p on p.id = c.project_id
               where p.org_id = v_org and c.status in ('Active','Closed') and (p_project is null or c.project_id = p_project) and app.has_project(c.project_id)),
  raw as (
    select v.vendor_id,
      (select jsonb_build_object('value', round(100.0 * count(*) filter (where t.act_finish <= t.base_finish) / nullif(count(*), 0), 1), 'sample', count(*))
         from tasks t where t.contractor_id = v.vendor_id and t.act_finish is not null and (p_project is null or t.project_id = p_project)) on_time,
      (select jsonb_build_object('value', round(100.0 * sum(coalesce((select sum(m.qty) from measurements m where m.contract_item_id = ci.id and m.status = 'Verified'), 0))
                 / nullif(sum(ci.qty * least(1, greatest(0, (v_today - c.start_date)::numeric / greatest(c.end_date - c.start_date, 1)))), 0), 1), 'sample', count(*))
         from contract_items ci join contracts c on c.id = ci.contract_id where c.vendor_id = v.vendor_id and c.status in ('Active','Closed') and (p_project is null or c.project_id = p_project)) productivity,
      (select jsonb_build_object('value', round(100.0 * count(*) filter (where i.status = 'Failed') / nullif(count(*), 0), 1), 'sample', count(*))
         from inspections i where i.status in ('Passed','Failed') and (p_project is null or i.project_id = p_project) and i.unit_id in (select c.unit_id from contracts c where c.vendor_id = v.vendor_id and c.unit_id is not null
                                                                                   union select w.unit_id from contracts c join work_packages w on w.id = c.work_package_id where c.vendor_id = v.vendor_id)) rework,
      (select jsonb_build_object('value', round(count(*) / nullif((select sum(b.gross + b.gst) from ra_bills b join contracts c on c.id = b.contract_id where c.vendor_id = v.vendor_id and b.status in ('Approved','Paid') and (p_project is null or c.project_id = p_project)) / 10000000.0, 0), 2), 'sample',
                 (select count(*) from ra_bills b join contracts c on c.id = b.contract_id where c.vendor_id = v.vendor_id and b.status in ('Approved','Paid') and (p_project is null or c.project_id = p_project)))
         from snags s where s.assignee_vendor_id = v.vendor_id and (p_project is null or s.project_id = p_project)) defects,
      (select jsonb_build_object('value', count(*), 'sample', 1) from snags s where s.assignee_vendor_id = v.vendor_id and s.severity = 'Safety-critical' and (p_project is null or s.project_id = p_project)) safety,
      (select jsonb_build_object('value', round(100.0 * coalesce(sum((select sum(x.amount) from contract_variations x where x.contract_id = c.id and x.status = 'Approved')), 0) / nullif(sum(app.contract_value(c.id)), 0), 1), 'sample', count(*))
         from contracts c where c.vendor_id = v.vendor_id and c.status in ('Active','Closed') and (p_project is null or c.project_id = p_project)) variations,
      (select jsonb_build_object('value', round(avg((cl.assessment ->> 'gross')::numeric * 100 / nullif(cl.claimed_gross, 0)), 1), 'sample', count(*))
         from contractor_claims cl join contracts c on c.id = cl.contract_id where c.vendor_id = v.vendor_id and cl.assessment is not null and (p_project is null or c.project_id = p_project)) claim_accuracy,
      (select jsonb_build_object('value', round(avg(extract(epoch from s.fixed_at - s.created_at) / 86400)::numeric, 1), 'sample', count(*))
         from snags s where s.assignee_vendor_id = v.vendor_id and s.fixed_at is not null and (p_project is null or s.project_id = p_project)) response
    from ven v),
  sc as (
    select r.vendor_id, w.metric, w.weight, w.min_sample, w.formula, m.val, m.sample,
      case w.metric
        when 'on_time' then m.val when 'productivity' then least(100, m.val) when 'rework' then greatest(0, 100 - 5 * m.val)
        when 'defects' then greatest(0, 100 - 10 * m.val) when 'safety' then greatest(0, 100 - 25 * m.val) when 'variations' then greatest(0, 100 - 2 * m.val)
        when 'claim_accuracy' then least(100, m.val) when 'response' then greatest(0, 100 - 5 * m.val) end s
    from raw r cross join lateral (values ('on_time', r.on_time), ('productivity', r.productivity), ('rework', r.rework), ('defects', r.defects), ('safety', r.safety),
                                          ('variations', r.variations), ('claim_accuracy', r.claim_accuracy), ('response', r.response), ('wastage', null::jsonb)) x(metric, j)
    join contractor_score_weights w on w.org_id = v_org and w.metric = x.metric
    cross join lateral (select (x.j ->> 'value')::numeric val, coalesce((x.j ->> 'sample')::integer, 0) sample) m)
  select sc.vendor_id, (select name from vendors where id = sc.vendor_id),
    round(sum(sc.weight * sc.s) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0) / nullif(sum(sc.weight) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0), 0), 1),
    -- B27: comparable only when at least four components AND at least 60% of the weight are measured
    -- (two contractors scored on different 45% slices of the formula are not comparable)
    count(*) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0) >= 4
      and coalesce(sum(sc.weight) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0), 0) * 100 >= 60 * nullif(sum(sc.weight) filter (where sc.weight > 0), 0),
    (count(*) filter (where sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0))::integer,
    jsonb_agg(jsonb_build_object('metric', sc.metric, 'value', sc.val, 'sample', sc.sample, 'score', round(sc.s, 1), 'weight', sc.weight, 'formula', sc.formula,
      'used', sc.s is not null and sc.sample >= sc.min_sample and sc.weight > 0, 'note', case when sc.weight = 0 then 'not weighted' when sc.s is null then 'no data' when sc.sample < sc.min_sample then format('needs %s, has %s', sc.min_sample, sc.sample) end)
      order by sc.weight desc)
  from sc group by sc.vendor_id order by 3 desc nulls last;
end $$;
