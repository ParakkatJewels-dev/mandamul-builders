// Cost report by cost code for the selected project (api.cost_position): budget, commitments, actuals, forecast, variance.
import { useApp } from '../app';
import { formatINR, sumPaise, toPaise } from '../lib/money';
import { Async, Empty, PageHead, useRpc } from '../ui/kit';

type Line = { code: string; name: string; original_budget: number; current_budget: number; committed: number; actual: number; paid_against_cost: number; retention_held: number; accrued_unpaid: number; forecast: number; variance: number };
const COLS: [keyof Line, string][] = [['current_budget', 'Current budget'], ['committed', 'Committed'], ['actual', 'Actual'], ['paid_against_cost', 'Paid'], ['accrued_unpaid', 'Accrued, unpaid'], ['forecast', 'Forecast at completion'], ['variance', 'Variance']];

export function Cost() {
  const { project, info } = useApp();
  const q = useRpc<Line[]>(project ? 'cost_position' : null, { p_project: project });
  if (!project) return <div className="card"><Empty title="No project selected" /></div>;
  return <>
    <PageHead title="Cost report" sub={`${info.projects.find(p => p.id === project)?.name ?? ''} · forecast = committed + estimate to complete; variance = budget − forecast`} />
    <Async q={q} empty={x => x.length === 0}>{rows => <section className="card flush"><table className="t stack"><thead><tr><th>Cost code</th>{COLS.map(([, l]) => <th key={l} className="num">{l}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.code}><td data-l="Cost code"><b>{r.code}</b> {r.name}</td>{COLS.map(([k, l]) => { const v = toPaise(r[k]); return <td key={l} data-l={l} className="num" style={{ color: k === 'variance' && v !== null && v < 0n ? 'var(--bad)' : undefined }}>{formatINR(v)}</td>; })}</tr>)}</tbody>
      <tfoot><tr><td>Total</td>{COLS.map(([k, l]) => <td key={l} className="num">{formatINR(sumPaise(rows.map(r => toPaise(r[k]))))}</td>)}</tr></tfoot></table></section>}</Async>
  </>;
}
