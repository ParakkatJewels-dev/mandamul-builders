-- Phase 3 batch 9: alert precision (B24–B26). Runs last; restores every estimate it changes.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select tests.as_system();
select id as p3 from projects where name = 'Phase 3 controls test' \gset
-- push two cost codes of the project over budget through the estimate to complete
create temp table _etc_before as select * from etc_estimates where project_id = :'p3';
with l as (select l.code, l.amount from budget_lines l where l.version_id = app.current_budget(:'p3') and l.amount > 0 and l.code in (select code from cost_codes where not is_contingency and org_id = '00000000-0000-0000-0000-00000000000a') order by l.code limit 2)
insert into etc_estimates (project_id, code, amount, basis) select :'p3', l.code, l.amount * 1.2, 'TEST: forced overrun' from l
on conflict (project_id, code) do update set amount = excluded.amount, basis = excluded.basis;
select api.scan_exceptions();
select tests.ok('B9 Alert precision', (select count(*) from alerts where project_id = :'p3' and dedupe_key = 'budget:' || :'p3' and status = 'Open') = 1
  and (select count(*) from alerts where project_id = :'p3' and dedupe_key like 'budget:' || :'p3' || ':%' and status <> 'Resolved') = 0,
  'cost-code overruns raise one budget alert for the project, not one per code');
select tests.ok('B9 Alert precision', (select jsonb_array_length(records) >= 2 and severity = 'Critical' and title like '%cost codes forecast over budget%' from alerts where dedupe_key = 'budget:' || :'p3'),
  'the project alert lists every over-budget code as a record and takes the worst code''s severity',
  (select title || ' · ' || severity from alerts where dedupe_key = 'budget:' || :'p3'));
select count(*) as n_before from notifications where link = 'alerts' \gset
select api.scan_exceptions();
select tests.ok('B9 Alert precision', (select count(*) from notifications where link = 'alerts') = :n_before, 'a repeat scan with the same overruns notifies nobody again');
-- bring the estimates back: the alert resolves itself
delete from etc_estimates where project_id = :'p3';
insert into etc_estimates select * from _etc_before;
select api.scan_exceptions();
select count(*) as still_over from budget_lines l left join etc_estimates e on e.project_id = :'p3' and e.code = l.code
 where l.version_id = app.current_budget(:'p3') and l.amount > 0
   and (coalesce(e.amount, 0) + (app.code_commitments(:'p3', l.code)).committed) * 100 > l.amount * (select flag_pct from org_settings where org_id = '00000000-0000-0000-0000-00000000000a') \gset
select tests.ok('B9 Alert precision', case when :still_over = 0 then (select status = 'Resolved' and resolution = 'Every cost code is back within the threshold' from alerts where dedupe_key = 'budget:' || :'p3')
  else (select status = 'Open' and jsonb_array_length(records) = :still_over from alerts where dedupe_key = 'budget:' || :'p3') end,
  'with the estimates restored the alert resolves, or lists only the codes still over', format('%s code(s) still over · %s', :still_over, (select status || ' ' || coalesce(resolution, '') from alerts where dedupe_key = 'budget:' || :'p3')));

-- contractor comparability needs coverage of the weight, not only a count of components
select id as lp from projects where name like 'Vembanad Lake Resort%' \gset
select tests.login('pd@a');
select tests.ok('B9 Alert precision', (select bool_and(not s.comparable or (select sum((c ->> 'weight')::numeric) filter (where (c ->> 'used')::boolean) * 100 >= 60 * sum((c ->> 'weight')::numeric) filter (where (c ->> 'weight')::numeric > 0) from jsonb_array_elements(s.components) c))
    from api.contractor_scores(:'lp') s), 'a contractor is comparable only when at least 60% of the score weight is measured',
  (select string_agg(vendor || ':' || comparable, ', ') from api.contractor_scores(:'lp')));

select tests.as_system(); select api.scan_exceptions();
select tests.ok('B9 Alert precision', not exists (select 1 from alerts a cross join lateral jsonb_array_elements(a.records) r join cost_codes c on c.code = r ->> 'id'
    where c.org_id = a.org_id and a.dedupe_key like 'budget:%' and a.status <> 'Resolved' and r ->> 'kind' = 'cost_code' and c.is_contingency),
  'the contingency line is never listed as a cost code over budget (B29)');
