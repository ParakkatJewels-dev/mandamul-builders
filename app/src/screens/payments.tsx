// Payments: approved, unpaid running bills and vendor invoices. Paying needs the MFA step and a bank reference;
// the database refuses overpayment, unapproved documents, and the person who booked an invoice paying it.
import { useState } from 'react';
import { useApp } from '../app';
import { rpc } from '../lib/api';
import { formatINR, parseRupees, toPaise } from '../lib/money';
import { Async, Dialog, Field, PageHead, fmtDate, todayISO, useRpc } from '../ui/kit';

type Due = { kind: 'ra_bill' | 'invoice'; id: string; project_id: string; project: string; payee: string; what: string; due_date: string | null; amount: number; paid: number; balance: number; tds_left: number };

export function Payments() {
  const { guard } = useApp(); const [all, setAll] = useState(true); const { project } = useApp();
  const q = useRpc<Due[]>('payment_queue', { p_project: all ? undefined : project });
  const [pay, setPay] = useState<Due | null>(null); const [f, setF] = useState({ amount: '', tds: '', date: todayISO(), ref: '' });
  const open = (d: Due) => { setPay(d); setF({ amount: String(d.balance), tds: String(d.tds_left || 0), date: todayISO(), ref: '' }); };
  const amount = parseRupees(f.amount), tds = parseRupees(f.tds || '0');
  const over = pay && amount !== null && toPaise(amount)! > toPaise(pay.balance)!;
  const save = async () => {
    const r = await guard(() => rpc<string>('record_payment', { p_kind: pay!.kind, p_ref: pay!.id, p_amount: amount, p_tds: tds, p_paid_on: f.date, p_bank_ref: f.ref.trim() }), `Payment recorded against ${pay!.id}`);
    if (r) { setPay(null); q.reload(); }
  };
  return <>
    <PageHead title="Payments" sub="Only approved bills and invoices appear here. Paying asks for your authenticator code.">
      <label className="sm" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={all} onChange={() => setAll(!all)} /> All my projects</label>
    </PageHead>
    <Async q={q} empty={x => x.length === 0}>{rows => <section className="card flush"><table className="t stack"><thead><tr><th>Payee</th><th>For</th><th>Project</th><th>Due</th><th className="num">Approved</th><th className="num">Paid</th><th className="num">Balance</th><th /></tr></thead><tbody>
      {rows.map(d => <tr key={d.id} data-testid="due"><td data-l="Payee"><b>{d.payee}</b></td><td data-l="For">{d.what}<br /><span className="mono sm">{d.id}</span></td><td data-l="Project">{d.project}</td>
        <td data-l="Due" style={{ color: d.due_date && d.due_date < todayISO() ? 'var(--bad)' : undefined }}>{fmtDate(d.due_date)}</td><td data-l="Approved" className="num">{formatINR(toPaise(d.amount))}</td>
        <td data-l="Paid" className="num">{formatINR(toPaise(d.paid))}</td><td data-l="Balance" className="num"><b>{formatINR(toPaise(d.balance))}</b></td><td><button className="btn sm primary" onClick={() => open(d)}>Pay</button></td></tr>)}
    </tbody></table></section>}</Async>
    {pay && <Dialog title={`Pay ${pay.payee}`} onClose={() => setPay(null)}><div className="form">
      <p className="sm">{pay.what} · balance <b>{formatINR(toPaise(pay.balance))}</b></p>
      <div className="grid2"><Field label="Amount paid (₹)"><input className="input" inputMode="decimal" aria-label="Payment amount" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="TDS remitted (₹)" hint={pay.kind === 'invoice' ? 'Not applicable to material invoices' : `Bill deduction left: ${formatINR(toPaise(pay.tds_left))}`}><input className="input" inputMode="decimal" disabled={pay.kind === 'invoice'} value={f.tds} onChange={e => setF({ ...f, tds: e.target.value })} /></Field></div>
      <div className="grid2"><Field label="Paid on"><input className="input" type="date" max={todayISO()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Bank reference (UTR)"><input className="input" aria-label="Bank reference" value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field></div>
      {over && <div className="error">More than the balance; the database will refuse it.</div>}
      <div className="actions"><button className="btn" onClick={() => setPay(null)}>Cancel</button><button className="btn primary" disabled={amount === null || toPaise(amount)! <= 0n || f.ref.trim().length < 4 || tds === null} onClick={save}>Record payment</button></div>
    </div></Dialog>}
  </>;
}
