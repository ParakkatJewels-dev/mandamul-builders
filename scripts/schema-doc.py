"""Regenerate docs/SCHEMA.md from the migrated test database (run scripts/db-test.sh first).
Groups tables by area; any table not in the map lands in 'Other' so nothing is silently left out."""
import os, re, subprocess
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
host, port = os.environ.get('PGHOST', '/tmp'), os.environ.get('PGPORT', '5544')
def q(sql):
    out = subprocess.run(['psql', '-h', host, '-p', port, '-U', 'postgres', '-d', 'mandamul_test', '-At', '-F', '\t', '-c', sql], capture_output=True, text=True, check=True).stdout
    return [l.split('\t') for l in out.strip().split('\n') if l]
AREAS = {
 'Organisation, people and access': 'organizations app_modules profiles roles role_permissions permission_defaults project_members org_settings channel_config doc_counters',
 'Projects, land, units and schedule': 'clients projects land_parcels unit_templates template_stages stage_templates units unit_stages unit_commissioning tasks task_dependencies plan_templates zones buildings floors work_packages progress_photos',
 'Budget and cost': 'cost_codes boq_items budget_profiles budget_versions feasibility_studies feasibility_scenarios budget_lines etc_estimates contingency_draws forecast_scenarios',
 'Procurement, stock and payables': 'vendors material_requests quotations purchase_orders goods_receipts vendor_invoices payments materials vendor_prices rfqs material_reservations material_shortages stock_moves payment_requests',
 'Contracts and contractor billing': 'contracts contract_items contract_variations measurements ra_bills ra_bill_lines bill_payments contractor_claims claim_lines contractor_score_weights',
 'Site, quality and documents': 'daily_reports report_work_lines daily_report_labour daily_report_work daily_report_contractors inspections snags documents document_versions document_links risks',
 'Handover and assets': 'ffe_items handover_items assets warranties warranty_claims',
 'Approvals, automation, alerts and audit': 'approvals approval_steps automation_rules automation_events automation_actions alerts notifications audit_log retention_policies',
}
where = {t: a for a, ts in AREAS.items() for t in ts.split()}
tabs = [r[0] for r in q("select tablename from pg_tables where schemaname = 'public' order by 1")]
cols = {}
for t, c, ty, nn in q("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position"):
    cols.setdefault(t, []).append(f"{c} {ty}{'?' if nn == 'YES' else ''}")
pol = dict((t, n) for t, n in q("select tablename, count(*) from pg_policies where schemaname = 'public' group by 1"))
aud = {r[0] for r in q("select distinct event_object_table from information_schema.triggers where trigger_name like '%audit%'")}
rls = {r[0] for r in q("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity")}
fns = [r[0] for r in q("select 'api.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' order by 1")]
fns = [re.sub(r' DEFAULT [^,)]+', '', f) for f in fns]
md = ['# Database schema', '', 'Generated from the migrated test database (Postgres 16, Supabase-compatible) by `scripts/schema-doc.py`. Do not edit by hand; regenerate after a migration.', '',
      "Conventions: money is `numeric(18,2)` rupees in the database (whole paise in the app prototype) — never floating point; quantities are `numeric`; ids for business documents are readable numbers from `doc_counters` (e.g. `PO-26-0012`); every business table has row-level security; writes go only through `api.*` functions; tables marked *audited* have an append-only audit trigger; `version` columns give optimistic locking. A `?` after a type means the column may be empty.", '',
      f"**{len(tabs)} tables · {len(fns)} API functions · row-level security on {len([t for t in tabs if t in rls])} of {len(tabs)} tables**", '']
for area in list(AREAS) + ['Other']:
    ts = [t for t in tabs if where.get(t, 'Other') == area]
    if not ts: continue
    md += [f'## {area}', '']
    for t in ts:
        tags = [f"{pol.get(t, '0')} RLS polic{'y' if pol.get(t) == '1' else 'ies'}" if t in rls else '**RLS off**'] + (['audited'] if t in aud else [])
        md += [f"**{t}** — {' · '.join(tags)}  ", '`' + ', '.join(cols.get(t, [])) + '`', '']
md += ['## API functions (schema `api`, security definer, permission-checked inside)', ''] + [f'- `{f}`' for f in fns] + ['']
open(os.path.join(root, 'docs/SCHEMA.md'), 'w').write('\n'.join(md))
print(f"{len(tabs)} tables, {len(fns)} api functions, {len([t for t in tabs if where.get(t, 'Other') == 'Other'])} in Other")
