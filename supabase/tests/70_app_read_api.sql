-- Batch 10: the read functions the production application uses. Runs last.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select tests.as_system();
select id as p3 from projects where name = 'Phase 3 controls test' \gset
select id as lp from projects where name like 'Vembanad Lake Resort%' \gset
select pr.id as pmp from projects pr join profiles p on p.user_id = pr.pm_id where p.email = 'pm@a' order by pr.created_at limit 1 \gset

select tests.login('pm@a');
select tests.ok('B10 App read API', (select (s -> 'user' ->> 'role') = 'pm' and (s ->> 'aal') = 'aal2' and (s -> 'permissions' -> 'procurement') ? 'create'
    and jsonb_array_length(s -> 'projects') = (select count(*) from app.visible_projects()) from api.session_info() s),
  'session info: role, MFA level, permissions and exactly the projects the user may see');
select tests.login('md@b');
select tests.ok('B10 App read API', (select not exists (select 1 from jsonb_array_elements(s -> 'projects') x where x ->> 'id' in (:'p3', :'lp', :'pmp')) from api.session_info() s),
  'another organisation''s session lists none of this organisation''s projects');
select tests.throws('B10 App read API', format('select api.mr_list(%L)', :'pmp'), 'no access', 'another organisation cannot read the material requests');

select tests.login('md@a');
select tests.ok('B10 App read API', (select bool_and(x -> 'finance' is not null and (x -> 'finance' ->> 'forecast') is not null) from jsonb_array_elements(api.portfolio_summary()) x),
  'portfolio summary carries budget, commitment, actual and forecast for the MD');
select tests.login('sup@a');
select tests.throws('B10 App read API', 'select api.portfolio_summary()', 'permission denied', 'a site supervisor has no command center (no dashboard right)');

-- prices hidden in procurement reads for roles without budget rights
select tests.as_system();
select m.project_id as mrp, m.id as mr_q from material_requests m where exists (select 1 from quotations q where q.mr_id = m.id)
  and m.project_id in (select project_id from project_members where user_id = (select id from auth.users where email = 'sup@a')) order by m.created_at limit 1 \gset
select po.id as po_any, po.project_id as pop from purchase_orders po where po.project_id = :'mrp' order by po.created_at limit 1 \gset
select tests.login('sup@a');
select tests.ok('B10 App read API', (select bool_and(q -> 'rate' = 'null'::jsonb) from jsonb_array_elements(api.mr_list(:'mrp')) m, jsonb_array_elements(m -> 'quotes') q),
  'a site supervisor sees requests and quotation vendors but no rates');
select tests.ok('B10 App read API', (select d -> 'total' = 'null'::jsonb and d -> 'rate' = 'null'::jsonb and (d ->> 'qty') is not null from api.po_detail(:'po_any') d),
  'a site supervisor sees an order''s quantity and receipts but not its price');
select tests.login('proc@a');
select tests.ok('B10 App read API', (select bool_or((q ->> 'rate') is not null) from jsonb_array_elements(api.mr_list(:'mrp')) m, jsonb_array_elements(m -> 'quotes') q),
  'procurement sees the rates');

-- approvals: the approver sees it, the requester does not
select tests.as_system();
select a.id as ap_any, (select role_id from approval_steps s where s.approval_id = a.id and s.status = 'pending') as ap_role, a.requested_by as ap_by
  from approvals a where a.status = 'Pending' and a.project_id in (select project_id from project_members where user_id = (select id from auth.users where email = 'pm@a'))
   and exists (select 1 from approval_steps s where s.approval_id = a.id and s.status = 'pending' and s.role_id in ('pm','pd','md','finance')) order by a.requested_at limit 1 \gset
select email as ap_user from profiles where role_id = :'ap_role' and org_id = '00000000-0000-0000-0000-00000000000a' and user_id <> :'ap_by' and active
  and (all_projects or user_id in (select user_id from project_members where project_id = (select project_id from approvals where id = :'ap_any'))) order by email limit 1 \gset
select tests.login(:'ap_user');
select tests.ok('B10 App read API', exists (select 1 from jsonb_array_elements(api.my_approvals() -> 'to_decide') x where x ->> 'id' = :'ap_any'),
  'a pending approval appears in the inbox of the person whose step it is', :'ap_any' || ' for ' || :'ap_user');
select tests.as_system(); select email as ap_req from profiles where user_id = :'ap_by' \gset
select tests.login(:'ap_req');
select tests.ok('B10 App read API', not exists (select 1 from jsonb_array_elements(api.my_approvals() -> 'to_decide') x where x ->> 'id' = :'ap_any')
  and exists (select 1 from jsonb_array_elements(api.my_approvals() -> 'requested') x where x ->> 'id' = :'ap_any'),
  'the person who raised it sees it under requested, never as theirs to decide');

select tests.login('sup@a');
select tests.ok('B10 App read API', jsonb_array_length(api.task_list(:'mrp')) > 0 and jsonb_typeof(api.daily_report_list(:'mrp')) = 'array', 'site supervisor reads activities and daily reports of the site');
select tests.ok('B10 App read API', (select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
     and p.proname in ('session_info','cost_code_list','portfolio_summary','my_approvals','mr_list','vendor_list','po_detail','daily_report_list','task_list')),
  'the new read functions are security definer with a fixed search path');
