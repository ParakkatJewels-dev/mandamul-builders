// Feasibility: investment, revenue, EBITDA, ROI and payback for a proposed property, with scenarios and sensitivity.
// Every figure is calculated by the database (app.feasibility_model) so screens, reports and AI agree.
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { formatCompact, formatINR, parseRupees, toPaise } from '../lib/money';
import { Async, Badge, Dialog, Field, PageHead, useRpc } from '../ui/kit';

type Result = { investment: number; construction: number; contingency: number; cost_per_key: number; occupancy_pct: number; adr: number; rooms_revenue: number; total_revenue: number;
  opex: number; management_fee: number; lease: number; ebitda: number; ebitda_margin_pct: number | null; roi_pct: number | null; payback_years: number | null };
type Study = { id: string; name: string; location: string | null; keys: number; status: string; regulatory_status: string; investment: number | null; payback_years: number | null };
type Detail = { study: Study & Record<string, unknown>; base: Result; scenarios: { name: string; note: string; result: Result }[]; sensitivity: { driver: string; low: number | null; high: number | null }[]; assumptions: string[] };

const FIELDS: [string, string, 'money' | 'num' | 'text'][] = [['name', 'Study name', 'text'], ['location', 'Location', 'text'], ['land_area_acres', 'Land area (acres)', 'num'], ['land_cost', 'Land cost (₹)', 'money'],
  ['keys', 'Keys (rooms + villas)', 'num'], ['built_up_sqft', 'Built-up area (sq ft)', 'num'], ['build_cost_per_sqft', 'Build cost per sq ft (₹)', 'money'], ['infra_cost', 'Infrastructure (₹)', 'money'],
  ['ffe_per_key', 'FF&E per key (₹)', 'money'], ['preopening_cost', 'Pre-opening (₹)', 'money'], ['adr', 'Average daily rate (₹)', 'money'], ['occupancy_pct', 'Stabilised occupancy %', 'num'],
  ['other_revenue_pct', 'Other revenue, % of rooms', 'num'], ['opex_pct', 'Operating expenses, % of revenue', 'num']];

