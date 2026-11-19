-- Phase 3 batch 7: paging, server-side filters, retention. Runs last.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select tests.as_system();
select id as lp from projects where name like 'Vembanad%' \gset
select tests.ok('B7 Performance & retention', (select count(*) = 0 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1 and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])),
  'every single-column foreign key has an index');
select tests.ok('B7 Performance & retention', not exists (select 1 from pg_policies where schemaname = 'public' and (qual ~ 'app\.can\(' or qual ~ 'has_project\(')),
  'no public policy evaluates project access row by row');
select tests.login('fin@a');
select tests.ok('B7 Performance & retention', (select count(*) = 5 from api.list_purchase_orders(null, null, null, null, 5)), 'orders are paged (5 per page)');
select created_at as page1_last from api.list_purchase_orders(null, null, null, null, 5) order by created_at limit 1 \gset
select tests.ok('B7 Performance & retention', not exists (select 1 from api.list_purchase_orders(null, null, null, :'page1_last', 5) p2 where p2.created_at >= :'page1_last'), 'the next page starts strictly after the last row (keyset)');
select tests.ok('B7 Performance & retention', (select bool_and(item ilike '%cement%') and count(*) > 0 from api.list_purchase_orders(null, null, 'cement', null, 50)), 'server-side search filters by item');
select tests.login('sup@a');
select tests.ok('B7 Performance & retention', (select bool_and(total is null) from api.list_purchase_orders(:'lp', null, null, null, 50)), 'site supervisor gets order status without prices');
select tests.login('pm2@a');
select tests.ok('B7 Performance & retention', (select count(*) = 0 from api.list_purchase_orders(:'lp', null, null, null, 50)) and (select count(*) = 0 from api.alert_feed(null, null, :'lp', null)), 'a PM outside the project sees none of its orders or alerts');
select tests.login('md@a');
select tests.ok('B7 Performance & retention', (select bool_and(r >= coalesce(nx, 0)) from (select app.sev_rank(severity) r, lead(app.sev_rank(severity)) over (order by n) nx
  from (select severity, row_number() over () n from api.alert_feed(null, null, null, null, null, 200)) a) x), 'alerts come most severe first');
select tests.login('admin@a');
select tests.ok('B7 Performance & retention', (select count(*) = 10 from api.audit_page(null, null, 10)), 'audit trail is paged');
select tests.as_system();
select (select count(*) from purchase_orders) po0, (select count(*) from payments) pay0, (select count(*) from audit_log) au0, (select count(*) from approvals) ap0 \gset
update notifications set read_at = now() - interval '400 days' where id in (select id from notifications order by id limit 20);
select api.purge_expired() as purged \gset
select tests.ok('B7 Performance & retention', (:'purged'::jsonb ->> 'notifications')::int >= 20, 'read notifications older than the policy are purged', :'purged');
select tests.ok('B7 Performance & retention', (select count(*) from purchase_orders) = :po0 and (select count(*) from payments) = :pay0 and (select count(*) from approvals) = :ap0
  and (select count(*) from audit_log) >= :au0, 'retention never removes orders, payments, approvals or audit rows');
select tests.throws('B7 Performance & retention', $$update retention_policies set keep_days = 30$$, 'keep_days_check|violates', 'retention cannot be set below 90 days');
select tests.login('pm@a');
select tests.throws('B7 Performance & retention', $$select api.purge_expired()$$, 'permission denied', 'only the scheduler or an administrator can purge');
select tests.as_system();
