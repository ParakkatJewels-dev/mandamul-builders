'use strict';
/* Engine v2 — financial engine (ten measures), contracts & running bills, invoices & payments, unit readiness,
   cash requirement, earned value, automation events. Mirrors the database functions in supabase/migrations. */

const inclGst = (a, g) => a + gstOf(a, g);
const contractValue = c => sum(c.items.map(i => lineAmt(i.qtyM, i.rateP)));
const contractTotal = c => inclGst(contractValue(c), c.gst) + sum(c.variations.filter(v => v.status === 'Approved').map(v => inclGst(v.amountP, c.gst)));
const CONTRACT_LIVE = ['Active'], BILL_COST = ['Approved', 'Paid'];
/* commitment of one order or contract: a short-closed order counts what was accepted, a closed contract what was certified (B04) */
const acceptedP = x => sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.valueP));
const certifiedP = c => sum(c.bills.filter(b => BILL_COST.includes(b.status)).map(b => b.grossP + b.gstP));
const poCommitP = x => COMMITTED.includes(x.status) ? x.totalP : x.status === 'Closed' ? acceptedP(x) : 0;
const conCommitP = c => CONTRACT_LIVE.includes(c.status) ? contractTotal(c) : c.status === 'Closed' ? certifiedP(c) : 0;
const invPaid = id => sum(S.payments.filter(p => p.kind === 'invoice' && p.ref === id).map(p => p.amountP));
const billPaid = id => sum(S.payments.filter(p => p.kind === 'ra_bill' && p.ref === id).map(p => p.amountP));
const billTdsPaid = id => sum(S.payments.filter(p => p.kind === 'ra_bill' && p.ref === id).map(p => p.tdsP));
const advancePaid = cid => sum(S.payments.filter(p => p.kind === 'advance' && p.ref === cid).map(p => p.amountP));

/* Formulas (documented in the report): committed = approved POs + active contracts + approved variations;
   actual = QC-passed receipts + approved/paid bills (gross + GST); paid = invoice payments + bill payments (cash + TDS)
   + advance recovered; accrued unpaid = actual − paid − retention; forecast = committed + estimate to complete. */
