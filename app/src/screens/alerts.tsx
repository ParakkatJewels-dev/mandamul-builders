// Action center: alerts with owner, urgency, records and next action; acknowledge, snooze or resolve.
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { Async, Badge, Dialog, Field, PageHead, fmtTime, useRpc } from '../ui/kit';

type Alert = { id: number; project_id: string | null; category: string; severity: string; title: string; detail: string | null; owner: string | null;
  due_at: string | null; next_action: string; records: { kind: string; id: string; label?: string }[]; status: string; created_at: string; can_act: boolean };

export function Alerts() {
  const { guard, info } = useApp();
  const [sev, setSev] = useState<string>(''); const [status, setStatus] = useState('Open');
  const q = useRpc<Alert[]>('alert_feed', { p_severity: sev || undefined, p_status: status, p_limit: 100 });
  const [resolve, setResolve] = useState<Alert | null>(null); const [note, setNote] = useState('');
  const pname = (id: string | null) => info.projects.find(p => p.id === id)?.name ?? '';
  const act = async (fn: string, args: Record<string, unknown>, done: string) => { const r = await guard(() => rpc(fn, args), done); if (r !== undefined) q.reload(); };
  return <>
    <PageHead title="Action center" sub="Each alert names who acts, by when, the records behind it and the next step.">
      <select className="input" style={{ width: 160 }} aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}><option value="Open">Open</option><option value="Resolved">Resolved</option><option value="Suppressed">Snoozed</option></select>
      <select className="input" style={{ width: 160 }} aria-label="Severity" value={sev} onChange={e => setSev(e.target.value)}><option value="">All severities</option>{['Critical', 'High', 'Medium', 'Info'].map(s => <option key={s}>{s}</option>)}</select>
    </PageHead>
    <Async q={q} empty={d => d.length === 0}>{rows => <>{rows.map(a => <article key={a.id} className={`card alert-card sev-${a.severity}`} data-testid="alert">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><Badge s={a.severity} /><span className="badge">{a.category}</span><span className="sm muted">{pname(a.project_id)}</span>{a.status !== 'Open' && <Badge s={a.status} />}</div>
      <h3 style={{ marginTop: 6 }}>{a.title}</h3>{a.detail && <p className="sm">{a.detail}</p>}
      <dl className="meta"><div><dt>Responsible</dt><dd>{a.owner ?? '—'}</dd></div><div><dt>Urgency</dt><dd>{a.due_at ? `by ${fmtTime(a.due_at)}` : '—'}</dd></div>
        <div><dt>Records</dt><dd className="mono">{a.records.map(r => r.label || r.id).join(' · ') || '—'}</dd></div><div><dt>Raised</dt><dd>{fmtTime(a.created_at)}</dd></div></dl>
      <p><b>Next action:</b> {a.next_action}</p>
      {['Open', 'Acknowledged'].includes(a.status) && !a.can_act && <p className="sm muted">For information: {a.owner ?? 'the owner'} or someone with edit rights on this area acts on it.</p>}
      {['Open', 'Acknowledged'].includes(a.status) && a.can_act && <div className="actions">
        {a.status === 'Open' && <button className="btn sm" onClick={() => act('ack_alert', { p_alert: a.id }, 'Acknowledged — the alert stays until its cause clears')}>Acknowledge</button>}
        <button className="btn sm" onClick={() => act('snooze_alert', { p_alert: a.id, p_until: new Date(Date.now() + 3 * 864e5).toISOString(), p_reason: 'Snoozed for 3 days from the action center' }, 'Snoozed for 3 days')}>Snooze 3 days</button>
        <button className="btn sm" onClick={() => { setResolve(a); setNote(''); }}>Mark resolved</button>
      </div>}
    </article>)}</>}</Async>
    {resolve && <Dialog title="Mark resolved" onClose={() => setResolve(null)}><div className="form">
      <p className="sm">{resolve.title}</p>
      <Field label="How was it resolved?" hint="At least 5 characters; recorded in the audit log."><textarea className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="actions"><button className="btn" onClick={() => setResolve(null)}>Cancel</button>
        <button className="btn primary" disabled={note.trim().length < 5} onClick={async () => { await act('resolve_alert', { p_alert: resolve.id, p_resolution: note.trim() }, 'Resolved'); setResolve(null); }}>Resolve</button></div>
    </div></Dialog>}
  </>;
}
