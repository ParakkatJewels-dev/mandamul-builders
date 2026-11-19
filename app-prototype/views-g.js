/* Views G — Phase 3: alerts engine and action center, playbooks (delay impact, shortage check, unit completion),
   digital twin, financial intelligence and scenarios, contractor scores, procurement planning and RFQ drafts,
   executive reports with review before distribution, mobile additions. Same rules as the database build
   (supabase/migrations/20261119001000–1300); the database is the production engine, this is the demo of the screens. */

/* ---------- B17: the cost engine is computed once per project per render, not 25 times ---------- */
let COST_V = 0, COST_C = { v: -1 };
const _cost0 = cost;
cost = function (pid) { if (COST_C.v !== COST_V) COST_C = { v: COST_V }; return COST_C[pid] || (COST_C[pid] = _cost0(pid)); };
const _save0 = save;
save = function () { COST_V++; return _save0(); };
const costFresh = () => { COST_V++; };
Object.assign(ICONS, { refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', layers: 'M12 3 2 8l10 5 10-5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5', flag: 'M5 21V4h11l-2 4 2 4H5' });

/* ---------- Phase 3 demo data, added to existing data without replacing it ---------- */
const CODE_TASKS = { '02': ['T04', 'T05'], '03': ['T06', 'T07'], '04': ['T10'], '05': ['T08'], '06': ['T09', 'T15'], '07': ['T09', 'T15'], '08': ['T11'], '09': ['T12'], '10': ['T13'], '11': ['T14'] };
const SCENARIOS = [
  { name: 'Best', etc: 0.95, pv: 50, delay: -15, note: 'Remaining work 5% below estimate; half of pending variations approved; 15 days of the forecast delay recovered' },
  { name: 'Base', etc: 1.0, pv: 75, delay: 0, note: 'Remaining work as estimated; three quarters of pending variations approved; delay as forecast' },
  { name: 'Worst', etc: 1.15, pv: 100, delay: 30, note: 'Remaining work 15% above estimate; all pending variations approved; a further 30 days of delay' }];
const SCORE_W = [
  ['on_time', 'On-time finish', 25, 3, '% of finished activities finished by their baseline date'],
  ['productivity', 'Productivity', 15, 1, 'certified quantity ÷ quantity planned to date × 100 (max 100)'],
  ['rework', 'Rework', 15, 5, '100 − 5 × % of inspections failed'],
  ['defects', 'Defects', 15, 1, '100 − 10 × defects per ₹1 crore certified'],
  ['safety', 'Safety', 10, 1, '100 − 25 × safety-critical defects'],
  ['variations', 'Variations', 5, 1, '100 − 2 × approved variations as % of original value'],
  ['claims', 'Claim accuracy', 10, 1, 'average certified ÷ claimed × 100'],
  ['response', 'Response to defects', 5, 3, '100 − 5 × average days to fix'],
  ['wastage', 'Material wastage', 0, 1, 'not measured yet: needs consumption norms per BOQ item']];
function ensurePhase3() {
  if (!S || S.p3) return;
  S.p3 = 1; S.zones = []; S.buildings = []; S.floors = []; S.wps = []; S.alerts = []; S.actions = []; S.reportRuns = []; S.rfqs = []; S.photos = S.photos || [];
  S.scenarios = SCENARIOS.map(x => ({ ...x })); S.scoreW = SCORE_W.map(([k, l, w, m, f]) => ({ k, l, w, min: m, f }));
  for (const p of S.projects) {
    const zone = (code, name, kind) => { const z = { id: nid('ZN'), projectId: p.id, code, name, kind }; S.zones.push(z); return z; };
    const zv = zone('Z-GU', 'Guest accommodation', 'Villas'), za = zone('Z-AM', 'Guest amenities', 'Amenities'), zl = zone('Z-EX', 'Landscape & external works', 'Landscape'), zu = zone('Z-UT', 'Utilities & services', 'Utilities');
    for (const u of S.units.filter(u => u.projectId === p.id)) {
      const z = ['amenity', 'pool'].includes(u.template) ? za : zv;
      const b = { id: nid('BL'), projectId: p.id, zoneId: z.id, code: 'B-' + u.code, name: u.name }; S.buildings.push(b);
      const f = { id: nid('FL'), buildingId: b.id, level: 0, name: 'Ground' }; S.floors.push(f);
      Object.assign(u, { zoneId: z.id, buildingId: b.id, floorId: f.id });
    }
    for (const c of S.contracts.filter(c => c.projectId === p.id)) {
      const u = c.unitId && S.units.find(x => x.id === c.unitId);
      const z = u ? S.zones.find(x => x.id === u.zoneId) : c.code === '10' ? zl : ['06', '07'].includes(c.code) ? zu : c.code === '11' ? za : zv;
      const w = { id: nid('WP'), projectId: p.id, code: 'WP-' + c.id.split('-').pop(), name: c.title, zoneId: z.id, unitId: c.unitId || null, contractId: c.id };
      S.wps.push(w); c.wpId = w.id;
      for (const k of CODE_TASKS[c.code] || []) { const t = S.tasks.find(t => t.projectId === p.id && t.key === k); if (t && !t.wpId) { t.wpId = w.id; t.contractorId = t.contractorId || c.vendorId; } }
    }
  }
  const r = S.rules.find(x => x.event === 'critical_delay'); if (r) r.enabled = false;   // replaced by the impact-based delay playbook, as in the database
  save();
}

/* ---------- alerts: one per condition, owner notified only when new or more severe ---------- */
const SEV = { Critical: 4, High: 3, Medium: 2, Info: 1 };
const CAT_MOD = { Budget: 'budget', Schedule: 'schedule', Material: 'procurement', Quality: 'quality', Contractor: 'contracts', Payment: 'approvals', Safety: 'quality', Permit: 'documents', Handover: 'handover' };
function alertOwners(x) { return x.owner ? [x.owner] : S.users.filter(u => u.active !== false && u.role === x.ownerRole && (!x.pid || hasProject(x.pid, u))).map(u => u.id); }
function raiseAlert(a) {
  let x = S.alerts.find(y => y.key === a.key), fresh = false;
  if (!x) { x = { id: nid('AL'), status: 'Open', at: nowISO(), notified: null, ...a }; S.alerts.unshift(x); fresh = true; }
  else {
    const up = SEV[a.sev] > SEV[x.sev];
    Object.assign(x, { title: a.title, detail: a.detail, records: a.records, next: a.next, due: a.due || x.due, owner: a.owner || x.owner });
    if (up) x.sev = a.sev;
    if (x.status === 'Resolved') { x.status = 'Open'; x.notified = null; x.at = nowISO(); }
    if (x.status === 'Suppressed' && x.until < nowISO()) x.status = 'Open';
  }
  if (x.status === 'Open' && x.sev !== 'Info' && SEV[x.sev] > SEV[x.notified || 'Info']) { notify(alertOwners(x), `[${x.sev}] ${x.title} — ${x.next}`, 'alerts'); x.notified = x.sev; x.changed = true; }
  return { x, fresh };
}
function clearAlert(key, why) { const x = S.alerts.find(y => y.key === key && y.status !== 'Resolved'); if (x) { x.status = 'Resolved'; x.resolvedAt = nowISO(); x.resolution = why; } }
function trace(pb, key, pid, steps) {   // every automated step is kept with what it found
  S.actions = S.actions || []; S.actions.unshift({ id: nid('AC'), at: nowISO(), pb, key, pid, steps }); if (S.actions.length > 300) S.actions.length = 300;
}

/* the delay forecast with extra days on one activity (what-if); extra duration survives the forward pass */
function whatIf(pid, tid, days) {
  const T = S.tasks.filter(t => t.projectId === pid), today = todayISO(), p = proj(pid), R = {};
  for (const t of topo(T)) {
    const pf = t.preds.map(x => R[x]?.ff).filter(Boolean), predMax = pf.length ? maxISO(pf) : p.start, ex = t.id === tid && !t.actFinish ? days : 0;
    let fs, ff;
    if (t.actFinish) { fs = t.actStart || t.baseStart; ff = t.actFinish; }
    else if (t.actStart) { fs = t.actStart; ff = addDays(today, Math.max(Math.ceil(t.dur * (100 - t.progress) / 100), 0) + ex); if (ff < fs) ff = fs; }
    else { fs = maxISO([today, t.baseStart, predMax]); ff = addDays(fs, t.dur + ex); }
    R[t.id] = { ff };
  }
  const s = sched(pid);
  return T.filter(t => t.milestone).map(t => ({ t, now: s.R[t.id].ff, then: R[t.id].ff, extra: diffDays(s.R[t.id].ff, R[t.id].ff) }));
}

function alertScan() {
  if (!S.alerts) return 0;
  const today = todayISO(), n0 = S.alerts.length, live = new Set();
  const keep = a => { live.add(a.key); return raiseAlert(a); };
  for (const p of S.projects.filter(p => !['Handed over', 'On hold'].includes(p.stage))) {
    const s = sched(p.id), succ = {};
    s.tasks.forEach(t => t.preds.forEach(x => (succ[x] = succ[x] || []).push(t.id)));
    const down = id => { const out = new Set(), st = [...(succ[id] || [])]; while (st.length) { const x = st.pop(); if (!out.has(x)) { out.add(x); st.push(...(succ[x] || [])); } } return [...out]; };
    const ms = s.tasks.filter(t => t.milestone && !s.R[t.id].done);
    /* delay playbook: schedule → dependents → milestone impact → alert → PM → recovery plan → escalation → risk */
    for (const t of s.tasks.filter(t => !s.R[t.id].done && t.dur > 0 && s.R[t.id].var >= 2)) {
      /* B24: a delay carried in from an open, late predecessor is reported once, on the activity that drives it */
      const inh = Math.max(0, ...t.preds.filter(x => s.R[x] && !s.R[x].done).map(x => s.R[x].var));
      if (s.R[t.id].var - inh < 2) continue;
      const r = s.R[t.id], deps = down(t.id).map(id => S.tasks.find(x => x.id === id)).filter(x => x && !s.R[x.id].done);
      const hit = ms.filter(m => deps.some(d => d.id === m.id) && s.R[m.id].var > 0), worst = hit.length ? Math.max(...hit.map(m => s.R[m.id].var)) : 0;
      const sev = r.critical && worst >= 7 ? 'Critical' : r.critical && worst > 0 ? 'High' : 'Medium';
      const v = t.contractorId && vendor(t.contractorId);
      const { x, fresh } = keep({ key: 'delay:' + t.id, pid: p.id, cat: v ? 'Contractor' : 'Schedule', module: 'schedule', sev, owner: p.pmId,
        title: `${t.name} is ${r.var} days late${v ? ' · ' + v.name : ''}`,
        detail: hit.length ? `${r.critical ? 'On the critical path. ' : ''}Pushes ${hit.map(m => m.name).join(', ')} — worst ${worst} days.` : `Has ${Math.max(r.float, 0)} days of float: no milestone moves yet.`,
        due: addDays(today, 2), records: [{ k: 'task', id: t.id, l: t.name }, ...deps.slice(0, 4).map(d => ({ k: 'task', id: d.id, l: d.name }))],
        next: t.recovery ? 'Recovery plan on record: confirm it still holds' : `Submit a recovery plan for ${t.name} by ${fmtDate(addDays(today, 2), false)}` });
      if (fresh || x.changed) {
        trace('Activity overdue', x.key, p.id, [
          ['Checked the approved schedule and latest progress', `baseline finish ${fmtDate(t.baseFinish)}, ${t.progress}% done, forecast ${fmtDate(r.ff)}`],
          ['Identified dependent activities', `${deps.length}: ${deps.slice(0, 5).map(d => d.name).join(', ') || 'none'}`],
          ['Calculated the impact on milestones', hit.length ? hit.map(m => `${m.name} +${s.R[m.id].var} d`).join(', ') : 'none (float absorbs it)'],
          ['Raised the delay alert', sev], ['Notified the responsible project manager', uname(p.pmId)],
          [t.recovery ? 'Recovery plan already on record' : 'Requested a recovery plan', t.recovery ? esc(t.recovery) : 'due in 2 days'],
          ['Escalation armed', sev === 'Critical' ? 'to the MD if not acknowledged in 4 h' : 'not needed'], ['Updated the risk register', sev === 'Medium' ? 'Medium' : 'High']]);
        if (!S.risks.some(k => k.key === 'delay:' + t.id)) S.risks.unshift({ id: nid('RK'), key: 'delay:' + t.id, projectId: p.id, title: 'Delay: ' + t.name, source: 'Activity overdue', severity: sev === 'Medium' ? 'Medium' : 'High', status: 'Open', at: nowISO() });
        x.changed = false;
      }
    }
    /* budget and contingency */
    const c = cost(p.id);
    if (c.version) {
      /* B24/B25: one alert per project listing the over-budget codes, graded by the worst; it clears when all are back */
      const over = c.lines.filter(l => l.code !== '13' && l.budget > 0 && flagLevel(l) === 'bad').sort((a, b) => b.fac / b.budget - a.fac / a.budget);
      if (over.length) { const w = over[0].fac / over[0].budget;
        keep({ key: 'budget:' + p.id, pid: p.id, cat: 'Budget', module: 'budget', sev: w > 1.1 ? 'Critical' : w > 1.05 ? 'High' : 'Medium', owner: p.pmId,
          title: `${over.length} cost code${over.length === 1 ? '' : 's'} forecast over budget (worst ${over[0].code} ${over[0].name} at ${Math.round(w * 100)}%)`,
          detail: `Forecast overrun ${fmtC(sum(over.map(l => Math.max(l.fac - l.budget, 0))))}: ${over.map(l => `${l.code} ${Math.round(pctOf(l.fac, l.budget))}%`).join(', ')}.`,
          records: [{ k: 'cost', id: p.id, l: 'Cost report' }], next: 'Review commitments and the estimate for the listed codes; request a revision or a transfer from contingency' }); }
      const k = contingency(p.id);
      if (k.available < 0) keep({ key: 'contingency:' + p.id, pid: p.id, cat: 'Budget', module: 'budget', sev: 'Critical', ownerRole: 'pd', title: 'Contingency exhausted', detail: `Overruns ${fmtC(k.overruns)} exceed the remaining contingency.`, records: [{ k: 'cost', id: p.id, l: 'Cost report' }], next: 'Decide a budget revision or savings with the MD' });
    }
    /* shortages reported from site: covered by an order due in time? otherwise procurement acts */
    for (const m of S.mrs.filter(m => m.projectId === p.id && /^Urgent/.test(m.urgency || '') && MR_OPEN.includes(m.status))) {
      const cover = S.pos.filter(x => x.projectId === p.id && ['Approved', 'Part received'].includes(x.status) && norm(x.item) === norm(m.item) && x.expected && x.expected <= m.neededBy);
      const { x, fresh } = keep({ key: 'shortage:' + m.id, pid: p.id, cat: 'Material', module: 'procurement', sev: cover.length ? 'Info' : diffDays(today, m.neededBy) <= 7 ? 'High' : 'Medium', ownerRole: 'proc',
        title: `Shortage: ${fmtQty(m.qtyM)} ${m.unit} ${m.item} needed by ${fmtDate(m.neededBy, false)}`, detail: cover.length ? `Covered by ${cover.map(x => x.id).join(', ')} due in time.` : 'No order due before the need date.',
        due: addDays(m.neededBy, -3), records: [{ k: 'mr', id: m.id, l: m.id }, ...cover.map(x => ({ k: 'po', id: x.id, l: x.id }))], next: cover.length ? 'Track the delivery' : `Get quotations and raise the order for ${m.id} (approval route applies)` });
      if (fresh) trace('Material shortage', x.key, p.id, [['Checked orders due before the need date', cover.length ? cover.map(x => x.id).join(', ') : 'none'], ['Quantity to buy', cover.length ? 'nothing: covered' : `${fmtQty(m.qtyM)} ${m.unit}`],
        ['Routed to procurement', 'PO approval follows the normal thresholds'], ['Tracking until delivery', 'resolved when the order is received'], ['Site stock and reservations', 'checked in the database build (stock ledger); not kept in this demo']]);
    }
    /* quality, safety, payments, permits */
    for (const i of S.inspections.filter(i => i.projectId === p.id && i.status === 'Failed' && diffDays(i.decidedAt.slice(0, 10), today) <= 30 && !S.inspections.some(j => j.unitId === i.unitId && j.kind === i.kind && j.stage === i.stage && j.system === i.system && j.status === 'Passed' && j.decidedAt > i.decidedAt))) {
      const u = S.units.find(x => x.id === i.unitId);
      keep({ key: 'inspfail:' + i.id, pid: p.id, cat: 'Quality', module: 'quality', sev: 'High', ownerRole: 'quality', title: `${i.kind} inspection failed: ${u ? u.code : ''} ${i.stage || i.system || ''}`, detail: i.notes || '', records: [{ k: 'unit', id: i.unitId, l: u ? u.code : 'Unit' }], next: 'Agree the corrective action with the contractor and re-inspect' });
    }
    for (const sn of S.snags.filter(s => s.projectId === p.id && s.severity === 'Safety-critical' && s.status !== 'Closed'))
      keep({ key: 'safety:' + sn.id, pid: p.id, cat: 'Safety', module: 'quality', sev: 'Critical', owner: p.pmId, title: 'Safety-critical defect: ' + sn.title, detail: '', due: addDays(today, 1), records: [{ k: 'unit', id: sn.unitId, l: S.units.find(u => u.id === sn.unitId)?.code || 'Unit' }], next: 'Make the area safe and fix it; a quality engineer closes it after re-inspection' });
    for (const a of S.approvals.filter(a => a.projectId === p.id && a.status === 'Pending' && ['INVOICE', 'RABILL'].includes(a.type) && (Date.now() - Date.parse(a.at)) / 864e5 > 3)) {
      const st = curStep(a);
      keep({ key: 'approval:' + a.id, pid: p.id, cat: 'Payment', module: 'approvals', sev: 'Medium', ownerRole: st && st.role, title: `${AP_TYPE[a.type]} ${a.ref} waiting ${Math.floor((Date.now() - Date.parse(a.at)) / 864e5)} days`, detail: a.title, records: [{ k: 'approval', id: a.id, l: a.id }], next: 'Decide the approval' });
    }
    for (const d of S.docs.filter(d => d.projectId === p.id && d.expiry && d.expiry <= addDays(today, 30)))
      keep({ key: 'permit:' + d.id, pid: p.id, cat: 'Permit', module: 'documents', sev: d.expiry < today ? 'Critical' : d.expiry <= addDays(today, 7) ? 'High' : 'Medium', ownerRole: 'pd', title: `${d.title} ${d.expiry < today ? 'expired' : 'expires'} on ${fmtDate(d.expiry)}`, detail: '', due: d.expiry, records: [{ k: 'doc', id: d.id, l: d.title }], next: 'Start the renewal and upload the renewed document' });
    /* unit completion playbook: stages → defects → FF&E → commissioning → final inspection request or blockers */
    for (const u of S.units.filter(u => u.projectId === p.id && !u.handedOverAt && u.stages.length && u.stages.every(s => s.status === 'Passed'))) {
      const fin = S.inspections.find(i => i.unitId === u.id && i.kind === 'Final' && ['Requested', 'Passed'].includes(i.status));
      if (fin) { if (fin.status === 'Requested') keep({ key: 'final:' + u.id, pid: p.id, cat: 'Handover', module: 'quality', sev: 'Medium', ownerRole: 'quality', title: `${u.code} is ready for its final handover inspection`, detail: '', due: addDays(fin.at.slice(0, 10), 2), records: [{ k: 'unit', id: u.id, l: u.code }], next: 'Carry out the final inspection; the unit becomes Ready when it passes' }); continue; }
      const sn = S.snags.filter(s => s.unitId === u.id && s.status !== 'Closed'), ff = S.ffe.filter(f => f.unitId === u.id && !['Installed', 'Tested'].includes(f.status)), cm = u.commissioning.filter(c => c.status !== 'Passed');
      const blk = sn.length + ff.length + cm.length;
      if (blk) {
        const { x, fresh } = keep({ key: 'handover:' + u.id, pid: p.id, cat: 'Handover', module: 'handover', sev: sn.some(s => s.severity === 'Safety-critical') ? 'High' : 'Medium', owner: p.pmId,
          title: `${u.code}: ${blk} handover blocker${blk === 1 ? '' : 's'}`, detail: `Defects ${sn.length} · FF&E not installed ${ff.length} · commissioning pending ${cm.length}${cm.length ? ' (' + cm.map(c => c.system).join(', ') + ')' : ''}`,
          records: [{ k: 'unit', id: u.id, l: u.code }], next: 'Clear the blockers; the final inspection is requested automatically when the last one closes' });
        if (fresh) trace('Unit works complete', x.key, p.id, [['Verified mandatory stage inspections', 'all passed'], ['Checked unresolved defects', String(sn.length)], ['Verified FF&E installation', ff.length ? ff.length + ' not installed' : 'complete'], ['Verified commissioning certificates', cm.length ? cm.map(c => c.system).join(', ') + ' pending' : 'complete'], ['Handover inspection', 'held back until the blockers clear']]);
      } else {
        const ins = { id: nid('IN'), projectId: p.id, unitId: u.id, kind: 'Final', stage: null, system: null, requestedBy: p.pmId, at: nowISO(), status: 'Requested', inspector: null, decidedAt: null, notes: 'Requested automatically: all stages, defects, FF&E and commissioning clear' };
        S.inspections.push(ins); clearAlert('handover:' + u.id, 'All blockers cleared');
        keep({ key: 'final:' + u.id, pid: p.id, cat: 'Handover', module: 'quality', sev: 'Medium', ownerRole: 'quality', title: `${u.code} is ready for its final handover inspection`, detail: '', due: addDays(today, 2), records: [{ k: 'unit', id: u.id, l: u.code }], next: 'Carry out the final inspection; the unit becomes Ready when it passes' });
        trace('Unit works complete', 'final:' + u.id, p.id, [['Verified mandatory stage inspections', 'all passed'], ['Checked unresolved defects', '0'], ['Verified FF&E installation', 'complete'], ['Verified commissioning certificates', 'complete'], ['Created the handover inspection request', ins.id], ['Readiness', 'becomes Ready only after the inspector passes it']]);
        log('Inspection requested', `${ins.id} Final for ${u.code} — requested automatically (all gates clear)`, p.id, ins.id);
      }
    }
  }
  /* resolve what has cleared; escalate unacknowledged critical alerts once */
  for (const x of S.alerts.filter(x => ['Open', 'Acknowledged'].includes(x.status) && !live.has(x.key))) clearAlert(x.key, 'Condition cleared');
  for (const x of S.alerts.filter(x => x.status === 'Open' && x.sev === 'Critical' && !x.escalated && (Date.now() - Date.parse(x.at)) / 36e5 > 4)) {
    x.escalated = nowISO(); notify(S.users.filter(u => u.role === 'md').map(u => u.id), `Escalation [Critical]: ${x.title} — ${x.next}`, 'alerts');
  }
  return S.alerts.length - n0;
}
/* run with every change, like the event engine */
const _refreshG = refresh; refresh = function (k) { try { alertScan(); } catch (e) { console.error('[M Andamul] alert scan', e); } return _refreshG(k); };

/* ---------- action center ---------- */
const recLink = r => ({ task: `data-act="taskOpen" data-id="${r.id}"`, unit: `data-act="unit" data-id="${r.id}"`, mr: `data-act="mr" data-id="${r.id}"`, po: `data-act="po" data-id="${r.id}"`, approval: `data-act="goApprovals"`, doc: `data-act="doc" data-id="${r.id}"`, cost: `data-act="goCost" data-id="${r.id}"` }[r.k] || '');
ACT.taskOpen = el => showModal('task', el.dataset.id);
ACT.goApprovals = () => { closeModal(); go('approvals'); };
ACT.goCost = el => { closeModal(); UI.ptab = 'cost'; go('p-' + el.dataset.id.toLowerCase()); };
function alertVisible(x) { return x.owner === me().id || (x.pid ? hasProject(x.pid) && can(x.module || CAT_MOD[x.cat]) : can(x.module || CAT_MOD[x.cat])); }
function alertCanAct(x) { return x.owner === me().id || (x.ownerRole && x.ownerRole === me().role && hasProject(x.pid)) || (hasProject(x.pid) && can(x.module || CAT_MOD[x.cat], 'edit')); }
VIEWS.alerts = {
  mod: 'dashboard', title: 'Action center', allowed: () => true,
  render() {
    ensurePhase3();
    const A = S.alerts.filter(x => alertVisible(x) && (!x.pid || inScope(x.pid))), st = UI.alst || 'open', sv = UI.alsev || 'all', cat = UI.alcat || 'all';
    const open = A.filter(x => ['Open', 'Acknowledged'].includes(x.status));
    const L = (st === 'open' ? open : st === 'mine' ? open.filter(x => alertOwners(x).includes(me().id)) : A.filter(x => x.status === 'Resolved' || x.status === 'Suppressed'))
      .filter(x => (sv === 'all' || x.sev === sv) && (cat === 'all' || x.cat === cat)).sort((a, b) => SEV[b.sev] - SEV[a.sev] || (a.at < b.at ? 1 : -1));
    const cnt = s => open.filter(x => x.sev === s).length;
    return pageHead('Action center', `${open.length} open · ${cnt('Critical')} critical · ${cnt('High')} high — each with an owner, the records behind it and the next action`, `<button class="btn" data-act="alertScanNow">${ic('refresh')}Check now</button>`) +
      `<div class="toolbar">${tabs([['open', 'Open', open.length], ['mine', 'Mine', open.filter(x => alertOwners(x).includes(me().id)).length], ['closed', 'Resolved & snoozed']], st, 'alst')}
        <div class="chips">${['all', 'Critical', 'High', 'Medium', 'Info'].map(s => `<button class="chip${sv === s ? ' on' : ''}" data-act="alsev" data-k="${s}">${s === 'all' ? 'All severities' : s}${s !== 'all' ? ` <span class="cnt">${cnt(s)}</span>` : ''}</button>`).join('')}</div>
        <label class="fsel"><span class="sr">Category</span><select class="sel" data-chg="alcat"><option value="all">All categories</option>${Object.keys(CAT_MOD).map(c => opt(c, c, cat)).join('')}</select></label></div>` +
      (L.length ? `<div class="alist">${L.map(alertCard).join('')}</div>` : empty(st === 'open' ? 'Nothing needs attention' : 'Nothing here', 'Alerts appear when the checks find a verified problem, and close themselves when it is fixed.'));
  }
};
function alertCard(x) {
  const due = x.due ? (x.due < todayISO() ? `<span class="tbad">overdue since ${fmtDate(x.due, false)}</span>` : 'by ' + fmtDate(x.due, false)) : '—';
  const who = x.owner ? uname(x.owner) : x.ownerRole ? roleName(x.ownerRole) : '—', act = alertCanAct(x) && ['Open', 'Acknowledged'].includes(x.status);
  const tr = (S.actions || []).find(a => a.key === x.key);
  return `<article class="card alert sev-${x.sev.toLowerCase()}"><div class="al-h"><span class="sevb sev-${x.sev.toLowerCase()}">${x.sev}</span><span class="altag">${esc(x.cat)}</span>${x.pid ? `<span class="sm muted">${esc(shortName(proj(x.pid)))}</span>` : ''}${x.status !== 'Open' ? badge(x.status) : ''}${x.escalated ? '<span class="altag">Escalated to MD</span>' : ''}</div>
    <h3 class="al-t">${esc(x.title)}</h3>${x.detail ? `<p class="sm">${esc(x.detail)}</p>` : ''}
    <dl class="al-m"><div><dt>Responsible</dt><dd>${esc(who)}</dd></div><div><dt>Urgency</dt><dd>${due}</dd></div><div class="span2"><dt>Records</dt><dd>${(x.records || []).map(r => `<button class="lnk" ${recLink(r)}>${esc(r.l)}</button>`).join(' · ') || '—'}</dd></div></dl>
    <p class="al-n"><b>Next action:</b> ${esc(x.next)}</p>${x.resolution ? `<p class="fine">${esc(x.resolution)}</p>` : ''}
    ${tr ? `<details class="trace"><summary>How the automation reached this</summary><ol>${tr.steps.map(([a, r]) => `<li><b>${esc(a)}</b> — ${r}</li>`).join('')}</ol><p class="fine">${esc(tr.pb)} playbook · ${fmtStamp(tr.at)}</p></details>` : ''}
    ${act ? `<div class="fa">${x.status === 'Open' ? `<button class="btn sm" data-act="alAck" data-id="${x.id}">Acknowledge</button>` : ''}${x.sev !== 'Critical' ? `<button class="btn sm ghost" data-act="alSnooze" data-id="${x.id}">Snooze 3 days</button>` : ''}<button class="btn sm" data-act="alResolve" data-id="${x.id}">Mark resolved</button></div>` : ''}</article>`;
}
ACT.alst = el => { UI.alst = el.dataset.k; render(); };
ACT.alsev = el => { UI.alsev = el.dataset.k; render(); };
CHG.alcat = el => { UI.alcat = el.value; render(); };
ACT.alertScanNow = () => { const n = alertScan(); save(); render(); toast(n > 0 ? `${n} new alert${n === 1 ? '' : 's'}` : 'Checked: nothing new'); };
ACT.alAck = el => { const x = S.alerts.find(a => a.id === el.dataset.id); x.status = 'Acknowledged'; x.ackBy = me().id; x.ackAt = nowISO(); log('Alert acknowledged', x.title, x.pid, x.id); save(); render(); toast('Acknowledged — the alert stays until the cause is fixed'); };
ACT.alSnooze = el => { const x = S.alerts.find(a => a.id === el.dataset.id); if (x.sev === 'Critical') { toast('Critical alerts cannot be snoozed', 'bad'); return; } x.status = 'Suppressed'; x.until = addDays(todayISO(), 3) + 'T00:00:00'; log('Alert snoozed', x.title + ' for 3 days', x.pid, x.id); save(); render(); };
ACT.alResolve = el => { UI.alRes = el.dataset.id; openModal('Mark resolved', `<form data-form="alResolve" class="form">${field('How was it resolved?', '<textarea name="note" class="ta" rows="2" required minlength="5" maxlength="300"></textarea>', 'If the cause is still there, the next check reopens the alert.')}<div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Resolve</button></div></form>`); };
FORM.alResolve = fd => { const x = S.alerts.find(a => a.id === UI.alRes), n = String(fd.get('note') || '').trim(); if (n.length < 5) { toast('Say how it was resolved (at least 5 characters)', 'bad'); return; } Object.assign(x, { status: 'Resolved', resolvedAt: nowISO(), resolution: n, resolvedBy: me().id }); log('Alert resolved', `${x.title}: ${n}`, x.pid, x.id); closeModal(); save(); render(); };

/* ---------- digital twin: property → zone → building → floor → unit → work package → task, from live records ---------- */
const unitPhotoList = u => [...S.reports.flatMap(r => (r.photos || []).filter(ph => ph.unitId === u.id).map(ph => ({ ...ph, date: r.date }))), ...(S.photos || []).filter(ph => ph.unitId === u.id)];
function leafOfUnit(u) {
  const r = readiness(u), c = unitCost(u), ins = S.inspections.filter(i => i.unitId === u.id), s = sched(u.projectId);
  const pass = u.stages.filter(x => x.status === 'Passed' && x.at).map(x => x.at.slice(0, 10)).sort();
  const C = S.contracts.filter(k => k.unitId === u.id), ho = s.tasks.find(t => t.key === 'M03');
  return { kind: 'unit', id: u.id, code: u.code, name: u.name, status: r.status, stT: r.total, stP: r.passed, budget: c.budget, committed: c.committed, actual: c.actual,
    defects: r.snags, safety: r.safety, insP: ins.filter(i => i.status === 'Passed').length, insO: ins.filter(i => i.status === 'Requested').length, insF: ins.filter(i => i.status === 'Failed').length,
    photos: unitPhotoList(u).length, design: S.docs.filter(d => (d.links?.units || []).includes(u.id)).length, contractors: C.map(k => vendor(k.vendorId).name),
    pStart: proj(u.projectId).start, pFinish: ho ? ho.baseFinish : null, aStart: pass[0] || null, aFinish: u.handedOverAt ? u.handedOverAt.slice(0, 10) : null, fFinish: unitEta(u) || (r.gates ? todayISO() : null),
    ready: r.status === 'Ready', handed: !!u.handedOverAt, units: 1 };
}
function leafOfWp(w) {
  const c = S.contracts.find(k => k.id === w.contractId), s = sched(w.projectId), T = S.tasks.filter(t => t.wpId === w.id);
  const sn = c ? S.snags.filter(x => x.projectId === w.projectId && x.vendorId === c.vendorId && x.status !== 'Closed') : [];
  const done = T.length && T.every(t => s.R[t.id]?.done);
  return { kind: 'wp', id: w.id, code: w.code, name: w.name, status: done ? 'Complete' : T.some(t => s.R[t.id]?.started) ? 'In progress' : 'Not started', stT: 0, stP: 0,
    budget: c ? contractTotal(c) : 0, committed: c ? conCommitP(c) : 0, actual: c ? certifiedP(c) : 0, defects: sn.length, safety: sn.filter(x => x.severity === 'Safety-critical').length, insP: 0, insO: 0, insF: 0,
    photos: 0, design: 0, contractors: c ? [vendor(c.vendorId).name] : [], pStart: T.length ? minISO(T.map(t => t.baseStart)) : null, pFinish: T.length ? maxISO(T.map(t => t.baseFinish)) : null,
    aStart: mnD(T.filter(t => t.actStart).map(t => t.actStart)), aFinish: done ? mxD(T.map(t => t.actFinish).filter(Boolean)) : null,
    fFinish: T.length ? maxISO(T.map(t => s.R[t.id].ff)) : null, ready: false, handed: false, units: 0 };
}
const mnD = a => (a.length ? minISO(a) : null), mxD = a => (a.length ? maxISO(a) : null);
function rollup(L) {
  const m = { budget: sum(L.map(x => x.budget)), committed: sum(L.map(x => x.committed)), actual: sum(L.map(x => x.actual)), defects: sum(L.map(x => x.defects)), safety: sum(L.map(x => x.safety)),
    insP: sum(L.map(x => x.insP)), insO: sum(L.map(x => x.insO)), insF: sum(L.map(x => x.insF)), photos: sum(L.map(x => x.photos)), design: sum(L.map(x => x.design)), stT: sum(L.map(x => x.stT)), stP: sum(L.map(x => x.stP)),
    units: sum(L.map(x => x.units)), ready: L.filter(x => x.ready).length, handed: L.filter(x => x.handed).length, contractors: [...new Set(L.flatMap(x => x.contractors))],
    pStart: mnD(L.map(x => x.pStart).filter(Boolean)), pFinish: mxD(L.map(x => x.pFinish).filter(Boolean)), aStart: mnD(L.map(x => x.aStart).filter(Boolean)),
    aFinish: L.length && L.every(x => x.aFinish) ? maxISO(L.map(x => x.aFinish)) : null, fFinish: mxD(L.map(x => x.fFinish).filter(Boolean)) };
  m.status = m.units && m.handed === m.units ? 'Handed over' : m.safety ? 'Blocked' : L.every(x => x.status === 'Not started') ? 'Not started' : 'In progress';
  return m;
}
const leafM = x => ({ ...x, remaining: Math.max(x.budget, x.committed) - x.actual });
function twinNode(pid, kind, id) {   // returns the node, its children and its rolled-up metrics
  const p = proj(pid), Z = S.zones.filter(z => z.projectId === pid);
  const unitsIn = f => S.units.filter(u => u.projectId === pid && f(u)), wpsIn = f => S.wps.filter(w => w.projectId === pid && !w.unitId && f(w));
  if (kind === 'property') {
    const ch = Z.map(z => ({ kind: 'zone', id: z.id, label: z.name, sub: z.kind, leaves: [...unitsIn(u => u.zoneId === z.id).map(leafOfUnit), ...wpsIn(w => w.zoneId === z.id).map(leafOfWp)] }));
    return { label: p.name, sub: p.location, ch, leaves: ch.flatMap(c => c.leaves) };
  }
  if (kind === 'zone') {
    const z = S.zones.find(x => x.id === id), B = S.buildings.filter(b => b.zoneId === id);
    const ch = [...B.map(b => ({ kind: 'building', id: b.id, label: b.name, sub: b.code, leaves: unitsIn(u => u.buildingId === b.id).map(leafOfUnit) })),
      ...wpsIn(w => w.zoneId === id).map(w => ({ kind: 'wp', id: w.id, label: w.name, sub: w.code + ' · zone work package', leaves: [leafOfWp(w)] }))];
    return { label: z.name, sub: z.kind, ch, leaves: ch.flatMap(c => c.leaves) };
  }
  if (kind === 'building') {
    const b = S.buildings.find(x => x.id === id), F = S.floors.filter(f => f.buildingId === id);
    const ch = F.map(f => ({ kind: 'floor', id: f.id, label: f.name + ' floor', sub: 'Level ' + f.level, leaves: unitsIn(u => u.floorId === f.id).map(leafOfUnit) }));
    return { label: b.name, sub: b.code, ch, leaves: ch.flatMap(c => c.leaves) };
  }
  if (kind === 'floor') {
    const f = S.floors.find(x => x.id === id), U = unitsIn(u => u.floorId === id);
    const ch = U.map(u => ({ kind: 'unit', id: u.id, label: u.code + ' · ' + u.name, sub: u.type, leaves: [leafOfUnit(u)] }));
    return { label: f.name + ' floor', sub: S.buildings.find(b => b.id === f.buildingId).name, ch, leaves: ch.flatMap(c => c.leaves) };
  }
  if (kind === 'unit') {
    const u = S.units.find(x => x.id === id), W = S.wps.filter(w => w.unitId === id);
    const ch = W.map(w => ({ kind: 'wp', id: w.id, label: w.name, sub: w.code, leaves: [leafOfWp(w)] }));
    return { label: u.code + ' · ' + u.name, sub: u.type, ch, leaves: [leafOfUnit(u)], unit: u };
  }
  if (kind === 'wp') { const w = S.wps.find(x => x.id === id); return { label: w.name, sub: w.code, ch: [], leaves: [leafOfWp(w)], wp: w }; }
}
function twinPath(pid, kind, id) {
  const P = [{ kind: 'property', id: pid, label: proj(pid).name }];
  const add = (k, x, l) => P.push({ kind: k, id: x, label: l });
  if (kind === 'zone') add('zone', id, S.zones.find(z => z.id === id).name);
  if (kind === 'building') { const b = S.buildings.find(x => x.id === id); add('zone', b.zoneId, S.zones.find(z => z.id === b.zoneId).name); add('building', id, b.name); }
  if (kind === 'floor') { const f = S.floors.find(x => x.id === id), b = S.buildings.find(x => x.id === f.buildingId); add('zone', b.zoneId, S.zones.find(z => z.id === b.zoneId).name); add('building', b.id, b.name); add('floor', id, f.name + ' floor'); }
  if (kind === 'unit') { const u = S.units.find(x => x.id === id), b = S.buildings.find(x => x.id === u.buildingId); if (b) { add('zone', b.zoneId, S.zones.find(z => z.id === b.zoneId).name); add('building', b.id, b.name); add('floor', u.floorId, 'Ground floor'); } add('unit', id, u.code); }
  if (kind === 'wp') { const w = S.wps.find(x => x.id === id); if (w.unitId) { const u = S.units.find(x => x.id === w.unitId); add('unit', u.id, u.code); } else add('zone', w.zoneId, S.zones.find(z => z.id === w.zoneId).name); add('wp', id, w.code); }
  return P;
}
function twinFacts(m, cost) {
  const pct = m.stT ? Math.round(m.stP * 100 / m.stT) : null;
  return `<dl class="twin-f">
    <div><dt>Status</dt><dd>${badge(m.status)}</dd></div>
    <div><dt>Verified completion</dt><dd>${pct == null ? '<span class="muted">no inspected stages</span>' : `${pct}% <span class="sm muted">(${m.stP}/${m.stT} stages passed by inspection)</span>`}</dd></div>
    <div><dt>Contractor</dt><dd>${m.contractors.length ? m.contractors.map(esc).join(', ') : '—'}</dd></div>
    <div><dt>Planned</dt><dd>${m.pStart ? fmtDate(m.pStart, false) : '—'} → ${m.pFinish ? fmtDate(m.pFinish) : '—'}</dd></div>
    <div><dt>Actual / forecast</dt><dd>${m.aStart ? fmtDate(m.aStart, false) : 'not started'} → ${m.aFinish ? fmtDate(m.aFinish) + ' (done)' : m.fFinish ? fmtDate(m.fFinish) + ' <span class="sm muted">forecast</span>' : '—'}</dd></div>
    ${cost ? `<div><dt>Current budget</dt><dd>${fmtC(m.budget)}</dd></div><div><dt>Committed · actual</dt><dd>${fmtC(m.committed)} · ${fmtC(m.actual)}</dd></div>
    <div><dt>Forecast remaining</dt><dd>${fmtC(Math.max(m.budget, m.committed) - m.actual)} <span class="sm muted">projection: larger of budget or commitment, less actual</span></dd></div>` : '<div><dt>Cost</dt><dd><span class="rs">Restricted</span></dd></div>'}
    <div><dt>Open defects</dt><dd>${m.defects}${m.safety ? ` <span class="tbad">(${m.safety} safety-critical)</span>` : ''}</dd></div>
    <div><dt>Inspections</dt><dd>${m.insP} passed · ${m.insO} requested · ${m.insF} failed</dd></div>
    <div><dt>Progress photos · design references</dt><dd>${m.photos} · ${m.design}</dd></div>
    <div><dt>Handover</dt><dd>${m.units ? `${m.handed}/${m.units} handed over · ${m.ready} ready` : '—'}</dd></div></dl>`;
}
VIEWS.twin = {
  mod: 'projects', title: 'Digital twin',
  render() {
    ensurePhase3();
    const pid = selProject('twinP'); if (!pid) return pageHead('Digital twin') + empty('No projects in view');
    const t = UI.twin && UI.twin.pid === pid ? UI.twin : { pid, kind: 'property', id: pid }, n = twinNode(pid, t.kind, t.id), m = rollup(n.leaves), fin = can('budget');
    const path = twinPath(pid, t.kind, t.id);
    const rows = n.ch.map(c => { const cm = rollup(c.leaves), pct = cm.stT ? cm.stP * 100 / cm.stT : null; return `<tr class="click" data-act="twinGo" data-k="${c.kind}" data-id="${c.id}" tabindex="0">
      <td><b>${esc(c.label)}</b><br><span class="sm muted">${esc(c.sub || '')}</span></td><td>${badge(cm.status)}</td><td class="w-pb">${pct == null ? '<span class="muted sm">—</span>' : bar(pct) + `<span class="sm">${Math.round(pct)}%</span>`}</td>
      ${fin ? `<td class="num">${fmtC(cm.budget)}</td><td class="num">${fmtC(cm.committed)}</td><td class="num">${fmtC(cm.actual)}</td>` : ''}<td class="num ${cm.safety ? 'tbad' : ''}">${cm.defects}</td><td class="num">${cm.insO}</td>
      <td class="nowrap">${cm.fFinish ? fmtDate(cm.fFinish, false) : '—'}</td><td class="num">${cm.units ? cm.handed + '/' + cm.units : '—'}</td></tr>`; }).join('');
    let tasks = '';
    if (t.kind === 'wp') {
      const s = sched(pid), T = S.tasks.filter(x => x.wpId === t.id);
      tasks = `<h3 class="h3">Tasks in this work package</h3>${T.length ? `<table class="t stack"><thead><tr><th>Task</th><th>Planned</th><th>Actual</th><th>Forecast finish</th><th class="num">Progress</th><th>Contractor</th></tr></thead><tbody>${T.map(x => { const r = s.R[x.id]; return `<tr class="click" data-act="taskOpen" data-id="${x.id}" tabindex="0"><td><b>${esc(x.name)}</b></td><td class="nowrap">${fmtDate(x.baseStart, false)} → ${fmtDate(x.baseFinish, false)}</td><td class="nowrap">${x.actStart ? fmtDate(x.actStart, false) : '—'} → ${x.actFinish ? fmtDate(x.actFinish, false) : '—'}</td><td class="nowrap ${r.var > 0 ? 'tbad' : ''}">${fmtDate(r.ff, false)}${r.var > 0 ? ` (+${r.var} d)` : ''}</td><td class="num">${x.progress}%</td><td>${x.contractorId ? esc(vendor(x.contractorId).name) : '—'}</td></tr>`; }).join('')}</tbody></table>` : empty('No tasks linked to this package yet')}`;
    }
    if (t.kind === 'unit') {
      const u = n.unit, ph = unitPhotoList(u).slice(-6), D = S.docs.filter(d => (d.links?.units || []).includes(u.id));
      tasks = `<div class="g2"><section><h3 class="h3">Design references</h3>${D.length ? `<ul class="al">${D.map(d => `<li><button class="lnk" data-act="doc" data-id="${d.id}">${esc(d.title)}</button> <span class="sm muted">${esc(d.status)}</span></li>`).join('')}</ul>` : '<p class="sm muted">No drawings linked to this unit.</p>'}</section>
        <section><h3 class="h3">Progress photographs</h3>${ph.length ? `<div class="thumbs">${ph.map(x => x.thumb ? `<img src="${x.thumb}" alt="${esc(x.caption || x.name || 'photo')}">` : BLOBS[x.key] ? `<img src="${BLOBS[x.key]}" alt="${esc(x.name || 'photo')}">` : `<span class="altag">${esc(x.name || 'photo')} · ${fmtDate(x.date, false)}</span>`).join('')}</div>` : '<p class="sm muted">No photos tagged to this unit yet.</p>'}</section></div>
        <div class="fa"><button class="btn" data-act="unit" data-id="${u.id}">Open unit workspace</button></div>`;
    }
    return pageHead('Digital twin', 'Live from the project records: every figure below comes from approved orders, contracts, inspections and certified bills — nothing is typed in here. A 3D model can be attached when model files and a compatible viewer are available.', '', projectPicker('twinP')) +
      `<nav class="crumbs" aria-label="Twin path">${path.map((x, i) => i === path.length - 1 ? `<b>${esc(x.label)}</b>` : `<button class="lnk" data-act="twinGo" data-k="${x.kind}" data-id="${x.id}">${esc(x.label)}</button> ›`).join(' ')}</nav>
      <section class="card"><div class="ch"><h2 class="h2">${esc(n.label)}</h2><span class="sm muted">${esc(n.sub || '')}</span></div>${twinFacts(m, fin)}</section>
      ${rows ? `<section class="card flush"><table class="t stack"><thead><tr><th>${{ property: 'Zone', zone: 'Building or work package', building: 'Floor', floor: 'Room / villa', unit: 'Work package' }[t.kind] || 'Part'}</th><th>Status</th><th>Verified completion</th>${fin ? '<th class="num">Budget</th><th class="num">Committed</th><th class="num">Actual</th>' : ''}<th class="num">Open defects</th><th class="num">Inspections due</th><th>Forecast finish</th><th class="num">Handed over</th></tr></thead><tbody>${rows}</tbody></table></section>` : ''}
      ${tasks}`;
  }
};
ACT.twinGo = el => { const pid = selProject('twinP'); UI.twin = { pid, kind: el.dataset.k, id: el.dataset.id }; render(); };

/* ---------- financial intelligence: recorded figures and projections kept apart ---------- */
function finIntel(pid) {
  const p = proj(pid), c = cost(pid), t = c.tot, k = contingency(pid), s = sched(pid), C = S.contracts.filter(x => x.projectId === pid);
  const pv = sum(C.flatMap(x => x.variations.filter(v => v.status === 'Pending approval').map(v => inclGst(v.amountP, x.gst))));
  const av = sum(C.flatMap(x => x.variations.filter(v => v.status === 'Approved').map(v => inclGst(v.amountP, x.gst))));
  const slip = Math.max(0, ...s.tasks.filter(x => x.milestone && !s.R[x.id].done).map(x => s.R[x.id].var));
  const dur = s.tasks.length ? Math.max(1, diffDays(minISO(s.tasks.map(x => x.baseStart)), maxISO(s.tasks.map(x => x.baseFinish)))) : 1;
  const prelim = c.lines.find(l => l.code === '01'), perDay = Math.round((prelim ? prelim.budget : 0) / dur);
  const scen = (S.scenarios || SCENARIOS).map(x => { const d = Math.max(0, slip + x.delay), etcS = Math.round(t.etc * x.etc), pvS = Math.round(pv * x.pv / 100), fc = t.committed + etcS + pvS + d * perDay;
    return { ...x, days: d, delayCost: d * perDay, etcS, pvS, fc, vsBudget: t.budget - fc, margin: p.contractValueP != null ? p.contractValueP - fc : null }; });
  const U = S.units.filter(u => u.projectId === pid), V = U.filter(u => ['villa', 'tent', 'room'].includes(u.template));
  const share = sum(U.map(u => u.budgetP)) ? sum(V.map(u => u.budgetP)) / sum(U.map(u => u.budgetP)) : 0;
  const contracts = C.filter(x => ['Active', 'Closed'].includes(x.status)).map(x => { const o = inclGst(contractValue(x), x.gst), a = sum(x.variations.filter(v => v.status === 'Approved').map(v => inclGst(v.amountP, x.gst)));
    return { c: x, v: vendor(x.vendorId), original: o, approved: a, pending: sum(x.variations.filter(v => v.status === 'Pending approval').map(v => inclGst(v.amountP, x.gst))), certified: certifiedP(x), growth: o ? a * 100 / o : 0, done: (o + a) ? certifiedP(x) * 100 / (o + a) : 0 }; })
    .sort((a, b) => b.growth - a.growth);
  const price = S.pos.filter(x => x.projectId === pid && !['Rejected', 'Cancelled'].includes(x.status) && x.kind !== 'Work order').map(x => {
    const prev = S.pos.filter(y => y.id !== x.id && norm(y.item) === norm(x.item) && !['Rejected', 'Cancelled'].includes(y.status) && y.at < x.at).map(y => y.rateP).sort((a, b) => a - b);
    const q = S.mrs.find(m => m.poId === x.id)?.quotes || [], low = q.length ? Math.min(...q.map(z => z.rateP)) : null;
    const ref = prev.length ? prev[Math.floor(prev.length / 2)] : low; if (!ref) return null;
    return { x, ref, basis: prev.length ? 'median of earlier orders' : 'lowest quotation', varP: Math.round((x.rateP - ref) * x.qtyM / 1000), pct: (x.rateP - ref) * 100 / ref };
  }).filter(r => r && Math.abs(r.pct) >= 0.5).sort((a, b) => Math.abs(b.varP) - Math.abs(a.varP));
  return { p, c, t, k, pv, av, slip, perDay, dur, scen, villas: V.length, attributed: V.length ? sum(V.map(u => unitCost(u).committed)) / V.length : null, allocated: V.length ? t.fac * share / V.length : null, contracts, price };
}
function intelHTML(pid) {
  const f = finIntel(pid), t = f.t, p = f.p, row = (l, v, n = '') => `<tr><td>${l}</td><td class="num">${v}</td><td class="sm muted">${n}</td></tr>`;
  const rev = budgetVersions(pid);
  return `<div class="g2"><section class="card"><h3 class="h3">Recorded <span class="altag">from approved documents</span></h3><table class="t"><tbody>
      ${row('Approved baseline (v1)', fmtC(t.original))}${row('Approved changes', fmtC(t.changes), rev.length + ' version' + (rev.length === 1 ? '' : 's') + ': ' + rev.map(v => `v${v.v} ${v.status}`).join(', '))}${row('Current budget', fmtC(t.budget))}
      ${row('Committed', fmtC(t.committed), 'approved orders, active contracts, approved variations')}${row('Actual cost', fmtC(t.actual), 'accepted receipts and certified bills')}${row('Paid', fmtC(t.paid))}
      ${row('Accrued, unpaid', fmtC(t.accrued))}${row('Retention held', fmtC(t.retention))}${row('Approved variations', fmtC(f.av))}
      ${row('Contingency available', `<span class="${f.k.available < 0 ? 'tbad' : ''}">${fmtC(f.k.available)}</span>`, `budget ${fmtC(f.k.budget)} − drawn − overruns ${fmtC(f.k.overruns)}`)}</tbody></table></section>
    <section class="card"><h3 class="h3">Projected <span class="altag">estimates, not records</span></h3><table class="t"><tbody>
      ${row('Estimate to complete', fmtC(t.etc), 'QS estimate for scope not yet committed')}${row('Forecast final cost', fmtC(t.fac), 'committed + estimate')}${row('Variance to budget', `<span class="${t.variance < 0 ? 'tbad' : ''}">${fmtC(t.variance)}</span>`)}
      ${row('Variation exposure (pending)', fmtC(f.pv))}${row('Forecast handover slip', f.slip + ' days')}${row('Delay cost per day', fmtC(f.perDay), 'assumption: preliminaries budget ÷ planned duration')}
      ${row('Cost per sq ft (forecast)', p.builtUpSqft ? fmtINR(Math.round(t.fac / p.builtUpSqft)) : '—', p.builtUpSqft ? fmtQty(p.builtUpSqft * 1000) + ' sq ft' : '')}${row('Cost per key (forecast)', p.keys ? fmtC(Math.round(t.fac / p.keys)) : '—', p.keys + ' keys')}
      ${row('Cost per villa — attributed', !f.attributed ? '—' : fmtC(Math.round(f.attributed)), f.attributed ? 'commitments linked to villa units ÷ villas' : 'no commitments are linked to villa units yet')}${row('Cost per villa — allocated', f.allocated == null ? '—' : fmtC(Math.round(f.allocated)), 'forecast × villa share of unit budgets ÷ villas')}
      ${row('Margin', p.contractValueP != null ? `<span class="${p.contractValueP - t.fac < 0 ? 'tbad' : ''}">${fmtC(p.contractValueP - t.fac)}</span>` : '—', p.contractValueP != null ? `client contract ${fmtC(p.contractValueP)} (recorded) − forecast (projected)` : 'no client contract value')}</tbody></table></section></div>
    <section class="card"><h3 class="h3">Forecast scenarios</h3><p class="fine">Each scenario starts from recorded commitments and changes only the stated assumptions. They are projections.</p>
      <table class="t stack"><thead><tr><th>Scenario</th><th>Assumptions</th><th class="num">Estimate to complete</th><th class="num">Pending variations</th><th class="num">Delay cost</th><th class="num">Final cost</th><th class="num">vs budget</th><th class="num">Margin</th></tr></thead><tbody>
      ${f.scen.map(x => `<tr><td><b>${x.name}</b></td><td class="sm">${esc(x.note)}</td><td class="num">${fmtC(x.etcS)}</td><td class="num">${fmtC(x.pvS)}</td><td class="num">${fmtC(x.delayCost)}<br><span class="sm muted">${x.days} d</span></td><td class="num"><b>${fmtC(x.fc)}</b></td><td class="num ${x.vsBudget < 0 ? 'tbad' : ''}">${fmtC(x.vsBudget)}</td><td class="num ${x.margin != null && x.margin < 0 ? 'tbad' : ''}">${x.margin == null ? '—' : fmtC(x.margin)}</td></tr>`).join('')}</tbody></table></section>
    <div class="g2"><section class="card flush"><div class="pad"><h3 class="h3">Contractor cost performance</h3></div>${f.contracts.length ? `<table class="t stack"><thead><tr><th>Work order</th><th class="num">Original</th><th class="num">Approved variations</th><th class="num">Pending</th><th class="num">Certified</th><th class="num">Growth</th></tr></thead><tbody>
      ${f.contracts.map(r => `<tr class="click" data-act="contract" data-id="${r.c.id}" tabindex="0"><td><b>${esc(r.v.name)}</b><br><span class="sm muted">${esc(r.c.title)}</span></td><td class="num">${fmtC(r.original)}</td><td class="num">${fmtC(r.approved)}</td><td class="num">${fmtC(r.pending)}</td><td class="num">${fmtC(r.certified)}<br><span class="sm muted">${Math.round(r.done)}% of value</span></td><td class="num ${r.growth > 10 ? 'tbad' : ''}">${r.growth.toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : empty('No contracts')}</section>
      <section class="card flush"><div class="pad"><h3 class="h3">Procurement price variance</h3></div>${f.price.length ? `<table class="t stack"><thead><tr><th>Order</th><th class="num">Rate</th><th class="num">Reference</th><th class="num">Variance</th></tr></thead><tbody>
      ${f.price.slice(0, 10).map(r => `<tr class="click" data-act="po" data-id="${r.x.id}" tabindex="0"><td><b>${r.x.id}</b> ${esc(r.x.item)}</td><td class="num">${fmtINR(r.x.rateP)}</td><td class="num">${fmtINR(r.ref)}<br><span class="sm muted">${r.basis}</span></td><td class="num ${r.varP > 0 ? 'tbad' : ''}">${fmtC(r.varP)}<br><span class="sm">${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}%</span></td></tr>`).join('')}</tbody></table>` : empty('No comparable orders yet', 'Variance needs an earlier order or a quotation for the same item.')}</section></div>`;
}
function repIntel() { const pid = selProject('intelP'); return pid ? projectPicker('intelP') + intelHTML(pid) : empty('No project'); }

/* ---------- contractor scores: transparent weighted formula, only where the data is enough ---------- */
function contractorScores(pids) {
  const today = todayISO(), W = S.scoreW || SCORE_W.map(([k, l, w, m, f]) => ({ k, l, w, min: m, f }));
  return S.vendors.map(v => {
    const C = S.contracts.filter(c => c.vendorId === v.id && pids.includes(c.projectId) && ['Active', 'Closed'].includes(c.status)); if (!C.length) return null;
    const T = S.tasks.filter(t => t.contractorId === v.id && pids.includes(t.projectId) && t.actFinish);
    const items = C.flatMap(c => c.items.map(i => ({ i, c }))), planned = sum(items.map(({ i, c }) => i.qtyM * clamp(diffDays(c.start, today) / Math.max(diffDays(c.start, c.end), 1), 0, 1)));
    const meas = sum(S.measurements.filter(m => C.some(c => c.id === m.contractId) && m.status === 'Verified').map(m => m.qtyM));
    const unitIds = C.map(c => c.unitId).filter(Boolean), ins = S.inspections.filter(i => unitIds.includes(i.unitId) && ['Passed', 'Failed'].includes(i.status));
    const cert = sum(C.map(certifiedP)), sn = S.snags.filter(s => s.vendorId === v.id && pids.includes(s.projectId)), fixed = sn.filter(s => s.fixedAt);
    const raw = { on_time: [T.length ? T.filter(t => t.actFinish <= t.baseFinish).length * 100 / T.length : null, T.length], productivity: [planned ? meas * 100 / planned : null, items.length],
      rework: [ins.length ? ins.filter(i => i.status === 'Failed').length * 100 / ins.length : null, ins.length], defects: [cert ? sn.length / (cert / 1e9) : null, C.flatMap(c => c.bills.filter(b => BILL_COST.includes(b.status))).length],
      safety: [sn.filter(s => s.severity === 'Safety-critical').length, 1], variations: [sum(C.map(contractValue)) ? sum(C.flatMap(c => c.variations.filter(x => x.status === 'Approved').map(x => x.amountP))) * 100 / sum(C.map(contractValue)) : null, C.length],
      claims: [null, 0], response: [fixed.length ? sum(fixed.map(s => (Date.parse(s.fixedAt) - Date.parse(s.at)) / 864e5)) / fixed.length : null, fixed.length], wastage: [null, 0] };
    const norm100 = (k, x) => x == null ? null : ({ on_time: x, productivity: Math.min(100, x), rework: Math.max(0, 100 - 5 * x), defects: Math.max(0, 100 - 10 * x), safety: Math.max(0, 100 - 25 * x), variations: Math.max(0, 100 - 2 * x), claims: Math.min(100, x), response: Math.max(0, 100 - 5 * x), wastage: null })[k];
    const comp = W.map(w => { const [val, n] = raw[w.k]; const sc = norm100(w.k, val); const used = sc != null && n >= w.min && w.w > 0; return { ...w, val, n, sc, used, note: w.w === 0 ? 'not weighted' : val == null ? 'no data' : n < w.min ? `needs ${w.min}, has ${n}` : '' }; });
    const U = comp.filter(x => x.used), score = U.length ? sum(U.map(x => x.w * x.sc)) / sum(U.map(x => x.w)) : null;
    const cover = sum(U.map(x => x.w)) * 100 / Math.max(sum(W.filter(w => w.w > 0).map(w => w.w)), 1);   // B27: share of the score weight actually measured
    return { v, score, comparable: U.length >= 4 && cover >= 60, used: U.length, cover, comp };
  }).filter(Boolean).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
function repScores(P) {
  const R = contractorScores(P.map(p => p.id)); REP_ROWS.scores = R;
  return `<p class="fine">Score = weighted average of the components that have enough data (weights and formulas below). A contractor is <b>comparable</b> only when four or more components, carrying at least 60% of the weight, are measured; otherwise read the components, not the score.</p>
    <section class="card flush"><table class="t stack"><thead><tr><th>Contractor</th><th class="num">Score</th><th>Comparable</th>${(S.scoreW || []).filter(w => w.w > 0).map(w => `<th class="num">${esc(w.l)}<br><span class="sm muted">${w.w}%</span></th>`).join('')}</tr></thead><tbody>
    ${R.map(r => `<tr><td><b>${esc(r.v.name)}</b><br><span class="sm muted">${esc(r.v.category)}</span></td><td class="num"><b>${r.score == null ? '—' : r.score.toFixed(0)}</b></td><td>${r.comparable ? badge('Comparable') : `<span class="sm muted">not comparable: ${r.used} of ${(S.scoreW || []).filter(w => w.w > 0).length} measured, ${Math.round(r.cover)}% of weight</span>`}</td>
      ${r.comp.filter(c => c.w > 0).map(c => `<td class="num" title="${esc(c.f)}">${c.used ? c.sc.toFixed(0) : `<span class="sm muted">${esc(c.note)}</span>`}${c.val != null ? `<br><span class="sm muted">${c.k === 'defects' ? c.val.toFixed(1) + '/Cr' : c.k === 'response' ? c.val.toFixed(1) + ' d' : c.k === 'safety' ? c.val : c.val.toFixed(0) + '%'} · n=${c.n}</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></section>
    <section class="card"><h3 class="h3">Formulas</h3><ul class="al">${(S.scoreW || []).map(w => `<li><b>${esc(w.l)}</b> (${w.w}%, needs ${w.min}) — ${esc(w.f)}</li>`).join('')}</ul></section>`;
}

/* ---------- procurement planning across projects; RFQs are drafts only ---------- */
function procPlan(pids, days = 60) {
  const today = todayISO(), G = {};
  for (const m of S.mrs.filter(m => pids.includes(m.projectId) && MR_OPEN.includes(m.status) && m.neededBy <= addDays(today, days))) {
    const k = norm(m.item); (G[k] = G[k] || { item: m.item, unit: m.unit, lines: [] }).lines.push(m);
  }
  return Object.values(G).map(g => {
    const Q = g.lines.flatMap(m => m.quotes || []), best = Q.length ? Q.reduce((a, b) => (a.rateP <= b.rateP ? a : b)) : null;
    const hist = S.pos.filter(x => norm(x.item) === norm(g.item) && !['Rejected', 'Cancelled'].includes(x.status)), avg = hist.length ? Math.round(sum(hist.map(x => x.rateP)) / hist.length) : null;
    const lead = best ? (best.leadDays || 7) : Math.max(7, ...hist.map(x => x.expected && x.at ? diffDays(x.at.slice(0, 10), x.expected) : 0));
    const need = minISO(g.lines.map(m => m.neededBy)), qty = sum(g.lines.map(m => m.qtyM)), prj = [...new Set(g.lines.map(m => m.projectId))];
    const onOrder = sum(S.pos.filter(x => pids.includes(x.projectId) && norm(x.item) === norm(g.item) && ['Approved', 'Part received'].includes(x.status)).map(x => x.qtyM - sum(x.grns.filter(r => r.qc === 'Pass').map(r => r.qtyM))));
    const orderBy = addDays(need, -lead), canCombine = prj.length >= 2 && orderBy >= today;
    return { ...g, qty, need, lead, leadAssumed: !best && !hist.some(x => x.expected && x.at), orderBy, prj, best, avg, onOrder, late: orderBy < today,
      advice: prj.length >= 2 ? (canCombine ? `Combine ${prj.length} projects into one RFQ for ${fmtQty(qty)} ${g.unit}; the earliest need (${fmtDate(need, false)}) still allows the ${lead}-day lead time` : 'Several projects need it, but the earliest need is inside the lead time: order separately to protect the schedule') : null,
      saving: canCombine && best && avg && avg > best.rateP ? Math.round((avg - best.rateP) * qty / 1000) : null };
  }).sort((a, b) => (a.orderBy < b.orderBy ? -1 : 1));
}
function planHTML(P0) {
  const P = P0.map(p => (typeof p === 'string' ? proj(p) : p)).filter(Boolean), pids = P.map(p => p.id), L = procPlan(pids), today = todayISO(), fin = can('budget');
  const late = S.pos.filter(x => pids.includes(x.projectId) && ['Approved', 'Part received'].includes(x.status) && x.expected && x.expected < today);
  const util = P.map(p => ({ p, t: cost(p.id).tot })).filter(x => x.t.budget);
  return `<p class="fine">Demand from open material requests in the next 60 days, across the projects in view. Advice is only advice: every purchase still goes through quotation and PO approval.</p>
    ${L.length ? `<section class="card flush"><table class="t stack"><thead><tr><th>Item</th><th class="num">Needed</th><th>Projects</th><th class="num">On order</th><th>Order by</th>${fin ? '<th class="num">Best quote</th><th class="num">Recent avg</th>' : ''}<th>Advice</th><th></th></tr></thead><tbody>
      ${L.map((r, i) => `<tr><td><b>${esc(r.item)}</b></td><td class="num">${fmtQty(r.qty)} ${esc(r.unit)}</td><td class="sm">${r.prj.map(x => esc(shortName(proj(x)))).join(', ')}</td><td class="num">${fmtQty(r.onOrder)}</td>
        <td class="nowrap ${r.late ? 'tbad' : ''}">${fmtDate(r.orderBy, false)}${r.late ? ' — late' : ''}<br><span class="sm muted">lead ${r.lead} d${r.leadAssumed ? ' (assumed: no quote or order history)' : ''}</span></td>${fin ? `<td class="num">${r.best ? fmtINR(r.best.rateP) + '<br><span class="sm muted">' + esc(vendor(r.best.vendorId).name) + '</span>' : '—'}</td><td class="num">${r.avg ? fmtINR(r.avg) : '—'}</td>` : ''}
        <td class="sm">${r.advice ? esc(r.advice) + (r.saving ? `<br><b>Possible saving ≈ ${fmtC(r.saving)}</b> <span class="muted">(recent average − best quote) × quantity</span>` : '') : '—'}</td>
        <td>${can('procurement', 'create') ? `<button class="btn sm" data-act="rfqDraft" data-i="${i}">Draft RFQ</button>` : ''}</td></tr>`).join('')}</tbody></table></section>` : empty('No open demand in the next 60 days')}
    <div class="g2"><section class="card flush"><div class="pad"><h3 class="h3">Late deliveries</h3></div>${late.length ? `<table class="t"><tbody>${late.map(x => `<tr class="click" data-act="po" data-id="${x.id}" tabindex="0"><td><b>${x.id}</b> ${esc(x.item)}<br><span class="sm muted">${esc(vendor(x.vendorId).name)}</span></td><td class="num tbad">${diffDays(x.expected, today)} d late</td></tr>`).join('')}</tbody></table>` : '<p class="pad sm muted">None.</p>'}</section>
      ${fin ? `<section class="card flush"><div class="pad"><h3 class="h3">Procurement budget use</h3></div><table class="t"><tbody>${util.map(x => `<tr><td>${esc(x.p.name)}</td><td class="w-pb">${bar(pctOf(x.t.committed, x.t.budget))}</td><td class="num">${Math.round(pctOf(x.t.committed, x.t.budget))}% committed</td></tr>`).join('')}</tbody></table></section>` : ''}</div>
    ${(S.rfqs || []).length ? `<section class="card flush"><div class="pad"><h3 class="h3">RFQ drafts</h3></div><table class="t stack"><thead><tr><th>RFQ</th><th>Item</th><th class="num">Quantity</th><th>Needed by</th><th>Vendors invited</th><th>Status</th></tr></thead><tbody>${S.rfqs.map(r => `<tr><td class="mono sm">${r.id}</td><td>${esc(r.item)}</td><td class="num">${fmtQty(r.qty)} ${esc(r.unit)}</td><td>${fmtDate(r.need, false)}</td><td class="sm">${r.vendors.map(v => esc(vendor(v).name)).join(', ')}</td><td>${badge(r.status)}</td></tr>`).join('')}</tbody></table><p class="pad fine">Drafts only. Sending is manual (email is not connected in this build) and the chosen quotation still needs PO approval.</p></section>` : ''}`;
}
ACT.rfqDraft = el => {
  const P = myProjects().filter(p => inScope(p.id)), r = procPlan(P.map(p => p.id))[Number(el.dataset.i)]; if (!r) return;
  const vs = [...new Set([...r.lines.flatMap(m => (m.quotes || []).map(q => q.vendorId)), ...S.vendors.filter(v => v.approved !== false && S.pos.some(x => x.vendorId === v.id && norm(x.item) === norm(r.item))).map(v => v.id)])];
  const id = nid('RFQ'); S.rfqs = S.rfqs || []; S.rfqs.unshift({ id, item: r.item, unit: r.unit, qty: r.qty, need: r.need, lines: r.lines.map(m => ({ mr: m.id, pid: m.projectId, qtyM: m.qtyM })), vendors: vs, status: 'Draft', by: me().id, at: nowISO() });
  log('RFQ drafted', `${id}: ${fmtQty(r.qty)} ${r.unit} ${r.item} for ${r.prj.join(', ')} · ${vs.length} vendors`, r.prj[0], id); save(); render(); toast(`${id} drafted for ${vs.length} vendor${vs.length === 1 ? '' : 's'} — nothing is ordered`);
};

/* ---------- executive reports: generated from verified data, reviewed, then distributed ---------- */
const REP_KINDS = { daily: 'Daily executive report', weekly: 'Weekly report', monthly: 'Monthly report' };
function buildReport(kind) {
  const P = myProjects().filter(p => inScope(p.id)), ids = P.map(p => p.id), today = todayISO(), fin = can('budget');
  const open = (S.alerts || []).filter(a => ['Open', 'Acknowledged'].includes(a.status) && ids.includes(a.pid));
  const sec = (title, cols, rows, note = '') => ({ title, cols, rows, note });
  const prog = P.map(p => { const s = sched(p.id), e = earned(p.id); return [p.name, Math.round(s.planned) + '%', Math.round(s.earned) + '%', s.slip > 0 ? s.slip + ' days late' : 'on time', fmtDate(s.foreFinish)]; });
  const crit = open.filter(a => ['Schedule', 'Contractor'].includes(a.cat) && ['Critical', 'High'].includes(a.sev)).map(a => [shortName(proj(a.pid)), a.sev, a.title, a.next]);
  const pend = S.approvals.filter(a => a.status === 'Pending' && ids.includes(a.projectId) && ['md', 'pd'].includes(curStep(a)?.role)).map(a => [shortName(proj(a.projectId)), AP_TYPE[a.type], a.ref, a.title, roleName(curStep(a).role), Math.floor((Date.now() - Date.parse(a.at)) / 36e5) + ' h']);
  const out = [];
  if (kind === 'daily') {
    out.push(sec('Construction progress', ['Project', 'Planned', 'Earned (verified)', 'Schedule', 'Forecast handover'], prog));
    out.push(sec('Critical delays', ['Project', 'Severity', 'Delay', 'Next action'], crit));
    out.push(sec('Unresolved site issues', ['Project', 'Date', 'Issue'], S.reports.filter(r => ids.includes(r.projectId) && r.issues && diffDays(r.date, today) <= 2 && r.status !== 'Draft').map(r => [shortName(proj(r.projectId)), fmtDate(r.date, false), r.issues])));
    out.push(sec('Material shortages', ['Project', 'Item', 'Status'], open.filter(a => a.cat === 'Material').map(a => [shortName(proj(a.pid)), a.title, a.next])));
    out.push(sec('Pending management approvals', ['Project', 'Type', 'Ref', 'Title', 'Waiting for', 'Age'], pend));
    out.push(sec('Contractor activity', ['Project', 'Contractor', 'Crew', 'Work'], S.reports.filter(r => ids.includes(r.projectId) && diffDays(r.date, today) <= 1 && r.status !== 'Draft').flatMap(r => (r.contractors || []).map(c => [shortName(proj(r.projectId)), vendor(c.vendorId)?.name || '', String(c.crew || c.count || ''), c.work || c.note || '']))));
    if (fin && can('payments')) { const cr = cashReq(ids, 30); out.push(sec('Urgent cash requirements (30 days)', ['Bucket', 'Due (approved, unpaid)', 'Forecast'], cr.buckets.map(b => [b.label, fmtINR(b.due), fmtINR(b.forecast)]))); }
  } else if (kind === 'weekly') {
    out.push(sec('Project-wise progress, planned vs actual', ['Project', 'Planned', 'Earned (verified)', 'Schedule', 'Forecast handover'], prog));
    if (fin) out.push(sec('Budget movements (last 7 days)', ['Project', 'Version', 'Status', 'Reason'], S.budgets.filter(b => ids.includes(b.projectId) && b.at && diffDays(b.at.slice(0, 10), today) <= 7).map(b => [shortName(proj(b.projectId)), 'v' + b.v, b.status, b.reason || ''])));
    out.push(sec('Contractor performance', ['Contractor', 'Score', 'Comparable', 'Measured components'], contractorScores(ids).map(r => [r.v.name, r.score == null ? '—' : r.score.toFixed(0), r.comparable ? 'yes' : 'no', `${r.used} (${Math.round(r.cover)}% of weight)`])));
    out.push(sec('Procurement bottlenecks', ['Kind', 'Record', 'Project', 'Item', 'Days'], bottlenecks(ids).map(x => [x.kind, x.id, shortName(proj(x.pid)), x.what, String(x.days)])));
    out.push(sec('Risk register changes (last 7 days)', ['Project', 'Risk', 'Severity', 'Status'], S.risks.filter(r => ids.includes(r.projectId) && r.at && diffDays(r.at.slice(0, 10), today) <= 7).map(r => [shortName(proj(r.projectId)), r.title, r.severity, r.status])));
    out.push(sec('Milestones due next week', ['Project', 'Milestone', 'Baseline', 'Forecast'], P.flatMap(p => { const s = sched(p.id); return s.tasks.filter(t => t.milestone && !s.R[t.id].done && s.R[t.id].ff <= addDays(today, 7 + 7)).map(t => [shortName(p), t.name, fmtDate(t.baseFinish, false), fmtDate(s.R[t.id].ff, false)]); })));
  } else {
    if (fin) {
      out.push(sec('Portfolio investment summary', ['Project', 'Budget', 'Committed', 'Actual', 'Forecast final', 'Variance'], P.map(p => { const t = cost(p.id).tot; return [p.name, fmtINR(t.budget), fmtINR(t.committed), fmtINR(t.actual), fmtINR(t.fac), fmtINR(t.variance)]; })));
      out.push(sec('Cost performance and scenarios', ['Project', 'Best', 'Base', 'Worst', 'Contract value'], P.map(p => { const f = finIntel(p.id); return [p.name, ...f.scen.map(x => fmtINR(x.fc)), p.contractValueP != null ? fmtINR(p.contractValueP) : '—']; }), 'Scenarios are projections; assumptions are listed in Reports → Financial intelligence.'));
      if (can('payments')) out.push(sec('Cash flow forecast (90 days)', ['Bucket', 'Due', 'Forecast'], cashReq(ids, 90).buckets.map(b => [b.label, fmtINR(b.due), fmtINR(b.forecast)])));
      out.push(sec('Financial risk', ['Project', 'Alert', 'Next action'], open.filter(a => a.cat === 'Budget').map(a => [shortName(proj(a.pid)), a.title, a.next])));
    }
    out.push(sec('Construction productivity', ['Project', 'Earned value', 'BOQ value', '% earned'], P.map(p => { const e = earned(p.id); return [p.name, fin ? fmtINR(e.ev) : '—', fin ? fmtINR(e.bac) : '—', Math.round(e.pct) + '%']; })));
    out.push(sec('Project completion outlook', ['Project', 'Baseline handover', 'Forecast handover', 'Slip', 'Units ready'], P.map(p => { const s = sched(p.id), U = S.units.filter(u => u.projectId === p.id); return [p.name, fmtDate(s.baseFinish), fmtDate(s.foreFinish), s.slip + ' days', U.filter(u => ['Ready', 'Handed over'].includes(readiness(u).status)).length + '/' + U.length]; })));
    out.push(sec('Management decisions required', ['Project', 'Decision', 'Ref', 'Detail', 'Waiting for', 'Age'], [...pend, ...open.filter(a => a.sev === 'Critical').map(a => [shortName(proj(a.pid)), 'Critical alert', a.cat, a.title, a.ownerRole ? roleName(a.ownerRole) : uname(a.owner), ''])]));
  }
  return out;
}
function repExec() {
  const R = (S.reportRuns || []).filter(r => r.by === me().id || can('dashboard', 'export') || ['md', 'pd'].includes(me().role)).slice(0, 20), open = R.find(r => r.id === UI.runId);
  if (open) return execRun(open);
  return `<div class="fa left">${Object.entries(REP_KINDS).map(([k, l]) => `<button class="btn" data-act="runNew" data-k="${k}">Generate ${l.toLowerCase()}</button>`).join('')}</div>
    <p class="fine">Reports are built from the records at the moment of generation, saved as a draft, reviewed by the MD or PD, and only then distributed. Distribution is in-app; email and WhatsApp show “not configured” until a provider is connected.</p>
    ${R.length ? `<section class="card flush"><table class="t stack"><thead><tr><th>Report</th><th>Generated</th><th>Status</th><th>Reviewed by</th><th></th></tr></thead><tbody>${R.map(r => `<tr class="click" data-act="runOpen" data-id="${r.id}" tabindex="0"><td><b>${REP_KINDS[r.kind]}</b><br><span class="sm muted mono">${r.id}</span></td><td>${fmtStamp(r.at)} · ${esc(uname(r.by))}</td><td>${badge(r.status)}</td><td>${r.reviewedBy ? esc(uname(r.reviewedBy)) : '—'}</td><td><button class="btn sm">Open</button></td></tr>`).join('')}</tbody></table></section>` : empty('No reports yet', 'Generate one above.')}`;
}
function execRun(r) {
  const reviewer = ['md', 'pd'].includes(me().role), draft = r.status === 'Draft';
  return `<div class="fa left"><button class="btn ghost" data-act="runBack">← All reports</button><button class="btn" data-act="runXlsx" data-id="${r.id}">Excel</button><button class="btn" data-act="runPdf" data-id="${r.id}">PDF / print</button>
      ${draft && reviewer && r.by !== me().id ? `<button class="btn primary" data-act="runReview" data-id="${r.id}">Mark reviewed</button>` : ''}${r.status === 'Reviewed' && reviewer ? `<button class="btn primary" data-act="runSend" data-id="${r.id}">Distribute</button>` : ''}</div>
    <section class="card exec-run" id="execRun"><div class="ch"><h2 class="h2">${REP_KINDS[r.kind]}</h2><span class="sm muted">${r.id} · generated ${fmtStamp(r.at)} by ${esc(uname(r.by))} · ${badge(r.status)}${r.reviewedBy ? ` · reviewed by ${esc(uname(r.reviewedBy))}` : ''}</span></div>
      ${draft ? `<form data-form="runNote" data-id="${r.id}" class="form">${field('Management commentary (editable until reviewed)', `<textarea name="note" class="ta" rows="3" maxlength="1500">${esc(r.note || '')}</textarea>`)}<div class="fa"><button class="btn sm">Save commentary</button></div></form>` : r.note ? `<p><b>Commentary:</b> ${esc(r.note)}</p>` : ''}
      ${r.sections.map(s => `<h3 class="h3">${esc(s.title)}</h3>${s.rows.length ? `<table class="t"><thead><tr>${s.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="sm muted">Nothing to report.</p>'}${s.note ? `<p class="fine">${esc(s.note)}</p>` : ''}`).join('')}
      ${r.sent ? `<p class="fine">Distributed ${fmtStamp(r.sent.at)}: in-app to ${r.sent.to} people · email ${r.sent.email} · WhatsApp ${r.sent.wa}</p>` : ''}</section>`;
}
ACT.runNew = el => { const k = el.dataset.k, r = { id: nid('ER'), kind: k, at: nowISO(), by: me().id, status: 'Draft', sections: buildReport(k), note: '' }; (S.reportRuns = S.reportRuns || []).unshift(r); UI.runId = r.id; log('Report generated', `${r.id} ${REP_KINDS[k]} (draft)`, null, r.id); save(); render(); };
ACT.runOpen = el => { UI.runId = el.dataset.id; render(); };
ACT.runBack = () => { UI.runId = null; render(); };
FORM.runNote = (fd, f) => { const r = S.reportRuns.find(x => x.id === f.dataset.id); if (r.status !== 'Draft') return; r.note = String(fd.get('note') || '').trim(); save(); toast('Commentary saved'); };
ACT.runReview = el => { const r = S.reportRuns.find(x => x.id === el.dataset.id); if (r.by === me().id) { toast('Another person must review the report you generated', 'bad'); return; } r.status = 'Reviewed'; r.reviewedBy = me().id; r.reviewedAt = nowISO(); log('Report reviewed', r.id, null, r.id); save(); render(); };
ACT.runSend = el => {
  const r = S.reportRuns.find(x => x.id === el.dataset.id); if (r.status !== 'Reviewed') { toast('Review the report before distributing it', 'bad'); return; }
  const to = S.users.filter(u => ['md', 'pd', 'finance'].includes(u.role) && u.id !== me().id).map(u => u.id); notify(to, `${REP_KINDS[r.kind]} ${r.id} is ready`, 'reports');
  r.status = 'Distributed'; r.sent = { at: nowISO(), to: to.length, email: S.channels?.email?.enabled ? 'queued' : 'not configured', wa: S.channels?.whatsapp?.enabled ? 'queued' : 'not configured' };
  log('Report distributed', `${r.id} to ${to.length} people in-app`, null, r.id); save(); render(); toast(`Sent in-app to ${to.length}; email and WhatsApp not configured`);
};
ACT.runXlsx = async el => {
  const r = S.reportRuns.find(x => x.id === el.dataset.id);
  try { const X = await loadXLSX(), wb = X.utils.book_new();
    r.sections.forEach((s, i) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([[s.title], s.cols, ...s.rows]), (i + 1 + ' ' + s.title).replace(/[\\/?*[\]:]/g, '').slice(0, 31)));
    const data = X.write(wb, { type: 'array', bookType: 'xlsx' }), name = `${r.id}-${r.kind}.xlsx`;
    if (DL) { await DL.save({ filename: name, data: new Uint8Array(data) }); } else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name; a.click(); }
    log('Exported', `${r.id} as ${name}`, null, r.id); save(); toast('Excel file prepared');
  } catch (e) { toast('Excel export needs the spreadsheet library, which could not load here. Use PDF / print or CSV export.', 'bad'); }
};
ACT.runPdf = () => { document.body.classList.add('print-run'); setTimeout(() => { try { window.print(); } finally { document.body.classList.remove('print-run'); } }, 50); };

/* ---------- AI assistant: the seven management questions, answered from records with references ---------- */
ASK_PRESETS.splice(0, ASK_PRESETS.length, 'Which projects require my attention today?', 'What are the top five reasons our Marari resort project is delayed?', 'Which materials should we purchase this week?',
  'How much funding is required to finish the remaining villas?', 'Which contractor is responsible for the highest number of unresolved defects?', 'What will happen if the landscaping contractor is delayed by 15 days?', 'Generate an executive summary of all active projects.');
const _presetAnswer0 = presetAnswer;
presetAnswer = function (i) {
  ensurePhase3();
  const P = myProjects(), ids = P.map(p => p.id), fin = can('budget'), li = a => `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>`, ref = x => `<span class="mono sm">[${esc(x)}]</span>`;
  const A = (S.alerts || []).filter(a => ['Open', 'Acknowledged'].includes(a.status) && ids.includes(a.pid) && alertVisible(a));
  if (i === 0) { const by = P.map(p => ({ p, a: A.filter(x => x.pid === p.id) })).filter(x => x.a.length).sort((a, b) => Math.max(...b.a.map(x => SEV[x.sev])) - Math.max(...a.a.map(x => SEV[x.sev])) || b.a.length - a.a.length);
    return by.length ? `<p>${by.length} project${by.length === 1 ? '' : 's'} need attention:</p>${li(by.map(({ p, a }) => `<b>${esc(p.name)}</b> ${ref(p.id)} — ${a.filter(x => x.sev === 'Critical').length} critical, ${a.filter(x => x.sev === 'High').length} high. Top: ${esc(a.sort((x, y) => SEV[y.sev] - SEV[x.sev])[0].title)} → ${esc(a[0].next)}`))}<p class="fine">Source: the action center (open alerts you are allowed to see).</p>` : '<p>No open alerts on your projects.</p>'; }
  if (i === 1) { const p = P.find(x => /marari/i.test(x.name)); if (!p) return '<p>Marari is not among the projects you can see.</p>'; const s = sched(p.id);
    const L = s.tasks.filter(t => !s.R[t.id].done && s.R[t.id].var > 0).sort((a, b) => (s.R[b.id].critical - s.R[a.id].critical) || s.R[b.id].var - s.R[a.id].var).slice(0, 5);
    return L.length ? `<p><b>${esc(p.name)}</b> forecasts handover ${fmtDate(s.foreFinish)} (${s.slip} days late). Main causes:</p>${li(L.map(t => `${esc(t.name)} ${ref(t.key)} — ${s.R[t.id].var} days late${s.R[t.id].critical ? ', on the critical path' : ''}. Reason recorded: ${esc(t.delayReason || 'none recorded')}${t.recovery ? `; recovery: ${esc(t.recovery)}` : ''}`))}<p class="fine">Source: schedule forecast from today's actual progress. Only reasons people recorded are shown; the order is by impact.</p>` : `<p>${esc(p.name)} has no late activities.</p>`; }
  if (i === 2) { const L = procPlan(ids, 21).filter(r => r.orderBy <= addDays(todayISO(), 7));
    return L.length ? `<p>Order these by the end of this week to keep the need dates (lead time included):</p>${li(L.map(r => `${esc(r.item)} — ${fmtQty(r.qty)} ${esc(r.unit)} for ${r.prj.map(x => esc(shortName(proj(x)))).join(', ')}; order by ${fmtDate(r.orderBy, false)}${r.late ? ' (already late)' : ''}${fin && r.best ? `; best quote ${fmtINR(r.best.rateP)} from ${esc(vendor(r.best.vendorId).name)}` : ''} ${r.lines.map(m => ref(m.id)).join(' ')}`))}<p class="fine">Source: open material requests and quotations. A suggestion only: each order still needs quotation review and PO approval.</p>` : '<p>Nothing needs ordering this week.</p>'; }
  if (i === 3) { if (!fin) return '<p>Cost figures are restricted for your role.</p>'; const rows = P.map(p => { const f = finIntel(p.id), V = S.units.filter(u => u.projectId === p.id && ['villa', 'tent', 'room'].includes(u.template) && !u.handedOverAt); if (!V.length) return null;
      const left = sum(V.map(u => { const c = unitCost(u); return Math.max(c.budget, c.committed) - c.actual; })); return { p, n: V.length, left, alloc: f.allocated != null ? Math.max(f.allocated * V.length - sum(V.map(u => unitCost(u).actual)), 0) : null }; }).filter(Boolean);
    return rows.length ? `<p>Remaining funding for villas not yet handed over:</p>${li(rows.map(r => `<b>${esc(r.p.name)}</b> ${ref(r.p.id)} — ${r.n} villas: <b>${fmtC(r.left)}</b> on unit budgets and commitments${r.alloc != null ? `; ${fmtC(r.alloc)} if the project forecast is allocated by villa share` : ''}`))}<p>Total: <b>${fmtC(sum(rows.map(r => r.left)))}</b>.</p><p class="fine">Assumptions: remaining = larger of unit budget or commitment, less actual; the allocated figure spreads the forecast final cost by villa share of unit budgets. Shared works (roads, utilities, landscape) are not in the first figure. Both are projections.</p>` : '<p>No villas left to finish.</p>'; }
  if (i === 4) { const by = {}; S.snags.filter(s => ids.includes(s.projectId) && s.status !== 'Closed' && s.vendorId).forEach(s => (by[s.vendorId] = by[s.vendorId] || []).push(s)); const L = Object.entries(by).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    return L.length ? `<p><b>${esc(vendor(L[0][0]).name)}</b> has the most unresolved defects (${L[0][1].length}, ${L[0][1].filter(s => s.severity === 'Safety-critical').length} safety-critical).</p>${li(L.map(([v, s]) => `${esc(vendor(v).name)} — ${s.length} open ${s.slice(0, 4).map(x => ref(x.id)).join(' ')}`))}<p class="fine">Source: defects assigned to each contractor and not yet closed.</p>` : '<p>No open defects assigned to contractors.</p>'; }
  if (i === 5) { const L = S.tasks.filter(t => ids.includes(t.projectId) && !t.actFinish && (/landscap/i.test(t.name) || (t.contractorId && /landscap/i.test(vendor(t.contractorId)?.category || '')))); if (!L.length) return '<p>No open landscaping activity found.</p>';
    return `${li(L.map(t => { const w = whatIf(t.projectId, t.id, 15).filter(x => x.extra > 0); return `<b>${esc(proj(t.projectId).name)}</b>: ${esc(t.name)} ${ref(t.key)} +15 days → ${w.length ? w.map(x => `${esc(x.t.name)} moves ${x.extra} day${x.extra === 1 ? '' : 's'} to ${fmtDate(x.then)}`).join('; ') : 'no milestone moves (the delay is absorbed by float)'}`; }))}<p class="fine">Method: the schedule forecast is re-run from today's actual progress with 15 extra days on the activity; milestones move by the delay minus the activity's float. Costs of delay are not included; see the worst-case scenario in Reports → Financial intelligence.</p>`; }
  if (i === 6) { const rows = P.filter(p => p.stage !== 'Handed over').map(p => { const s = sched(p.id), t = cost(p.id).tot, a = A.filter(x => x.pid === p.id), U = S.units.filter(u => u.projectId === p.id);
      return `<b>${esc(p.name)}</b> ${ref(p.id)} — ${Math.round(s.earned)}% earned vs ${Math.round(s.planned)}% planned; handover forecast ${fmtDate(s.foreFinish)}${s.slip > 0 ? ` (${s.slip} days late)` : ''}${fin ? `; forecast cost ${fmtC(t.fac)} against ${fmtC(t.budget)}` : ''}; ${U.filter(u => ['Ready', 'Handed over'].includes(readiness(u).status)).length}/${U.length} units ready; ${a.filter(x => x.sev === 'Critical').length} critical alerts`; });
    return `<p>Executive summary, ${fmtDate(todayISO())}:</p>${li(rows)}<p class="fine">Figures are recorded or forecast as labelled; for a reviewed report use Reports → Executive reports.</p>`; }
  return _presetAnswer0(i);
};
const _aiTools0 = AI_TOOLS;
AI_TOOLS = () => [..._aiTools0(), ...[
  { name: 'action_center', description: 'Open alerts: severity, category, project, owner, next action and record ids.', execute: () => (S.alerts || []).filter(a => ['Open', 'Acknowledged'].includes(a.status) && alertVisible(a)).slice(0, 60).map(a => ({ id: a.id, project: a.pid, severity: a.sev, category: a.cat, title: a.title, owner: a.owner ? uname(a.owner) : a.ownerRole, next_action: a.next, records: (a.records || []).map(r => r.id) })) },
  { name: 'what_if_delay', description: 'Delay one activity by N days and return the milestone dates before and after. Input {task_id, days}. Read-only.', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, days: { type: 'number' } }, required: ['task_id', 'days'] },
    execute: x => { const t = S.tasks.find(y => y.id === x.task_id || y.key === x.task_id); if (!t || !hasProject(t.projectId)) throw new Error('unknown activity'); return whatIf(t.projectId, t.id, Math.max(1, Math.min(365, Number(x.days) || 0))).map(r => ({ milestone: r.t.name, now: r.now, if_delayed: r.then, extra_days: r.extra })); } },
  { name: 'purchase_plan', description: 'Materials to order across projects with need date, lead time, order-by date and consolidation advice. Suggestions only.', execute: () => procPlan(myProjects().map(p => p.id), 30).map(r => ({ item: r.item, qty: fmtQty(r.qty) + ' ' + r.unit, projects: r.prj, need_by: r.need, order_by: r.orderBy, advice: r.advice, requests: r.lines.map(m => m.id) })) },
  { name: 'contractor_scores', description: 'Weighted contractor scores with components, sample sizes and whether comparable.', execute: () => contractorScores(myProjects().map(p => p.id)).map(r => ({ contractor: r.v.name, score: r.score == null ? null : Math.round(r.score), comparable: r.comparable, components: r.comp.filter(c => c.used).map(c => ({ metric: c.l, score: Math.round(c.sc), n: c.n })) })) },
  { name: 'scenarios', description: 'Best/base/worst final cost per project with stated assumptions (projections). Rupees.', execute: () => can('budget') ? myProjects().map(p => ({ project: p.id, scenarios: finIntel(p.id).scen.map(s => ({ scenario: s.name, final_cost: Math.round(s.fc / 100), assumptions: s.note })) })) : 'restricted' }]];

/* ---------- mobile site additions ---------- */
async function compressImage(file, max = 1600, q = 0.8) {   // full image ≤ 1600 px and a 320 px thumbnail, both JPEG
  const bmp = await createImageBitmap(file), one = (lim, qq) => { const k = Math.min(1, lim / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', qq); };
  const full = one(max, q), thumb = one(320, 0.7); return { full, thumb, before: file.size, after: Math.round(full.length * 0.75), w: bmp.width, h: bmp.height };
}
ACT.quickPhoto = el => { const pid = el.dataset.pid, U = S.units.filter(u => u.projectId === pid); openModal('Progress photographs', `<form data-form="quickPhoto" data-pid="${pid}" class="form">${field('Photos', '<input type="file" name="f" accept="image/*" capture="environment" multiple required>', 'Compressed on this phone before upload (max 1600 px) with a small thumbnail for lists.')}
  ${field('Unit', `<select name="unit"><option value="">Site-wide</option>${U.map(u => opt(u.id, u.code + ' ' + u.name)).join('')}</select>`)}${field('Caption', '<input name="cap" maxlength="120" placeholder="e.g. V-05 roof slab casting">')}<div class="fa"><button class="btn primary">Save photos</button></div></form>`); };
FORM.quickPhoto = async (fd, f) => {
  const files = fd.getAll('f').filter(x => x && x.size); if (!files.length) { toast('Choose at least one photo', 'bad'); return; }
  let b = 0, a = 0; S.photos = S.photos || [];
  for (const file of files.slice(0, 6)) { if (!/^image\//.test(file.type)) { toast(`${file.name} is not an image`, 'bad'); continue; } const r = await compressImage(file); const key = nid('PH'); BLOBS[key] = r.full; b += r.before; a += r.after;
    S.photos.unshift({ id: key, key, projectId: f.dataset.pid, unitId: fd.get('unit') || null, caption: String(fd.get('cap') || '').trim(), thumb: r.thumb, date: todayISO(), by: me().id, name: file.name }); }
  if (S.photos.length > 120) S.photos.length = 120;
  log('Photos added', `${files.length} photo(s), ${Math.round(b / 1024)} KB → ${Math.round(a / 1024)} KB after compression`, f.dataset.pid); closeModal(); save(); render(); toast(`Saved · ${Math.round(b / 1024)} KB compressed to ${Math.round(a / 1024)} KB`);
};
ACT.quickDone = el => { const pid = el.dataset.pid, s = sched(pid), T = s.tasks.filter(t => !t.milestone && s.R[t.id].started && !s.R[t.id].done);
  openModal('Activity completed', T.length ? `<ul class="al">${T.map(t => `<li><span><b>${esc(t.name)}</b><br><span class="sm muted">${t.progress}% · forecast ${fmtDate(s.R[t.id].ff, false)}</span></span><button class="btn sm primary" data-act="quickDoneGo" data-pid="${pid}" data-id="${t.id}">Done today</button></li>`).join('')}</ul><p class="fine">Recorded as 100% in today's report; it counts only after the project manager verifies the report.</p>` : empty('No activity in progress')); };
ACT.quickDoneGo = el => { const r = todayDraft(el.dataset.pid), t = S.tasks.find(x => x.id === el.dataset.id), w = r.work.find(x => x.taskId === t.id); if (w) w.to = 100; else r.work.push({ taskId: t.id, to: 100, boqId: null, qtyM: null, note: 'Completed' }); log('Draft saved', `${t.name} marked complete in today's report`, el.dataset.pid, r.id); closeModal(); save(); render(); toast('Added to today’s report as complete'); };
ACT.quickGrn = el => { const pid = el.dataset.pid, L = S.pos.filter(x => x.projectId === pid && ['Approved', 'Part received'].includes(x.status));
  openModal('Material receipt', L.length ? `<ul class="al">${L.map(x => { const rec = sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)); return `<li><span><b>${esc(x.item)}</b><br><span class="sm muted">${x.id} · ${esc(vendor(x.vendorId).name)} · ${fmtQty(x.qtyM - rec)} ${esc(x.unit)} outstanding${x.expected ? ' · due ' + fmtDate(x.expected, false) : ''}</span></span><button class="btn sm primary" data-act="grn" data-id="${x.id}">Receive</button></li>`; }).join('')}</ul>` : empty('Nothing awaiting delivery')); };
const _todayRender0 = VIEWS.today.render;
VIEWS.today.render = function () {
  const h = _todayRender0.call(this), pid = UI.todayP; if (!pid || !hasProject(pid)) return h;
  const tile = (act, label, sub2) => `<button class="tile" data-act="${act}" data-pid="${pid}"><span class="tl-t">${label}</span><span class="tl-s">${sub2}</span></button>`;
  return h.replace('<section class="tiles">', `<section class="tiles">${tile('quickDone', 'Activity done', 'Mark finished work')}${can('procurement', 'edit') ? tile('quickGrn', 'Material receipt', 'Record a delivery') : ''}${tile('quickPhoto', 'Photos', 'Compressed, tagged to a unit')}`);
};
/* less retyping (B19): invoice quantity starts at the accepted, not-yet-invoiced quantity; yesterday's labour can be copied */
const _invNew0 = MODALS.invNew;
MODALS.invNew = function (...a) { _invNew0.apply(this, a); const sel = $('#modal select[name=po]'), q = $('#modal input[name=qty]'); if (!sel || !q || q.value) return; const po = S.pos.find(x => x.id === sel.value); if (!po) return;
  const left = sum(po.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)) - sum(S.invoices.filter(i => i.poId === po.id && i.status !== 'Rejected').map(i => i.qtyM)); if (left > 0) q.value = qtyInput(left); };
ACT.copyLabour = () => { const pid = UI.rf && UI.rf.pid, last = S.reports.filter(r => r.projectId === pid && r.date < todayISO() && r.status !== 'Draft').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!last) { toast('No earlier report to copy from', 'bad'); return; } (last.labour || []).forEach(l => { const i = $(`#modal input[name="lab_${l.trade}"]`); if (i) i.value = l.count; }); toast(`Labour copied from ${fmtDate(last.date, false)} — check today’s numbers`); };
const _rf0 = MODALS.reportForm;
MODALS.reportForm = function (...a) { _rf0.apply(this, a); const anchor = $('#modal input[name^="lab_"]'); if (anchor && !$('#modal [data-act=copyLabour]')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ghost'; b.dataset.act = 'copyLabour'; b.textContent = 'Copy yesterday’s labour'; const fs = anchor.closest('fieldset') || anchor.closest('.form'); fs.insertBefore(b, fs.firstElementChild ? fs.firstElementChild.nextSibling : null); } };