function cost(pid) {
  const bv = currentBudget(pid), prov = bv ? null : budgetVersions(pid).find(b => b.status === 'Pending'), use = bv || prov;
  const v1 = budgetVersions(pid).find(b => b.v === 1 && b.status === 'Approved');
  const etc = S.etc[pid] || {}, pos = S.pos.filter(x => x.projectId === pid), cons = S.contracts.filter(c => c.projectId === pid);
  const lines = S.costCodes.map(c => {
    const P = pos.filter(x => x.code === c.code), C = cons.filter(x => x.code === c.code);
    const budget = use ? (use.lines[c.code] || 0) : 0, original = v1 ? (v1.lines[c.code] || 0) : budget;
    const committed = sum(P.map(poCommitP)) + sum(C.map(conCommitP));
    const pending = sum(P.filter(x => x.status === 'Pending approval').map(x => x.totalP)) + sum(C.filter(x => x.status === 'Pending approval').map(x => inclGst(contractValue(x), x.gst)))
      + sum(C.flatMap(x => x.variations.filter(v => v.status === 'Pending approval' && v.amountP > 0).map(v => inclGst(v.amountP, x.gst))));
    const bills = C.flatMap(x => x.bills.filter(b => BILL_COST.includes(b.status)));
    const grn = sum(P.flatMap(x => x.grns.filter(g => g.qc === 'Pass').map(g => g.valueP)));
    const actual = grn + sum(bills.map(b => b.grossP + b.gstP));
    const paid = sum(S.invoices.filter(i => P.some(x => x.id === i.poId)).map(i => invPaid(i.id))) + sum(bills.map(b => billPaid(b.id) + billTdsPaid(b.id) + b.advRecP));
    const retention = sum(bills.map(b => b.retentionP)), e = etc[c.code] || 0, fac = committed + e;
    return { code: c.code, name: c.name, original, changes: budget - original, budget, committed, pending, actual, paid, retention, accrued: actual - paid - retention,
      etc: e, fac, variance: budget - fac, uncommitted: budget - committed, avail: budget - committed - pending, open: committed - actual };
  });
  const tot = {}; ['original', 'changes', 'budget', 'committed', 'pending', 'actual', 'paid', 'retention', 'accrued', 'etc', 'fac', 'variance', 'uncommitted', 'open'].forEach(k => (tot[k] = sum(lines.map(l => l[k]))));
  return { lines, tot, version: bv, provisional: !!prov };
}
function contingency(pid) {
  const L = cost(pid).lines, c = L.find(l => l.code === '13') || { budget: 0, committed: 0 };
  const overruns = sum(L.filter(l => l.code !== '13').map(l => Math.max(0, l.fac - l.budget)));
  return { budget: c.budget, overruns, available: c.budget - c.committed - overruns };
}
/* Earned value from measured BOQ quantities, kept apart from spend and schedule progress */
function earned(pid) {
  const ev = sum(S.boq.filter(b => b.projectId === pid).map(b => inclGst(lineAmt(b.doneM, b.rateP), b.gst)));
  const bac = sum(S.boq.filter(b => b.projectId === pid).map(b => inclGst(lineAmt(b.qtyM, b.rateP), b.gst)));
  return { ev, bac, pct: bac ? ev * 100 / bac : 0 };
}
/* Cash requirement: obligations due (approved, unpaid) vs forecast outflows, 30-day buckets */
function cashReq(pids, days = 90) {
  const today = todayISO(), L = [];
  for (const i of S.invoices.filter(x => pids.includes(x.projectId) && x.status === 'Approved')) L.push({ d: i.dueDate, amt: i.totalP - invPaid(i.id), k: 'due', ref: i.id, what: `Invoice ${i.no} · ${vendor(i.vendorId).name}`, pid: i.projectId });
  for (const c of S.contracts.filter(x => pids.includes(x.projectId))) {
    for (const b of c.bills.filter(b => b.status === 'Approved')) L.push({ d: b.dueDate, amt: b.netP - billPaid(b.id), k: 'due', ref: b.id, what: `${b.id} · ${vendor(c.vendorId).name}`, pid: c.projectId });
    if (c.status === 'Active' && c.end > today) {
      const left = contractTotal(c) - sum(c.bills.filter(b => b.status !== 'Rejected').map(b => b.grossP + b.gstP)), months = Math.max(1, Math.ceil(diffDays(today, c.end) / 30));
      if (left > 0) for (let g = 1; g <= months; g++) L.push({ d: addDays(today, 30 * g), amt: Math.round(left / months), k: 'forecast', ref: c.id, what: `${c.id} remaining work · ${vendor(c.vendorId).name}`, pid: c.projectId });
    }
  }
  for (const x of S.pos.filter(p => pids.includes(p.projectId) && ['Approved', 'Part received'].includes(p.status))) {
    const rec = sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)), bal = inclGst(lineAmt(x.qtyM - rec, x.rateP), x.gst);
    if (bal > 0) L.push({ d: addDays(x.expected || today, vendor(x.vendorId).creditDays || 30), amt: bal, k: 'forecast', ref: x.id, what: `${x.id} undelivered · ${vendor(x.vendorId).name}`, pid: x.projectId });
  }
  const B = [[0, 30, '0–30 days'], [31, 60, '31–60 days'], [61, 90, '61–90 days']].filter(b => b[0] < days);
  return { buckets: B.map(([lo, hi, label]) => { const In = L.filter(l => l.amt > 0 && Math.max(diffDays(today, l.d), 0) >= lo && Math.max(diffDays(today, l.d), 0) <= hi); return { label, due: sum(In.filter(l => l.k === 'due').map(l => l.amt)), forecast: sum(In.filter(l => l.k === 'forecast').map(l => l.amt)), lines: In }; }), lines: L };
}
function outstanding(pids) { // approved, unpaid obligations + retention held
  const inv = S.invoices.filter(i => pids.includes(i.projectId) && i.status === 'Approved').map(i => ({ id: i.id, pid: i.projectId, vendorId: i.vendorId, what: 'Invoice ' + i.no, due: i.dueDate, amt: i.totalP - invPaid(i.id) }));
  const bills = S.contracts.filter(c => pids.includes(c.projectId)).flatMap(c => c.bills.filter(b => b.status === 'Approved').map(b => ({ id: b.id, pid: c.projectId, vendorId: c.vendorId, what: `RA bill ${b.no} on ${c.id}`, due: b.dueDate, amt: b.netP - billPaid(b.id) })));
  const retention = sum(S.contracts.filter(c => pids.includes(c.projectId)).flatMap(c => c.bills.filter(b => BILL_COST.includes(b.status)).map(b => b.retentionP)));
  const rows = [...inv, ...bills].filter(r => r.amt > 0).sort((a, b) => (a.due < b.due ? -1 : 1));
  return { rows, total: sum(rows.map(r => r.amt)), overdue: sum(rows.filter(r => r.due < todayISO()).map(r => r.amt)), retention };
}

