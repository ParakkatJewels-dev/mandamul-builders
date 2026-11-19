// Contracts and contractor billing for the selected project:
// measurement (site) → verification (engineer) → claim (contractor) → automatic assessment → running bill → certification (Approvals) → payment (Payments).
// Contractors see only their own contracts; site staff see quantities but no money; the database enforces both.
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { formatINR, parseRupees, toPaise } from '../lib/money';
import { Async, Badge, Dialog, Empty, Field, PageHead, fmtDate, fmtTime, todayISO, useRpc } from '../ui/kit';

type Row = { id: string; title: string; vendor: string; status: string; value: number | null; certified: number | null; paid: number | null; pending_measurements: number; open_claim: string | null; bill_in_approval: boolean };
type Item = { id: string; description: string; uom: string; qty: number; rate: number | null; verified_qty: number; pending_qty: number; billed_qty: number };
type Meas = { id: string; item: string; uom: string; qty: number; measured_on: string; status: string; note: string | null; recorded_by: string; recorded_by_me: boolean; verified_by: string | null };
type Disc = { line: number; type: string; issue: string };
type Claim = { id: string; claim_no: number; status: string; submitted_at: string; note: string | null; claimed_gross: number | null; ra_bill_id: string | null;
  assessment: { gross?: number; net?: number; discrepancies?: Disc[]; formula?: string } | null; lines: { description: string; qty: number; rate: number | null }[] };
type Bill = { id: string; bill_no: number; status: string; due_date: string | null; gross: number | null; gst: number | null; retention: number | null; advance_recovery: number | null; tds: number | null; other_deductions: number | null; net_payable: number | null; paid: number | null };
type Detail = { contract: { id: string; title: string; status: string; vendor: string; retention_pct: number; tds_pct: number; gst_pct: number }; items: Item[]; measurements: Meas[]; claims: Claim[]; bills: Bill[];
  variations: { description: string; amount: number | null; status: string }[]; can: { measure: boolean; verify: boolean; claim: boolean; assess: boolean } };
const n = (v: unknown) => Number(v ?? 0);
const money = (v: number | null | undefined) => v === null || v === undefined ? '—' : formatINR(toPaise(v));

