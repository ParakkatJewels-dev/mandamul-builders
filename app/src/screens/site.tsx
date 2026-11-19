// Daily site reports for the selected project: submit (one per day; the database refuses a second) and see verification.
// Progress moves only when the project manager verifies the report in Approvals.
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { Async, Badge, Dialog, Empty, Field, PageHead, fmtDate, todayISO, useRpc } from '../ui/kit';

type Report = { id: string; date: string; status: string; weather: string | null; labour: { trade: string; count: number }[]; issues: string | null; safety: string | null;
  submitted_by: string; verified_by: string | null; review_note: string | null; work: { task: string; progress_to: number; qty: number | null; note: string | null }[] };
type Task = { id: string; name: string; progress: number; milestone: boolean; act_finish: string | null; overdue: boolean };
const TRADES = ['Mason', 'Carpenter', 'Bar bender', 'Electrician', 'Plumber', 'Helper'];
const DRAFT = (p: string) => `mandamul.draft.report.${p}`;

function NewReport({ project, onClose }: { project: string; onClose: (saved: boolean) => void }) {
  const { guard } = useApp(); const tasks = useRpc<Task[]>('task_list', { p_project: project });
  const saved = (() => { try { return JSON.parse(localStorage.getItem(DRAFT(project)) || 'null'); } catch { return null; } })();
  const [f, setF] = useState<{ date: string; weather: string; labour: Record<string, string>; issues: string; safety: string; work: { task_id: string; progress_to: string }[] }>(
    saved || { date: todayISO(), weather: 'Clear', labour: {}, issues: '', safety: '', work: [] });
  const put = (x: typeof f) => { setF(x); try { localStorage.setItem(DRAFT(project), JSON.stringify(x)); } catch { /* draft not kept */ } };   // drafts stay on this device until submitted
  const open = (tasks.data || []).filter(t => !t.milestone && !t.act_finish);
  const submit = async () => {
    const labour = Object.entries(f.labour).filter(([, v]) => Number(v) > 0).map(([trade, v]) => ({ trade, count: Number(v) }));
    const work = f.work.filter(w => w.task_id && w.progress_to !== '').map(w => ({ task_id: w.task_id, progress_to: Number(w.progress_to) }));
    const id = await guard(() => rpc<string>('submit_daily_report', { p_project: project, p_date: f.date, p_weather: f.weather, p_labour: labour, p_issues: f.issues.trim() || null, p_safety: f.safety.trim() || null, p_work: work }),
      'Report submitted; the project manager verifies it before progress moves');
    if (id) { localStorage.removeItem(DRAFT(project)); onClose(true); }
  };
  return <Dialog title="Daily site report" onClose={() => onClose(false)}><div className="form">
    {saved && <div className="notice">Draft restored from this device.</div>}
    <div className="grid2"><Field label="Date"><input className="input" type="date" max={todayISO()} value={f.date} onChange={e => put({ ...f, date: e.target.value })} /></Field>
      <Field label="Weather"><select className="input" value={f.weather} onChange={e => put({ ...f, weather: e.target.value })}>{['Clear', 'Cloudy', 'Light rain', 'Heavy rain — work stopped'].map(w => <option key={w}>{w}</option>)}</select></Field></div>
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="sm muted" style={{ fontWeight: 600 }}>Labour on site</legend>
      <div className="grid3">{TRADES.map(t => <Field key={t} label={t}><input className="input" inputMode="numeric" aria-label={`${t} count`} value={f.labour[t] || ''} onChange={e => put({ ...f, labour: { ...f.labour, [t]: e.target.value.replace(/\D/g, '') } })} /></Field>)}</div></fieldset>
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="sm muted" style={{ fontWeight: 600 }}>Work done today</legend>
      {f.work.map((w, i) => <div key={i} className="grid2" style={{ marginBottom: 8 }}>
        <select className="input" aria-label={`Activity ${i + 1}`} value={w.task_id} onChange={e => put({ ...f, work: f.work.map((x, j) => j === i ? { ...x, task_id: e.target.value } : x) })}><option value="">Activity…</option>{open.map(t => <option key={t.id} value={t.id}>{t.name} (now {t.progress}%)</option>)}</select>
        <input className="input" inputMode="numeric" placeholder="Progress now, %" aria-label={`Progress ${i + 1}`} value={w.progress_to} onChange={e => put({ ...f, work: f.work.map((x, j) => j === i ? { ...x, progress_to: e.target.value.replace(/\D/g, '').slice(0, 3) } : x) })} /></div>)}
      <button className="btn sm" type="button" onClick={() => put({ ...f, work: [...f.work, { task_id: '', progress_to: '' }] })}>Add activity</button></fieldset>
    <Field label="Issues"><textarea className="input" value={f.issues} onChange={e => put({ ...f, issues: e.target.value })} /></Field>
    <Field label="Safety observations"><textarea className="input" value={f.safety} onChange={e => put({ ...f, safety: e.target.value })} /></Field>
    <div className="actions"><button className="btn" onClick={() => onClose(false)}>Keep as draft</button><button className="btn primary" onClick={submit}>Submit report</button></div>
  </div></Dialog>;
}

export function Site() {
  const { project, can, info } = useApp(); const [nw, setNw] = useState(false);
  const q = useRpc<Report[]>(project ? 'daily_report_list' : null, { p_project: project, p_limit: 30 });
  if (!project) return <div className="card"><Empty title="No project selected" /></div>;
  return <>
    <PageHead title="Site reports" sub={`${info.projects.find(p => p.id === project)?.name ?? ''} · one report per site per day; verified by the project manager`}>
      {can('site', 'create') && <button className="btn primary" onClick={() => setNw(true)}>New daily report</button>}
    </PageHead>
    <Async q={q} empty={x => x.length === 0}>{rows => <section className="card flush"><table className="t stack"><thead><tr><th>Date</th><th>Status</th><th>Labour</th><th>Work</th><th>Issues</th><th>By</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td data-l="Date"><b>{fmtDate(r.date)}</b><br /><span className="mono sm">{r.id}</span></td><td data-l="Status"><Badge s={r.status} />{r.verified_by && <div className="sm muted">by {r.verified_by}</div>}</td>
        <td data-l="Labour">{r.labour.reduce((a, l) => a + Number(l.count || 0), 0)}</td><td data-l="Work" className="sm">{r.work.map(w => `${w.task} → ${w.progress_to}%`).join('; ') || '—'}</td>
        <td data-l="Issues" className="sm">{r.issues || '—'}</td><td data-l="By">{r.submitted_by}</td></tr>)}
    </tbody></table></section>}</Async>
    {nw && <NewReport project={project} onClose={saved => { setNw(false); if (saved) q.reload(); }} />}
  </>;
}