/* ---------- contracts, measurements, running bills ---------- */
function measuredQty(itemId) { return sum(S.measurements.filter(m => m.itemId === itemId && m.status !== 'Rejected').map(m => m.qtyM)); }
function billedQty(itemId, exceptBill) { return sum(S.contracts.flatMap(c => c.bills.filter(b => b.status !== 'Rejected' && b.id !== exceptBill).flatMap(b => b.lines.filter(l => l.itemId === itemId).map(l => l.thisM)))); }
function buildBill(c, otherP = 0) { // from verified, unbilled measurements
  const M = S.measurements.filter(m => m.contractId === c.id && m.status === 'Verified' && !m.billId);
  const lines = c.items.map(it => { const thisM = sum(M.filter(m => m.itemId === it.id).map(m => m.qtyM)); if (!thisM) return null; const prevM = billedQty(it.id); return { itemId: it.id, prevM, thisM, cumM: prevM + thisM, rateP: it.rateP, amountP: lineAmt(thisM, it.rateP) }; }).filter(Boolean);
  const grossP = sum(lines.map(l => l.amountP)), gstP = gstOf(grossP, c.gst), retentionP = gstOf(grossP, c.retention);
  const advOut = advancePaid(c.id) - sum(c.bills.filter(b => b.status !== 'Rejected').map(b => b.advRecP));
  const advRecP = Math.min(gstOf(grossP, c.advRecPct), Math.max(advOut, 0)), tdsP = gstOf(grossP, c.tds);
  return { lines, grossP, gstP, retentionP, advRecP, tdsP, otherP, netP: grossP + gstP - retentionP - advRecP - tdsP - otherP, measurementIds: M.map(m => m.id) };
}
function billSteps(totalP) {
  const t = S.settings.thresholds, s = [{ role: 'pm', module: 'site', label: 'Engineer certification' }, { role: 'qs', module: 'boq', label: 'QS verification' }, { role: 'finance', module: 'payments', label: 'Finance review' }];
  if (totalP > t.pm) s.push({ role: 'pd', module: 'contracts', label: 'Approve bill' });
  if (totalP > t.pd) s.push({ role: 'md', module: 'contracts', label: 'Approve bill' });
  return s;
}
function invoiceSteps(totalP) {
  const t = S.settings.thresholds, s = [{ role: 'finance', module: 'payments', label: 'Finance review' }];
  if (totalP > t.pm) s.push({ role: 'pd', module: 'payments', label: 'Approve payment' });
  if (totalP > t.pd) s.push({ role: 'md', module: 'payments', label: 'Approve payment' });
  return s;
}
function matchInvoice(po, qtyM, rateP, gst, selfId) { // three-way match: order · receipt · invoice
  const acc = sum(po.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)), inv = sum(S.invoices.filter(i => i.poId === po.id && i.status !== 'Rejected' && i.id !== selfId).map(i => i.qtyM)), n = [];
  if (inv + qtyM > acc) n.push(`invoiced ${fmtQty(inv + qtyM)} ${po.unit} exceeds accepted ${fmtQty(acc)}`);
  if (rateP !== po.rateP) n.push(`rate ${fmtINR(rateP)} differs from PO ${fmtINR(po.rateP)}`);
  if (gst !== po.gst) n.push(`GST ${gst}% differs from PO ${po.gst}%`);
  return n;
}
function consumeEtc(pid, code, amt, ref) {
  const e = (S.etc[pid] = S.etc[pid] || {}), before = e[code] || 0; e[code] = Math.max(0, before - amt);
  log('Estimate consumed', `${code}: estimate ${fmtINR(before)} → ${fmtINR(e[code])} by ${ref} (capped at zero)`, pid, ref);
}
Object.assign(ON_DONE, {
  PO(ap, ok) { const po = S.pos.find(x => x.id === ap.ref); if (!ok) { po.status = 'Rejected'; return; } po.status = 'Approved'; po.approvedAt = nowISO(); consumeEtc(po.projectId, po.code, po.totalP, po.id); },
  CONTRACT(ap, ok) { const c = S.contracts.find(x => x.id === ap.ref); c.status = ok ? 'Active' : 'Rejected'; if (ok) consumeEtc(c.projectId, c.code, inclGst(contractValue(c), c.gst), c.id); },
  VARIATION(ap, ok) { const c = S.contracts.find(x => x.variations.some(v => v.id === ap.ref)), v = c.variations.find(x => x.id === ap.ref); v.status = ok ? 'Approved' : 'Rejected'; if (ok && v.amountP > 0) consumeEtc(c.projectId, c.code, inclGst(v.amountP, c.gst), v.id); },
  INVOICE(ap, ok) { const i = S.invoices.find(x => x.id === ap.ref); i.status = ok ? 'Approved' : 'Rejected'; if (ok) i.dueDate = addDays(i.date, vendor(i.vendorId).creditDays || 30); },
  RABILL(ap, ok) {
    const c = S.contracts.find(x => x.bills.some(b => b.id === ap.ref)), b = c.bills.find(x => x.id === ap.ref);
    if (ok) { b.status = 'Approved'; b.dueDate = addDays(todayISO(), S.settings.billDueDays || 15); }
    else { b.status = 'Rejected'; S.measurements.filter(m => m.billId === b.id).forEach(m => (m.billId = null)); }
  }
});
const _docDone = ON_DONE.DOC;
ON_DONE.DOC = (ap, ok) => { _docDone(ap, ok); if (ok) revisionImpact(ap.ctx.docId, ap.ctx.rev); };
function revisionImpact(docId, rev) { // Workflow 2: an approved drawing revision flags what it touches
  const d = S.docs.find(x => x.id === docId), L = d.links || { tasks: [], boq: [], codes: [], units: [] };
  const openPOs = S.pos.filter(p => p.projectId === d.projectId && (L.codes || []).includes(p.code) && ['Pending approval', 'Approved', 'Part received'].includes(p.status)).map(p => p.id);
  const openMRs = S.mrs.filter(m => m.projectId === d.projectId && (L.codes || []).includes(m.code) && MR_OPEN.includes(m.status)).map(m => m.id);
  const imp = { id: nid('RI'), docId, rev, projectId: d.projectId, at: nowISO(), tasks: L.tasks || [], boq: L.boq || [], codes: L.codes || [], units: L.units || [], openPOs, openMRs, status: 'Open' };
  S.impacts.unshift(imp); (L.tasks || []).forEach(t => { const x = S.tasks.find(y => y.id === t); if (x) x.revisedBy = `${d.title} ${rev}`; });
  emit('drawing_revision', `docrev:${docId}:${rev}`, d.projectId, { title: `${d.title} ${rev}`, impact: imp.id });
  log('Revision impact', `${d.title} ${rev}: ${imp.tasks.length} activities, ${imp.boq.length} BOQ items, ${openPOs.length} open orders, ${openMRs.length} open requests to review`, d.projectId, imp.id);
}