function Measure({ item, onClose }: { item: Item; onClose: (saved: boolean) => void }) {
  const { guard } = useApp(); const left = n(item.qty) - n(item.verified_qty) - n(item.pending_qty);
  const [f, setF] = useState({ qty: '', date: todayISO(), note: '' });
  const save = async () => { if (await guard(() => rpc('record_measurement', { p_item: item.id, p_qty: f.qty, p_measured_on: f.date, p_note: f.note.trim() || null }), 'Measurement recorded; an engineer verifies it before it can be billed') !== undefined) onClose(true); };
  return <Dialog title={`Measure: ${item.description}`} onClose={() => onClose(false)}><div className="form">
    <p className="sm muted">Contract {item.qty} {item.uom} · verified {item.verified_qty} · awaiting verification {item.pending_qty} · left to measure {left}</p>
    <div className="grid2"><Field label={`Quantity (${item.uom})`}><input className="input" inputMode="decimal" aria-label="Measured quantity" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
      <Field label="Measured on"><input className="input" type="date" max={todayISO()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field></div>
    <Field label="Location / note"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. Villa 3 slab, grid A–C" /></Field>
    <div className="actions"><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" disabled={!(Number(f.qty) > 0)} onClick={save}>Record measurement</button></div>
  </div></Dialog>;
}

function NewClaim({ d, onClose }: { d: Detail; onClose: (saved: boolean) => void }) {
  const { guard } = useApp();
  const claimable = d.items.filter(i => n(i.verified_qty) - n(i.billed_qty) > 0);
  const [lines, setLines] = useState(() => claimable.map(i => ({ id: i.id, qty: String(n(i.verified_qty) - n(i.billed_qty)), rate: i.rate === null ? '' : String(i.rate), on: true })));
  const [note, setNote] = useState('');
  const chosen = lines.filter(l => l.on && Number(l.qty) > 0);
  const ok = chosen.length > 0 && chosen.every(l => parseRupees(l.rate) !== null);
  const gross = chosen.reduce((a, l) => a + (toPaise(parseRupees(l.rate)) ?? 0n) * BigInt(Math.round(Number(l.qty) * 1000)) / 1000n, 0n);
  const save = async () => { if (await guard(() => rpc<string>('submit_claim', { p_contract: d.contract.id, p_lines: chosen.map(l => ({ contract_item_id: l.id, qty: l.qty, rate: parseRupees(l.rate) })), p_note: note.trim() || null }),
    'Claim submitted; it is checked against verified measurements and contract rates')) onClose(true); };
  return <Dialog title={`Claim on ${d.contract.id}`} onClose={() => onClose(false)}><div className="form">
    {claimable.length === 0 ? <div className="notice">Nothing to claim: no verified quantity is left unbilled. Measurements must be verified first.</div> : <>
      <p className="sm muted">Quantities start at what is verified and not yet billed. Anything above that, a different rate, or work outside the contract is held for the quantity surveyor.</p>
      <table className="t"><thead><tr><th /><th>Item</th><th className="num">Quantity</th><th className="num">Rate (₹)</th></tr></thead><tbody>
        {lines.map((l, k) => { const i = claimable[k]; return <tr key={l.id}><td><input type="checkbox" aria-label={`Include ${i.description}`} checked={l.on} onChange={() => setLines(lines.map((x, j) => j === k ? { ...x, on: !x.on } : x))} /></td>
          <td>{i.description}<br /><span className="sm muted">verified, unbilled {n(i.verified_qty) - n(i.billed_qty)} {i.uom}</span></td>
          <td className="num"><input className="input" style={{ width: 110 }} inputMode="decimal" aria-label={`Claim quantity ${i.description}`} value={l.qty} onChange={e => setLines(lines.map((x, j) => j === k ? { ...x, qty: e.target.value } : x))} /></td>
          <td className="num"><input className="input" style={{ width: 120 }} inputMode="decimal" aria-label={`Claim rate ${i.description}`} value={l.rate} onChange={e => setLines(lines.map((x, j) => j === k ? { ...x, rate: e.target.value } : x))} /></td></tr>; })}
      </tbody></table>
      <p className="sm">Claimed before GST: <b>{formatINR(gross)}</b></p>
      <Field label="Note"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field></>}
    <div className="actions"><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" disabled={!ok} onClick={save}>Submit claim</button></div>
  </div></Dialog>;
}

function ContractView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { guard } = useApp(); const q = useRpc<Detail>('contract_detail', { p_contract: id });
  const [tab, setTab] = useState<'items' | 'claims' | 'bills'>('items'); const [meas, setMeas] = useState<Item | null>(null); const [claim, setClaim] = useState(false);
  const [assess, setAssess] = useState<{ c: Claim; d: 'bill_assessed' | 'return' } | null>(null); const [note, setNote] = useState('');
  const refresh = () => { q.reload(); onChanged(); };
  const verify = async (m: Meas, accept: boolean) => { if (await guard(() => rpc('verify_measurement', { p_measurement: m.id, p_accept: accept }), accept ? 'Measurement verified' : 'Measurement rejected') !== undefined) refresh(); };
  return <Async q={q}>{d => { const active = d.contract.status === 'Active'; const open = d.claims.some(c => ['Submitted', 'Discrepancies'].includes(c.status)); const inApproval = d.bills.some(b => b.status === 'In approval');
    return <section className="card" data-testid="contract-detail">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><h2 style={{ margin: 0 }}>{d.contract.id} · {d.contract.title}</h2><Badge s={d.contract.status} /><span className="sm muted">{d.contract.vendor} · retention {d.contract.retention_pct}% · TDS {d.contract.tds_pct}% · GST {d.contract.gst_pct}%</span></div>
      <div className="tabs" role="tablist" style={{ marginTop: 10 }}>
        <button className="tab" role="tab" aria-selected={tab === 'items'} onClick={() => setTab('items')}>Items and measurements</button>
        <button className="tab" role="tab" aria-selected={tab === 'claims'} onClick={() => setTab('claims')}>Claims ({d.claims.length})</button>
        <button className="tab" role="tab" aria-selected={tab === 'bills'} onClick={() => setTab('bills')}>Running bills ({d.bills.length})</button>
      </div>
      {tab === 'items' && <>
        <table className="t stack"><thead><tr><th>Item</th><th className="num">Contract</th><th className="num">Verified</th><th className="num">Awaiting check</th><th className="num">Billed</th><th className="num">Rate</th><th /></tr></thead><tbody>
          {d.items.map(i => <tr key={i.id}><td data-l="Item">{i.description}</td><td data-l="Contract" className="num">{i.qty} {i.uom}</td><td data-l="Verified" className="num">{i.verified_qty}</td><td data-l="Awaiting check" className="num">{i.pending_qty}</td>
            <td data-l="Billed" className="num">{i.billed_qty}</td><td data-l="Rate" className="num">{money(i.rate)}</td>
            <td>{d.can.measure && active && <button className="btn sm" onClick={() => setMeas(i)}>Measure</button>}</td></tr>)}</tbody></table>
        <h3 style={{ margin: '14px 0 6px' }}>Measurements</h3>
        {d.measurements.length === 0 ? <p className="sm muted">None yet.</p> : <table className="t stack"><thead><tr><th>Date</th><th>Item</th><th className="num">Quantity</th><th>Recorded by</th><th>Status</th><th /></tr></thead><tbody>
          {d.measurements.map(m => <tr key={m.id}><td data-l="Date">{fmtDate(m.measured_on)}</td><td data-l="Item">{m.item}{m.note && <span className="sm muted"> · {m.note}</span>}</td><td data-l="Quantity" className="num">{m.qty} {m.uom}</td>
            <td data-l="Recorded by">{m.recorded_by}</td><td data-l="Status"><Badge s={m.status} />{m.verified_by && <span className="sm muted"> {m.verified_by}</span>}</td>
            <td>{d.can.verify && m.status === 'Recorded' && (m.recorded_by_me ? <span className="sm muted">another engineer verifies</span> : <span style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => verify(m, false)}>Reject</button><button className="btn sm primary" onClick={() => verify(m, true)}>Verify</button></span>)}</td></tr>)}
        </tbody></table>}
      </>}
      {tab === 'claims' && <>
        {d.can.claim && active && <div className="actions" style={{ marginBottom: 8 }}>{open || inApproval ? <span className="sm muted">{open ? 'A claim is open on this contract.' : 'The last bill is still in certification.'} A new claim can follow once it is settled.</span>
          : <button className="btn primary" onClick={() => setClaim(true)}>New claim</button>}</div>}
        {d.claims.length === 0 ? <Empty title="No claims yet" /> : d.claims.map(c => <article key={c.id} className="card" data-testid="claim">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b className="mono">{c.id}</b><span>Claim {c.claim_no}</span><Badge s={c.status === 'Discrepancies' ? 'High' : c.status} />{c.status === 'Discrepancies' && <span className="badge warn">Discrepancies</span>}<span className="sm muted">{fmtTime(c.submitted_at)}</span></div>
          <p className="sm" style={{ marginTop: 6 }}>{c.lines.map(l => `${l.description}: ${l.qty} × ${money(l.rate)}`).join(' · ')}</p>
          <dl className="meta"><div><dt>Claimed</dt><dd>{money(c.claimed_gross)}</dd></div><div><dt>Assessed gross</dt><dd>{money(c.assessment?.gross)}</dd></div><div><dt>Net payable if billed</dt><dd>{money(c.assessment?.net)}</dd></div><div><dt>Running bill</dt><dd className="mono">{c.ra_bill_id ?? '—'}</dd></div></dl>
          {(c.assessment?.discrepancies || []).length > 0 && <ul className="sm" style={{ color: 'var(--warn)' }}>{c.assessment!.discrepancies!.map((x, k) => <li key={k}>Line {x.line}, {x.type}: {x.issue}</li>)}</ul>}
          {c.status === 'Discrepancies' && d.can.assess && <div className="actions"><button className="btn sm" onClick={() => { setAssess({ c, d: 'return' }); setNote(''); }}>Return to contractor</button><button className="btn sm primary" onClick={() => { setAssess({ c, d: 'bill_assessed' }); setNote(''); }}>Bill the assessed amount</button></div>}
        </article>)}
      </>}
      {tab === 'bills' && (d.bills.length === 0 ? <Empty title="No running bills yet" /> : <table className="t stack"><thead><tr><th>Bill</th><th className="num">Gross</th><th className="num">GST</th><th className="num">Retention</th><th className="num">Advance</th><th className="num">TDS</th><th className="num">Net payable</th><th className="num">Paid</th><th>Status</th></tr></thead><tbody>
        {d.bills.map(b => <tr key={b.id}><td data-l="Bill" className="mono">{b.id}</td><td data-l="Gross" className="num">{money(b.gross)}</td><td data-l="GST" className="num">{money(b.gst)}</td><td data-l="Retention" className="num">−{money(b.retention)}</td>
          <td data-l="Advance" className="num">−{money(b.advance_recovery)}</td><td data-l="TDS" className="num">−{money(b.tds)}</td><td data-l="Net payable" className="num"><b>{money(b.net_payable)}</b></td><td data-l="Paid" className="num">{money(b.paid)}</td><td data-l="Status"><Badge s={b.status} /></td></tr>)}
      </tbody></table>)}
      {meas && <Measure item={meas} onClose={s => { setMeas(null); if (s) refresh(); }} />}
      {claim && <NewClaim d={d} onClose={s => { setClaim(false); if (s) { refresh(); setTab('claims'); } }} />}
      {assess && <Dialog title={assess.d === 'return' ? 'Return the claim' : 'Bill the assessed amount'} onClose={() => setAssess(null)}><div className="form">
        <p className="sm">{assess.d === 'return' ? 'The contractor sees your note and can submit a corrected claim.' : `A running bill is created for the assessed amount (${money(assess.c.assessment?.gross)} before GST) and routed for certification.`}</p>
        <Field label="Reason (recorded)"><textarea className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        <div className="actions"><button className="btn" onClick={() => setAssess(null)}>Cancel</button><button className="btn primary" disabled={note.trim().length < 5} onClick={async () => {
          if (await guard(() => rpc('decide_claim', { p_claim: assess.c.id, p_decision: assess.d, p_note: note.trim() }), assess.d === 'return' ? 'Claim returned' : 'Running bill created and sent for certification') !== undefined) { setAssess(null); refresh(); } }}>Confirm</button></div>
      </div></Dialog>}
    </section>; }}</Async>;
}

