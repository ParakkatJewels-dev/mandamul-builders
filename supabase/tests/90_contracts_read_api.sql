-- Batch 14: read functions behind the contracts, billing and payment screens. Runs last.
\set ON_ERROR_STOP 1
\pset pager off
set client_min_messages = warning;
select tests.as_system();
select id as p3 from projects where name = 'Phase 3 controls test' \gset
select tests.login('vend@a');
select tests.ok('B14 Contracts read API', (select bool_and(x ->> 'vendor' like 'Western Ghats%') and count(*) >= 1 from jsonb_array_elements(api.contract_list(:'p3')) x),
  'a contractor sees only their own contracts', (select string_agg(x ->> 'id', ', ') from jsonb_array_elements(api.contract_list(:'p3')) x));
select tests.ok('B14 Contracts read API', (select (d -> 'items' -> 0 ->> 'rate') is not null and (d -> 'can' ->> 'claim')::boolean from api.contract_detail('WO-26-0003') d),
  'a contractor sees the rates and bills of their own contract and may claim on it');
select tests.throws('B14 Contracts read API', 'select api.contract_list(''MA-2026-001'')', 'no access', 'a contractor cannot list contracts of a project they are not on');
select tests.login('vend2@a');
select tests.throws('B14 Contracts read API', 'select api.contract_detail(''WO-26-0003'')', 'not found', 'another contractor cannot open the contract');
select tests.login('sup@a');
select tests.ok('B14 Contracts read API', (select (d -> 'items' -> 0 -> 'rate') = 'null'::jsonb and (d -> 'can' ->> 'measure')::boolean and not (d -> 'can' ->> 'claim')::boolean
    and (d -> 'bills' -> 0 -> 'net_payable') = 'null'::jsonb from api.contract_detail('WO-26-0001') d),
  'a site supervisor sees quantities to measure but no rates or bill amounts');
select tests.login('pm@a');
select tests.ok('B14 Contracts read API', (select (x ->> 'value')::numeric > 0 and (x ->> 'certified') is not null from jsonb_array_elements(api.contract_list('MA-2026-001')) x where x ->> 'id' = 'WO-26-0001'),
  'the project manager sees contract value, certified and paid');
select tests.throws('B14 Contracts read API', 'select api.payment_queue()', 'permission', 'the project manager has no payment queue (no payments right)');
select tests.login('fin@a');
select tests.ok('B14 Contracts read API', exists (select 1 from jsonb_array_elements(api.payment_queue()) x where x ->> 'id' = 'RA-26-0002' and (x ->> 'balance')::numeric = 272700),
  'finance sees the approved, unpaid bill with its exact balance');
select tests.ok('B14 Contracts read API', (select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname in ('contract_list','contract_detail','payment_queue')),
  'the new functions are security definer with a fixed search path');