/* ---------- units: readiness from verified gates ---------- */
const UNIT_STATUS = ['Not started', 'In progress', 'Awaiting inspection', 'Blocked', 'Ready', 'Handed over'];
function readiness(u) {
  const st = u.stages, snags = S.snags.filter(s => s.unitId === u.id && s.status !== 'Closed'), ffe = S.ffe.filter(f => f.unitId === u.id), cm = u.commissioning;
  const r = { total: st.length, passed: st.filter(s => s.status === 'Passed').length, awaiting: st.filter(s => s.status === 'Awaiting inspection').length, started: st.filter(s => s.status !== 'Not started').length,
    snags: snags.length, safety: snags.filter(s => s.severity === 'Safety-critical').length, ffeTotal: ffe.length, ffeReady: ffe.filter(f => ['Installed', 'Tested'].includes(f.status)).length,
    cmTotal: cm.length, cmPassed: cm.filter(c => c.status === 'Passed').length, final: S.inspections.some(i => i.unitId === u.id && i.kind === 'Final' && i.status === 'Passed') };
  r.gates = r.passed === r.total && r.snags === 0 && r.ffeReady === r.ffeTotal && r.cmPassed === r.cmTotal;
  r.status = u.handedOverAt ? 'Handed over' : (r.safety || u.blocked) ? 'Blocked' : (r.gates && r.final) ? 'Ready' : r.awaiting ? 'Awaiting inspection' : r.started ? 'In progress' : 'Not started';
  r.pct = r.total ? r.passed * 100 / r.total : 0;
  r.phase = (st.find(s => s.status !== 'Passed') || { label: r.gates ? (r.final ? 'Complete' : 'Final inspection') : 'Commissioning & FF&E' }).label;
  return r;
}
function unitCost(u) {
  const P = S.pos.filter(p => p.unitId === u.id), C = S.contracts.filter(c => c.unitId === u.id);
  const committed = sum(P.map(poCommitP)) + sum(C.map(conCommitP)) + sum(S.ffe.filter(f => f.unitId === u.id && f.status !== 'Specified').map(f => f.costP || 0));
  const actual = sum(P.flatMap(p => p.grns.filter(g => g.qc === 'Pass').map(g => g.valueP))) + sum(C.flatMap(c => c.bills.filter(b => BILL_COST.includes(b.status)).map(b => b.grossP + b.gstP))) + sum(S.ffe.filter(f => f.unitId === u.id && ['Delivered', 'Installed', 'Tested'].includes(f.status)).map(f => f.costP || 0));
  return { budget: u.budgetP, committed, actual };
}
const STAGE_TASK = { foundation: 'T05', structure: 'T07', roofing: 'T08', mep_rough: 'T09', plaster: 'T10', flooring: 'T11', painting: 'T11', doors_windows: 'T12', bathrooms: 'T11', furniture: 'T15', cleaning: 'T15', platform: 'G04', bath_pod: 'G07' };
function unitEta(u) { const s = sched(u.projectId), rem = u.stages.filter(x => x.status !== 'Passed'); if (!rem.length) return null; const ffs = rem.map(x => { const t = s.tasks.find(t => t.key === STAGE_TASK[x.key]); return t ? s.R[t.id].ff : s.foreFinish; }); return maxISO(ffs); }