export function Contracts() {
  const { project, info } = useApp(); const q = useRpc<Row[]>(project ? 'contract_list' : null, { p_project: project }); const [sel, setSel] = useState<string | null>(null);
  if (!project) return <div className="card"><Empty title="No project selected" /></div>;
  return <>
    <PageHead title="Contracts" sub={`${info.projects.find(p => p.id === project)?.name ?? ''} · measure → verify → claim → bill → certify → pay`} />
    <Async q={q} empty={x => x.length === 0}>{rows => <section className="card flush"><table className="t stack"><thead><tr><th>Contract</th><th>Contractor</th><th className="num">Value</th><th className="num">Certified</th><th className="num">Paid</th><th>Waiting</th><th>Status</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id} className="click" tabIndex={0} aria-selected={sel === r.id} onClick={() => setSel(r.id)} onKeyDown={e => e.key === 'Enter' && setSel(r.id)}>
        <td data-l="Contract"><b className="mono">{r.id}</b><br /><span className="sm">{r.title}</span></td><td data-l="Contractor">{r.vendor}</td><td data-l="Value" className="num">{money(r.value)}</td><td data-l="Certified" className="num">{money(r.certified)}</td><td data-l="Paid" className="num">{money(r.paid)}</td>
        <td data-l="Waiting" className="sm">{[r.pending_measurements ? `${r.pending_measurements} measurement(s) to verify` : '', r.open_claim ? `claim ${r.open_claim.toLowerCase()}` : '', r.bill_in_approval ? 'bill in certification' : ''].filter(Boolean).join(' · ') || '—'}</td>
        <td data-l="Status"><Badge s={r.status} /></td></tr>)}
    </tbody></table></section>}</Async>
    {sel && <div style={{ marginTop: 14 }}><ContractView key={sel} id={sel} onChanged={q.reload} /></div>}
  </>;
}
