// Procurement for the selected project: request → quotations → order (approval route applies) → goods receipt.
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { formatINR, parseRupees, toPaise } from '../lib/money';
import { Async, Badge, Dialog, Empty, Field, PageHead, fmtDate, todayISO, useRpc } from '../ui/kit';

type Quote = { vendor_id: string; vendor: string; rate: number | null; gst_pct: number; lead_days: number | null; note: string | null };
type MR = { id: string; code: string; item: string; qty: number; uom: string; needed_by: string; urgency: string; status: string; requested_by: string; quotes: Quote[]; po: { id: string; status: string } | null };
type PO = { id: string; item: string; vendor: string; total: number | null; status: string; created_at: string };
type PODetail = { id: string; item: string; uom: string; qty: number; status: string; vendor: string; rate: number | null; total: number | null; expected_delivery: string | null; accepted_qty: number;
  approval: { id: string; status: string } | null; receipts: { id: string; received_on: string; qty: number; qc: string; note: string | null; value: number | null; by: string }[] };

function NewRequest({ project, onClose }: { project: string; onClose: (saved: boolean) => void }) {
  const { guard } = useApp(); const codes = useRpc<{ code: string; name: string }[]>('cost_code_list');
  const [f, setF] = useState({ code: '', item: '', qty: '', uom: 'nos', needed_by: '', urgency: 'Normal' });
  const ok = f.code && f.item.trim().length >= 2 && Number(f.qty) > 0 && f.needed_by;
  const save = async () => { const r = await guard(() => rpc<string>('raise_mr', { p_project: project, p_code: f.code, p_item: f.item.trim(), p_qty: f.qty, p_uom: f.uom.trim(), p_needed_by: f.needed_by, p_urgency: f.urgency }), 'Material request raised'); if (r) onClose(true); };
  return <Dialog title="New material request" onClose={() => onClose(false)}><div className="form">
    <Field label="Cost code"><select className="input" value={f.code} onChange={e => setF({ ...f, code: e.target.value })}><option value="">Choose…</option>{(codes.data || []).map(c => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}</select></Field>
    <Field label="Item"><input className="input" value={f.item} onChange={e => setF({ ...f, item: e.target.value })} placeholder="e.g. OPC 53 grade cement" /></Field>
    <div className="grid3"><Field label="Quantity"><input className="input" inputMode="decimal" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
      <Field label="Unit"><input className="input" value={f.uom} onChange={e => setF({ ...f, uom: e.target.value })} /></Field>
      <Field label="Needed by"><input className="input" type="date" min={todayISO()} value={f.needed_by} onChange={e => setF({ ...f, needed_by: e.target.value })} /></Field></div>
    <Field label="Urgency"><select className="input" value={f.urgency} onChange={e => setF({ ...f, urgency: e.target.value })}>{['Normal', 'Urgent', 'Urgent — work stopped'].map(u => <option key={u}>{u}</option>)}</select></Field>
    <div className="actions"><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" disabled={!ok} onClick={save}>Raise request</button></div>
  </div></Dialog>;
}

function RequestDetail({ mr, onChanged }: { mr: MR; onChanged: () => void }) {
  const { guard, can, project } = useApp(); const vendors = useRpc<{ id: string; name: string; category: string }[]>(can('procurement', 'edit') ? 'vendor_list' : null);
  const [q, setQ] = useState({ vendor: '', rate: '', gst: '18', lead: '7' }); const [po, setPo] = useState({ vendor: '', reason: '', date: '' });
  const lowest = mr.quotes.reduce<Quote | null>((a, b) => (a && toPaise(a.rate)! <= toPaise(b.rate)! ? a : b), null);
  const rate = parseRupees(q.rate);
  const addQuote = async () => { if (await guard(() => rpc('add_quotation', { p_mr: mr.id, p_vendor: q.vendor, p_rate: rate, p_gst: q.gst, p_lead: Number(q.lead) || null }), 'Quotation recorded') !== undefined) { setQ({ vendor: '', rate: '', gst: '18', lead: '7' }); onChanged(); } };
  const raise = async () => { const id = await guard(() => rpc<string>('raise_po', { p_mr: mr.id, p_vendor: po.vendor, p_not_lowest_reason: po.reason.trim() || null, p_expected_delivery: po.date || null }), 'Purchase order raised and sent for approval'); if (id) onChanged(); };
  const notLowest = po.vendor && lowest && po.vendor !== lowest.vendor_id;
  return <div className="form" style={{ padding: '4px 0 8px' }}>
    {mr.quotes.length ? <table className="t"><thead><tr><th>Vendor</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Lead time</th></tr></thead><tbody>
      {mr.quotes.map(x => <tr key={x.vendor_id}><td>{x.vendor}{lowest?.vendor_id === x.vendor_id && <> <Badge s="Lowest" /></>}</td><td className="num">{x.rate === null ? 'hidden' : formatINR(toPaise(x.rate))}</td><td className="num">{x.gst_pct}%</td><td className="num">{x.lead_days ?? '—'} days</td></tr>)}
    </tbody></table> : <p className="sm muted">No quotations yet.</p>}
    {!mr.po && can('procurement', 'edit') && can('budget') && <>
      <div className="grid3" style={{ alignItems: 'end' }}>
        <Field label="Vendor"><select className="input" aria-label="Quotation vendor" value={q.vendor} onChange={e => setQ({ ...q, vendor: e.target.value })}><option value="">Choose…</option>{(vendors.data || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label="Rate per unit (₹, before GST)"><input className="input" inputMode="decimal" aria-label="Quotation rate" value={q.rate} onChange={e => setQ({ ...q, rate: e.target.value })} /></Field>
        <div className="grid2"><Field label="GST %"><input className="input" inputMode="decimal" value={q.gst} onChange={e => setQ({ ...q, gst: e.target.value })} /></Field><Field label="Lead days"><input className="input" inputMode="numeric" value={q.lead} onChange={e => setQ({ ...q, lead: e.target.value })} /></Field></div>
      </div>
      <div className="actions"><button className="btn" disabled={!q.vendor || !rate} onClick={addQuote}>Add quotation</button></div>
      {mr.quotes.length > 0 && <><div className="grid3" style={{ alignItems: 'end' }}>
        <Field label="Order from"><select className="input" aria-label="Order vendor" value={po.vendor} onChange={e => setPo({ ...po, vendor: e.target.value })}><option value="">Choose a quoted vendor…</option>{mr.quotes.map(x => <option key={x.vendor_id} value={x.vendor_id}>{x.vendor}</option>)}</select></Field>
        <Field label="Expected delivery"><input className="input" type="date" min={todayISO()} value={po.date} onChange={e => setPo({ ...po, date: e.target.value })} /></Field>
        {notLowest && <Field label="Why not the lowest quote?"><input className="input" value={po.reason} onChange={e => setPo({ ...po, reason: e.target.value })} /></Field>}
      </div>
        <div className="actions"><button className="btn primary" disabled={!po.vendor || (!!notLowest && po.reason.trim().length < 5)} onClick={raise}>Raise purchase order</button></div></>}
    </>}
    {mr.po && <p className="sm">Order <b className="mono">{mr.po.id}</b> <Badge s={mr.po.status} /> — see the Orders tab.</p>}
    {project === null && null}
  </div>;
}

function Receipt({ po, onClose }: { po: PODetail; onClose: (saved: boolean) => void }) {
  const { guard } = useApp(); const left = Number(po.qty) - Number(po.accepted_qty);
  const [f, setF] = useState({ qty: String(left > 0 ? left : ''), qc: 'Pass', date: todayISO(), note: '' });
  const save = async () => { const r = await guard(() => rpc<string>('record_grn', { p_po: po.id, p_qty: f.qty, p_qc: f.qc, p_received_on: f.date, p_note: f.note.trim() || null }), f.qc === 'Pass' ? 'Receipt recorded; stock and actual cost updated' : 'Rejected delivery recorded'); if (r) onClose(true); };
  return <Dialog title={`Receive ${po.item}`} onClose={() => onClose(false)}><div className="form">
    <p className="sm">{po.id} · {po.vendor} · {left} {po.uom} outstanding</p>
    <div className="grid3"><Field label="Quantity received"><input className="input" inputMode="decimal" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
      <Field label="Quality check"><select className="input" value={f.qc} onChange={e => setF({ ...f, qc: e.target.value })}><option>Pass</option><option>Fail</option></select></Field>
      <Field label="Received on"><input className="input" type="date" max={todayISO()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field></div>
    <Field label="Note" hint={f.qc === 'Fail' ? 'Say what was wrong; a failed delivery adds no cost.' : undefined}><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
    <div className="actions"><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" disabled={!(Number(f.qty) > 0) || (f.qc === 'Fail' && f.note.trim().length < 3)} onClick={save}>Record receipt</button></div>
  </div></Dialog>;
}

function Orders({ project }: { project: string }) {
  const { can } = useApp(); const list = useRpc<PO[]>('list_purchase_orders', { p_project: project, p_limit: 50 }); const [open, setOpen] = useState<string | null>(null);
  const d = useRpc<PODetail>(open ? 'po_detail' : null, { p_po: open }); const [recv, setRecv] = useState(false);
  return <>
    <Async q={list} empty={x => x.length === 0}>{rows => <section className="card flush"><table className="t stack"><thead><tr><th>Order</th><th>Item</th><th>Vendor</th><th className="num">Total</th><th>Status</th><th>Raised</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id} className="click" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={e => e.key === 'Enter' && setOpen(r.id)}><td data-l="Order" className="mono">{r.id}</td><td data-l="Item">{r.item}</td><td data-l="Vendor">{r.vendor}</td><td data-l="Total" className="num">{r.total === null ? '—' : formatINR(toPaise(r.total))}</td><td data-l="Status"><Badge s={r.status} /></td><td data-l="Raised">{fmtDate(r.created_at)}</td></tr>)}
    </tbody></table></section>}</Async>
    {open && <Dialog title={`Order ${open}`} onClose={() => setOpen(null)}><Async q={d}>{po => <div className="form">
      <dl className="meta"><div><dt>Item</dt><dd>{po.item}</dd></div><div><dt>Vendor</dt><dd>{po.vendor}</dd></div><div><dt>Ordered</dt><dd>{po.qty} {po.uom}</dd></div><div><dt>Accepted</dt><dd>{po.accepted_qty} {po.uom}</dd></div>
        <div><dt>Total</dt><dd>{po.total === null ? '—' : formatINR(toPaise(po.total))}</dd></div><div><dt>Status</dt><dd><Badge s={po.status} /></dd></div><div><dt>Expected</dt><dd>{fmtDate(po.expected_delivery)}</dd></div><div><dt>Approval</dt><dd>{po.approval ? <Badge s={po.approval.status} /> : '—'}</dd></div></dl>
      {po.receipts.length ? <table className="t"><thead><tr><th>Received</th><th className="num">Qty</th><th>QC</th><th>By</th><th className="num">Value</th></tr></thead><tbody>{po.receipts.map(g => <tr key={g.id}><td>{fmtDate(g.received_on)}</td><td className="num">{g.qty}</td><td><Badge s={g.qc} /></td><td>{g.by}</td><td className="num">{g.value === null ? '—' : formatINR(toPaise(g.value))}</td></tr>)}</tbody></table> : <p className="sm muted">Nothing received yet.</p>}
      <div className="actions"><button className="btn" onClick={() => setOpen(null)}>Close</button>{can('procurement', 'edit') && ['Approved', 'Part received'].includes(po.status) && <button className="btn primary" onClick={() => setRecv(true)}>Record receipt</button>}</div>
      {recv && <Receipt po={po} onClose={saved => { setRecv(false); if (saved) { d.reload(); list.reload(); } }} />}
    </div>}</Async></Dialog>}
  </>;
}

export function Procurement() {
  const { project, can, info } = useApp(); const [tab, setTab] = useState<'mr' | 'po'>('mr'); const [nw, setNw] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const mrs = useRpc<MR[]>(project ? 'mr_list' : null, { p_project: project });
  if (!project) return <div className="card"><Empty title="No project selected" /></div>;
  return <>
    <PageHead title="Procurement" sub={`${info.projects.find(p => p.id === project)?.name ?? ''} · request → quotations → order (approval) → receipt`}>
      {can('procurement', 'create') && <button className="btn primary" onClick={() => setNw(true)}>New request</button>}
    </PageHead>
    <div className="tabs" role="tablist"><button className="tab" role="tab" aria-selected={tab === 'mr'} onClick={() => setTab('mr')}>Requests</button><button className="tab" role="tab" aria-selected={tab === 'po'} onClick={() => setTab('po')}>Orders</button></div>
    {tab === 'mr' ? <Async q={mrs} empty={x => x.length === 0}>{rows => <section className="card flush"><table className="t stack"><thead><tr><th>Request</th><th>Item</th><th className="num">Quantity</th><th>Needed by</th><th>Status</th><th className="num">Quotes</th></tr></thead><tbody>
      {rows.flatMap(m => [<tr key={m.id} className="click" tabIndex={0} aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)} onKeyDown={e => e.key === 'Enter' && setOpen(open === m.id ? null : m.id)}>
        <td data-l="Request" className="mono">{m.id}</td><td data-l="Item">{m.item}<br /><span className="sm muted">{m.code} · {m.urgency} · {m.requested_by}</span></td><td data-l="Quantity" className="num">{m.qty} {m.uom}</td><td data-l="Needed by">{fmtDate(m.needed_by)}</td><td data-l="Status"><Badge s={m.status} /></td><td data-l="Quotes" className="num">{m.quotes.length}</td></tr>,
        open === m.id ? <tr key={m.id + '-d'}><td colSpan={6}><RequestDetail mr={m} onChanged={mrs.reload} /></td></tr> : null])}
    </tbody></table></section>}</Async> : <Orders project={project} />}
    {nw && <NewRequest project={project} onClose={saved => { setNw(false); if (saved) mrs.reload(); }} />}
  </>;
}