/* ---------- automation: events with de-duplication, rules, channels, escalation ---------- */
function emit(type, key, pid, payload = {}) {
  if (!S.events) return null;
  if (S.events.some(e => e.key === key)) { S.meta.dupes = (S.meta.dupes || 0) + 1; return null; }
  const e = { id: nid('EV'), type, key, pid, payload, at: nowISO(), status: 'queued', attempts: 0, results: [] }; S.events.unshift(e); if (S.events.length > 600) S.events.length = 600; return e;
}
function processEvents() {
  if (!S.events) return 0; let n = 0;
  for (const e of S.events.filter(x => x.status === 'queued')) {
    const r = S.rules.find(x => x.event === e.type && x.enabled); e.attempts++;
    if (r) {
      const text = `${r.name}${e.pid ? ' — ' + (proj(e.pid)?.name || e.pid) : ''}${e.payload.title ? ': ' + e.payload.title : ''}`;
      const ids = S.users.filter(u => r.roles.includes(u.role) && (!e.pid || hasProject(e.pid, u))).map(u => u.id);
      for (const ch of r.channels) {
        if (ch === 'in_app') { notify(ids, text, e.payload.link || (e.pid ? 'p-' + e.pid.toLowerCase() : 'dashboard')); e.results.push({ ch, n: ids.length, status: 'delivered' }); }
        else e.results.push({ ch, n: ids.length, status: S.channels[ch]?.enabled ? 'queued' : 'not configured' });
      }
      if (r.risk && e.pid && !S.risks.some(k => k.key === 'risk:' + e.key)) S.risks.unshift({ id: nid('RK'), key: 'risk:' + e.key, projectId: e.pid, title: text, source: r.name, severity: ['safety_defect', 'budget_overrun'].includes(e.type) ? 'High' : 'Medium', status: 'Open', at: nowISO() });
    }
    e.status = 'processed'; e.doneAt = nowISO(); n++;
  }
  // escalation: approvals waiting longer than the rule allows, once per approval
  const er = S.rules.find(x => x.event === 'approval_requested' && x.enabled && x.escalateTo);
  if (er) for (const a of S.approvals.filter(a => a.status === 'Pending' && !a.escalated && (Date.now() - Date.parse(a.at)) / 36e5 > er.escalateHours)) {
    a.escalated = nowISO(); notify(S.users.filter(u => u.role === er.escalateTo && hasProject(a.projectId, u)).map(u => u.id), `Escalation: ${AP_TYPE[a.type]} ${a.ref} has waited over ${er.escalateHours} h`, 'approvals');
    log('Escalated', `${a.id} (${a.ref}) escalated to ${roleName(er.escalateTo)} after ${er.escalateHours} h`, a.projectId, a.id);
  }
  return n;
}
function scanExceptions() { // safe to repeat: every event carries a de-duplication key
  const wk = (() => { const d = new Date(); const j = new Date(d.getFullYear(), 0, 1); return d.getFullYear() + '-W' + Math.ceil(((d - j) / 864e5 + j.getDay() + 1) / 7); })(); let n = 0;
  for (const p of S.projects.filter(p => !['Handed over', 'On hold'].includes(p.stage))) {
    const s = sched(p.id), c = cost(p.id);
    if (c.version) for (const l of c.lines.filter(l => l.code !== '13' && flagLevel(l) === 'bad')) if (emit('budget_overrun', `overrun:${p.id}:${l.code}:${wk}`, p.id, { title: `${l.code} ${l.name} forecast ${Math.round(pctOf(l.fac, l.budget))}% of budget`, link: 'p-' + p.id.toLowerCase() })) n++;
    for (const t of s.tasks.filter(t => s.R[t.id].threat && (s.R[t.id].started || t.preds.every(x => S.tasks.find(y => y.id === x)?.actFinish)))) if (emit('critical_delay', `delay:${t.id}:${wk}`, p.id, { title: `${t.name} ${s.R[t.id].var} days late` })) n++;
    const rs = reportStatus(p); if (rs.due && !rs.today && rs.pastCutoff && emit('missing_report', `missing:${p.id}:${todayISO()}`, p.id, { title: 'No report by ' + S.settings.cutoff, link: 'site' })) n++;
  }
  return n;
}
function snapshot() { // weekly cost history for trend charts
  const today = todayISO();
  for (const p of S.projects) { const L = (S.snaps[p.id] = S.snaps[p.id] || []), last = L[L.length - 1]; if (last && diffDays(last.date, today) < 7) continue; const c = cost(p.id).tot; L.push({ date: today, budget: c.budget, committed: c.committed, actual: c.actual, fac: c.fac }); }
}