function New({ onClose }: { onClose: (id?: string) => void }) {
  const { guard } = useApp(); const [f, setF] = useState<Record<string, string>>({ other_revenue_pct: '35', opex_pct: '55' });
  const bad = FIELDS.filter(([k, , t]) => t !== 'text' && f[k] && (t === 'money' ? parseRupees(f[k]) === null : !(Number(f[k]) > 0)));
  const ready = ['name', 'keys', 'built_up_sqft', 'build_cost_per_sqft', 'adr', 'occupancy_pct'].every(k => f[k]) && bad.length === 0;
  const save = async () => {
    const p: Record<string, unknown> = {}; for (const [k, , t] of FIELDS) if (f[k]) p[k] = t === 'money' ? parseRupees(f[k]) : t === 'num' ? Number(f[k]) : f[k].trim();
    const id = await guard(() => rpc<string>('save_feasibility', { p }), 'Feasibility study saved'); if (id) onClose(id);
  };
  return <Dialog title="New feasibility study" onClose={() => onClose()}><div className="form">
    <div className="grid2">{FIELDS.map(([k, l]) => <Field key={k} label={l}><input className="input" aria-label={l} value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
    {bad.length > 0 && <div className="error">Check: {bad.map(b => b[1]).join(', ')}</div>}
    <p className="sm muted">Regulatory figures stay marked as an estimate until a qualified professional validates them.</p>
    <div className="actions"><button className="btn" onClick={() => onClose()}>Cancel</button><button className="btn primary" disabled={!ready} onClick={save}>Calculate and save</button></div>
  </div></Dialog>;
}

function View({ id }: { id: string }) {
  const q = useRpc<Detail>('feasibility', { p_id: id });
  return <Async q={q}>{d => { const b = d.base; return <>
    <div className="kpis" data-testid="feasibility-kpis">
      <div className="kpi"><span>Total investment</span><b>{formatCompact(toPaise(b.investment))}</b><small>{formatCompact(toPaise(b.cost_per_key))} per key</small></div>
      <div className="kpi"><span>Stabilised revenue</span><b>{formatCompact(toPaise(b.total_revenue))}</b><small>ADR {formatINR(toPaise(b.adr), { paise: false })} · {b.occupancy_pct}% occupancy</small></div>
      <div className="kpi"><span>EBITDA</span><b>{formatCompact(toPaise(b.ebitda))}</b><small>{b.ebitda_margin_pct ?? '—'}% margin</small></div>
      <div className="kpi"><span>ROI</span><b>{b.roi_pct ?? '—'}%</b><small>EBITDA ÷ investment</small></div>
      <div className="kpi"><span>Payback</span><b>{b.payback_years ?? '—'} years</b><small>simple, before tax and financing</small></div>
    </div>
    <section className="card flush"><table className="t stack"><thead><tr><th>Scenario</th><th className="num">Investment</th><th className="num">Revenue</th><th className="num">EBITDA</th><th className="num">ROI</th><th className="num">Payback</th><th>Assumption</th></tr></thead><tbody>
      {d.scenarios.map(s => <tr key={s.name}><td data-l="Scenario"><b>{s.name}</b></td><td data-l="Investment" className="num">{formatCompact(toPaise(s.result.investment))}</td><td data-l="Revenue" className="num">{formatCompact(toPaise(s.result.total_revenue))}</td>
        <td data-l="EBITDA" className="num">{formatCompact(toPaise(s.result.ebitda))}</td><td data-l="ROI" className="num">{s.result.roi_pct ?? '—'}%</td><td data-l="Payback" className="num">{s.result.payback_years ?? '—'} yrs</td><td data-l="Assumption" className="sm muted">{s.note}</td></tr>)}
    </tbody></table></section>
    <section className="card"><h2>Sensitivity of payback</h2><table className="t"><thead><tr><th>Driver</th><th className="num">Worse</th><th className="num">Better</th></tr></thead><tbody>
      {d.sensitivity.map(s => <tr key={s.driver}><td>{s.driver}</td><td className="num">{s.low ?? '—'} yrs</td><td className="num">{s.high ?? '—'} yrs</td></tr>)}</tbody></table></section>
    <section className="card"><h2>Assumptions</h2><ul className="sm">{d.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
      <p className="sm"><Badge s={d.study.regulatory_status === 'Estimate — not validated' ? 'Pending' : 'Approved'} /> {d.study.regulatory_status}. These are projections, not approvals.</p></section>
  </>; }}</Async>;
}

export function Feasibility() {
  const { can } = useApp(); const list = useRpc<Study[]>('feasibility_list'); const [sel, setSel] = useState<string | null>(null); const [nw, setNw] = useState(false);
  return <>
    <PageHead title="Feasibility" sub="Land and investment appraisal before a project is approved. Projections, with their assumptions.">
      {can('projects', 'create') && <button className="btn primary" onClick={() => setNw(true)}>New study</button>}
    </PageHead>
    <Async q={list}>{rows => rows.length === 0 ? <div className="card"><p className="muted">No studies yet.</p></div> : <section className="card flush"><table className="t stack"><thead><tr><th>Study</th><th className="num">Keys</th><th className="num">Investment</th><th className="num">Payback</th><th>Regulatory</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id} className="click" tabIndex={0} onClick={() => setSel(r.id)} onKeyDown={e => e.key === 'Enter' && setSel(r.id)}><td data-l="Study"><b>{r.name}</b><br /><span className="sm muted mono">{r.id}</span> <span className="sm muted">{r.location}</span></td>
        <td data-l="Keys" className="num">{r.keys}</td><td data-l="Investment" className="num">{formatCompact(toPaise(r.investment))}</td><td data-l="Payback" className="num">{r.payback_years ?? '—'} yrs</td><td data-l="Regulatory" className="sm">{r.regulatory_status}</td></tr>)}
    </tbody></table></section>}</Async>
    {sel && <div style={{ marginTop: 16 }}><h2 style={{ marginBottom: 10 }}>{list.data?.find(r => r.id === sel)?.name}</h2><View id={sel} /></div>}
    {nw && <New onClose={id => { setNw(false); if (id) { list.reload(); setSel(id); } }} />}
  </>;
}
