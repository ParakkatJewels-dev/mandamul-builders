'use strict';
/* M Andamul — Development OS · Phase 1 prototype · core engine
   Money is held as integer paise, quantities as integer milli-units. No float maths on totals. */

const APP_KEY = 'mandamul-devos-demo-v1';
const SCHEMA = 4;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = a => a.reduce((x, y) => x + y, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad = (n, w) => String(n).padStart(w, '0');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------- dates (ISO yyyy-mm-dd, calendar days) ---------- */
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function maxISO(a) { return a.reduce((m, x) => (x > m ? x : m)); }
function minISO(a) { return a.reduce((m, x) => (x < m ? x : m)); }
function fmtDate(s, yr = true) { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1] + (yr ? ' ' + y : ''); }
const nowISO = () => new Date().toISOString();
function fmtStamp(t) { const d = new Date(t); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2); }
function ago(t) { const m = Math.round((Date.now() - Date.parse(t)) / 6e4); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago'; const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago'; }
function stampDaysAgo(n, hh = 10, mm = 0) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hh, mm, 0, 0); return d.toISOString(); }

/* ---------- money & quantities (integers) ---------- */
function mulDiv(a, b, d) {
  const A = BigInt(Math.round(a)) * BigInt(Math.round(b)), D = BigInt(d);
  let q = A / D, r = A % D; if (r < 0n) r = -r;
  if (r * 2n >= D) q += A < 0n ? -1n : 1n;
  return Number(q);
}
const lineAmt = (qtyM, rateP) => mulDiv(qtyM, rateP, 1000);      // paise
const gstOf = (amtP, pct) => mulDiv(amtP, Math.round(pct * 100), 10000);
function fmtINR(p) {
  if (p == null || isNaN(p)) return '—';
  const neg = p < 0, a = Math.abs(p), r = Math.floor(a / 100), ps = a % 100;
  return (neg ? '−' : '') + '₹' + r.toLocaleString('en-IN') + (ps ? '.' + pad(ps, 2) : '');
}
function fmtC(p) { // compact for KPIs: ₹38.50 Cr · ₹14.6 L
  if (p == null) return '—';
  const neg = p < 0, a = Math.abs(p) / 100; let s;
  if (a >= 1e7) s = (a / 1e7).toFixed(2) + ' Cr'; else if (a >= 1e5) s = (a / 1e5).toFixed(1) + ' L'; else s = Math.round(a).toLocaleString('en-IN');
  return (neg ? '−' : '') + '₹' + s;
}
function parseMoney(s) {
  s = String(s ?? '').replace(/[₹,\s]/g, ''); if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.'); return Number(i) * 100 + Number((f + '00').slice(0, 2));
}
function parseQty(s) {
  s = String(s ?? '').replace(/[,\s]/g, ''); if (!/^\d+(\.\d{0,3})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.'); return Number(i) * 1000 + Number((f + '000').slice(0, 3));
}
function fmtQty(m) {
  if (m == null) return '—';
  const neg = m < 0, a = Math.abs(m), i = Math.floor(a / 1000), f = a % 1000;
  return (neg ? '−' : '') + i.toLocaleString('en-IN') + (f ? '.' + pad(f, 3).replace(/0+$/, '') : '');
}
const moneyInput = p => (p == null ? '' : (Math.floor(p / 100) + (p % 100 ? '.' + pad(p % 100, 2) : '')));
const qtyInput = m => (m == null ? '' : (Math.floor(m / 1000) + (m % 1000 ? '.' + pad(m % 1000, 3).replace(/0+$/, '') : '')));
const pctOf = (a, b) => (b ? (a * 100) / b : 0); // display only

/* ---------- reference data ---------- */
const MODULES = [
  ['dashboard', 'Executive dashboard'], ['projects', 'Projects'], ['schedule', 'Schedule & tasks'],
  ['site', 'Daily site reports'], ['boq', 'BOQ & estimates'], ['budget', 'Budgets & cost figures'],
  ['procurement', 'Procurement & vendors'], ['contracts', 'Contracts & contractor billing'], ['payments', 'Invoices & payments'],
  ['quality', 'Inspections & defects'], ['handover', 'Units, readiness & handover'], ['approvals', 'Approvals'], ['documents', 'Documents'],
  ['settings', 'Users, roles & settings'], ['audit', 'Audit log']
];
const ACTIONS = ['view', 'create', 'edit', 'approve', 'export'];
const UNITS = ['cum', 'sqm', 'rmt', 'MT', 'kg', 'nos', 'set', 'point', 'TR', 'key', 'bag', 'month', 'LS', '%'];
const PROP_TYPES = ['Luxury resort', 'Boutique hotel', 'Private pool villas', 'Beach resort', 'Hill-station resort', 'Wellness retreat', 'Luxury homestay', 'Glamping property', 'Renovation / expansion'];
const DOC_TYPES = ['Drawing', 'Contract', 'Permit', 'Insurance', 'BOQ', 'Purchase order', 'Invoice', 'Site photo', 'Minutes', 'Correspondence', 'Inspection report', 'Handover', 'Warranty'];
const UPLOAD_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'dwg', 'dxf', 'xlsx', 'xls', 'csv', 'docx'];
const WEATHER = ['Clear', 'Cloudy', 'Mist', 'Light rain', 'Heavy rain'];
const TRADES = ['Mason', 'Helper', 'Bar bender', 'Carpenter', 'Electrician', 'Plumber', 'Welder', 'Painter', 'Tiler', 'Machine operator'];
const PRIVILEGED = ['super_admin', 'md', 'pd', 'finance'];

