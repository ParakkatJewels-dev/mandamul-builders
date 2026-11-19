// Warranty and defect liability for the selected project: register, claims with response deadlines, response and evidence-backed resolution.
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { Async, Badge, Dialog, Empty, Field, PageHead, fmtDate, fmtTime, useRpc } from '../ui/kit';

type W = { id: string; item: string; kind: string; vendor: string | null; unit: string | null; start: string; end: string; days_left: number; active: boolean; response_hours: number; open_claims: number };
type C = { id: string; title: string; status: string; in_warranty: boolean; reported_at: string; response_due_at: string; responded_at: string | null; resolved_at: string | null; response_overdue: boolean; response_hours: number | null };
type Reg = { warranties: W[]; claims: C[]; average_response_hours: number | null; overdue_responses: number };

export function Warranty() {
  const { project, can, guard, info } = useApp();
  const q = useRpc<Reg>(project ? 'warranty_register' : null, { p_project: project });
  const [raise, setRaise] = useState<W | null>(null); const [f, setF] = useState({ title: '', description: '' });
  const [act, setAct] = useState<{ c: C; mode: 'respond' | 'resolve' } | null>(null); const [g, setG] = useState({ note: '', doc: '' });
  if (!project) return <div className="card"><Empty title="No project selected" /></div>;
  const submit = async () => { if (await guard(() => rpc<string>('raise_warranty_claim', { p_warranty: raise!.id, p_title: f.title.trim(), p_description: f.description.trim() || null }), 'Claim raised; the response clock has started')) { setRaise(null); q.reload(); } };
  const decide = async () => {
    const r = act!.mode === 'respond' ? await guard(() => rpc('respond_warranty_claim', { p_claim: act!.c.id, p_note: g.note.trim() }), 'Response recorded')
      : await guard(() => rpc('resolve_warranty_claim', { p_claim: act!.c.id, p_resolution: g.note.trim(), p_evidence_document: g.doc.trim() }), 'Claim resolved with evidence');
    if (r !== undefined) { setAct(null); q.reload(); }
  };
  return <>
    <PageHead title="Warranty" sub={`${info.projects.find(p => p.id === project)?.name ?? ''} · warranties, defect liability periods and claims`} />
    <Async q={q}>{d => <>
      <div className="kpis"><div className="kpi"><span>Active warranties</span><b>{d.warranties.filter(w => w.active).length}</b><small>{d.warranties.filter(w => w.active && w.days_left <= 60).length} end within 60 days</small></div>
        <div className="kpi"><span>Open claims</span><b>{d.claims.filter(c => ['Open', 'Acknowledged'].includes(c.status)).length}</b><small>{d.overdue_responses} past their response time</small></div>
        <div className="kpi"><span>Average response</span><b>{d.average_response_hours ?? '—'} h</b><small>reported → first response</small></div></div>
      <section className="card flush">{d.warranties.length ? <table className="t stack"><thead><tr><th>Item</th><th>Type</th><th>Vendor</th><th>Ends</th><th className="num">Open claims</th><th /></tr></thead><tbody>
        {d.warranties.map(w => <tr key={w.id}><td data-l="Item"><b>{w.item}</b>{w.unit && <span className="sm muted"> · {w.unit}</span>}</td><td data-l="Type">{w.kind}</td><td data-l="Vendor">{w.vendor ?? '—'}</td>
          <td data-l="Ends">{fmtDate(w.end)} {w.active ? <span className="sm muted">({w.days_left} days)</span> : <Badge s="Expired" />}</td><td data-l="Open claims" className="num">{w.open_claims}</td>
          <td>{can('handover', 'create') && <button className="btn sm" onClick={() => { setRaise(w); setF({ title: '', description: '' }); }}>Raise claim</button>}</td></tr>)}
      </tbody></table> : <Empty title="No warranties recorded for this project" />}</section>
      {d.claims.length > 0 && <section className="card flush"><table className="t stack"><thead><tr><th>Claim</th><th>Status</th><th>Reported</th><th>Respond by</th><th className="num">Response</th><th /></tr></thead><tbody>
        {d.claims.map(c => <tr key={c.id}><td data-l="Claim"><span className="mono">{c.id}</span> {c.title}{!c.in_warranty && <> <Badge s="Out of warranty" /></>}</td><td data-l="Status"><Badge s={c.status} /></td><td data-l="Reported">{fmtTime(c.reported_at)}</td>
          <td data-l="Respond by" style={{ color: c.response_overdue ? 'var(--bad)' : undefined }}>{fmtTime(c.response_due_at)}</td><td data-l="Response" className="num">{c.response_hours === null ? '—' : `${c.response_hours} h`}</td>
          <td>{can('handover', 'edit') && c.status === 'Open' && <button className="btn sm" onClick={() => { setAct({ c, mode: 'respond' }); setG({ note: '', doc: '' }); }}>Respond</button>}
            {can('handover', 'edit') && ['Open', 'Acknowledged'].includes(c.status) && <button className="btn sm" onClick={() => { setAct({ c, mode: 'resolve' }); setG({ note: '', doc: '' }); }}>Resolve</button>}</td></tr>)}
      </tbody></table></section>}
    </>}</Async>
    {raise && <Dialog title={`Claim on ${raise.item}`} onClose={() => setRaise(null)}><div className="form">
      {!raise.active && <div className="notice">This warranty has ended; the claim is recorded as out of warranty.</div>}
      <Field label="What is wrong?"><input className="input" aria-label="Claim title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Details"><textarea className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <div className="actions"><button className="btn" onClick={() => setRaise(null)}>Cancel</button><button className="btn primary" disabled={f.title.trim().length < 5} onClick={submit}>Raise claim</button></div></div></Dialog>}
    {act && <Dialog title={act.mode === 'respond' ? 'Record the response' : 'Resolve with evidence'} onClose={() => setAct(null)}><div className="form">
      <Field label={act.mode === 'respond' ? 'What will be done, and when?' : 'What was repaired?'}><textarea className="input" value={g.note} onChange={e => setG({ ...g, note: e.target.value })} /></Field>
      {act.mode === 'resolve' && <Field label="Evidence document number" hint="Upload the photo, service report or test certificate to Documents first, then enter its number (e.g. DOC-26-0012)."><input className="input" value={g.doc} onChange={e => setG({ ...g, doc: e.target.value })} /></Field>}
      <div className="actions"><button className="btn" onClick={() => setAct(null)}>Cancel</button><button className="btn primary" disabled={g.note.trim().length < 5 || (act.mode === 'resolve' && g.doc.trim().length < 3)} onClick={decide}>Save</button></div></div></Dialog>}
  </>;
}
