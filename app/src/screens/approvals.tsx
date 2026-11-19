// Approvals inbox: what waits for me, with the chain so far; approve or reject with a comment.
// The database decides who may act (role, module right, MFA, not the requester, one step per person).
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { formatINR, toPaise } from '../lib/money';
import { Async, Badge, Empty, PageHead, fmtTime, useRpc } from '../ui/kit';

type Step = { seq: number; label: string; role: string; status: string; by: string | null; at: string | null; comment: string | null };
type Item = { id: string; kind: string; ref: string; title: string; project: string; amount: number | null; requested_by: string; requested_at: string; step: Step; steps: Step[]; ctx: Record<string, unknown> };
type Mine = { id: string; kind: string; ref: string; title: string; status: string; project: string; requested_at: string; waiting_for: string | null };
const KIND: Record<string, string> = { PO: 'Purchase order', BUDGET: 'Budget', CONTRACT: 'Contract', VARIATION: 'Variation', INVOICE: 'Vendor invoice', RABILL: 'Running bill', REPORT: 'Daily report', DOC: 'Drawing / document' };

function Card({ a, onDone }: { a: Item; onDone: () => void }) {
  const { guard } = useApp(); const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  const decide = async (d: 'approve' | 'reject') => {
    setBusy(true);
    const r = await guard(() => rpc<string>('decide', { p_approval: a.id, p_decision: d, p_comment: c.trim() || null, p_expected_seq: a.step.seq }),
      d === 'approve' ? `${a.ref}: approved` : `${a.ref}: rejected`);
    setBusy(false); if (r !== undefined) onDone();
  };
  return <article className="card" data-testid="approval">
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><span className="badge info">{KIND[a.kind] ?? a.kind}</span><span className="mono">{a.ref}</span><span className="sm muted">{a.project}</span></div>
    <h3 style={{ marginTop: 6 }}>{a.title}</h3>
    <dl className="meta"><div><dt>Amount</dt><dd>{a.amount === null ? '—' : formatINR(toPaise(a.amount))}</dd></div><div><dt>Raised by</dt><dd>{a.requested_by} · {fmtTime(a.requested_at)}</dd></div><div><dt>Your step</dt><dd>{a.step.label}</dd></div></dl>
    <ol className="sm" style={{ margin: '0 0 10px 18px', padding: 0 }}>{a.steps.map(s => <li key={s.seq}>{s.label} — <Badge s={s.status === 'approved' ? 'Approved' : s.status === 'rejected' ? 'Rejected' : s.status === 'pending' ? 'Pending' : s.status} />{s.by && ` ${s.by}, ${fmtTime(s.at)}`}{s.comment && ` · “${s.comment}”`}</li>)}</ol>
    <textarea className="input" placeholder="Comment (required to reject)" aria-label={`Comment on ${a.ref}`} value={c} onChange={e => setC(e.target.value)} />
    <div className="actions" style={{ marginTop: 8 }}><button className="btn danger" disabled={busy || c.trim().length < 3} onClick={() => decide('reject')}>Reject</button><button className="btn primary" disabled={busy} onClick={() => decide('approve')}>Approve</button></div>
  </article>;
}

export function Approvals() {
  const q = useRpc<{ to_decide: Item[]; requested: Mine[] }>('my_approvals'); const [tab, setTab] = useState<'decide' | 'mine'>('decide');
  return <>
    <PageHead title="Approvals" sub="Routes follow the value thresholds; nobody approves their own request or two steps of one chain." />
    <div className="tabs" role="tablist">
      <button className="tab" role="tab" aria-selected={tab === 'decide'} onClick={() => setTab('decide')}>Waiting for me {q.data ? `(${q.data.to_decide.length})` : ''}</button>
      <button className="tab" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>Raised by me</button>
    </div>
    <Async q={q}>{d => tab === 'decide'
      ? (d.to_decide.length ? <>{d.to_decide.map(a => <Card key={a.id} a={a} onDone={q.reload} />)}</> : <div className="card"><Empty title="Nothing waiting for you" /></div>)
      : <section className="card flush">{d.requested.length ? <table className="t stack"><thead><tr><th>Ref</th><th>What</th><th>Project</th><th>Status</th><th>Waiting for</th></tr></thead><tbody>
          {d.requested.map(r => <tr key={r.id}><td data-l="Ref" className="mono">{r.ref}</td><td data-l="What">{KIND[r.kind] ?? r.kind}: {r.title}</td><td data-l="Project">{r.project}</td><td data-l="Status"><Badge s={r.status} /></td><td data-l="Waiting for">{r.waiting_for ?? '—'}</td></tr>)}
        </tbody></table> : <Empty title="You have not raised anything in the last 60 days" />}</section>}</Async>
  </>;
}