/* ---------- state ---------- */
let S = null;
const UI = { pf: 'all', ptab: 'overview', btab: 'cost', prtab: 'mr', atab: 'mine', stab: 'users', roleSel: 'pm', pof: 'all', srf: 'all', docq: '', doct: 'all', boqq: '', auditq: '', open: {} };
const BLOBS = {}; // session-only object URLs for uploaded files
function save() { try { localStorage.setItem(APP_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: session only */ } }
function load() { try { const t = localStorage.getItem(APP_KEY); if (t) { const s = JSON.parse(t); if (s && s.meta && s.meta.schema === SCHEMA) return s; } } catch (e) {} return null; }

function nid(prefix) {
  const q = S.meta.seq; q[prefix] = (q[prefix] || 0) + 1; const n = q[prefix], yy = todayISO().slice(2, 4);
  if (prefix === 'AU' || prefix === 'N' || prefix === 'C' || prefix === 'X') return prefix + n;
  return prefix + '-' + yy + '-' + pad(n, 4);
}

/* ---------- session & permissions (data-driven, never hardcoded per screen) ---------- */
const me = () => S && S.users.find(u => u.id === S.session?.userId);
const userById = id => S.users.find(u => u.id === id);
const uname = id => userById(id)?.name || (id === 'system' ? 'System' : 'Unknown user');
const roleById = id => S.roles.find(r => r.id === id);
const roleName = id => roleById(id)?.name || id;
function can(mod, act = 'view', u = me()) { if (!u) return false; const r = roleById(u.role); return !!(r && r.active && r.perms[mod] && r.perms[mod][act]); }
function hasProject(pid, u = me()) { return !!u && (u.projects === 'all' || u.projects.includes(pid)); }
const myProjects = () => S.projects.filter(p => hasProject(p.id));
const inScope = pid => hasProject(pid) && (UI.pf === 'all' || UI.pf === pid);
const proj = id => S.projects.find(p => p.id === id);
const vendor = id => S.vendors.find(v => v.id === id);
const codeName = c => S.costCodes.find(x => x.code === c)?.name || c;
const money = p => (can('budget') ? fmtINR(p) : '<span class="rs">Restricted</span>');
const moneyC = p => (can('budget') ? fmtC(p) : '<span class="rs">Restricted</span>');

/* ---------- audit & notifications ---------- */
function log(action, detail, pid = null, entity = null) {
  S.audit.unshift({ id: nid('AU'), at: nowISO(), userId: me()?.id || 'system', role: me()?.role || 'system', projectId: pid, action, entity, detail });
  if (S.audit.length > 1500) S.audit.length = 1500;
}
function notify(ids, text, link) { for (const id of new Set(ids)) S.notifs.unshift({ id: nid('N'), userId: id, at: nowISO(), text, link, read: false }); }

/* ---------- schedule engine: baseline vs forecast, float, critical path ---------- */
function topo(tasks) {
  const ids = new Set(tasks.map(t => t.id)), seen = new Set(), out = [], byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  const visit = (t, stack = new Set()) => {
    if (seen.has(t.id) || stack.has(t.id)) return; stack.add(t.id);
    for (const p of t.preds) if (ids.has(p)) visit(byId[p], stack);
    seen.add(t.id); out.push(t);
  };
  tasks.forEach(t => visit(t)); return out;
}
function baselineFrom(tasks, start) { // forward pass used when a plan is created
  const f = {};
  for (const t of topo(tasks)) {
    const pf = t.preds.map(p => f[p]).filter(Boolean);
    t.baseStart = pf.length ? maxISO([start, ...pf]) : start;
    t.baseFinish = addDays(t.baseStart, t.dur); f[t.id] = t.baseFinish;
  }
}
function sched(pid) {
  const p = proj(pid), T = S.tasks.filter(t => t.projectId === pid), today = todayISO(), R = {};
  if (!T.length) return { tasks: [], R, planned: 0, earned: 0, baseFinish: p.end, foreFinish: p.end, slip: 0, start: p.start };
  const order = topo(T);
  for (const t of order) {
    const pf = t.preds.map(x => R[x]?.ff).filter(Boolean), predMax = pf.length ? maxISO(pf) : p.start;
    let fs, ff;
    if (t.actFinish) { fs = t.actStart || t.baseStart; ff = t.actFinish; }
    else if (t.actStart) { fs = t.actStart; const rem = Math.ceil(t.dur * (100 - t.progress) / 100); ff = addDays(today, Math.max(rem, 0)); if (ff < fs) ff = fs; }
    else { fs = maxISO([today, t.baseStart, predMax]); ff = addDays(fs, t.dur); }
    R[t.id] = { fs, ff, var: diffDays(t.baseFinish, ff), done: !!t.actFinish, started: !!t.actStart };
  }
  const foreFinish = maxISO(Object.values(R).map(r => r.ff)), baseFinish = maxISO(T.map(t => t.baseFinish));
  const succ = {}; T.forEach(t => t.preds.forEach(x => (succ[x] = succ[x] || []).push(t.id)));
  for (const t of [...order].reverse()) {
    const r = R[t.id], ss = (succ[t.id] || []).filter(s => !R[s].done);
    const lf = ss.length ? minISO(ss.map(s => R[s].ls)) : foreFinish;
    const fd = r.started ? diffDays(today, r.ff) : diffDays(r.fs, r.ff);
    r.lf = lf; r.ls = addDays(lf, -Math.max(fd, 0)); r.float = diffDays(r.ff, lf);
    r.critical = !r.done && r.float <= 0;
    r.late = !r.done && r.var > 0; r.threat = r.critical && r.var > 0;
    r.status = r.done ? 'Done' : r.started ? (r.late ? 'Late' : 'In progress') : (r.late ? 'Late start' : 'Not started');
  }
  const W = T.filter(t => t.dur > 0), tw = sum(W.map(t => t.dur)) || 1;
  const planned = sum(W.map(t => t.dur * clamp(diffDays(t.baseStart, today) / t.dur, 0, 1))) / tw * 100;
  const earned = sum(W.map(t => t.dur * t.progress / 100)) / tw * 100;
  return { tasks: T, R, planned, earned, baseFinish, foreFinish, slip: diffDays(baseFinish, foreFinish), start: p.start };
}

/* ---------- cost engine: budget, committed, actual, pending, ETC, forecast at completion ---------- */
const COMMITTED = ['Approved', 'Part received', 'Received'];
function budgetVersions(pid) { return S.budgets.filter(b => b.projectId === pid).sort((a, b) => a.v - b.v); }
function currentBudget(pid) { const v = budgetVersions(pid).filter(b => b.status === 'Approved'); return v[v.length - 1] || null; }
function flagLevel(l) { // bad: forecast exceeds the flag % of budget · warn: commitments have used the warn % of budget
  if (!l.budget) return l.fac > 0 ? 'bad' : '';
  if (l.fac * 100 > l.budget * S.settings.flagPct) return 'bad';
  if (l.committed * 100 >= l.budget * S.settings.warnPct) return 'warn';
  return '';
}

/* ---------- approvals engine ---------- */
function poSteps(totalP, overBy, module = 'procurement') {
  const t = S.settings.thresholds, roles = ['pm'];
  if (totalP > t.pm) roles.push('pd');
  if (totalP > t.pd) roles.push('md');
  const steps = roles.map(r => ({ role: r, module, label: module === 'contracts' ? 'Approve work order' : 'Approve purchase' }));
  steps[0].label = 'Review & approve';
  if (overBy > 0) {
    const last = steps[steps.length - 1];
    if (last.role === 'md') { last.module = 'budget'; last.label = 'Approve with budget override'; }
    else steps.push({ role: 'md', module: 'budget', label: 'Budget override' });
  }
  return steps;
}
const STEP_TEMPLATES = {
  BUDGET: () => [{ role: 'finance', module: 'budget', label: 'Finance review' }, { role: 'md', module: 'budget', label: 'Approve budget' }],
  REPORT: () => [{ role: 'pm', module: 'site', label: 'Verify site report' }],
  DOC: () => [{ role: 'pd', module: 'documents', label: 'Approve for construction' }]
};
const AP_TYPE = { PO: 'Purchase order', BUDGET: 'Budget revision', REPORT: 'Daily site report', DOC: 'Document approval', CONTRACT: 'Work order', VARIATION: 'Contract variation', INVOICE: 'Vendor invoice', RABILL: 'Running bill' };
function stepUsers(ap, st) { return S.users.filter(u => u.role === st.role && hasProject(ap.projectId, u) && can(st.module, 'approve', u) && u.id !== ap.requestedBy); }
function createApproval({ type, ref, projectId, title, amountP = null, steps, ctx = {} }) {
  const ap = { id: nid('AP'), type, ref, projectId, title, amountP, ctx, requestedBy: me().id, at: nowISO(), status: 'Pending',
    steps: steps.map((s, i) => ({ ...s, status: i ? 'waiting' : 'pending', by: null, at: null, comment: '' })) };
  S.approvals.unshift(ap);
  notify(stepUsers(ap, ap.steps[0]).map(u => u.id), `${AP_TYPE[type]} ${ref} needs your ${ap.steps[0].label.toLowerCase()}`, 'approvals');
  log('Approval requested', `${AP_TYPE[type]} ${ref} → ${ap.steps.map(s => roleName(s.role)).join(' → ')}`, projectId, ap.id);
  if (typeof emit === 'function') emit('approval_requested', 'approval:' + ap.id, projectId, { approval: ap.id, ref, kind: type });
  return ap;
}
const curStep = ap => ap.steps.find(s => s.status === 'pending');
function whyCantAct(ap, u = me()) {
  if (ap.status !== 'Pending') return 'Already decided';
  const st = curStep(ap); if (!st) return 'No open step';
  if (u.role !== st.role) return `Waiting for ${roleName(st.role)}`;
  if (!can(st.module, 'approve', u)) return 'Your role lacks approve permission';
  if (!hasProject(ap.projectId, u)) return 'No access to this project';
  if (ap.requestedBy === u.id) return 'You raised this request — segregation of duties';
  if (ap.steps.some(s => s.by === u.id)) return 'You approved an earlier step';
  return '';
}
const canAct = ap => !whyCantAct(ap);
function decide(apId, decision, comment) {
  const ap = S.approvals.find(a => a.id === apId), st = curStep(ap), why = whyCantAct(ap);
  if (why) { toast(why, 'bad'); return false; }
  st.status = decision === 'approve' ? 'approved' : 'rejected'; st.by = me().id; st.at = nowISO(); st.comment = comment || '';
  log(decision === 'approve' ? 'Approved step' : 'Rejected', `${AP_TYPE[ap.type]} ${ap.ref} · ${st.label}${comment ? ' — “' + comment + '”' : ''}`, ap.projectId, ap.id);
  if (decision === 'approve') {
    const next = ap.steps.find(s => s.status === 'waiting');
    if (next) { next.status = 'pending'; notify(stepUsers(ap, next).map(u => u.id), `${AP_TYPE[ap.type]} ${ap.ref} needs your ${next.label.toLowerCase()}`, 'approvals'); }
    else { ap.status = 'Approved'; ap.closedAt = nowISO(); ON_DONE[ap.type](ap, true); notify([ap.requestedBy], `${AP_TYPE[ap.type]} ${ap.ref} was approved`, 'approvals'); }
  } else {
    ap.status = 'Rejected'; ap.closedAt = nowISO(); ap.steps.filter(s => s.status === 'waiting').forEach(s => (s.status = 'skipped'));
    ON_DONE[ap.type](ap, false); notify([ap.requestedBy], `${AP_TYPE[ap.type]} ${ap.ref} was ${ap.type === 'REPORT' ? 'returned' : 'rejected'}: ${comment}`, 'approvals');
  }
  return true;
}
const ON_DONE = {
  PO(ap, ok) {
    const po = S.pos.find(x => x.id === ap.ref);
    if (!ok) { po.status = 'Rejected'; const mr = S.mrs.find(m => m.poId === po.id); if (mr) { mr.status = 'Quotes received'; mr.poId = null; } return; }
    po.status = 'Approved'; po.approvedAt = nowISO();
    const e = (S.etc[po.projectId] = S.etc[po.projectId] || {}), before = e[po.code] || 0;
    e[po.code] = Math.max(0, before - po.totalP);
    log('Commitment recorded', `${po.id} committed ${fmtINR(po.totalP)} on ${po.code}; estimate-to-complete ${fmtINR(before)} → ${fmtINR(e[po.code])}`, po.projectId, po.id);
  },
  BUDGET(ap, ok) {
    const b = S.budgets.find(x => x.id === ap.ref); b.status = ok ? 'Approved' : 'Rejected'; b.decidedAt = nowISO();
    if (ok) log('Budget version live', `${proj(b.projectId).name} budget v${b.v} is now the approved budget (${fmtINR(sum(Object.values(b.lines)))})`, b.projectId, b.id);
  },
  REPORT(ap, ok) {
    const r = S.reports.find(x => x.id === ap.ref);
    if (!ok) { r.status = 'Returned'; r.reviewNote = curStepComment(ap); return; }
    r.status = 'Approved'; r.verifiedBy = me().id; applyReport(r);
  },
  DOC(ap, ok) {
    const d = S.docs.find(x => x.id === ap.ctx.docId), v = d.versions.find(x => x.rev === ap.ctx.rev);
    if (!ok) { v.status = 'Rejected'; return; }
    d.versions.forEach(x => { if (x.status === 'Approved') x.status = 'Superseded'; });
    v.status = 'Approved'; d.status = 'Approved';
  }
};
function curStepComment(ap) { const s = ap.steps.filter(x => x.status === 'rejected')[0]; return s ? s.comment : ''; }
function applyReport(r) { // verified quantities update schedule & BOQ
  for (const w of r.work) {
    const t = S.tasks.find(x => x.id === w.taskId);
    if (t && w.to != null && w.to > t.progress) {
      const before = t.progress; t.progress = Math.min(100, w.to);
      if (!t.actStart) t.actStart = r.date;
      if (t.progress >= 100 && !t.actFinish) t.actFinish = r.date;
      log('Progress verified', `${t.name}: ${before}% → ${t.progress}% (from ${r.id})`, r.projectId, t.id);
    }
    if (w.boqId && w.qtyM) { const b = S.boq.find(x => x.id === w.boqId); if (b) { b.doneM += w.qtyM; log('BOQ quantity executed', `${b.ref} ${b.desc}: +${fmtQty(w.qtyM)} ${b.unit} (from ${r.id})`, r.projectId, b.id); } }
  }
}

/* ---------- UI helpers ---------- */
function toast(msg, kind = 'ok') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.setAttribute('role', 'status'); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.classList.add('out'), 3600); setTimeout(() => el.remove(), 4100);
}
let lastFocus = null;
function openModal(title, body, opts = {}) {
  lastFocus = document.activeElement;
  $('#modal').innerHTML = `<div class="scrim" data-act="scrim"><div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mt">
    <div class="mh"><div><h2 id="mt">${title}</h2>${opts.sub ? `<p class="sub">${opts.sub}</p>` : ''}</div><button class="x" data-act="closeModal" aria-label="Close">${ic('x')}</button></div>
    <div class="mb">${body}</div></div></div>`;
  document.body.classList.add('locked');
  setTimeout(() => { const f = $('#modal [autofocus]') || $('#modal input:not([type=hidden]),#modal select,#modal textarea,#modal button.primary'); f && f.focus(); }, 30);
}
function keepValues(fn) { // re-render the open modal without losing what the person typed
  const f = $('#modal form'), vals = f ? [...f.elements].filter(e => e.name && e.type !== 'file').map(e => ({ n: e.name, t: e.type, c: e.checked, v: e.value })) : [];
  fn(); const g = $('#modal form'); if (!g) return;
  for (const x of vals) for (const e of [...g.elements].filter(e => e.name === x.n)) { if (x.t === 'checkbox' || x.t === 'radio') { if (e.value === x.v) e.checked = x.c; } else if (e.type !== 'file') e.value = x.v; }
}
function closeModal() { UI.modal = null; $('#modal').innerHTML = ''; document.body.classList.remove('locked'); lastFocus && lastFocus.focus && lastFocus.focus(); }
const BADGE = { Done: 'ok', Approved: 'ok', Received: 'ok', Pass: 'ok', 'On track': 'ok', Active: 'ok', Late: 'bad', 'Late start': 'bad', Rejected: 'bad', Returned: 'bad', Fail: 'bad', Restricted: 'bad', 'Pending approval': 'warn', Pending: 'warn', Submitted: 'warn', 'Quotes received': 'warn', Quoting: 'warn', 'Part received': 'info', 'In progress': 'info', 'PO raised': 'info', Draft: 'mute', 'Not started': 'mute', Superseded: 'mute', Cancelled: 'mute', waiting: 'mute', skipped: 'mute', pending: 'warn', approved: 'ok', rejected: 'bad' };
const badge = (s, label) => `<span class="bd ${BADGE[s] || 'mute'}">${esc(label || s)}</span>`;
function bar(pct, cls = '', marker = null) { return `<span class="pb ${cls}"><i style="width:${clamp(pct, 0, 100).toFixed(1)}%"></i>${marker != null ? `<b style="left:${clamp(marker, 0, 100).toFixed(1)}%"></b>` : ''}</span>`; }
const empty = (t, s = '') => `<div class="empty"><p class="et">${t}</p>${s ? `<p>${s}</p>` : ''}</div>`;
const opt = (v, l, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`;
function field(label, inner, hint = '', cls = '') { return `<label class="fld ${cls}"><span class="fl">${label}</span>${inner}${hint ? `<span class="fh">${hint}</span>` : ''}</label>`; }
const sDays = n => (n > 0 ? `+${n} days` : n < 0 ? `${n} days` : 'on baseline');

/* icons: simple stroke set */
const ICONS = {
  dash: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z', proj: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
  cal: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4', site: 'M5 21V8l7-5 7 5v13M9 21v-6h6v6', boq: 'M5 3h14v18H5zM9 7h6M9 11h6M9 15h3',
  cart: 'M3 4h2l2.5 11h11L21 7H6.5M9 20h.01M18 20h.01', check: 'M4 12l5 5L20 6', doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  log: 'M4 5h16M4 10h16M4 15h10M4 20h7', bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4', menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5', up: 'M12 19V5M6 11l6-6 6 6',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01', spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  unit: 'M3 21V9l9-6 9 6v12M9 21v-7h6v7M3 13h18', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', wallet: 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', hard: 'M3 18h18M5 18v-3a7 7 0 0114 0v3M12 8V5', today: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4M8 14h3v3H8z', key: 'M7 14a4 4 0 113.4-6.1L21 8v3h-2v2h-3l-1.6 1.6A4 4 0 017 14z', arrow: 'M5 12h14M13 6l6 6-6 6', lock: 'M6 11h12v10H6zM8 11V7a4 4 0 118 0v4', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0'
};
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;

/* CSV + export (downloads capability when the host offers it, clipboard otherwise) */
function toCSV(rows) { return rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n'); }
function parseCSV(text) {
  const rows = []; let row = [], v = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { v += '"'; i++; } else if (c === '"') q = false; else v += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(v); v = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(v); rows.push(row); row = []; v = ''; }
    else v += c;
  }
  if (v !== '' || row.length) { row.push(v); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
let DL = null;
async function exportCSV(filename, rows, what) {
  const data = toCSV(rows);
  if (DL) { try { await DL.save({ filename, data }); log('Exported', `${what} (${rows.length - 1} rows) as ${filename}`); save(); return; } catch (e) { /* declined or failed: fall back */ } }
  try { await navigator.clipboard.writeText(data); toast(`${what} copied as CSV — paste into Excel or Sheets`); log('Exported', `${what} (${rows.length - 1} rows) to clipboard`); save(); }
  catch (e) { openModal('Export ' + esc(what), `<p class="muted">Copy the CSV below.</p><textarea class="ta mono" rows="12" readonly>${esc(data)}</textarea>`, { wide: true }); }
}

/* ---------- registries filled by the view files ---------- */
const VIEWS = {}, ACT = {}, FORM = {}, CHG = {}, MODALS = {};
function showModal(name, id) { UI.modal = { name, id }; MODALS[name](id); }
function refresh(keepModal = true) {
  save();
  const mb = $('#modal .mb'), top = mb ? mb.scrollTop : 0;
  render();
  if (keepModal && UI.modal && $('#modal').innerHTML) { MODALS[UI.modal.name](UI.modal.id); const nb = $('#modal .mb'); if (nb) nb.scrollTop = top; }
}
