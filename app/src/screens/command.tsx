// Command center: one row per project, every figure from the database (api.portfolio_summary).
import { useApp } from '../app';
import { formatCompact, pct, sumPaise, toPaise } from '../lib/money';
import { Async, Badge, Bar, PageHead, useRpc } from '../ui/kit';

type Row = { id: string; name: string; stage: string; location: string; keys: number | null; pm: string | null; progress: number | string | null; overdue_tasks: number;
  finance: { budget: number; committed: number; actual: number; forecast: number; variance: number } | null;
  alerts: { critical: number; high: number; open: number }; pending_approvals: number; units: { total: number; handed_over: number } };

export function Command() {
  const { setProject, go } = useApp();
  const q = useRpc<Row[]>('portfolio_summary');
  return <>
    <PageHead title="Command center" sub="Every figure is calculated from approved records in the database." >
      <button className="btn" onClick={q.reload}>Refresh</button>
    </PageHead>
    <Async q={q} empty={d => d.length === 0}>{rows => {
      const fin = rows.filter(r => r.finance);
      const tot = (k: 'budget' | 'committed' | 'actual' | 'forecast') => sumPaise(fin.map(r => toPaise(r.finance![k])));
      const budget = tot('budget'), forecast = tot('forecast');
      return <>
        <div className="kpis">
          <div className="kpi"><span>Active projects</span><b>{rows.length}</b><small>{rows.filter(r => r.overdue_tasks > 0).length} with overdue activities</small></div>
          {fin.length > 0 && <>
            <div className="kpi"><span>Approved budget</span><b>{formatCompact(budget)}</b><small>{fin.length} projects</small></div>
            <div className="kpi"><span>Committed</span><b>{formatCompact(tot('committed'))}</b><small>{pct(tot('committed'), budget)} of budget</small></div>
            <div className="kpi"><span>Actual cost</span><b>{formatCompact(tot('actual'))}</b><small>{pct(tot('actual'), budget)} of budget</small></div>
            <div className="kpi"><span>Forecast at completion</span><b>{formatCompact(forecast)}</b><small className={forecast > budget ? 'error' : ''}>{forecast > budget ? `${formatCompact(forecast - budget)} over budget` : 'within budget'}</small></div>
          </>}
          <div className="kpi"><span>Critical alerts</span><b>{rows.reduce((a, r) => a + r.alerts.critical, 0)}</b><small>{rows.reduce((a, r) => a + r.pending_approvals, 0)} approvals pending</small></div>
        </div>
        <section className="card flush"><table className="t stack"><thead><tr><th>Project</th><th>Stage</th><th>Progress</th><th className="num">Budget</th><th className="num">Forecast</th><th className="num">Variance</th><th className="num">Overdue</th><th className="num">Alerts</th><th className="num">Units handed over</th></tr></thead>
          <tbody>{rows.map(r => { const v = toPaise(r.finance?.variance); return <tr key={r.id} className="click" tabIndex={0} onClick={() => { setProject(r.id); go(r.finance ? 'cost' : 'site'); }} onKeyDown={e => e.key === 'Enter' && (setProject(r.id), go('cost'))}>
            <td data-l="Project"><b>{r.name}</b><br /><span className="sm muted">{r.location} · PM {r.pm ?? '—'}</span></td>
            <td data-l="Stage"><Badge s={r.stage} /></td>
            <td data-l="Progress"><Bar v={Number(r.progress ?? 0)} /><span className="sm muted">{Number(r.progress ?? 0).toFixed(0)}% reported</span></td>
            <td data-l="Budget" className="num">{formatCompact(toPaise(r.finance?.budget))}</td>
            <td data-l="Forecast" className="num">{formatCompact(toPaise(r.finance?.forecast))}</td>
            <td data-l="Variance" className="num" style={{ color: v !== null && v < 0n ? 'var(--bad)' : undefined }}>{formatCompact(v)}</td>
            <td data-l="Overdue" className="num">{r.overdue_tasks}</td>
            <td data-l="Alerts" className="num">{r.alerts.critical > 0 && <Badge s="Critical" />} {r.alerts.open}</td>
            <td data-l="Units" className="num">{r.units.handed_over}/{r.units.total}</td>
          </tr>; })}</tbody></table></section>
        <p className="sm muted" style={{ marginTop: 8 }}>Progress is the activity progress people reported, weighted by duration; verified completion is in the cost and readiness reports. Variance = budget − forecast.</p>
      </>;
    }}</Async>
  </>;
}
