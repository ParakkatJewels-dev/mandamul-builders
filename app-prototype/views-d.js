'use strict';
/* Views D — contracts & running bills, invoices & payments, reports (cost, cash, payables, hospitality, profitability, contractors, procurement, risks) */

/* ================= CONTRACTS & CONTRACTOR BILLING ================= */
VIEWS.contracts = {
  mod: 'contracts', title: 'Contracts',
  render() {
    const P = myProjects().filter(p => inScope(p.id)).map(p => p.id), C = S.contracts.filter(c => P.includes(c.projectId)).sort((a, b) => (a.at < b.at ? 1 : -1));
    const live = C.filter(c => c.status === 'Active'), cert = sum(C.flatMap(c => c.bills.filter(b => BILL_COST.includes(b.status)).map(b => b.grossP + b.gstP)));
    const inAp = C.flatMap(c => c.bills.filter(b => b.status === 'In approval')).length, toVerify = S.measurements.filter(m => m.status === 'Recorded' && C.some(c => c.id === m.contractId)).length;
    return pageHead('Contracts & contractor billing', `${live.length} active work orders · ${moneyC(sum(live.map(contractTotal)))} committed · ${moneyC(cert)} certified · ${inAp} bill${inAp === 1 ? '' : 's'} in certification · ${toVerify} measurement${toVerify === 1 ? '' : 's'} to verify`,
      can('contracts', 'create') ? `<button class="btn primary" data-act="newContract">${ic('plus')}Work order</button>` : '') +
      `<section class="card flush"><table class="t stack"><thead><tr><th>Work order</th><th>Project</th><th>Contractor</th><th>Scope</th><th class="num">Value incl. GST</th><th>Certified</th><th class="num">Retention held</th><th>Status</th></tr></thead><tbody>
      ${C.map(c => { const tot = contractTotal(c), certd = sum(c.bills.filter(b => BILL_COST.includes(b.status)).map(b => b.grossP + b.gstP)), ret = sum(c.bills.filter(b => BILL_COST.includes(b.status)).map(b => b.retentionP)), ia = c.bills.some(b => b.status === 'In approval');
        return `<tr class="click" data-act="contract" data-id="${c.id}" tabindex="0"><td class="mono sm nowrap">${c.id}</td><td>${esc(shortName(proj(c.projectId)))}</td><td>${esc(vendor(c.vendorId).name)}</td><td>${esc(c.title)} <span class="muted sm">· ${c.code}</span></td><td class="num">${money(tot)}</td><td class="w-pb">${bar(pctOf(certd, tot), 'ok')}<span class="sm">${Math.round(pctOf(certd, tot))}%</span></td><td class="num">${money(ret)}</td><td>${badge(c.status === 'Active' ? 'In progress' : c.status, c.status)}${ia ? ' <span class="bd warn">Bill in approval</span>' : ''}</td></tr>`; }).join('') || `<tr><td colspan="8">${empty('No work orders yet')}</td></tr>`}
      </tbody></table></section>`;
  }
};
ACT.contract = el => showModal('contract', el.dataset.id);
MODALS.contract = id => {
  const c = S.contracts.find(x => x.id === id), p = proj(c.projectId), ap = S.approvals.find(a => a.id === c.approvalId), fin = can('budget');
  const M = S.measurements.filter(m => m.contractId === c.id).sort((a, b) => (a.date < b.date ? 1 : -1)), pend = M.filter(m => m.status === 'Recorded');
  const unbilled = M.filter(m => m.status === 'Verified' && !m.billId), advP = advancePaid(c.id), advRec = sum(c.bills.filter(b => b.status !== 'Rejected').map(b => b.advRecP));
  const canVerify = can('site', 'approve') && hasProject(c.projectId);
  openModal(`${c.id} · ${esc(c.title)}`, `<div class="kv2"><div><span class="kl">Contractor</span>${esc(vendor(c.vendorId).name)}</div><div><span class="kl">Status</span>${badge(c.status === 'Active' ? 'In progress' : c.status, c.status)}</div>
    <div><span class="kl">Cost code</span>${c.code} ${esc(codeName(c.code))}${c.unitId ? ' · ' + esc(S.units.find(u => u.id === c.unitId)?.code || '') : ''}</div><div><span class="kl">Period</span>${fmtDate(c.start)} → ${fmtDate(c.end)}</div>
    ${fin ? `<div><span class="kl">Value</span>${fmtINR(contractValue(c))} + GST ${c.gst}% = <b>${fmtINR(contractTotal(c))}</b></div><div><span class="kl">Terms</span>Retention ${c.retention}% · TDS ${c.tds}% · advance ${fmtINR(c.advanceP)} recovered at ${c.advRecPct}% per bill</div>
    <div><span class="kl">Advance</span>paid ${fmtINR(advP)} · recovered ${fmtINR(advRec)} · outstanding ${fmtINR(advP - advRec)}</div>` : ''}</div>
    ${ap && ap.status === 'Pending' ? chainHTML(ap) + (canAct(ap) ? decideButtons(ap) : demoSwitch(ap)) : ''}
    <h3 class="h3">Items</h3><div class="scroll"><table class="t"><thead><tr><th>Item</th><th class="num">Contract qty</th><th class="num">Measured</th><th class="num">Billed</th>${fin ? '<th class="num">Rate</th>' : ''}</tr></thead><tbody>
    ${c.items.map(it => `<tr><td>${esc(it.desc)}${it.boqId ? ` <span class="muted sm">· BOQ ${esc(S.boq.find(b => b.id === it.boqId)?.ref || '')}</span>` : ''}</td><td class="num">${fmtQty(it.qtyM)} ${esc(it.unit)}</td><td class="num">${fmtQty(measuredQty(it.id))}</td><td class="num">${fmtQty(billedQty(it.id))}</td>${fin ? `<td class="num">${fmtINR(it.rateP)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <h3 class="h3">Measurement book</h3>${M.length ? `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>Item</th><th class="num">Qty</th><th>Recorded by</th><th>Status</th><th></th></tr></thead><tbody>${M.slice(0, 12).map(m => { const it = c.items.find(i => i.id === m.itemId);
      return `<tr><td class="nowrap">${fmtDate(m.date)}</td><td class="sm">${esc(it?.desc || '')}${m.note ? ' · ' + esc(m.note) : ''}</td><td class="num">${fmtQty(m.qtyM)} ${esc(it?.unit || '')}</td><td class="sm">${esc(uname(m.by))}</td><td>${badge(m.status === 'Verified' ? (m.billId ? 'Done' : 'Approved') : m.status === 'Recorded' ? 'Pending' : 'Rejected', m.billId ? 'Billed ' + m.billId : m.status)}</td><td class="nowrap">${m.status === 'Recorded' && canVerify && m.by !== me().id ? `<button class="btn sm" data-act="mVerify" data-id="${m.id}" data-ok="1">Verify</button> <button class="btn sm ghost danger" data-act="mVerify" data-id="${m.id}" data-ok="0">Reject</button>` : m.status === 'Recorded' && m.by === me().id ? '<span class="sm muted">Another person verifies</span>' : ''}</td></tr>`; }).join('')}</tbody></table></div>${M.length > 12 ? `<p class="fine">Showing 12 of ${M.length}.</p>` : ''}` : '<p class="muted">No measurements yet.</p>'}
    <h3 class="h3">Running-account bills</h3>${c.bills.length ? `<div class="scroll"><table class="t"><thead><tr><th>Bill</th><th>Date</th>${fin ? '<th class="num">Gross</th><th class="num">Net payable</th>' : ''}<th>Status</th></tr></thead><tbody>${[...c.bills].reverse().map(b => `<tr class="click" data-act="bill" data-id="${b.id}" tabindex="0"><td class="mono sm">${b.id} · RA ${b.no}</td><td class="nowrap">${fmtDate(b.at.slice(0, 10))}</td>${fin ? `<td class="num">${fmtINR(b.grossP)}</td><td class="num">${fmtINR(b.netP)}</td>` : ''}<td>${badge(b.status === 'In approval' ? 'Pending' : b.status === 'Paid' ? 'Done' : b.status, b.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No bills yet.</p>'}
    ${c.variations.length ? `<h3 class="h3">Variations</h3><ul class="al">${c.variations.map(v => `<li><span class="sm mono">${v.id}</span><span>${esc(v.desc)} · ${money(v.amountP)} ${badge(v.status === 'Pending approval' ? 'Pending' : v.status, v.status)}</span></li>`).join('')}</ul>` : ''}
    <div class="fa">${c.status === 'Active' && can('site', 'create') && hasProject(c.projectId) ? `<button class="btn" data-act="mNew" data-id="${c.id}">Record measurement</button>` : ''}
      ${c.status === 'Active' && can('contracts', 'create') ? `<button class="btn" data-act="varNew" data-id="${c.id}">Variation</button>` : ''}
      ${c.status === 'Active' && can('payments', 'create') && advP < c.advanceP ? `<button class="btn" data-act="payNew" data-kind="advance" data-id="${c.id}">Pay advance</button>` : ''}
      ${c.status === 'Active' && can('contracts', 'create') && unbilled.length ? `<button class="btn primary" data-act="billNew" data-id="${c.id}">Prepare running bill (${unbilled.length} measurement${unbilled.length === 1 ? '' : 's'})</button>` : ''}</div>`, { wide: true, sub: esc(p.name) });
};
ACT.mVerify = el => {
  const m = S.measurements.find(x => x.id === el.dataset.id), c = S.contracts.find(x => x.id === m.contractId), ok = el.dataset.ok === '1';
  if (m.by === me().id) { toast('The person who recorded a measurement cannot verify it', 'bad'); return; }
  m.status = ok ? 'Verified' : 'Rejected'; m.verifiedBy = me().id; m.verifiedAt = nowISO();
  const it = c.items.find(i => i.id === m.itemId);
  if (ok && it.boqId) { const b = S.boq.find(x => x.id === it.boqId); if (b) b.doneM += m.qtyM; }
  log(ok ? 'Measurement verified' : 'Measurement rejected', `${c.id}: ${fmtQty(m.qtyM)} ${it.unit} ${it.desc}`, c.projectId, m.id); toast(ok ? 'Measurement verified — it will go on the next bill' : 'Measurement rejected'); refresh();
};
ACT.mNew = el => showModal('mNew', el.dataset.id);
MODALS.mNew = id => {
  const c = S.contracts.find(x => x.id === id), U = S.units.filter(u => u.projectId === c.projectId);
  openModal('Record measurement', `<form data-form="mNew" data-id="${id}" class="form">${field('Item', `<select name="item">${c.items.map(it => opt(it.id, `${it.desc} — ${fmtQty(it.qtyM - measuredQty(it.id))} ${it.unit} left`)).join('')}</select>`)}
    <div class="g3">${field('Quantity', '<input name="qty" required inputmode="decimal" autofocus>')}${field('Measured on', `<input type="date" name="date" required max="${todayISO()}" value="${todayISO()}">`)}${field('Unit / location', `<select name="unit"><option value="">Package-wide</option>${U.map(u => opt(u.id, u.code + ' ' + u.name)).join('')}</select>`)}</div>
    ${field('Note', '<input name="note" maxlength="140" placeholder="e.g. slab C5, gridlines 3–6">')}<p class="fine">Recorded quantities count only after an engineer other than you verifies them; verified quantities feed the next running bill and the BOQ.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Record</button></div></form>`, { sub: esc(c.id + ' · ' + vendor(c.vendorId).name) });
};
FORM.mNew = (fd, f) => {
  const c = S.contracts.find(x => x.id === f.dataset.id), it = c.items.find(i => i.id === fd.get('item')), q = parseQty(fd.get('qty'));
  if (!q) { toast('Enter a quantity', 'bad'); return; }
  if (measuredQty(it.id) + q > it.qtyM) { toast(`Exceeds contract quantity (${fmtQty(it.qtyM - measuredQty(it.id))} ${it.unit} left) — raise a variation`, 'bad'); return; }
  const m = { id: nid('MB'), contractId: c.id, itemId: it.id, qtyM: q, date: fd.get('date'), unitId: fd.get('unit') || null, note: String(fd.get('note') || '').trim(), by: me().id, status: 'Recorded', verifiedBy: null, billId: null };
  S.measurements.push(m); log('Measurement recorded', `${c.id}: ${fmtQty(q)} ${it.unit} ${it.desc}`, c.projectId, m.id);
  notify(S.users.filter(u => u.role === 'pm' && hasProject(c.projectId, u)).map(u => u.id), `Measurement on ${c.id} needs verification`, 'contracts');
  toast('Measurement recorded — waiting for verification'); UI.modal = { name: 'contract', id: c.id }; refresh();
};
ACT.billNew = el => showModal('billNew', el.dataset.id);
MODALS.billNew = id => {
  const c = S.contracts.find(x => x.id === id), b = buildBill(c);
  openModal(`Running bill ${c.bills.length + 1} · ${c.id}`, `<form data-form="billNew" data-id="${id}" class="form">
    <table class="t"><thead><tr><th>Item</th><th class="num">Previous</th><th class="num">This bill</th><th class="num">Cumulative</th><th class="num">Amount</th></tr></thead><tbody>${b.lines.map(l => { const it = c.items.find(i => i.id === l.itemId); return `<tr><td class="sm">${esc(it.desc)}</td><td class="num">${fmtQty(l.prevM)}</td><td class="num">${fmtQty(l.thisM)}</td><td class="num">${fmtQty(l.cumM)} ${esc(it.unit)}</td><td class="num">${fmtINR(l.amountP)}</td></tr>`; }).join('')}</tbody></table>
    ${billBreakdown(b, c)}${field('Other deductions (₹)', '<input name="other" inputmode="decimal" value="0">', 'Penalties, material recoveries; explain in the note')}${field('Note', '<input name="note" maxlength="160">')}
    <p class="fine">Certification route: ${billSteps(b.grossP + b.gstP).map(s => roleName(s.role)).join(' → ')}.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Submit for certification</button></div></form>`, { wide: true, sub: esc(vendor(c.vendorId).name) });
};
function billBreakdown(b, c) {
  return `<dl class="calc"><dt>Gross work done (Σ this qty × rate)</dt><dd>${fmtINR(b.grossP)}</dd><dt>+ GST ${c.gst}%</dt><dd>${fmtINR(b.gstP)}</dd><dt>− Retention ${c.retention}% of gross</dt><dd>${fmtINR(b.retentionP)}</dd>
    <dt>− Advance recovery (${c.advRecPct}% of gross, up to outstanding advance)</dt><dd>${fmtINR(b.advRecP)}</dd><dt>− TDS ${c.tds}% of gross</dt><dd>${fmtINR(b.tdsP)}</dd>${b.otherP ? `<dt>− Other deductions</dt><dd>${fmtINR(b.otherP)}</dd>` : ''}<dt class="tot">Net payable</dt><dd class="tot">${fmtINR(b.netP)}</dd></dl>`;
}
FORM.billNew = (fd, f) => {
  const c = S.contracts.find(x => x.id === f.dataset.id); if (c.bills.some(b => b.status === 'In approval')) { toast('A bill for this contract is already in certification', 'bad'); return; }
  const other = parseMoney(fd.get('other') || '0'); if (other == null) { toast('Other deductions must be an amount', 'bad'); return; }
  const b = buildBill(c, other); if (!b.lines.length) { toast('No verified, unbilled measurements', 'bad'); return; } if (b.netP < 0) { toast('Deductions exceed the bill value', 'bad'); return; }
  const bill = { id: nid('RA'), no: c.bills.length + 1, ...b, note: String(fd.get('note') || ''), at: nowISO(), by: me().id, status: 'In approval', dueDate: null }; delete bill.measurementIds;
  S.measurements.filter(m => b.measurementIds.includes(m.id)).forEach(m => (m.billId = bill.id)); c.bills.push(bill);
  const ap = createApproval({ type: 'RABILL', ref: bill.id, projectId: c.projectId, title: `RA bill ${bill.no} on ${c.id} — ${vendor(c.vendorId).name}`, amountP: bill.grossP + bill.gstP, steps: billSteps(bill.grossP + bill.gstP) }); bill.approvalId = ap.id;
  emit('contractor_bill', 'rabill:' + bill.id, c.projectId, { title: `${bill.id} ${fmtINR(bill.grossP)}` });
  log('Running bill prepared', `${bill.id}: gross ${fmtINR(bill.grossP)}, net ${fmtINR(bill.netP)}`, c.projectId, bill.id); toast(`${bill.id} sent for certification`); UI.modal = { name: 'contract', id: c.id }; refresh();
};
ACT.bill = el => showModal('bill', el.dataset.id);
MODALS.bill = id => {
  const c = S.contracts.find(x => x.bills.some(b => b.id === id)), b = c.bills.find(x => x.id === id), ap = S.approvals.find(a => a.id === b.approvalId), paid = billPaid(b.id);
  openModal(`${b.id} · RA bill ${b.no}`, `<p class="sm">${esc(c.id)} · ${esc(vendor(c.vendorId).name)} · ${badge(b.status === 'In approval' ? 'Pending' : b.status, b.status)}${b.dueDate && b.status === 'Approved' ? ` · due ${fmtDate(b.dueDate)}` : ''}</p>
    ${can('budget') ? `<table class="t"><thead><tr><th>Item</th><th class="num">Previous</th><th class="num">This bill</th><th class="num">Cumulative</th><th class="num">Amount</th></tr></thead><tbody>${b.lines.map(l => { const it = c.items.find(i => i.id === l.itemId); return `<tr><td class="sm">${esc(it?.desc || '')}</td><td class="num">${fmtQty(l.prevM)}</td><td class="num">${fmtQty(l.thisM)}</td><td class="num">${fmtQty(l.cumM)}</td><td class="num">${fmtINR(l.amountP)}</td></tr>`; }).join('')}</tbody></table>${billBreakdown(b, c)}
    <p class="sm">Paid ${fmtINR(paid)} of ${fmtINR(b.netP)} · TDS deposited ${fmtINR(billTdsPaid(b.id))} of ${fmtINR(b.tdsP)}</p>` : '<p class="muted">Amounts are restricted for your role.</p>'}
    ${ap ? chainHTML(ap) + (ap.status === 'Pending' ? (canAct(ap) ? decideButtons(ap) : demoSwitch(ap)) : '') : ''}
    ${b.status === 'Approved' && can('payments', 'create') ? `<div class="fa"><button class="btn primary" data-act="payNew" data-kind="ra_bill" data-id="${b.id}">Record payment</button></div>` : ''}`, { wide: true, sub: esc(proj(c.projectId).name) });
};
ACT.varNew = el => openModal('Contract variation', `<form data-form="varNew" data-id="${el.dataset.id}" class="form">${field('Description', '<input name="desc" required minlength="5" maxlength="160" autofocus>')}${field('Amount excl. GST (₹)', '<input name="amt" required inputmode="decimal">', 'Use a minus sign for an omission, e.g. -2,50,000')}<div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Send for approval</button></div></form>`);
FORM.varNew = (fd, f) => {
  const c = S.contracts.find(x => x.id === f.dataset.id), raw = String(fd.get('amt')).trim(), neg = raw.startsWith('-'), a = parseMoney(raw.replace(/^-/, ''));
  if (!a) { toast('Enter the variation amount', 'bad'); return; }
  const v = { id: nid('VO'), desc: String(fd.get('desc')).trim(), amountP: neg ? -a : a, status: 'Pending approval', by: me().id, at: nowISO() }; c.variations.push(v);
  const incl = inclGst(a, c.gst), line = cost(c.projectId).lines.find(l => l.code === c.code), over = neg ? 0 : Math.max(0, -line.avail);
  v.approvalId = createApproval({ type: 'VARIATION', ref: v.id, projectId: c.projectId, title: `${v.desc} (${c.id})`, amountP: v.amountP, steps: poSteps(incl, over, 'contracts'), ctx: { overBy: over } }).id;
  log('Variation requested', `${v.id} on ${c.id}: ${fmtINR(v.amountP)}`, c.projectId, v.id); closeModal(); toast('Variation sent for approval'); UI.modal = { name: 'contract', id: c.id }; refresh();
};
ACT.newContract = () => showModal('newContract', UI.pf !== 'all' ? UI.pf : myProjects()[0]?.id);
CHG.ncProject = el => keepValues(() => MODALS.newContract(el.value));
CHG.ncCode = el => { UI.ncCode = el.value; keepValues(() => MODALS.newContract($('#modal select[name=projectId]').value)); };
MODALS.newContract = pid => {
  const codes = S.costCodes.filter(c => c.code !== '13'), code = UI.ncCode || '03', B = S.boq.filter(b => b.projectId === pid && b.code === code).slice(0, 4);
  openModal('New work order', `<form data-form="newContract" class="form">
    <div class="g3">${field('Project', `<select name="projectId" data-chg="ncProject">${myProjects().map(p => opt(p.id, p.name, pid)).join('')}</select>`)}${field('Cost code', `<select name="code" data-chg="ncCode">${codes.map(c => opt(c.code, c.code + ' ' + c.name, code)).join('')}</select>`)}${field('Contractor', `<select name="vendorId">${S.vendors.filter(v => v.approved).map(v => opt(v.id, v.name + ' — ' + v.category)).join('')}</select>`)}</div>
    <div class="g2">${field('Title', '<input name="title" required maxlength="120" placeholder="e.g. Roofing package — cottages C13–C24">')}${field('Unit (optional)', `<select name="unitId"><option value="">Package-wide</option>${S.units.filter(u => u.projectId === pid).map(u => opt(u.id, u.code + ' ' + u.name)).join('')}</select>`)}</div>
    <fieldset class="fs"><legend>Items from the BOQ (${code})</legend>${B.length ? B.map((b, i) => `<div class="g3"><label class="fld"><span class="fl">${esc(b.ref)} ${esc(b.desc)}</span><input type="checkbox" name="use_${i}" checked></label>${field(`Quantity (${esc(b.unit)})`, `<input name="qty_${i}" inputmode="decimal" value="${qtyInput(b.qtyM)}">`)}${field('Contract rate (₹)', `<input name="rate_${i}" inputmode="decimal" value="${moneyInput(Math.round(b.rateP * 0.62 / 100) * 100)}">`)}<input type="hidden" name="boq_${i}" value="${b.id}"></div>`).join('') : '<p class="muted">No BOQ items under this cost code.</p>'}</fieldset>
    <div class="g4">${field('Start', `<input type="date" name="start" required value="${todayISO()}">`)}${field('End', `<input type="date" name="end" required value="${addDays(todayISO(), 120)}">`)}${field('Retention %', '<input name="ret" type="number" min="0" max="20" step="0.5" value="5">')}${field('TDS %', '<input name="tds" type="number" min="0" max="10" step="0.5" value="2">')}</div>
    <div class="g3">${field('Mobilisation advance (₹)', '<input name="adv" inputmode="decimal" value="0">')}${field('Advance recovery % per bill', '<input name="rec" type="number" min="0" max="100" value="10">')}${field('GST %', '<input name="gst" type="number" min="0" max="28" step="0.5" value="18">')}</div>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Send for approval</button></div></form>`, { wide: true });
};
FORM.newContract = fd => {
  const pid = fd.get('projectId'), code = fd.get('code'); if (!currentBudget(pid)) { toast('Project has no approved budget; work orders are blocked', 'bad'); return; }
  const items = []; for (let i = 0; i < 4; i++) { if (!fd.get('use_' + i) || !fd.get('boq_' + i)) continue; const q = parseQty(fd.get('qty_' + i)), r = parseMoney(fd.get('rate_' + i)); const b = S.boq.find(x => x.id === fd.get('boq_' + i)); if (!q || !r) { toast(`Check quantity and rate for ${b.ref}`, 'bad'); return; } items.push({ id: nid('CI'), boqId: b.id, desc: b.desc, unit: b.unit, qtyM: q, rateP: r }); }
  if (!items.length) { toast('Select at least one item', 'bad'); return; }
  const c = { id: nid('WO'), projectId: pid, vendorId: fd.get('vendorId'), code, unitId: fd.get('unitId') || null, title: String(fd.get('title')).trim(), retention: Number(fd.get('ret')), advanceP: parseMoney(fd.get('adv') || '0') || 0, advRecPct: Number(fd.get('rec')), tds: Number(fd.get('tds')), gst: Number(fd.get('gst')), start: fd.get('start'), end: fd.get('end'), status: 'Pending approval', by: me().id, at: nowISO(), items, variations: [], bills: [] };
  if (c.end < c.start) { toast('End date is before start date', 'bad'); return; }
  const total = inclGst(contractValue(c), c.gst), line = cost(pid).lines.find(l => l.code === code), over = Math.max(0, total - line.avail);
  S.contracts.push(c); c.approvalId = createApproval({ type: 'CONTRACT', ref: c.id, projectId: pid, title: `${c.title} — ${vendor(c.vendorId).name}`, amountP: total, steps: poSteps(total, over, 'contracts'), ctx: { overBy: over } }).id;
  log('Work order raised', `${c.id} ${c.title}: ${fmtINR(total)}${over ? ' · over available budget by ' + fmtINR(over) : ''}`, pid, c.id); UI.ncCode = null; closeModal(); toast(`${c.id} sent for approval`); go('contracts');
};

/* ================= INVOICES & PAYMENTS ================= */
VIEWS.payments = {
  mod: 'payments', title: 'Payments',
  render() {
    const P = myProjects().filter(p => inScope(p.id)).map(p => p.id), o = outstanding(P), tab = UI.paytab || 'payables';
    const I = S.invoices.filter(i => P.includes(i.projectId)), Y = S.payments.filter(x => P.includes(x.projectId));
    const body = tab === 'invoices' ? invoicesList(I) : tab === 'paid' ? paymentsList(Y) : tab === 'retention' ? retentionList(P) : payablesList(o);
    return pageHead('Invoices & payments', `${money(o.total)} approved and unpaid${o.overdue ? ` · <span class="tbad">${money(o.overdue)} overdue</span>` : ''} · ${money(o.retention)} retention held · ${Y.filter(x => !x.reconciled).length} payments to reconcile`,
      can('payments', 'create') ? `<button class="btn primary" data-act="invNew">${ic('plus')}Record vendor invoice</button>` : '') +
      tabs([['payables', 'Payables', o.rows.length], ['invoices', 'Invoices', I.filter(i => ['On hold', 'Pending approval'].includes(i.status)).length], ['paid', 'Payments'], ['retention', 'Retention']], tab, 'paytab') + `<div class="panel">${body}</div>`;
  }
};
ACT.paytab = el => { UI.paytab = el.dataset.k; render(); };
function payablesList(o) {
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Due</th><th>Project</th><th>Vendor</th><th>Document</th><th class="num">Outstanding</th><th></th></tr></thead><tbody>
  ${o.rows.map(r => `<tr><td class="nowrap ${r.due < todayISO() ? 'tbad' : ''}">${fmtDate(r.due)}${r.due < todayISO() ? ' · overdue' : ''}</td><td>${esc(shortName(proj(r.pid)))}</td><td>${esc(vendor(r.vendorId).name)}</td><td class="sm"><button class="lnk" data-act="${r.id.startsWith('RA') ? 'bill' : 'inv'}" data-id="${r.id}">${esc(r.what)}</button></td><td class="num">${money(r.amt)}</td><td>${can('payments', 'create') ? `<button class="btn sm" data-act="payNew" data-kind="${r.id.startsWith('RA') ? 'ra_bill' : 'invoice'}" data-id="${r.id}">Pay</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6">${empty('Nothing approved and unpaid')}</td></tr>`}
  </tbody></table></section>`;
}
function invoicesList(I) {
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Invoice</th><th>Vendor</th><th>PO</th><th class="num">Total</th><th>Match</th><th>Status</th></tr></thead><tbody>
  ${[...I].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 80).map(i => `<tr class="click" data-act="inv" data-id="${i.id}" tabindex="0"><td><span class="mono sm">${i.id}</span><br><span class="sm">${esc(i.no)} · ${fmtDate(i.date)}</span></td><td>${esc(vendor(i.vendorId).name)}</td><td class="mono sm">${i.poId}</td><td class="num">${money(i.totalP)}</td><td>${i.match.length ? `<span class="bd bad">Mismatch</span>` : '<span class="bd ok">3-way matched</span>'}</td><td>${badge(i.status === 'Paid' ? 'Done' : i.status === 'On hold' ? 'Rejected' : i.status, i.status)}</td></tr>`).join('') || `<tr><td colspan="6">${empty('No invoices')}</td></tr>`}
  </tbody></table></section>`;
}
function paymentsList(Y) {
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Payment</th><th>Date</th><th>Vendor</th><th>Against</th><th class="num">Amount</th><th class="num">TDS</th><th>Bank ref</th><th>Reconciled</th></tr></thead><tbody>
  ${[...Y].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 80).map(x => `<tr><td class="mono sm">${x.id}</td><td class="nowrap">${fmtDate(x.date)}</td><td>${esc(vendor(x.vendorId).name)}</td><td class="sm">${x.kind === 'advance' ? 'Advance on ' : ''}${esc(x.ref)}</td><td class="num">${money(x.amountP)}</td><td class="num">${x.tdsP ? money(x.tdsP) : '—'}</td><td class="mono sm">${esc(x.bankRef)}</td><td>${x.reconciled ? badge('Done', 'Reconciled') : can('payments', 'edit') ? `<button class="btn sm" data-act="reconcile" data-id="${x.id}">Reconcile</button>` : badge('Pending', 'Open')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No payments')}</td></tr>`}
  </tbody></table></section>`;
}
function retentionList(P) {
  const C = S.contracts.filter(c => P.includes(c.projectId)).map(c => ({ c, r: sum(c.bills.filter(b => BILL_COST.includes(b.status)).map(b => b.retentionP)) })).filter(x => x.r > 0);
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Work order</th><th>Contractor</th><th class="num">Retention held</th><th>Release</th></tr></thead><tbody>${C.map(({ c, r }) => `<tr><td class="mono sm">${c.id}</td><td>${esc(vendor(c.vendorId).name)}</td><td class="num">${money(r)}</td><td class="sm">Half at completion, half after the defects-liability period</td></tr>`).join('') || `<tr><td colspan="4">${empty('No retention held')}</td></tr>`}</tbody></table></section>`;
}
ACT.inv = el => showModal('inv', el.dataset.id);
MODALS.inv = id => {
  const i = S.invoices.find(x => x.id === id), po = S.pos.find(x => x.id === i.poId), ap = S.approvals.find(a => a.id === i.approvalId), acc = sum(po.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM));
  openModal(`${i.id} · invoice ${esc(i.no)}`, `<div class="kv2"><div><span class="kl">Vendor</span>${esc(vendor(i.vendorId).name)}</div><div><span class="kl">Status</span>${badge(i.status === 'Paid' ? 'Done' : i.status === 'On hold' ? 'Rejected' : i.status, i.status)}</div>
    <div><span class="kl">Invoice date</span>${fmtDate(i.date)}${i.dueDate ? ` · due ${fmtDate(i.dueDate)}` : ''}</div><div><span class="kl">Total</span><b>${money(i.totalP)}</b></div></div>
    <h3 class="h3">Three-way match</h3><table class="t"><thead><tr><th></th><th class="num">Order (${po.id})</th><th class="num">Receipt (QC passed)</th><th class="num">Invoice</th></tr></thead><tbody>
      <tr><td>Quantity</td><td class="num">${fmtQty(po.qtyM)} ${esc(po.unit)}</td><td class="num">${fmtQty(acc)}</td><td class="num ${i.match.some(m => m.includes('exceeds')) ? 'tbad' : ''}">${fmtQty(i.qtyM)}</td></tr>
      <tr><td>Rate</td><td class="num">${money(po.rateP)}</td><td class="num">—</td><td class="num ${i.match.some(m => m.startsWith('rate')) ? 'tbad' : ''}">${money(i.rateP)}</td></tr>
      <tr><td>GST</td><td class="num">${po.gst}%</td><td class="num">—</td><td class="num">${i.gst}%</td></tr></tbody></table>
    ${i.match.length ? `<p class="note bad"><b>On hold:</b> ${i.match.map(esc).join('; ')}. Ask the vendor for a corrected invoice or a credit note; it cannot be approved or paid as it stands.</p>` : '<p class="note ok">Order, receipt and invoice agree.</p>'}
    ${ap ? chainHTML(ap) + (ap.status === 'Pending' ? (canAct(ap) ? decideButtons(ap) : demoSwitch(ap)) : '') : ''}
    <div class="fa">${i.status === 'On hold' && can('payments', 'edit') ? `<button class="btn ghost danger" data-act="invReject" data-id="${i.id}">Reject invoice</button>` : ''}${i.status === 'Approved' && can('payments', 'create') ? `<button class="btn primary" data-act="payNew" data-kind="invoice" data-id="${i.id}">Record payment</button>` : ''}</div>`, { wide: true, sub: esc(proj(i.projectId).name) });
};
ACT.invReject = el => { const i = S.invoices.find(x => x.id === el.dataset.id); i.status = 'Rejected'; log('Invoice rejected', `${i.id} (${i.no}) rejected after failed match`, i.projectId, i.id); toast('Invoice rejected'); refresh(); };
ACT.invNew = () => showModal('invNew');
CHG.invPo = el => keepValues(() => { UI.invPo = el.value; MODALS.invNew(); });
MODALS.invNew = () => {
  const P = myProjects().map(p => p.id), POs = S.pos.filter(x => P.includes(x.projectId) && x.grns.some(g => g.qc === 'Pass')), po = POs.find(x => x.id === UI.invPo) || POs[0];
  if (!po) { openModal('Record vendor invoice', empty('No purchase orders with accepted receipts yet')); return; }
  openModal('Record vendor invoice', `<form data-form="invNew" class="form">${field('Purchase order', `<select name="po" data-chg="invPo">${POs.map(x => opt(x.id, `${x.id} · ${x.item} · ${vendor(x.vendorId).name}`, po.id)).join('')}</select>`, `Accepted ${fmtQty(sum(po.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)))} ${esc(po.unit)} · already invoiced ${fmtQty(sum(S.invoices.filter(i => i.poId === po.id && i.status !== 'Rejected').map(i => i.qtyM)))}`)}
    <div class="g2">${field('Vendor invoice number', '<input name="no" required maxlength="40" autofocus>')}${field('Invoice date', `<input type="date" name="date" required max="${todayISO()}" value="${todayISO()}">`)}</div>
    <div class="g3">${field(`Quantity (${esc(po.unit)})`, '<input name="qty" required inputmode="decimal">')}${field('Rate (₹)', `<input name="rate" required inputmode="decimal" value="${moneyInput(po.rateP)}">`)}${field('GST %', `<input name="gst" type="number" min="0" max="28" step="0.5" value="${po.gst}">`)}</div>
    <p class="fine">The invoice is matched against the order and the QC-passed receipts. A mismatch puts it on hold; a duplicate invoice number from the same vendor is refused.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Record & match</button></div></form>`);
};
FORM.invNew = fd => {
  const po = S.pos.find(x => x.id === fd.get('po')), no = String(fd.get('no')).trim(), q = parseQty(fd.get('qty')), r = parseMoney(fd.get('rate')), g = Number(fd.get('gst'));
  if (!q || !r) { toast('Enter quantity and rate', 'bad'); return; }
  const key = norm(no).replace(/ /g, ''); const dup = S.invoices.find(i => i.vendorId === po.vendorId && norm(i.no).replace(/ /g, '') === key);
  if (dup) { toast(`Duplicate: ${dup.id} already books invoice ${dup.no} from this vendor`, 'bad'); return; }
  const n = matchInvoice(po, q, r, g), amountP = lineAmt(q, r), taxP = gstOf(amountP, g);
  const i = { id: nid('INV'), poId: po.id, projectId: po.projectId, vendorId: po.vendorId, no, date: fd.get('date'), qtyM: q, rateP: r, gst: g, amountP, taxP, totalP: amountP + taxP, match: n, status: n.length ? 'On hold' : 'Pending approval', by: me().id, at: nowISO(), dueDate: null };
  S.invoices.push(i);
  if (!n.length) i.approvalId = createApproval({ type: 'INVOICE', ref: i.id, projectId: po.projectId, title: `Invoice ${no} on ${po.id} — ${vendor(po.vendorId).name}`, amountP: i.totalP, steps: invoiceSteps(i.totalP) }).id;
  log('Invoice recorded', `${i.id} (${no}) ${fmtINR(i.totalP)} · ${n.length ? 'on hold: ' + n.join('; ') : 'three-way matched'}`, po.projectId, i.id);
  UI.invPo = null; closeModal(); toast(n.length ? 'Invoice on hold — match failed' : 'Invoice matched and sent for approval', n.length ? 'bad' : 'ok'); UI.paytab = 'invoices'; refresh(false);
};
ACT.payNew = el => showModal('payNew', el.dataset.kind + '|' + el.dataset.id);
MODALS.payNew = key => {
  const [kind, id] = key.split('|'); let max = 0, tdsMax = 0, title = '', vid;
  if (kind === 'invoice') { const i = S.invoices.find(x => x.id === id); max = i.totalP - invPaid(id); title = `Invoice ${i.no}`; vid = i.vendorId; }
  else if (kind === 'ra_bill') { const c = S.contracts.find(x => x.bills.some(b => b.id === id)), b = c.bills.find(x => x.id === id); max = b.netP - billPaid(id); tdsMax = b.tdsP - billTdsPaid(id); title = `${b.id} RA ${b.no}`; vid = c.vendorId; }
  else { const c = S.contracts.find(x => x.id === id); max = c.advanceP - advancePaid(id); title = `Advance on ${c.id}`; vid = c.vendorId; }
  openModal('Record payment', `<form data-form="payNew" data-key="${key}" class="form"><p class="sm">${esc(title)} · ${esc(vendor(vid).name)} · outstanding <b>${fmtINR(max)}</b></p>
    <div class="g3">${field('Amount (₹)', `<input name="amt" required inputmode="decimal" value="${moneyInput(max)}">`)}${kind === 'ra_bill' ? field('TDS deposited (₹)', `<input name="tds" inputmode="decimal" value="${moneyInput(tdsMax)}">`) : '<input type="hidden" name="tds" value="0">'}${field('Paid on', `<input type="date" name="date" required max="${todayISO()}" value="${todayISO()}">`)}</div>
    ${field('Bank reference (UTR / cheque no.)', '<input name="ref" required minlength="4" maxlength="40" autofocus>')}
    <p class="fine">Payments cannot exceed the approved amount, and a bank reference is used once per vendor. The person who booked an invoice cannot pay it.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Record payment</button></div></form>`);
};
FORM.payNew = (fd, f) => {
  const [kind, id] = f.dataset.key.split('|'), amt = parseMoney(fd.get('amt')), tds = parseMoney(fd.get('tds') || '0') || 0, ref = String(fd.get('ref')).trim();
  if (!amt) { toast('Enter the amount paid', 'bad'); return; }
  let pid, vid, max, tdsMax = 0;
  if (kind === 'invoice') { const i = S.invoices.find(x => x.id === id); if (i.status !== 'Approved') { toast('Only approved invoices can be paid', 'bad'); return; } if (i.by === me().id) { toast('The person who booked the invoice cannot also pay it', 'bad'); return; } pid = i.projectId; vid = i.vendorId; max = i.totalP - invPaid(id); }
  else if (kind === 'ra_bill') { const c = S.contracts.find(x => x.bills.some(b => b.id === id)), b = c.bills.find(x => x.id === id); if (b.status !== 'Approved') { toast('Only approved bills can be paid', 'bad'); return; } pid = c.projectId; vid = c.vendorId; max = b.netP - billPaid(id); tdsMax = b.tdsP - billTdsPaid(id); }
  else { const c = S.contracts.find(x => x.id === id); if (c.status !== 'Active') { toast('Contract is not active', 'bad'); return; } pid = c.projectId; vid = c.vendorId; max = c.advanceP - advancePaid(id); }
  if (amt > max) { toast(`Overpayment: only ${fmtINR(max)} is outstanding`, 'bad'); return; }
  if (tds > tdsMax) { toast(`TDS exceeds the bill's remaining deduction of ${fmtINR(tdsMax)}`, 'bad'); return; }
  if (S.payments.some(x => x.vendorId === vid && x.bankRef.toLowerCase() === ref.toLowerCase())) { toast('That bank reference is already used for this vendor', 'bad'); return; }
  const x = { id: nid('PAY'), kind, ref: id, projectId: pid, vendorId: vid, amountP: amt, tdsP: tds, date: fd.get('date'), bankRef: ref, reconciled: false, by: me().id }; S.payments.push(x);
  if (kind === 'invoice' && amt === max) S.invoices.find(i => i.id === id).status = 'Paid';
  if (kind === 'ra_bill' && amt === max) S.contracts.find(c => c.bills.some(b => b.id === id)).bills.find(b => b.id === id).status = 'Paid';
  log('Payment recorded', `${x.id}: ${fmtINR(amt)}${tds ? ' + TDS ' + fmtINR(tds) : ''} against ${id} · ${ref}`, pid, x.id); closeModal(); toast('Payment recorded'); refresh(false);
};
ACT.reconcile = el => { const x = S.payments.find(p => p.id === el.dataset.id); x.reconciled = true; x.reconciledAt = nowISO(); x.reconciledBy = me().id; log('Payment reconciled', `${x.id} (${x.bankRef}) matched to bank statement`, x.projectId, x.id); toast('Reconciled'); refresh(false); };

/* ================= REPORTS ================= */
VIEWS.reports = {
  mod: 'dashboard', title: 'Reports', allowed: () => can('dashboard') || can('budget'),
  render() {
    const P = cmdProjects(), pids = P.map(p => p.id), fin = can('budget'), tab = UI.rtab || (fin ? 'cost' : 'contractors');
    const T = [fin && ['cost', 'Cost'], fin && can('payments') && ['cash', 'Cash flow'], fin && can('payments') && ['payables', 'Payables'], fin && ['hospitality', 'Hospitality metrics'], fin && ['profit', 'Profitability'], fin && ['intel', 'Financial intelligence'], ['exec', 'Executive reports'], ['contractors', 'Contractors'], ['scores', 'Contractor scores'], ['procurement', 'Procurement'], ['risks', 'Risks']].filter(Boolean);
    if (!T.some(t => t[0] === tab)) UI.rtab = T[0][0];
    const body = { cost: repCost, cash: repCash, payables: () => payablesList(outstanding(pids)), hospitality: repHospitality, profit: repProfit, contractors: repContractors, procurement: repProcurement, risks: repRisks, intel: repIntel, scores: repScores, exec: repExec }[UI.rtab || tab](P);
    return pageHead('Reports', `Calculated from transactions for ${P.length} project${P.length === 1 ? '' : 's'} · filters from the command center apply`, `<button class="btn" data-act="exportReport">Export</button>`) + filterBar() + tabs(T, UI.rtab || tab, 'rtab') + `<div class="panel">${body}</div>`;
  }
};
ACT.rtab = el => { UI.rtab = el.dataset.k; render(); };
const REP_ROWS = {};
function repCost(P) {
  const rows = P.map(p => ({ p, c: cost(p.id), k: contingency(p.id), e: earned(p.id), s: sched(p.id) })); REP_ROWS.cost = rows;
  const H = ['Original budget', 'Approved changes', 'Current budget', 'Actual', 'Committed', 'Accrued unpaid', 'Uncommitted forecast', 'Forecast total', 'Variance', 'Contingency available'];
  return `<section class="card flush"><div class="scroll"><table class="t wide pf1"><thead><tr><th>Project</th>${H.map(h => `<th class="num">${h}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(({ p, c, k }) => `<tr class="click" ${drill('p-' + p.id.toLowerCase(), { ptab: 'cost' })} tabindex="0"><td><b>${esc(p.name)}</b>${c.version ? '' : '<br><span class="sm twarn">budget awaiting approval</span>'}</td>${[c.tot.original, c.tot.changes, c.tot.budget, c.tot.actual, c.tot.committed, c.tot.accrued, c.tot.etc, c.tot.fac, c.tot.variance, k.available].map((v, i) => `<td class="num ${i === 6 ? 'est' : ''} ${(i === 8 || i === 9) && v < 0 ? 'tbad' : ''}">${fmtINR(v)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div><div class="pad"><p class="fine"><b>Formulas.</b> Current budget = latest approved version; approved changes = current − original. Committed = approved purchase orders + active work orders + approved variations. Actual = QC-passed receipts + approved running bills (incl. GST); actual is part of committed and never added twice. Accrued unpaid = actual − paid − retention held. Forecast total = committed + uncommitted forecast (the QS estimate, shown in italics). Contingency available = contingency budget − contingency commitments − overruns on other codes.</p></div></section>
  <section class="card"><h2 class="h2">Physical progress, earned value and spend are separate measures</h2><table class="t stack"><thead><tr><th>Project</th><th class="num">Schedule progress</th><th class="num">Measured work (BOQ earned value)</th><th class="num">Spend (actual ÷ forecast)</th></tr></thead><tbody>
    ${rows.map(({ p, c, e, s }) => `<tr><td>${esc(p.name)}</td><td class="num">${s.earned.toFixed(0)}%</td><td class="num">${e.pct.toFixed(0)}% · ${fmtC(e.ev)}</td><td class="num">${c.tot.fac ? Math.round(pctOf(c.tot.actual, c.tot.fac)) : 0}%</td></tr>`).join('')}</tbody></table>
    <p class="fine">Schedule progress weights activities by duration. Earned value prices verified BOQ quantities at BOQ rates. Spend is recorded cost. They diverge when materials are bought ahead of use or work is done before it is billed.</p></section>`;
}
function repCash(P) {
  const cr = cashReq(P.map(p => p.id), Number(UI.period || 90)); REP_ROWS.cash = cr.lines; const mx = Math.max(1, ...cr.buckets.map(b => b.due + b.forecast));
  return `<section class="card"><h2 class="h2">Cash requirement · next ${UI.period || 90} days</h2>
    ${cr.buckets.map(b => `<div class="cashrow"><span class="sm"><b>${b.label}</b></span><span class="cbar"><i class="due" style="width:${(b.due / mx * 100).toFixed(1)}%"></i><i class="fc" style="width:${(b.forecast / mx * 100).toFixed(1)}%"></i></span><span class="sm num">${fmtC(b.due)} due · ${fmtC(b.forecast)} forecast</span></div>`).join('')}
    <p class="legend"><span><i class="lg a"></i>Due: approved invoices and bills not yet paid</span><span><i class="lg e"></i>Forecast: undelivered orders and unbilled contract work</span></p></section>
  <section class="card flush"><table class="t stack"><thead><tr><th>Date</th><th>Kind</th><th>Project</th><th>Source</th><th class="num">Amount</th></tr></thead><tbody>${[...cr.lines].filter(l => l.amt > 0 && diffDays(todayISO(), l.d) <= Number(UI.period || 90)).sort((a, b) => (a.d < b.d ? -1 : 1)).slice(0, 60).map(l => `<tr><td class="nowrap">${fmtDate(l.d)}</td><td>${l.k === 'due' ? badge('Pending', 'Due') : badge('Draft', 'Forecast')}</td><td>${esc(shortName(proj(l.pid)))}</td><td class="sm">${esc(l.what)}</td><td class="num">${fmtINR(l.amt)}</td></tr>`).join('')}</tbody></table></section>`;
}
function repHospitality(P) {
  const rows = P.map(p => { const c = cost(p.id).tot, L = cost(p.id).lines, U = S.units.filter(u => u.projectId === p.id), R = U.map(readiness), keys = p.keys || 1;
    return { p, fac: c.fac, perKey: c.fac / keys, ffePerKey: (L.find(l => l.code === '12')?.fac || 0) / keys, sqft: p.builtUpSqft ? c.fac / p.builtUpSqft : null, infra: sum(L.filter(l => ['07', '10'].includes(l.code)).map(l => l.fac)), units: U.length, ready: R.filter(r => ['Ready', 'Handed over'].includes(r.status)).length, verified: U.length ? sum(R.map(r => r.pct)) / U.length : 0 }; });
  REP_ROWS.hosp = rows;
  return `<section class="card flush"><div class="scroll"><table class="t wide pf1"><thead><tr><th>Project</th><th class="num">Forecast cost per key</th><th class="num">FF&E per key</th><th class="num">Cost per sq ft built-up</th><th class="num">Infrastructure (MEP + external)</th><th class="num">Units ready</th><th class="num">Verified stages</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.p.name)}</b><br><span class="sm muted">${r.p.keys} keys · ${esc(r.p.type)}</span></td><td class="num">${fmtC(r.perKey)}</td><td class="num">${fmtC(r.ffePerKey)}</td><td class="num">${r.sqft ? fmtINR(Math.round(r.sqft / 100) * 100) : '—'}</td><td class="num">${fmtC(r.infra)}</td><td class="num">${r.ready}/${r.units}</td><td class="num">${r.verified.toFixed(0)}%</td></tr>`).join('')}</tbody></table></div>
    <div class="pad"><p class="fine">Cost figures use the forecast total (committed + estimate). Readiness counts only units whose stages, defects, FF&E, commissioning and final inspection have all passed.</p></div></section>`;
}
function repProfit(P) {
  const rows = P.map(p => { const c = cost(p.id).tot, cv = p.contractValueP || 0; return { p, cv, fac: c.fac, actual: c.actual, margin: cv - c.fac, pct: cv ? (cv - c.fac) * 100 / cv : 0 }; }); REP_ROWS.profit = rows;
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Project</th><th class="num">Client contract value</th><th class="num">Forecast total cost</th><th class="num">Forecast margin</th><th class="num">Margin %</th><th class="num">Invested to date (actual)</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.p.name)}</b></td><td class="num">${r.cv ? fmtINR(r.cv) : '—'}</td><td class="num">${fmtINR(r.fac)}</td><td class="num ${r.margin < 0 ? 'tbad' : 'tok'}">${r.cv ? fmtINR(r.margin) : '—'}</td><td class="num ${r.pct < 5 ? 'tbad' : ''}">${r.cv ? r.pct.toFixed(1) + '%' : '—'}</td><td class="num">${fmtINR(r.actual)}</td></tr>`).join('')}</tbody></table>
    <div class="pad"><p class="fine">Margin is a forecast: contract value less forecast total cost. Client variations are not yet modelled; add them to contract value when approved.</p></div></section>`;
}
function contractorStats(pids) {
  return S.vendors.map(v => {
    const C = S.contracts.filter(c => c.vendorId === v.id && pids.includes(c.projectId)); if (!C.length) return null;
    const T = S.tasks.filter(t => t.contractorId === v.id && pids.includes(t.projectId)), late = T.filter(t => { const r = sched(t.projectId).R[t.id]; return r && (r.var > 0 || (t.actFinish && t.actFinish > t.baseFinish)); });
    const due = T.filter(t => t.baseFinish <= todayISO()), onTime = due.filter(t => t.actFinish && t.actFinish <= t.baseFinish).length;
    const snags = S.snags.filter(s => s.vendorId === v.id && s.status !== 'Closed' && pids.includes(s.projectId)).length;
    const bills = C.flatMap(c => c.bills), certDays = bills.filter(b => b.status !== 'In approval').map(b => { const a = S.approvals.find(x => x.id === b.approvalId); return a && a.closedAt ? diffDays(a.at.slice(0, 10), a.closedAt.slice(0, 10)) : null; }).filter(x => x != null);
    return { v, contracts: C.length, value: sum(C.map(contractTotal)), late: late.length, tasks: T.length, onTime: due.length ? onTime * 100 / due.length : null, snags, certDays: certDays.length ? sum(certDays) / certDays.length : null };
  }).filter(Boolean).sort((a, b) => b.late - a.late || b.snags - a.snags);
}
function repContractors(P) {
  const rows = contractorStats(P.map(p => p.id)); REP_ROWS.contractors = rows;
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Contractor</th><th class="num">Work orders</th>${can('budget') ? '<th class="num">Value</th>' : ''}<th class="num">Activities late or finished late</th><th class="num">On-time finish rate</th><th class="num">Open defects</th><th class="num">Avg. bill certification</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.v.name)}</b><br><span class="sm muted">${esc(r.v.category)}</span></td><td class="num">${r.contracts}</td>${can('budget') ? `<td class="num">${fmtC(r.value)}</td>` : ''}<td class="num ${r.late ? 'tbad' : ''}">${r.late} of ${r.tasks}</td><td class="num">${r.onTime == null ? '—' : r.onTime.toFixed(0) + '%'}</td><td class="num ${r.snags ? 'twarn' : ''}">${r.snags}</td><td class="num">${r.certDays == null ? '—' : r.certDays.toFixed(1) + ' days'}</td></tr>`).join('') || `<tr><td colspan="7">${empty('No contractors in view')}</td></tr>`}</tbody></table>
    <div class="pad"><p class="fine">Computed from activities assigned to each contractor, defects assigned to them and the time their bills spent in certification. Ratings are not typed in.</p></div></section>`;
}
function bottlenecks(pids) {
  const now = Date.now(), today = todayISO(), X = [];
  S.mrs.filter(m => pids.includes(m.projectId) && ['Submitted', 'Quoting'].includes(m.status) && (now - Date.parse(m.at)) / 864e5 > 3).forEach(m => X.push({ kind: 'Request ageing', id: m.id, what: m.item, pid: m.projectId, days: Math.floor((now - Date.parse(m.at)) / 864e5), act: 'mr' }));
  S.pos.filter(x => pids.includes(x.projectId) && x.status === 'Pending approval' && (now - Date.parse(x.at)) / 864e5 > 2).forEach(x => X.push({ kind: 'Order awaiting approval', id: x.id, what: x.item, pid: x.projectId, days: Math.floor((now - Date.parse(x.at)) / 864e5), act: 'po' }));
  S.pos.filter(x => pids.includes(x.projectId) && ['Approved', 'Part received'].includes(x.status) && x.expected && x.expected < today).forEach(x => X.push({ kind: 'Late delivery', id: x.id, what: x.item, pid: x.projectId, days: diffDays(x.expected, today), act: 'po' }));
  S.mrs.filter(m => pids.includes(m.projectId) && MR_OPEN.includes(m.status) && m.neededBy <= addDays(today, 7)).forEach(m => X.push({ kind: 'Needed within 7 days, no order', id: m.id, what: m.item, pid: m.projectId, days: diffDays(today, m.neededBy), act: 'mr' }));
  return X.sort((a, b) => b.days - a.days);
}
function repProcurement(P) {
  const X = bottlenecks(P.map(p => p.id)); REP_ROWS.proc = X;
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Bottleneck</th><th>Record</th><th>Project</th><th>Item</th><th class="num">Days</th></tr></thead><tbody>${X.map(x => `<tr class="click" data-act="${x.act}" data-id="${x.id}" tabindex="0"><td>${esc(x.kind)}</td><td class="mono sm">${x.id}</td><td>${esc(shortName(proj(x.pid)))}</td><td>${esc(x.what)}</td><td class="num">${x.days}</td></tr>`).join('') || `<tr><td colspan="5">${empty('No procurement bottlenecks')}</td></tr>`}</tbody></table></section>`;
}
function repRisks(P) {
  const R = S.risks.filter(r => P.some(p => p.id === r.projectId)); REP_ROWS.risks = R;
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Risk</th><th>Project</th><th>Source</th><th>Severity</th><th>Status</th><th></th></tr></thead><tbody>${R.map(r => `<tr><td class="mono sm">${r.id}</td><td>${esc(shortName(proj(r.projectId)))}</td><td class="sm">${esc(r.title)}</td><td>${badge(r.severity === 'High' ? 'Rejected' : 'Pending', r.severity)}</td><td>${badge(r.status === 'Closed' ? 'Done' : 'Pending', r.status)}</td><td>${r.status !== 'Closed' && can('projects', 'edit') ? `<button class="btn sm ghost" data-act="riskClose" data-id="${r.id}">Close</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6">${empty('No open risks')}</td></tr>`}</tbody></table>
  <div class="pad"><p class="fine">Risks are created by the automation rules (budget overrun, critical delay, safety-critical defect) and de-duplicated per week.</p></div></section>`;
}
ACT.riskClose = el => { const r = S.risks.find(x => x.id === el.dataset.id); r.status = 'Closed'; log('Risk closed', r.title, r.projectId, r.id); refresh(false); };
ACT.exportReport = () => {
  const t = UI.rtab || 'cost'; let rows;
  if (t === 'cost') rows = [['Project', 'Original budget ₹', 'Approved changes ₹', 'Current budget ₹', 'Actual ₹', 'Committed ₹', 'Accrued unpaid ₹', 'Uncommitted forecast ₹', 'Forecast total ₹', 'Variance ₹', 'Contingency available ₹'], ...(REP_ROWS.cost || []).map(({ p, c, k }) => [p.name, ...[c.tot.original, c.tot.changes, c.tot.budget, c.tot.actual, c.tot.committed, c.tot.accrued, c.tot.etc, c.tot.fac, c.tot.variance, k.available].map(v => (v / 100).toFixed(2))])];
  else if (t === 'cash') rows = [['Date', 'Kind', 'Project', 'Source', 'Amount ₹'], ...(REP_ROWS.cash || []).filter(l => l.amt > 0).map(l => [l.d, l.k, l.pid, l.what, (l.amt / 100).toFixed(2)])];
  else if (t === 'hospitality') rows = [['Project', 'Cost per key ₹', 'FF&E per key ₹', 'Cost per sq ft ₹', 'Units ready', 'Units'], ...(REP_ROWS.hosp || []).map(r => [r.p.name, (r.perKey / 100).toFixed(0), (r.ffePerKey / 100).toFixed(0), r.sqft ? (r.sqft / 100).toFixed(0) : '', r.ready, r.units])];
  else if (t === 'profit') rows = [['Project', 'Contract value ₹', 'Forecast cost ₹', 'Margin ₹', 'Margin %'], ...(REP_ROWS.profit || []).map(r => [r.p.name, (r.cv / 100).toFixed(2), (r.fac / 100).toFixed(2), (r.margin / 100).toFixed(2), r.pct.toFixed(1)])];
  else if (t === 'contractors') rows = [['Contractor', 'Work orders', 'Late activities', 'Activities', 'On-time %', 'Open defects', 'Avg certification days'], ...(REP_ROWS.contractors || []).map(r => [r.v.name, r.contracts, r.late, r.tasks, r.onTime == null ? '' : r.onTime.toFixed(0), r.snags, r.certDays == null ? '' : r.certDays.toFixed(1)])];
  else if (t === 'procurement') rows = [['Bottleneck', 'Record', 'Project', 'Item', 'Days'], ...(REP_ROWS.proc || []).map(x => [x.kind, x.id, x.pid, x.what, x.days])];
  else if (t === 'risks') rows = [['Risk', 'Project', 'Title', 'Severity', 'Status'], ...(REP_ROWS.risks || []).map(r => [r.id, r.projectId, r.title, r.severity, r.status])];
  else { const o = outstanding(cmdProjects().map(p => p.id)); rows = [['Due', 'Project', 'Document', 'Outstanding ₹'], ...o.rows.map(r => [r.due, r.pid, r.what, (r.amt / 100).toFixed(2)])]; }
  exportCSV(`report-${t}-${todayISO()}.csv`, rows, 'Report');
};
