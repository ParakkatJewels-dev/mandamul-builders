'use strict';
/* Views B — daily site reports, BOQ & budgets, procurement */

/* ================= DAILY SITE REPORTS ================= */
const commercial = () => can('procurement', 'edit') && can('budget');
VIEWS.site = {
  mod: 'site', title: 'Site reports',
  render() {
    const P = myProjects().filter(p => inScope(p.id)), due = P.filter(p => p.stage === 'Construction');
    const st = due.map(p => ({ p, rs: reportStatus(p) })), inN = st.filter(x => x.rs.today).length;
    return pageHead('Daily site reports', `Today ${inN} of ${due.length} construction site${due.length === 1 ? '' : 's'} reported · cutoff ${S.settings.cutoff} · progress counts only after the project manager verifies it`, can('site', 'create') ? `<button class="btn primary" data-act="newReport">${ic('plus')}New daily report</button>` : '') +
      `<section class="sites">${st.map(({ p, rs }) => { const last = S.reports.filter(r => r.projectId === p.id && r.status !== 'Draft').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        return `<div class="site ${rs.today ? 'ok' : rs.pastCutoff ? 'bad' : 'warn'}"><p class="pr-t">${esc(p.name)}</p><p class="sm">Today: <b>${rs.today ? 'Received' : rs.pastCutoff ? 'Missing' : 'Due by ' + S.settings.cutoff}</b> · Yesterday: <b class="${rs.yesterday ? '' : 'tbad'}">${rs.yesterday ? 'Received' : 'Missed'}</b></p><p class="sm muted">Last report ${last ? fmtDate(last.date) + ' by ' + esc(uname(last.by)) : 'none'}</p></div>`; }).join('') || empty('No projects in construction')}</section>` +
      reportsList(P.map(p => p.id));
  }
};
function reportsPanel(pid) { return `<div class="ph-a end">${can('site', 'create') ? `<button class="btn primary" data-act="newReport" data-pid="${pid}">${ic('plus')}New daily report</button>` : ''}</div>` + reportsList([pid]); }
function reportsList(pids) {
  const mine = me().id, F = UI.srf;
  let R = S.reports.filter(r => pids.includes(r.projectId) && (r.status !== 'Draft' || r.by === mine));
  const counts = { all: R.length, Submitted: R.filter(r => r.status === 'Submitted').length, Returned: R.filter(r => r.status === 'Returned').length, Draft: R.filter(r => r.status === 'Draft').length };
  if (F !== 'all') R = R.filter(r => r.status === F);
  R.sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1));
  return `<section class="card flush"><div class="ch pad">${tabs([['all', 'All', counts.all], ['Submitted', 'Awaiting verification', counts.Submitted], ['Returned', 'Returned', counts.Returned], ['Draft', 'My drafts', counts.Draft]], F, 'srf')}</div>
  <table class="t stack"><thead><tr><th>Report</th><th>Date</th><th>Project</th><th>Submitted by</th><th class="num">Workers</th><th>Work recorded</th><th>Status</th></tr></thead><tbody>
  ${R.slice(0, 60).map(r => `<tr class="click" data-act="report" data-id="${r.id}" tabindex="0"><td class="mono sm nowrap">${r.id}</td><td class="nowrap">${fmtDate(r.date)}</td><td>${esc(shortName(proj(r.projectId)))}</td><td>${esc(uname(r.by))}</td><td class="num">${sum(r.labour.map(l => l.count))}</td><td class="sm">${r.work.map(w => esc(S.tasks.find(t => t.id === w.taskId)?.name || '') + (w.to != null ? ' → ' + w.to + '%' : '')).join('; ') || '—'}</td><td>${badge(r.status, r.status === 'Submitted' ? 'Awaiting verification' : r.status)}</td></tr>`).join('') || `<tr><td colspan="7">${empty('No reports match')}</td></tr>`}
  </tbody></table></section>`;
}
ACT.srf = el => { UI.srf = el.dataset.k; render(); };
ACT.newReport = el => { UI.rf = { pid: el.dataset.pid || (UI.pf !== 'all' ? UI.pf : null), id: null, photos: [] }; showModal('reportForm'); };
CHG.rfProject = el => { UI.rf.pid = el.value; keepValues(() => MODALS.reportForm()); };
MODALS.reportForm = () => {
  const rf = UI.rf, P = myProjects().filter(p => p.stage === 'Construction' || p.stage === 'Pre-construction');
  const ex = rf.id ? S.reports.find(r => r.id === rf.id) : null; if (ex) rf.pid = ex.projectId;
  if (!rf.pid && P.length === 1) rf.pid = P[0].id;
  if (!rf.pid) { openModal('New daily report', `<div class="form">${field('Which site?', `<select data-chg="rfProject" autofocus><option value="">Choose a project</option>${P.map(p => opt(p.id, p.name)).join('')}</select>`)}</div>`); return; }
  const p = proj(rf.pid), s = sched(p.id);
  const live = s.tasks.filter(t => !t.milestone && !s.R[t.id].done && (s.R[t.id].started || t.preds.every(x => S.tasks.find(y => y.id === x)?.actFinish)));
  const boq = S.boq.filter(b => b.projectId === p.id), wv = id => ex?.work.find(w => w.taskId === id) || {};
  const lab = t => ex?.labour.find(l => l.trade === t)?.count ?? '';
  const mats = ex?.materials || []; const m = i => mats[i] || {};
  openModal(ex ? `Edit ${ex.id}` : 'New daily report', `<form data-form="report" class="form">
    ${ex && ex.status === 'Returned' ? `<p class="note bad"><b>Returned by the project manager:</b> ${esc(ex.reviewNote || '')}</p>` : ''}
    <div class="g3">${field('Project', `<select data-chg="rfProject" ${ex ? 'disabled' : ''}>${P.map(x => opt(x.id, x.name, p.id)).join('')}</select>`)}${field('Report date', `<input type="date" name="date" required max="${todayISO()}" value="${ex?.date || todayISO()}">`)}${field('Weather', `<select name="weather">${WEATHER.map(w => opt(w, w, ex ? ex.weather.split(',')[0] : 'Clear')).join('')}</select>`)}</div>
    ${field('Weather notes', `<input name="wnote" maxlength="80" placeholder="e.g. rain from 3 pm, 2 h lost" value="${esc(ex && ex.weather.includes(',') ? ex.weather.split(',').slice(1).join(',').trim() : '')}">`)}
    <fieldset class="fs"><legend>Labour on site (headcount)</legend><div class="g5">${TRADES.map(t => `<label class="fld"><span class="fl">${t}</span><input type="number" min="0" max="999" name="lab_${t}" inputmode="numeric" value="${lab(t)}"></label>`).join('')}</div></fieldset>
    <fieldset class="fs"><legend>Work done today</legend>${live.length ? live.map(t => `<div class="wl"><p class="sm"><b>${esc(t.name)}</b> <span class="muted">· now ${t.progress}%</span></p><div class="g3">
      <label class="fld"><span class="fl">Progress to %</span><input type="number" name="to_${t.id}" min="${t.progress}" max="100" inputmode="numeric" placeholder="${t.progress}" value="${wv(t.id).to ?? ''}"></label>
      <label class="fld"><span class="fl">BOQ item (optional)</span><select name="boq_${t.id}"><option value="">—</option>${boq.map(b => opt(b.id, b.ref + ' ' + b.desc + ' (' + b.unit + ')', wv(t.id).boqId)).join('')}</select></label>
      <label class="fld"><span class="fl">Quantity executed</span><input name="qty_${t.id}" inputmode="decimal" placeholder="0" value="${wv(t.id).qtyM ? qtyInput(wv(t.id).qtyM) : ''}"></label></div>
      <label class="fld"><span class="fl">Note</span><input name="note_${t.id}" maxlength="140" value="${esc(wv(t.id).note || '')}"></label></div>`).join('') : '<p class="muted">No activities are open for progress on this project.</p>'}</fieldset>
    <fieldset class="fs"><legend>Materials consumed</legend>${[0, 1, 2].map(i => `<div class="g3"><label class="fld"><span class="fl">Material</span><input name="mi_${i}" maxlength="60" value="${esc(m(i).item || '')}"></label><label class="fld"><span class="fl">Quantity</span><input name="mq_${i}" inputmode="decimal" value="${esc(m(i).qty || '')}"></label><label class="fld"><span class="fl">Unit</span><select name="mu_${i}">${UNITS.map(u => opt(u, u, m(i).unit || 'cum')).join('')}</select></label></div>`).join('')}</fieldset>
    <div class="g2">${field('Issues & blockers', `<textarea name="issues" rows="3" class="ta" maxlength="800">${esc(ex?.issues || '')}</textarea>`)}${field('Safety observations', `<textarea name="safety" rows="3" class="ta" maxlength="800">${esc(ex?.safety || '')}</textarea>`)}</div>
    ${field('Site photographs', `<input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple data-chg="rfPhotos">`, `Up to 6 images, 10 MB each. ${rf.photos.length ? rf.photos.length + ' attached.' : ''} In this demo photos stay in this browser tab; production stores them in secure object storage with the capture time.`)}
    ${rf.photos.length ? `<div class="thumbs">${rf.photos.map(ph => `<img src="${BLOBS[ph.key]}" alt="${esc(ph.name)}">`).join('')}</div>` : ''}
    ${S.units.some(u => u.projectId === p.id) ? field('Photos show unit', `<select name="photoUnit"><option value="">Not unit-specific</option>${S.units.filter(u => u.projectId === p.id).map(u => opt(u.id, u.code + ' ' + u.name)).join('')}</select>`, 'Tagged photos appear in the unit workspace') : ''}
    <div class="fa"><button class="btn ghost" name="intent" value="draft">Save draft</button><button class="btn primary" name="intent" value="submit">Submit for verification</button></div></form>`, { wide: true, sub: `${esc(p.name)} · drafts stay on this device until you submit` });
};
CHG.rfPhotos = el => {
  const files = [...el.files], ok = [];
  for (const f of files) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast(`${f.name}: only JPEG, PNG or WebP images`, 'bad'); continue; }
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name} is over 10 MB`, 'bad'); continue; }
    if (UI.rf.photos.length + ok.length >= 6) { toast('Up to 6 photos per report', 'bad'); break; }
    const key = 'ph' + Date.now() + Math.random().toString(36).slice(2, 6); BLOBS[key] = URL.createObjectURL(f); ok.push({ key, name: f.name, sizeKB: Math.round(f.size / 1024) });
  }
  UI.rf.photos.push(...ok); keepValues(() => MODALS.reportForm());
};
FORM.report = (fd, f, e) => {
  const intent = e && e.submitter ? e.submitter.value : 'submit', rf = UI.rf, p = proj(rf.pid), date = fd.get('date');
  if (!date || date > todayISO()) { toast('Report date cannot be in the future', 'bad'); return; }
  const ex = rf.id ? S.reports.find(r => r.id === rf.id) : null;
  const clash = S.reports.find(r => r.projectId === p.id && r.date === date && r.status !== 'Draft' && r.id !== rf.id);
  if (intent === 'submit' && clash) { toast(`${clash.id} already covers ${fmtDate(date)} for this site${clash.status === 'Returned' ? ' — edit that returned report instead' : ''}`, 'bad'); return; }
  const labour = TRADES.map(t => ({ trade: t, count: Number(fd.get('lab_' + t) || 0) })).filter(l => l.count > 0);
  if (labour.some(l => !Number.isInteger(l.count) || l.count < 0)) { toast('Headcounts must be whole numbers', 'bad'); return; }
  const work = [];
  for (const t of S.tasks.filter(x => x.projectId === p.id)) {
    const toS = fd.get('to_' + t.id); if (toS == null) continue;
    const qS = String(fd.get('qty_' + t.id) || '').trim(), boqId = fd.get('boq_' + t.id) || null, note = String(fd.get('note_' + t.id) || '').trim();
    if (toS === '' && !qS && !note) continue;
    const to = toS === '' ? null : Number(toS);
    if (to != null && (!Number.isInteger(to) || to < t.progress || to > 100)) { toast(`${t.name}: progress must be ${t.progress}–100%`, 'bad'); return; }
    let qtyM = 0; if (qS) { qtyM = parseQty(qS); if (qtyM == null) { toast(`${t.name}: quantity must be a number (up to 3 decimals)`, 'bad'); return; } if (qtyM && !boqId) { toast(`${t.name}: choose the BOQ item the quantity belongs to`, 'bad'); return; } }
    work.push({ taskId: t.id, to, boqId, qtyM, note });
  }
  const materials = [0, 1, 2].map(i => ({ item: String(fd.get('mi_' + i) || '').trim(), qty: String(fd.get('mq_' + i) || '').trim(), unit: fd.get('mu_' + i) })).filter(x => x.item);
  const wn = String(fd.get('wnote') || '').trim();
  const pu = fd.get('photoUnit') || null, data = { projectId: p.id, date, weather: fd.get('weather') + (wn ? ', ' + wn : ''), labour, work, materials, issues: String(fd.get('issues') || '').trim(), safety: String(fd.get('safety') || '').trim(), photos: [...(ex?.photos || []), ...rf.photos.map(ph => ({ ...ph, unitId: pu }))], contractors: ex?.contractors || [] };
  if (intent === 'submit' && !labour.length && !work.length && !data.issues) { toast('Add headcount, work done or an issue before submitting', 'bad'); return; }
  let r = ex;
  if (!r) { r = { id: nid('DR'), by: me().id, at: nowISO(), status: 'Draft', ...data }; S.reports.push(r); }
  else Object.assign(r, data, { at: nowISO() });
  if (intent === 'draft') { r.status = 'Draft'; log('Draft saved', `${r.id} for ${fmtDate(date)}`, p.id, r.id); closeModal(); toast('Draft saved on this device'); UI.srf = 'Draft'; refresh(false); return; }
  r.status = 'Submitted'; r.reviewNote = '';
  const ap = createApproval({ type: 'REPORT', ref: r.id, projectId: p.id, title: `Daily site report — ${fmtDate(date)}`, steps: STEP_TEMPLATES.REPORT() }); r.approvalId = ap.id;
  log('Site report submitted', `${r.id} · ${sum(labour.map(l => l.count))} workers · ${work.length} work line(s)`, p.id, r.id);
  closeModal(); toast(`${r.id} sent to ${uname(stepUsers(ap, ap.steps[0])[0]?.id) || 'the project manager'} for verification`); UI.srf = 'all'; refresh(false);
};
ACT.report = el => showModal('report', el.dataset.id);
MODALS.report = id => {
  const r = S.reports.find(x => x.id === id), p = proj(r.projectId), ap = S.approvals.find(a => a.id === r.approvalId);
  const editable = r.by === me().id && (r.status === 'Draft' || r.status === 'Returned') && can('site', 'create');
  openModal(`${r.id} · ${fmtDate(r.date)}`, `<div class="kv2"><div><span class="kl">Status</span>${badge(r.status, r.status === 'Submitted' ? 'Awaiting verification' : r.status)}</div><div><span class="kl">Submitted by</span>${esc(uname(r.by))} · ${fmtStamp(r.at)}</div><div><span class="kl">Weather</span>${esc(r.weather)}</div><div><span class="kl">Workers</span>${sum(r.labour.map(l => l.count))}</div>${r.verifiedBy ? `<div><span class="kl">Verified by</span>${esc(uname(r.verifiedBy))}</div>` : ''}</div>
    ${r.reviewNote && r.status === 'Returned' ? `<p class="note bad"><b>Returned:</b> ${esc(r.reviewNote)}</p>` : ''}
    <h3 class="h3">Labour</h3><p>${r.labour.map(l => `${esc(l.trade)} <b>${l.count}</b>`).join(' · ') || '—'}</p>
    <h3 class="h3">Work done</h3>${r.work.length ? `<table class="t"><thead><tr><th>Activity</th><th class="num">Progress to</th><th>BOQ quantity</th><th>Note</th></tr></thead><tbody>${r.work.map(w => { const t = S.tasks.find(x => x.id === w.taskId), b = S.boq.find(x => x.id === w.boqId); return `<tr><td>${esc(t?.name || '')}</td><td class="num">${w.to != null ? w.to + '%' : '—'}</td><td class="sm">${b && w.qtyM ? `${fmtQty(w.qtyM)} ${b.unit} · ${esc(b.ref)}` : '—'}</td><td class="sm">${esc(w.note || '')}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">No work lines.</p>'}
    ${(r.contractors || []).length ? `<h3 class="h3">Contractor activity</h3><p>${r.contractors.map(c => `${esc(vendor(c.vendorId).name)} <b>${c.crew}</b> crew${c.activity ? ' · ' + esc(c.activity) : ''}`).join('<br>')}</p>` : ''}
    <h3 class="h3">Materials consumed</h3><p>${r.materials.map(m => `${esc(m.item)} <b>${esc(m.qty)} ${esc(m.unit)}</b>`).join(' · ') || '—'}</p>
    <div class="g2"><div><h3 class="h3">Issues & blockers</h3><p>${esc(r.issues || 'None reported')}</p></div><div><h3 class="h3">Safety</h3><p>${esc(r.safety || 'None reported')}</p></div></div>
    ${r.photos.length ? `<h3 class="h3">Photographs</h3><div class="thumbs">${r.photos.map(ph => BLOBS[ph.key] ? `<img src="${BLOBS[ph.key]}" alt="${esc(ph.name)}">` : `<span class="file">${esc(ph.name)} · stored copy</span>`).join('')}</div>` : ''}
    ${ap ? chainHTML(ap) : ''}${ap && canAct(ap) ? decideButtons(ap) : ap && ap.status === 'Pending' ? demoSwitch(ap) : ''}
    ${editable ? `<div class="fa"><button class="btn primary" data-act="editReport" data-id="${r.id}">${r.status === 'Returned' ? 'Edit & resubmit' : 'Continue draft'}</button></div>` : ''}`, { wide: true, sub: esc(p.name) });
};
ACT.editReport = el => { UI.rf = { pid: null, id: el.dataset.id, photos: [] }; showModal('reportForm'); };

/* ================= BOQ, BUDGETS & COST CONTROL ================= */
VIEWS.boq = {
  mod: 'boq', title: 'BOQ & budgets', allowed: () => can('boq') || can('budget'),
  render() {
    const P = myProjects().filter(p => inScope(p.id)), pid = selProject('boqP');
    if (!pid) return pageHead('BOQ & budgets') + empty('No projects in view');
    const fin = can('budget');
    const port = fin && UI.pf === 'all' ? (() => { const all = P.map(p => { const cc = cost(p.id); return { p, c: cc.tot, ok: !!cc.version }; }), rows = all.filter(r => r.ok), pend = all.filter(r => !r.ok), t = k => sum(rows.map(r => r.c[k]));
      return `<section class="card flush"><div class="ch pad"><h2 class="h2">Portfolio cost position</h2>${can('budget', 'export') ? '<button class="btn sm" data-act="exportPortfolio">Export</button>' : ''}</div><div class="scroll"><table class="t wide pf1"><thead><tr><th>Project</th><th class="num">Approved budget</th><th class="num">Committed</th><th class="num">Actual</th><th class="num">Awaiting approval</th><th class="num">Estimate to complete</th><th class="num">Forecast at completion</th><th class="num">Variance</th></tr></thead><tbody>
      ${rows.map(({ p, c }) => `<tr class="click" data-act="pick" data-key="boqP" data-id="${p.id}" tabindex="0"><td><b>${esc(p.name)}</b></td><td class="num">${fmtINR(c.budget)}</td><td class="num">${fmtINR(c.committed)}</td><td class="num">${fmtINR(c.actual)}</td><td class="num">${fmtINR(c.pending)}</td><td class="num est">${fmtINR(c.etc)}</td><td class="num">${fmtINR(c.fac)}</td><td class="num ${c.variance < 0 ? 'tbad' : 'tok'}">${fmtINR(c.variance)}</td></tr>`).join('')}
      ${pend.map(({ p, c }) => `<tr class="click" data-act="pick" data-key="boqP" data-id="${p.id}" tabindex="0"><td><b>${esc(p.name)}</b></td><td class="num">${fmtINR(c.budget)}<br><span class="sm twarn">awaiting approval</span></td><td class="num">${fmtINR(c.committed)}</td><td class="num">${fmtINR(c.actual)}</td><td class="num">${fmtINR(c.pending)}</td><td class="num est">${fmtINR(c.etc)}</td><td class="num muted">—</td><td class="num muted">—</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Total${pend.length ? ' (approved budgets)' : ''}</td>${['budget', 'committed', 'actual', 'pending', 'etc', 'fac', 'variance'].map(k => `<td class="num">${fmtINR(t(k))}</td>`).join('')}</tr></tfoot></table></div></section>`; })() : '';
    const T = [fin && ['cost', 'Cost control'], can('boq') && ['boq', 'Bill of quantities'], fin && ['versions', 'Budget versions']].filter(Boolean);
    if (!T.some(t => t[0] === UI.btab)) UI.btab = T[0][0];
    const body = UI.btab === 'cost' ? costPanel(pid) : UI.btab === 'boq' ? boqPanel(pid) : versionsPanel(pid);
    return pageHead('BOQ & budgets', 'Every BOQ line and purchase traces to a project, work package and cost code') + port + projectPicker('boqP') + `<h2 class="h2 sec">${esc(proj(pid).name)}</h2>` + tabs(T, UI.btab, 'btab') + `<div class="panel">${body}</div>`;
  }
};
ACT.btab = el => { UI.btab = el.dataset.k; render(); };
function costPanel(pid) {
  if (!can('budget')) return empty('Cost figures are restricted', 'Your role does not include budget visibility.');
  const c = cost(pid), pendingRev = S.budgets.find(b => b.projectId === pid && b.status === 'Pending'), edit = can('budget', 'edit');
  const head = `<div class="ch"><div><p class="sm muted">${c.version ? `Approved budget v${c.version.v} (${esc(c.version.reason)})` : 'No approved budget yet — purchase orders are blocked until Finance and the MD approve one.'}${pendingRev ? ` · <b>v${pendingRev.v} awaiting approval</b>` : ''}</p></div>
    <div class="ph-a">${can('budget', 'export') ? `<button class="btn sm" data-act="exportCost" data-id="${pid}">Export</button>` : ''}${can('budget', 'create') && c.version ? `<button class="btn sm primary" data-act="budgetRev" data-id="${pid}">Request budget revision</button>` : ''}</div></div>`;
  return `<section class="card flush"><div class="pad">${head}</div><div class="scroll"><table class="t wide cost"><thead><tr><th>Cost code</th><th class="num">${c.provisional ? 'Requested budget' : 'Budget'}</th><th class="num">Committed</th><th class="num">Actual</th><th class="num">Open commitments</th><th class="num">Awaiting approval</th><th class="num">Estimate to complete</th><th class="num">Forecast</th><th class="num">Variance</th><th>Forecast vs budget</th></tr></thead><tbody>
    ${c.lines.map(l => { const fl = flagLevel(l); return `<tr class="${fl ? 'r-' + fl : ''}"><td><b class="mono">${l.code}</b> ${esc(l.name)}</td><td class="num">${fmtINR(l.budget)}</td><td class="num"><a href="#procurement" data-act="drill" data-go="procurement" data-set='${esc(JSON.stringify({ prtab: 'po', pof: 'committed', pcode: l.code, pf: pid }))}'>${fmtINR(l.committed)}</a></td><td class="num">${fmtINR(l.actual)}</td><td class="num">${fmtINR(l.open)}</td><td class="num">${l.pending ? fmtINR(l.pending) : '—'}</td>
      <td class="num est">${edit ? `<button class="lnk" data-act="etc" data-pid="${pid}" data-code="${l.code}" aria-label="Update estimate for ${l.code}">${fmtINR(l.etc)}</button>` : fmtINR(l.etc)}</td><td class="num"><b>${fmtINR(l.fac)}</b></td><td class="num ${l.variance < 0 ? 'tbad' : ''}">${fmtINR(l.variance)}</td><td class="w-pb">${l.budget ? bar(pctOf(l.fac, l.budget * 1.25), fl || 'ok', 80) : ''}<span class="sm">${l.budget ? Math.round(pctOf(l.fac, l.budget)) + '%' : '—'}</span></td></tr>`; }).join('')}
    </tbody><tfoot><tr><td>Total</td>${['budget', 'committed', 'actual', 'open', 'pending', 'etc', 'fac', 'variance'].map(k => `<td class="num">${fmtINR(c.tot[k])}</td>`).join('')}<td><span class="sm">${c.tot.budget ? Math.round(pctOf(c.tot.fac, c.tot.budget)) + '%' : ''}</span></td></tr></tfoot></table></div>
    <div class="pad"><p class="fine"><b>Actual</b> = goods received and QC-passed, or work certified. <b>Committed</b> = approved purchase orders and work orders (includes actual). <b>Estimate to complete</b> is the quantity surveyor's estimate of uncommitted remaining cost — an estimate, not verified cost${edit ? '; select a figure to update it' : ''}. <b>Forecast</b> = committed + estimate to complete. Rows turn amber when commitments reach ${S.settings.warnPct}% of budget and red when the forecast exceeds ${S.settings.flagPct}%.</p></div></section>`;
}
ACT.exportCost = el => { const c = cost(el.dataset.id), rows = [['Code', 'Cost code', 'Budget ₹', 'Committed ₹', 'Actual ₹', 'Open commitments ₹', 'Awaiting approval ₹', 'Estimate to complete ₹', 'Forecast ₹', 'Variance ₹']]; c.lines.forEach(l => rows.push([l.code, l.name, ...['budget', 'committed', 'actual', 'open', 'pending', 'etc', 'fac', 'variance'].map(k => (l[k] / 100).toFixed(2))])); exportCSV(`cost-${el.dataset.id}.csv`, rows, 'Cost report'); };
ACT.etc = el => showModal('etc', el.dataset.pid + '|' + el.dataset.code);
MODALS.etc = key => {
  const [pid, code] = key.split('|'), l = cost(pid).lines.find(x => x.code === code);
  openModal(`Estimate to complete · ${code} ${esc(l.name)}`, `<form data-form="etc" data-key="${key}" class="form"><div class="kv2"><div><span class="kl">Budget</span>${fmtINR(l.budget)}</div><div><span class="kl">Committed</span>${fmtINR(l.committed)}</div><div><span class="kl">Current estimate</span>${fmtINR(l.etc)}</div><div><span class="kl">Forecast now</span>${fmtINR(l.fac)}</div></div>
    ${field('New estimate to complete (₹)', `<input name="etc" required inputmode="decimal" value="${moneyInput(l.etc)}" autofocus>`, 'Uncommitted cost still needed to finish this package.')}${field('Basis of the estimate', '<textarea name="why" class="ta" rows="2" required minlength="10" maxlength="400" placeholder="e.g. remeasured cottage roofs; 2,600 sqm at current tile rates"></textarea>')}
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Save estimate</button></div></form>`);
};
FORM.etc = (fd, f) => {
  const [pid, code] = f.dataset.key.split('|'), v = parseMoney(fd.get('etc')); if (v == null) { toast('Enter an amount in rupees', 'bad'); return; }
  const e = (S.etc[pid] = S.etc[pid] || {}), before = e[code] || 0; e[code] = v;
  log('Estimate updated', `${code} estimate-to-complete ${fmtINR(before)} → ${fmtINR(v)} — ${fd.get('why')}`, pid, code); closeModal(); toast('Estimate updated'); refresh(false);
};
ACT.budgetRev = el => showModal('budgetRev', el.dataset.id);
MODALS.budgetRev = pid => {
  const c = cost(pid), pend = S.budgets.find(b => b.projectId === pid && b.status === 'Pending');
  if (pend) { openModal('Budget revision', `<p>Budget v${pend.v} is already waiting for approval. One revision can be in approval at a time so every change keeps a clean history.</p><div class="fa"><button class="btn" data-act="closeModal">Close</button></div>`); return; }
  const codes = c.lines.map(l => opt(l.code, `${l.code} ${l.name} — ${fmtC(l.budget)}`)).join('');
  openModal('Request budget revision', `<form data-form="budgetRev" data-id="${pid}" class="form">
    ${field('Type of change', `<select name="mode">${opt('transfer', 'Transfer between cost codes (total unchanged)')}${opt('increase', 'Increase a cost code (total rises)')}${opt('decrease', 'Decrease a cost code (total falls)')}</select>`)}
    <div class="g2">${field('From cost code', `<select name="from">${codes}</select>`, 'Used for transfers only')}${field('To / affected cost code', `<select name="to">${codes}</select>`)}</div>
    ${field('Amount (₹)', '<input name="amt" required inputmode="decimal" placeholder="e.g. 78,00,000">')}
    ${field('Reason', '<textarea name="reason" class="ta" rows="3" required minlength="15" maxlength="600"></textarea>', 'Goes to Finance for review and the MD for approval. The current budget stays in force until then.')}
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Send for approval</button></div></form>`, { sub: `Current approved budget ${fmtINR(c.tot.budget)}` });
};
FORM.budgetRev = (fd, f) => {
  const pid = f.dataset.id, c = cost(pid), cur = c.version, mode = fd.get('mode'), from = fd.get('from'), to = fd.get('to'), amt = parseMoney(fd.get('amt'));
  if (!amt) { toast('Enter an amount greater than zero', 'bad'); return; }
  const lines = { ...cur.lines }, changes = [];
  if (mode === 'transfer') { if (from === to) { toast('Choose two different cost codes', 'bad'); return; } lines[from] -= amt; lines[to] += amt; changes.push({ code: from, delta: -amt }, { code: to, delta: amt }); }
  else { const d = mode === 'increase' ? amt : -amt; lines[to] += d; changes.push({ code: to, delta: d }); }
  for (const ch of changes) { const l = c.lines.find(x => x.code === ch.code); if (lines[ch.code] < l.committed + l.pending) { toast(`${ch.code} cannot fall below what is committed or awaiting approval (${fmtINR(l.committed + l.pending)})`, 'bad'); return; } }
  const v = Math.max(...budgetVersions(pid).map(b => b.v)) + 1;
  const bv = { id: nid('BV'), projectId: pid, v, lines, status: 'Pending', reason: String(fd.get('reason')).trim(), by: me().id, at: nowISO(), approvalId: null, changes };
  S.budgets.push(bv);
  const ap = createApproval({ type: 'BUDGET', ref: bv.id, projectId: pid, title: `${proj(pid).name} — budget v${v}`, amountP: amt, steps: STEP_TEMPLATES.BUDGET() }); bv.approvalId = ap.id;
  log('Budget revision requested', `v${v}: ${changes.map(x => `${x.code} ${x.delta > 0 ? '+' : '−'}${fmtINR(Math.abs(x.delta))}`).join(', ')}`, pid, bv.id);
  closeModal(); toast(`Budget v${v} sent to Finance`); UI.btab = 'versions'; refresh(false);
};
function versionsPanel(pid) {
  const V = budgetVersions(pid).reverse(), cur = currentBudget(pid);
  return V.map(b => { const ap = S.approvals.find(a => a.id === b.approvalId), tot = sum(Object.values(b.lines));
    return `<section class="card"><div class="ch"><div><h3 class="h3">Budget v${b.v} ${badge(b.status)}${cur && cur.id === b.id ? ' <span class="bd ok">In force</span>' : ''}</h3><p class="sm muted">${esc(uname(b.by))} · ${fmtStamp(b.at)} · total ${fmtINR(tot)}</p></div></div><p>${esc(b.reason)}</p>
    ${b.changes ? `<p class="sm">${b.changes.filter(x => x.delta).slice(0, 13).map(x => `<span class="chg">${x.code} ${x.delta > 0 ? '+' : '−'}${fmtINR(Math.abs(x.delta))}</span>`).join(' ')}</p>` : ''}${ap ? chainHTML(ap) : ''}${ap && canAct(ap) ? decideButtons(ap) : ''}</section>`; }).join('') || empty('No budget versions');
}
/* BOQ */
function boqPanel(pid) {
  if (!can('boq')) return empty('BOQ is restricted for your role');
  const q = norm(UI.boqq), items = S.boq.filter(b => b.projectId === pid && (!q || norm(b.ref + ' ' + b.desc).includes(q))), fin = can('budget'), bv = currentBudget(pid);
  const groups = S.costCodes.filter(c => items.some(b => b.code === c.code));
  const tot = sum(items.map(b => lineAmt(b.qtyM, b.rateP))), totG = sum(items.map(b => { const a = lineAmt(b.qtyM, b.rateP); return a + gstOf(a, b.gst); }));
  return `<div class="toolbar"><form data-form="boqSearch" class="search"><label class="sr" for="bq-s">Search BOQ</label>${ic('search')}<input id="bq-s" name="q" value="${esc(UI.boqq)}" placeholder="Search item or reference" inputmode="search"></form>
    <div class="ph-a">${can('boq', 'export') ? `<button class="btn sm" data-act="exportBoq" data-id="${pid}">Export</button>` : ''}${can('boq', 'create') ? `<button class="btn sm" data-act="boqImport" data-id="${pid}">Import CSV / Excel</button><button class="btn sm primary" data-act="boqItem" data-id="${pid}|new">${ic('plus')}Item</button>` : ''}</div></div>
  ${fin ? `<p class="sm muted">BOQ value ${fmtINR(tot)} + GST = ${fmtINR(totG)} · approved budget ${bv ? fmtINR(sum(Object.values(bv.lines))) : 'awaiting approval'} (includes contingency)</p>` : ''}
  ${groups.map(g => { const G = items.filter(b => b.code === g.code), ga = sum(G.map(b => lineAmt(b.qtyM, b.rateP))), gg = sum(G.map(b => { const a = lineAmt(b.qtyM, b.rateP); return a + gstOf(a, b.gst); }));
    return `<details class="grp" open><summary><b class="mono">${g.code}</b> ${esc(g.name)} <span class="muted sm">· ${G.length} item${G.length === 1 ? '' : 's'}${fin ? ' · ' + fmtINR(gg) + ' incl. GST' + (bv ? ' · budget ' + fmtINR(bv.lines[g.code] || 0) : '') : ''}</span></summary>
    <div class="scroll"><table class="t wide boqt"><thead><tr><th>Ref</th><th>Description</th><th>Unit</th><th class="num">Quantity</th>${fin ? '<th class="num">Rate</th><th class="num">Amount</th><th class="num">GST</th>' : ''}<th>Executed</th></tr></thead><tbody>
    ${G.map(b => { const a = lineAmt(b.qtyM, b.rateP), ex = pctOf(b.doneM, b.qtyM); return `<tr class="click" data-act="boqItem" data-id="${pid}|${b.id}" tabindex="0"><td class="mono sm nowrap">${esc(b.ref)}</td><td>${esc(b.desc)}</td><td>${esc(b.unit)}</td><td class="num">${fmtQty(b.qtyM)}</td>${fin ? `<td class="num">${fmtINR(b.rateP)}</td><td class="num">${fmtINR(a)}</td><td class="num">${b.gst}%</td>` : ''}<td class="w-pb">${bar(ex, ex > 100 ? 'bad' : 'ok')}<span class="sm">${fmtQty(b.doneM)} ${esc(b.unit)} · ${Math.round(ex)}%</span></td></tr>`; }).join('')}
    </tbody>${fin ? `<tfoot><tr><td colspan="5">Subtotal</td><td class="num">${fmtINR(ga)}</td><td class="num">${fmtINR(gg - ga)}</td><td></td></tr></tfoot>` : ''}</table></div></details>`; }).join('') || empty(q ? 'No BOQ items match' : 'No BOQ items yet', can('boq', 'create') ? 'Add items or import a CSV / Excel sheet.' : '')}`;
}
FORM.boqSearch = fd => { UI.boqq = String(fd.get('q') || ''); render(); };
ACT.exportBoq = el => { const fin = can('budget'), rows = [['cost_code', 'ref', 'description', 'unit', 'qty', ...(fin ? ['rate', 'gst', 'amount'] : []), 'executed_qty']]; S.boq.filter(b => b.projectId === el.dataset.id).forEach(b => rows.push([b.code, b.ref, b.desc, b.unit, qtyInput(b.qtyM), ...(fin ? [moneyInput(b.rateP), b.gst, moneyInput(lineAmt(b.qtyM, b.rateP))] : []), qtyInput(b.doneM)])); exportCSV(`boq-${el.dataset.id}.csv`, rows, 'BOQ'); };
ACT.boqItem = el => showModal('boqItem', el.dataset.id);
MODALS.boqItem = key => {
  const [pid, id] = key.split('|'), b = id === 'new' ? null : S.boq.find(x => x.id === id), ed = b ? can('boq', 'edit') : can('boq', 'create'), fin = can('budget');
  if (!ed) { openModal(esc(b.ref + ' ' + b.desc), `<div class="kv2"><div><span class="kl">Cost code</span>${b.code} ${esc(codeName(b.code))}</div><div><span class="kl">Quantity</span>${fmtQty(b.qtyM)} ${esc(b.unit)}</div><div><span class="kl">Executed</span>${fmtQty(b.doneM)} ${esc(b.unit)}</div>${fin ? `<div><span class="kl">Rate</span>${fmtINR(b.rateP)}</div><div><span class="kl">Amount</span>${fmtINR(lineAmt(b.qtyM, b.rateP))}</div>` : ''}</div>`); return; }
  openModal(b ? `Edit ${esc(b.ref)}` : 'New BOQ item', `<form data-form="boqItem" data-key="${key}" class="form">
    <div class="g2">${field('Cost code', `<select name="code">${S.costCodes.filter(c => c.code !== '13').map(c => opt(c.code, c.code + ' ' + c.name, b?.code)).join('')}</select>`)}${field('Reference', `<input name="ref" required maxlength="12" value="${esc(b?.ref || '')}" placeholder="e.g. 03.05">`)}</div>
    ${field('Description', `<input name="desc" required maxlength="140" value="${esc(b?.desc || '')}">`)}
    <div class="g4">${field('Unit', `<select name="unit">${UNITS.map(u => opt(u, u, b?.unit || 'cum')).join('')}</select>`)}${field('Quantity', `<input name="qty" required inputmode="decimal" value="${b ? qtyInput(b.qtyM) : ''}">`)}${field('Rate (₹)', `<input name="rate" required inputmode="decimal" value="${b ? moneyInput(b.rateP) : ''}">`)}${field('GST %', `<input name="gst" type="number" min="0" max="28" step="0.5" value="${b?.gst ?? 18}">`)}</div>
    ${b ? `<p class="fine">Executed so far: ${fmtQty(b.doneM)} ${esc(b.unit)}. Changes are logged with before and after values.</p>` : ''}
    <div class="fa">${b && b.doneM === 0 ? `<button type="button" class="btn ghost danger" data-act="boqDelete" data-id="${b.id}">Delete item</button>` : ''}<button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">${b ? 'Save changes' : 'Add item'}</button></div></form>`, { sub: esc(proj(pid).name) });
};
function boqRowValid(pid, r, selfId = null) {
  const err = [];
  if (!S.costCodes.some(c => c.code === r.code) || r.code === '13') err.push('unknown cost code');
  if (!r.ref) err.push('missing ref'); else if (S.boq.some(b => b.projectId === pid && b.ref === r.ref && b.id !== selfId)) err.push('ref already used');
  if (!r.desc) err.push('missing description'); if (!UNITS.includes(r.unit)) err.push('unit not recognised');
  if (r.qtyM == null || r.qtyM <= 0) err.push('quantity must be a positive number'); if (r.rateP == null) err.push('rate must be a number');
  if (!(r.gst >= 0 && r.gst <= 28)) err.push('GST must be 0–28%');
  return err;
}
FORM.boqItem = (fd, f) => {
  const [pid, id] = f.dataset.key.split('|'), r = { code: fd.get('code'), ref: String(fd.get('ref')).trim(), desc: String(fd.get('desc')).trim(), unit: fd.get('unit'), qtyM: parseQty(fd.get('qty')), rateP: parseMoney(fd.get('rate')), gst: Number(fd.get('gst')) };
  const err = boqRowValid(pid, r, id === 'new' ? null : id); if (err.length) { toast('Check: ' + err.join(', '), 'bad'); return; }
  if (id === 'new') { const b = { id: nid('BQ'), projectId: pid, doneM: 0, ...r }; S.boq.push(b); log('BOQ item added', `${r.ref} ${r.desc} · ${fmtQty(r.qtyM)} ${r.unit} × ${fmtINR(r.rateP)}`, pid, b.id); }
  else { const b = S.boq.find(x => x.id === id), ch = Object.keys(r).filter(k => b[k] !== r[k]).map(k => `${k} ${k === 'qtyM' ? fmtQty(b[k]) : k === 'rateP' ? fmtINR(b[k]) : b[k]} → ${k === 'qtyM' ? fmtQty(r[k]) : k === 'rateP' ? fmtINR(r[k]) : r[k]}`); Object.assign(b, r); if (ch.length) log('BOQ item revised', `${b.ref}: ${ch.join('; ')}`, pid, b.id); }
  closeModal(); toast('BOQ saved'); refresh(false);
};
ACT.boqDelete = el => { const b = S.boq.find(x => x.id === el.dataset.id); if (b.doneM) { toast('Executed items cannot be deleted', 'bad'); return; } S.boq = S.boq.filter(x => x.id !== b.id); log('BOQ item deleted', `${b.ref} ${b.desc}`, b.projectId, b.id); closeModal(); toast('Item deleted'); refresh(false); };
ACT.boqImport = el => { UI.imp = { pid: el.dataset.id, rows: null, name: '' }; showModal('boqImport'); };
const BOQ_TEMPLATE = 'cost_code,ref,description,unit,qty,rate,gst\n03,03.10,RCC M30 lift core walls,cum,42.5,9400,18\n08,08.10,Wooden deck flooring (IPE),sqm,310,7600,18';
MODALS.boqImport = () => {
  const im = UI.imp, R = im.rows;
  openModal('Import BOQ items', `<p class="sm">Columns: <span class="mono">cost_code, ref, description, unit, qty, rate, gst</span>. Rates in rupees excluding GST. Units: ${UNITS.join(', ')}.</p>
    <div class="ph-a"><label class="btn">Choose CSV or Excel file<input type="file" accept=".csv,.xlsx,.xls,text/csv" data-chg="boqFile" class="sr"></label><button class="btn ghost" data-act="copyTpl">Copy template</button></div>
    <form data-form="boqPaste" class="form">${field('…or paste rows', `<textarea name="csv" class="ta mono" rows="4" placeholder="${esc(BOQ_TEMPLATE)}"></textarea>`)}<div class="fa"><button class="btn">Check rows</button></div></form>
    ${R ? `<h3 class="h3">${esc(im.name)} · ${R.filter(r => !r.err.length).length} valid, ${R.filter(r => r.err.length).length} with errors</h3><div class="scroll"><table class="t"><thead><tr><th>Row</th><th>Ref</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th>Check</th></tr></thead><tbody>${R.map((r, i) => `<tr class="${r.err.length ? 'r-bad' : ''}"><td>${i + 2}</td><td class="mono sm">${esc(r.ref)}</td><td>${esc(r.desc)}</td><td class="num">${r.qtyM != null ? fmtQty(r.qtyM) + ' ' + esc(r.unit) : '—'}</td><td class="num">${r.rateP != null ? fmtINR(r.rateP) : '—'}</td><td class="sm ${r.err.length ? 'tbad' : 'tok'}">${r.err.length ? esc(r.err.join(', ')) : 'OK'}</td></tr>`).join('')}</tbody></table></div>
    <div class="fa"><button class="btn primary" data-act="boqImportGo" ${R.some(r => !r.err.length) ? '' : 'disabled'}>Import ${R.filter(r => !r.err.length).length} valid row(s)</button></div>` : ''}`, { wide: true, sub: esc(proj(im.pid).name) });
};
function stageImport(rows, name) {
  const pid = UI.imp.pid; if (!rows.length) { toast('No rows found', 'bad'); return; }
  const h = rows[0].map(x => norm(x).replace(/ /g, '_')), idx = k => h.indexOf(k), need = ['cost_code', 'ref', 'description', 'unit', 'qty', 'rate'];
  if (need.some(k => idx(k) < 0)) { toast('Header row must include ' + need.join(', '), 'bad'); return; }
  const seen = new Set();
  UI.imp.rows = rows.slice(1).map(c => { const g = k => String(c[idx(k)] ?? '').trim(); const r = { code: g('cost_code').padStart(2, '0'), ref: g('ref'), desc: g('description'), unit: g('unit'), qtyM: parseQty(g('qty')), rateP: parseMoney(g('rate')), gst: idx('gst') >= 0 && g('gst') !== '' ? Number(g('gst')) : 18 };
    r.err = boqRowValid(pid, r); if (seen.has(r.ref)) r.err.push('duplicate ref in file'); seen.add(r.ref); return r; });
  UI.imp.name = name; MODALS.boqImport();
}
FORM.boqPaste = fd => stageImport(parseCSV(String(fd.get('csv') || '')), 'Pasted rows');
ACT.copyTpl = async () => { try { await navigator.clipboard.writeText(BOQ_TEMPLATE); toast('Template copied'); } catch (e) { toast('Copy blocked — type the header row shown above', 'bad'); } };
let XLSX_P = null;
function loadXLSX() { if (window.XLSX) return Promise.resolve(window.XLSX); if (!XLSX_P) XLSX_P = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { XLSX_P = null; rej(new Error('load')); }; document.head.appendChild(s); }); return XLSX_P; }
CHG.boqFile = async el => {
  const f = el.files[0]; if (!f) return; const ext = f.name.split('.').pop().toLowerCase();
  if (f.size > 5 * 1024 * 1024) { toast('File is over 5 MB', 'bad'); return; }
  if (ext === 'csv') { stageImport(parseCSV(await f.text()), f.name); return; }
  if (ext !== 'xlsx' && ext !== 'xls') { toast('Use a .csv, .xlsx or .xls file', 'bad'); return; }
  try { const X = await loadXLSX(), wb = X.read(await f.arrayBuffer(), { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]]; stageImport(X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }), f.name + ' · ' + wb.SheetNames[0]); }
  catch (e) { toast('The Excel reader could not load here — save the sheet as CSV and import that', 'bad'); }
};
ACT.boqImportGo = () => {
  const { pid, rows } = UI.imp, ok = rows.filter(r => !r.err.length);
  ok.forEach(r => { const { err, ...x } = r; S.boq.push({ id: nid('BQ'), projectId: pid, doneM: 0, ...x }); });
  log('BOQ imported', `${ok.length} item(s) from ${UI.imp.name}; ${rows.length - ok.length} rejected by validation`, pid);
  closeModal(); toast(`${ok.length} BOQ item(s) imported`); UI.btab = 'boq'; refresh(false);
};

/* ================= PROCUREMENT ================= */
const MR_OPEN = ['Submitted', 'Quoting', 'Quotes received'];
VIEWS.procurement = {
  mod: 'procurement', title: 'Procurement',
  render() {
    const P = myProjects().filter(p => inScope(p.id)).map(p => p.id);
    const nMR = S.mrs.filter(m => P.includes(m.projectId) && MR_OPEN.includes(m.status)).length, nPO = S.pos.filter(x => P.includes(x.projectId) && x.status === 'Pending approval').length;
    const body = UI.prtab === 'po' ? poList(P) : UI.prtab === 'vendors' ? vendorList() : UI.prtab === 'planning' ? planHTML(P) : mrList(P);
    return pageHead('Procurement', 'Material request → quotations → comparison → approval → purchase order → goods receipt', can('procurement', 'create') ? `<button class="btn primary" data-act="newMR">${ic('plus')}Material request</button>` : '') +
      tabs([['mr', 'Material requests', nMR], ['po', 'Purchase orders', nPO], ['planning', 'Planning'], ['vendors', 'Vendors']], UI.prtab, 'prtab') + `<div class="panel">${body}</div>`;
  }
};
function procPanel(pid) { return `<div class="ph-a end">${can('procurement', 'create') ? `<button class="btn primary" data-act="newMR" data-pid="${pid}">${ic('plus')}Material request</button>` : ''}</div><h3 class="h3">Material requests</h3>${mrList([pid])}<h3 class="h3">Purchase orders</h3>${poList([pid])}`; }
ACT.prtab = el => { UI.prtab = el.dataset.k; UI.pcode = null; render(); };
function mrList(pids) {
  const M = S.mrs.filter(m => pids.includes(m.projectId)).sort((a, b) => (a.at < b.at ? 1 : -1));
  return `<section class="card flush"><table class="t stack"><thead><tr><th>Request</th><th>Project</th><th>Item</th><th class="num">Quantity</th><th>Cost code</th><th>Needed by</th><th>Requested by</th><th>Status</th></tr></thead><tbody>
  ${M.map(m => `<tr class="click" data-act="mr" data-id="${m.id}" tabindex="0"><td class="mono sm nowrap">${m.id}</td><td>${esc(shortName(proj(m.projectId)))}</td><td><b>${esc(m.item)}</b></td><td class="num nowrap">${fmtQty(m.qtyM)} ${esc(m.unit)}</td><td class="mono sm">${m.code}</td><td class="nowrap ${m.neededBy < todayISO() && MR_OPEN.includes(m.status) ? 'tbad' : ''}">${fmtDate(m.neededBy)}</td><td>${esc(uname(m.requestedBy))}</td><td>${badge(m.status)}</td></tr>`).join('') || `<tr><td colspan="8">${empty('No material requests')}</td></tr>`}</tbody></table></section>`;
}
function poList(pids) {
  const F = UI.pof, code = UI.pcode;
  let L = S.pos.filter(x => pids.includes(x.projectId) && (!code || x.code === code));
  const cnt = k => L.filter(x => k === 'all' || (k === 'committed' ? COMMITTED.includes(x.status) : k === 'received' ? x.grns.some(g => g.qc === 'Pass') : x.status === k)).length;
  const fl = k => (k === 'all' ? L : L.filter(x => (k === 'committed' ? COMMITTED.includes(x.status) : k === 'received' ? x.grns.some(g => g.qc === 'Pass') : x.status === k)));
  const R = fl(F).sort((a, b) => (a.at < b.at ? 1 : -1));
  return `<section class="card flush"><div class="ch pad">${tabs([['all', 'All', cnt('all')], ['Pending approval', 'Awaiting approval', cnt('Pending approval')], ['committed', 'Committed', cnt('committed')], ['received', 'With receipts', cnt('received')], ['Rejected', 'Rejected', cnt('Rejected')]], F, 'pof')}${code ? `<span class="chip on">Cost code ${code} <button class="x" data-act="clearCode" aria-label="Clear cost code filter">${ic('x')}</button></span>` : ''}</div>
  <table class="t stack"><thead><tr><th>PO</th><th>Date</th><th>Project</th><th>Vendor</th><th>Item</th><th class="num">Total</th><th>Status</th><th>Received</th></tr></thead><tbody>
  ${R.slice(0, 80).map(x => { const ap = S.approvals.find(a => a.id === x.approvalId), done = ap ? ap.steps.filter(s => s.status === 'approved').length : 0, rec = sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM));
    return `<tr class="click" data-act="po" data-id="${x.id}" tabindex="0"><td class="mono sm nowrap">${x.id}</td><td class="nowrap">${fmtDate(x.at.slice(0, 10))}</td><td>${esc(shortName(proj(x.projectId)))}</td><td>${esc(vendor(x.vendorId).name)}</td><td>${esc(x.item)} <span class="muted sm">· ${x.code}</span></td><td class="num">${money(x.totalP)}</td><td>${badge(x.status)}${x.status === 'Pending approval' && ap ? ` <span class="sm muted">${done}/${ap.steps.length}</span>` : ''}${x.budgetCheck?.overBy > 0 && x.status === 'Pending approval' ? ' <span class="bd bad">Over budget</span>' : ''}</td><td class="w-pb">${bar(pctOf(rec, x.qtyM), 'ok')}<span class="sm">${Math.round(pctOf(rec, x.qtyM))}%</span></td></tr>`; }).join('') || `<tr><td colspan="8">${empty('No purchase orders match')}</td></tr>`}
  </tbody></table>${R.length > 80 ? `<p class="fine pad">Showing 80 of ${R.length}.</p>` : ''}</section>`;
}
ACT.pof = el => { UI.pof = el.dataset.k; render(); };
ACT.clearCode = () => { UI.pcode = null; render(); };
/* material request */
ACT.newMR = el => { UI.mrDraft = { projectId: el.dataset.pid || (UI.pf !== 'all' ? UI.pf : myProjects()[0]?.id) }; showModal('newMR'); };
MODALS.newMR = () => {
  const d = UI.mrDraft || {}, P = myProjects();
  openModal('New material request', `<form data-form="newMR" class="form">
    ${d.dup ? `<p class="note bad"><b>Possible duplicate:</b> ${esc(d.dup)}. Explain why this is a separate requirement to continue.</p>` : ''}
    <div class="g2">${field('Project', `<select name="projectId">${P.map(p => opt(p.id, p.name, d.projectId)).join('')}</select>`)}${field('Cost code', `<select name="code">${S.costCodes.filter(c => c.code !== '13').map(c => opt(c.code, c.code + ' ' + c.name, d.code)).join('')}</select>`)}</div>
    ${field('Material or service', `<input name="item" required maxlength="100" value="${esc(d.item || '')}" placeholder="e.g. OPC 53 grade cement" autofocus>`)}
    <div class="g3">${field('Quantity', `<input name="qty" required inputmode="decimal" value="${esc(d.qty || '')}">`)}${field('Unit', `<select name="unit">${UNITS.map(u => opt(u, u, d.unit || 'nos')).join('')}</select>`)}${field('Needed on site by', `<input type="date" name="neededBy" required min="${todayISO()}" value="${d.neededBy || addDays(todayISO(), 10)}">`)}</div>
    <div class="g2">${field('Purpose / location of use', `<input name="note" maxlength="160" value="${esc(d.note || '')}">`)}${field('Urgency', `<select name="urgency">${['Normal', 'Urgent', 'Urgent — work stopped'].map(u => opt(u, u, d.urgency || (d.urgent ? 'Urgent — work stopped' : 'Normal'))).join('')}</select>`, 'Urgent requests alert procurement at once')}</div>
    ${d.dup ? field('Why this is not a duplicate', '<textarea name="dupNote" class="ta" rows="2" required minlength="10" maxlength="300"></textarea>') : ''}
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Submit request</button></div></form>`);
};
FORM.newMR = fd => {
  const d = { projectId: fd.get('projectId'), code: fd.get('code'), item: String(fd.get('item')).trim(), qty: String(fd.get('qty')).trim(), unit: fd.get('unit'), neededBy: fd.get('neededBy'), note: String(fd.get('note') || '').trim(), urgency: fd.get('urgency') || 'Normal' };
  const qtyM = parseQty(d.qty); if (!qtyM) { toast('Quantity must be a positive number', 'bad'); return; }
  if (!hasProject(d.projectId)) { toast('No access to that project', 'bad'); return; }
  const dupNote = String(fd.get('dupNote') || '').trim(), since = addDays(todayISO(), -30), k = norm(d.item);
  const sim = x => { const a = norm(x); return a && k && (a.includes(k) || k.includes(a)); };
  const dm = S.mrs.find(m => m.projectId === d.projectId && MR_OPEN.concat(['PO raised']).includes(m.status) && m.at.slice(0, 10) >= since && sim(m.item));
  const dp = S.pos.find(x => x.projectId === d.projectId && x.status !== 'Rejected' && x.at.slice(0, 10) >= since && sim(x.item));
  if ((dm || dp) && !dupNote) { UI.mrDraft = { ...d, dup: dm ? `${dm.id} (${dm.item}, ${fmtQty(dm.qtyM)} ${dm.unit}) is ${dm.status.toLowerCase()}` : `${dp.id} (${dp.item}) was ordered on ${fmtDate(dp.at.slice(0, 10))}` }; MODALS.newMR(); return; }
  const m = { id: nid('MR'), projectId: d.projectId, code: d.code, item: d.item, qtyM, unit: d.unit, neededBy: d.neededBy, requestedBy: me().id, at: nowISO(), status: 'Submitted', note: d.note, urgency: d.urgency, dupNote, quotes: [], vendorId: null, poId: null };
  if (d.urgency !== 'Normal') emit('material_shortage', 'shortage:' + m.id, m.projectId, { title: `${m.item} (${d.urgency})`, link: 'procurement' });
  S.mrs.push(m); log('Material request raised', `${m.id} ${m.item} · ${fmtQty(qtyM)} ${m.unit} · needed ${fmtDate(m.neededBy)}${dupNote ? ' · duplicate check overridden: ' + dupNote : ''}`, m.projectId, m.id);
  notify(S.users.filter(u => u.role === 'proc' && hasProject(m.projectId, u)).map(u => u.id), `New material request ${m.id}: ${m.item}`, 'procurement');
  UI.mrDraft = null; closeModal(); toast(`${m.id} submitted to procurement`); UI.prtab = 'mr'; refresh(false);
};
ACT.mr = el => showModal('mr', el.dataset.id);
function priceHistory(item) { const k = norm(item); return S.pos.filter(x => { const a = norm(x.item); return x.status !== 'Rejected' && (a.includes(k) || k.includes(a)); }).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 4); }
MODALS.mr = id => {
  const m = S.mrs.find(x => x.id === id), p = proj(m.projectId), com = commercial() && hasProject(m.projectId);
  const qs = m.quotes.map(q => { const a = lineAmt(m.qtyM, q.rateP), t = a + gstOf(a, q.gst); return { ...q, total: t, v: vendor(q.vendorId) }; });
  const ok = qs.filter(q => q.v.approved), l1 = ok.length ? ok.reduce((x, y) => (y.total < x.total ? y : x)) : null, ph = can('budget') ? priceHistory(m.item) : [];
  openModal(`${m.id} · ${esc(m.item)}`, `<div class="kv2"><div><span class="kl">Status</span>${badge(m.status)}</div><div><span class="kl">Quantity</span>${fmtQty(m.qtyM)} ${esc(m.unit)}</div><div><span class="kl">Cost code</span>${m.code} ${esc(codeName(m.code))}</div><div><span class="kl">Needed by</span>${fmtDate(m.neededBy)}</div><div><span class="kl">Requested by</span>${esc(uname(m.requestedBy))} · ${fmtStamp(m.at)}</div>${m.poId ? `<div><span class="kl">Purchase order</span><button class="lnk" data-act="po" data-id="${m.poId}">${m.poId}</button></div>` : ''}</div>
    ${m.note ? `<p>${esc(m.note)}</p>` : ''}${m.dupNote ? `<p class="note"><b>Duplicate check overridden:</b> ${esc(m.dupNote)}</p>` : ''}
    ${can('budget') ? `<h3 class="h3">Quotation comparison</h3>${qs.length ? `<div class="scroll"><table class="t"><thead><tr><th>Vendor</th><th class="num">Rate</th><th class="num">Total incl. GST</th><th class="num">Lead time</th><th>Note</th></tr></thead><tbody>${qs.sort((a, b) => a.total - b.total).map(q => `<tr class="${q === l1 ? 'r-ok' : ''}"><td><b>${esc(q.v.name)}</b>${q === l1 ? ' <span class="bd ok">L1</span>' : ''}${q.v.approved ? '' : ' <span class="bd bad">Not on approved list</span>'}</td><td class="num">${fmtINR(q.rateP)}/${esc(m.unit)}</td><td class="num">${fmtINR(q.total)}</td><td class="num">${q.leadDays} days</td><td class="sm">${esc(q.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No quotations yet.</p>'}
      ${ph.length ? `<p class="sm muted">Price history: ${ph.map(x => `${x.id} ${fmtINR(x.rateP)}/${esc(x.unit)} (${esc(vendor(x.vendorId).name.split(' ')[0])}, ${fmtDate(x.at.slice(0, 10), false)})`).join(' · ')}</p>` : ''}` : '<p class="muted">Commercial details are restricted for your role.</p>'}
    <div class="fa">
      ${com && m.status === 'Submitted' ? `<button class="btn" data-act="mrQuoting" data-id="${m.id}">Review & request quotations</button>` : ''}
      ${com && ['Quoting', 'Quotes received'].includes(m.status) ? `<button class="btn" data-act="addQuote" data-id="${m.id}">${ic('plus')}Quotation</button>` : ''}
      ${com && ['Quoting', 'Quotes received'].includes(m.status) && ok.length ? `<button class="btn primary" data-act="raisePO" data-id="${m.id}">Compare & raise PO</button>` : ''}
      ${MR_OPEN.includes(m.status) && (m.requestedBy === me().id || com) ? `<button class="btn ghost danger" data-act="mrCancel" data-id="${m.id}">Cancel request</button>` : ''}
    </div>${threadHTML(m.id)}`, { wide: true, sub: esc(p.name) });
};
ACT.mrQuoting = el => { const m = S.mrs.find(x => x.id === el.dataset.id); m.status = 'Quoting'; log('Request reviewed', `${m.id} accepted; quotations requested`, m.projectId, m.id); toast('Quotations requested'); refresh(); };
ACT.mrCancel = el => { UI.cancelMR = el.dataset.id; openModal('Cancel material request', `<form data-form="mrCancel" class="form">${field('Reason', '<textarea name="why" class="ta" rows="2" required minlength="5" maxlength="300" autofocus></textarea>')}<div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Keep request</button><button class="btn primary danger">Cancel request</button></div></form>`); UI.modal = null; };
FORM.mrCancel = fd => { const m = S.mrs.find(x => x.id === UI.cancelMR); m.status = 'Cancelled'; log('Request cancelled', `${m.id}: ${fd.get('why')}`, m.projectId, m.id); closeModal(); toast(`${m.id} cancelled`); refresh(false); };
ACT.addQuote = el => showModal('addQuote', el.dataset.id);
MODALS.addQuote = id => {
  const m = S.mrs.find(x => x.id === id);
  openModal('Add quotation', `<form data-form="addQuote" data-id="${id}" class="form">
    ${field('Vendor', `<select name="vendorId" required>${S.vendors.map(v => `<option value="${v.id}" ${v.approved ? '' : 'disabled'}>${esc(v.name)} — ${esc(v.category)}${v.approved ? '' : ' (not approved)'}</option>`).join('')}</select>`, 'Only vendors on the approved list can quote.')}
    <div class="g3">${field(`Rate (₹ per ${esc(m.unit)})`, '<input name="rate" required inputmode="decimal" autofocus>')}${field('GST %', '<input name="gst" type="number" min="0" max="28" step="0.5" value="18">')}${field('Lead time (days)', '<input name="lead" type="number" min="0" max="365" value="7" inputmode="numeric">')}</div>
    ${field('Terms / note', '<input name="note" maxlength="140">')}
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Add quotation</button></div></form>`, { sub: `${esc(m.id)} · ${fmtQty(m.qtyM)} ${esc(m.unit)} ${esc(m.item)}` });
};
FORM.addQuote = (fd, f) => {
  const m = S.mrs.find(x => x.id === f.dataset.id), rateP = parseMoney(fd.get('rate')), v = vendor(fd.get('vendorId'));
  if (!rateP) { toast('Enter the quoted rate', 'bad'); return; } if (!v.approved) { toast('Vendor is not on the approved list', 'bad'); return; }
  m.quotes = m.quotes.filter(q => q.vendorId !== v.id).concat([{ vendorId: v.id, rateP, gst: Number(fd.get('gst')), leadDays: Number(fd.get('lead')), note: String(fd.get('note') || '').trim() }]);
  m.status = 'Quotes received'; log('Quotation recorded', `${m.id}: ${v.name} ${fmtINR(rateP)}/${m.unit}`, m.projectId, m.id);
  toast('Quotation added'); UI.modal = { name: 'mr', id: m.id }; refresh();
};
ACT.raisePO = el => showModal('raisePO', el.dataset.id);
MODALS.raisePO = id => {
  const m = S.mrs.find(x => x.id === id), c = cost(m.projectId), line = c.lines.find(l => l.code === m.code);
  const qs = m.quotes.filter(q => vendor(q.vendorId).approved).map(q => { const a = lineAmt(m.qtyM, q.rateP), t = a + gstOf(a, q.gst); return { ...q, a, t }; }).sort((x, y) => x.t - y.t);
  if (!c.version) { openModal('Raise purchase order', `<p class="note bad">This project has no approved budget yet, so no purchase order can be raised.</p><div class="fa"><button class="btn" data-act="closeModal">Close</button></div>`); return; }
  openModal('Compare quotations & raise PO', `<form data-form="raisePO" data-id="${id}" class="form">
    <p class="sm">Cost code <b>${m.code} ${esc(line.name)}</b> · budget ${fmtINR(line.budget)} · committed ${fmtINR(line.committed)} · awaiting approval ${fmtINR(line.pending)} · <b>available ${fmtINR(line.avail)}</b></p>
    <fieldset class="fs"><legend>Select vendor</legend>${qs.map((q, i) => { const over = q.t - line.avail; return `<label class="radio-card"><input type="radio" name="vendorId" value="${q.vendorId}" ${i ? '' : 'checked'}><span><b>${esc(vendor(q.vendorId).name)}</b>${i ? '' : ' <span class="bd ok">L1</span>'}<br><span class="sm">${fmtINR(q.rateP)}/${esc(m.unit)} · ${fmtINR(q.a)} + GST ${q.gst}% = <b>${fmtINR(q.t)}</b> · ${q.leadDays} days</span>${over > 0 ? `<br><span class="sm tbad">Exceeds available budget by ${fmtINR(over)} — needs MD budget override</span>` : ''}</span></label>`; }).join('')}</fieldset>
    ${field('Reason if not choosing L1', '<input name="why" maxlength="200" placeholder="e.g. shorter lead time protects the roofing start">')}
    <p class="fine">Approval route: up to ${fmtINR(S.settings.thresholds.pm)} Project Manager; up to ${fmtINR(S.settings.thresholds.pd)} adds the Project Director; above that adds the Managing Director. Over-budget orders always add an MD budget override.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Raise PO & send for approval</button></div></form>`, { wide: true, sub: `${esc(m.id)} · ${fmtQty(m.qtyM)} ${esc(m.unit)} ${esc(m.item)}` });
};
FORM.raisePO = (fd, f) => {
  const m = S.mrs.find(x => x.id === f.dataset.id); if (m.poId) { toast(`${m.poId} already exists for this request`, 'bad'); return; }
  const vId = fd.get('vendorId'), q = m.quotes.find(x => x.vendorId === vId), why = String(fd.get('why') || '').trim();
  const sorted = m.quotes.filter(x => vendor(x.vendorId).approved).map(x => ({ x, t: lineAmt(m.qtyM, x.rateP) + gstOf(lineAmt(m.qtyM, x.rateP), x.gst) })).sort((a, b) => a.t - b.t);
  if (sorted[0].x.vendorId !== vId && why.length < 5) { toast('Give a reason for not choosing the lowest quotation', 'bad'); return; }
  const amountP = lineAmt(m.qtyM, q.rateP), taxP = gstOf(amountP, q.gst), totalP = amountP + taxP, line = cost(m.projectId).lines.find(l => l.code === m.code), overBy = Math.max(0, totalP - line.avail);
  const po = { id: nid('PO'), projectId: m.projectId, code: m.code, kind: 'Material', vendorId: vId, item: m.item, unit: m.unit, qtyM: m.qtyM, rateP: q.rateP, gst: q.gst, amountP, taxP, totalP, status: 'Pending approval', at: nowISO(), by: me().id, mrId: m.id, grns: [], budgetCheck: { availP: line.avail, overBy, at: nowISO() }, why };
  S.pos.push(po); m.status = 'PO raised'; m.vendorId = vId; m.poId = po.id;
  const ap = createApproval({ type: 'PO', ref: po.id, projectId: po.projectId, title: `${po.item} — ${vendor(vId).name}`, amountP: totalP, steps: poSteps(totalP, overBy), ctx: { overBy } }); po.approvalId = ap.id;
  log('Purchase order raised', `${po.id} from ${m.id} · ${vendor(vId).name} · ${fmtINR(totalP)}${overBy ? ' · over available budget by ' + fmtINR(overBy) : ''}${why ? ' · not L1: ' + why : ''}`, po.projectId, po.id);
  closeModal(); toast(`${po.id} sent for approval (${ap.steps.map(s => roleName(s.role)).join(' → ')})`); UI.prtab = 'po'; UI.pof = 'Pending approval'; refresh(false);
};
/* purchase order & goods receipt */
ACT.po = el => showModal('po', el.dataset.id);
MODALS.po = id => {
  const x = S.pos.find(y => y.id === id), p = proj(x.projectId), ap = S.approvals.find(a => a.id === x.approvalId), fin = can('budget');
  const rec = sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)), canGRN = can('procurement', 'edit') && hasProject(x.projectId) && ['Approved', 'Part received'].includes(x.status);
  openModal(`${x.id} · ${esc(x.item)}`, `<div class="kv2"><div><span class="kl">Status</span>${badge(x.status)}</div><div><span class="kl">Vendor</span>${esc(vendor(x.vendorId).name)}</div><div><span class="kl">Type</span>${esc(x.kind)}</div><div><span class="kl">Cost code</span>${x.code} ${esc(codeName(x.code))}</div>
    <div><span class="kl">Quantity</span>${fmtQty(x.qtyM)} ${esc(x.unit)}</div><div><span class="kl">Received / certified</span>${fmtQty(rec)} ${esc(x.unit)} (${Math.round(pctOf(rec, x.qtyM))}%)</div>
    ${fin ? `<div><span class="kl">Rate</span>${fmtINR(x.rateP)}/${esc(x.unit)}</div><div><span class="kl">Amount + GST ${x.gst}%</span>${fmtINR(x.amountP)} + ${fmtINR(x.taxP)}</div><div class="span2"><span class="kl">Total</span><b class="big">${fmtINR(x.totalP)}</b></div>` : ''}
    ${x.mrId ? `<div><span class="kl">From request</span><button class="lnk" data-act="mr" data-id="${x.mrId}">${x.mrId}</button></div>` : ''}</div>
    ${fin && x.budgetCheck ? `<p class="note ${x.budgetCheck.overBy > 0 ? 'bad' : 'ok'}"><b>Budget check at request:</b> ${x.budgetCheck.overBy > 0 ? `exceeded available budget (${fmtINR(x.budgetCheck.availP)}) by ${fmtINR(x.budgetCheck.overBy)}; MD override required.` : `within available budget of ${fmtINR(x.budgetCheck.availP)}.`}</p>` : ''}
    ${x.why ? `<p class="note"><b>Not lowest quotation:</b> ${esc(x.why)}</p>` : ''}
    ${ap ? chainHTML(ap) : ''}${ap && canAct(ap) ? decideButtons(ap) : ap && ap.status === 'Pending' ? demoSwitch(ap) : ''}
    <h3 class="h3">Goods receipts</h3>${x.grns.length ? `<table class="t"><thead><tr><th>GRN</th><th>Date</th><th class="num">Quantity</th><th>QC</th>${fin ? '<th class="num">Value</th>' : ''}<th>By</th></tr></thead><tbody>${x.grns.map(g => `<tr><td class="mono sm">${g.id}</td><td class="nowrap">${fmtDate(g.date)}</td><td class="num">${fmtQty(g.qtyM)} ${esc(x.unit)}</td><td>${badge(g.qc)}</td>${fin ? `<td class="num">${g.qc === 'Pass' ? fmtINR(g.valueP) : '—'}</td>` : ''}<td>${esc(uname(g.by))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing received yet.</p>'}
    ${canGRN ? `<div class="fa"><button class="btn primary" data-act="grn" data-id="${x.id}">Record goods receipt</button></div>` : ''}
    ${poCloseActions(x)}
    ${S.invoices.filter(i => i.poId === x.id).length ? `<h3 class="h3">Invoices</h3><ul class="al">${S.invoices.filter(i => i.poId === x.id).map(i => `<li><span class="sm mono">${i.id}</span><span><button class="lnk" data-act="inv" data-id="${i.id}">${esc(i.no)}</button> · ${money(i.totalP)} · ${esc(i.status)}</span></li>`).join('')}</ul>` : ''}`, { wide: true, sub: esc(p.name) });
};
ACT.grn = el => showModal('grn', el.dataset.id);
MODALS.grn = id => {
  const x = S.pos.find(y => y.id === id), rec = sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)), rem = x.qtyM - rec;
  openModal(`Goods receipt · ${x.id}`, `<form data-form="grn" data-id="${id}" class="form">
    <p class="sm">${esc(x.item)} · ordered ${fmtQty(x.qtyM)} ${esc(x.unit)} · outstanding <b>${fmtQty(rem)} ${esc(x.unit)}</b></p>
    <div class="g3">${field('Date received', `<input type="date" name="date" required max="${todayISO()}" value="${todayISO()}">`)}${field(`Quantity (${esc(x.unit)})`, `<input name="qty" required inputmode="decimal" value="${qtyInput(rem)}" autofocus>`)}${field('Quality check', `<select name="qc">${opt('Pass', 'Pass — accept delivery')}${opt('Fail', 'Fail — reject at gate')}</select>`)}</div>
    ${field('Note', '<input name="note" maxlength="160" placeholder="Vehicle no., challan no., test certificate reference">')}
    <p class="fine">Only a receipt with a passed quality check counts as received and as actual cost. Rejected deliveries are recorded but not counted. A stock ledger (issues to site, balances) is in the Phase 2 backlog.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Record receipt</button></div></form>`);
};
FORM.grn = (fd, f) => {
  const x = S.pos.find(y => y.id === f.dataset.id), qtyM = parseQty(fd.get('qty')), qc = fd.get('qc'), rec = sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM));
  if (!qtyM) { toast('Enter the quantity received', 'bad'); return; }
  if (qc === 'Pass' && rec + qtyM > x.qtyM) { toast(`Cannot receive more than ordered — ${fmtQty(x.qtyM - rec)} ${x.unit} outstanding`, 'bad'); return; }
  const a = lineAmt(qtyM, x.rateP), last = qc === 'Pass' && rec + qtyM === x.qtyM;
  const g = { id: nid('GRN'), date: fd.get('date'), qtyM, qc, note: String(fd.get('note') || '').trim(), by: me().id, valueP: qc !== 'Pass' ? 0 : last ? x.totalP - acceptedP(x) : a + gstOf(a, x.gst) };
  x.grns.push(g); const nr = rec + (qc === 'Pass' ? qtyM : 0); if (qc === 'Pass') x.status = nr >= x.qtyM ? 'Received' : 'Part received';
  log(qc === 'Pass' ? 'Goods received' : 'Delivery rejected', `${g.id} on ${x.id}: ${fmtQty(qtyM)} ${x.unit} ${qc === 'Pass' ? 'accepted after quality check' : 'rejected at quality check'}`, x.projectId, x.id);
  toast(qc === 'Pass' ? `${g.id} recorded · accepted quantity now counts as actual cost` : `${g.id} recorded as rejected`); UI.modal = { name: 'po', id: x.id }; refresh();
};
/* vendors */
function vendorList() {
  const V = S.vendors, ap = can('procurement', 'approve'), fin = can('budget');
  return `<div class="ph-a end">${can('procurement', 'create') ? `<button class="btn" data-act="newVendor">${ic('plus')}Vendor</button>` : ''}</div><section class="card flush"><table class="t stack"><thead><tr><th>Vendor</th><th>Category</th><th>City</th><th>Status</th><th class="num">Orders</th>${fin ? '<th class="num">Committed</th>' : ''}<th class="num">Avg quoted lead</th><th class="num">Rating</th></tr></thead><tbody>
  ${V.map(v => { const P = S.pos.filter(x => x.vendorId === v.id && COMMITTED.includes(x.status)), Q = S.mrs.flatMap(m => m.quotes.filter(q => q.vendorId === v.id)), lead = Q.length ? Math.round(sum(Q.map(q => q.leadDays)) / Q.length) + ' days' : '—';
    return `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.category)}</td><td>${esc(v.city)}</td><td>${v.approved ? badge('Approved') : badge('Pending', 'Not approved')}${ap ? ` <button class="btn sm ghost" data-act="vendorToggle" data-id="${v.id}">${v.approved ? 'Suspend' : 'Approve'}</button>` : ''}</td><td class="num">${P.length}</td>${fin ? `<td class="num">${fmtC(sum(P.map(x => x.totalP)))}</td>` : ''}<td class="num">${lead}</td><td class="num">${v.rating ? v.rating.toFixed(1) : '—'}</td></tr>`; }).join('')}</tbody></table></section>
  <p class="fine">Vendor ratings are entered by procurement today; scored contractor performance arrives with Phase 2.</p>`;
}
ACT.newVendor = () => openModal('New vendor', `<form data-form="newVendor" class="form">${field('Vendor name', '<input name="name" required maxlength="80" autofocus>')}<div class="g2">${field('Category', '<input name="category" required maxlength="40" placeholder="e.g. Roofing">')}${field('City', '<input name="city" required maxlength="40">')}</div><p class="fine">New vendors start off the approved list until someone with procurement approval rights approves them.</p><div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Add vendor</button></div></form>`);
FORM.newVendor = fd => { const name = String(fd.get('name')).trim(); if (S.vendors.some(v => norm(v.name) === norm(name))) { toast('A vendor with this name exists', 'bad'); return; } const v = { id: 'V' + pad(S.vendors.length + 1, 2), name, category: String(fd.get('category')).trim(), city: String(fd.get('city')).trim(), rating: null, approved: false, addedOn: todayISO() }; S.vendors.push(v); log('Vendor added', `${v.name} (${v.category}) — awaiting approval`); closeModal(); toast('Vendor added'); refresh(false); };
ACT.vendorToggle = el => { const v = vendor(el.dataset.id); v.approved = !v.approved; log(v.approved ? 'Vendor approved' : 'Vendor suspended', v.name); toast(`${v.name} ${v.approved ? 'approved' : 'suspended'}`); refresh(false); };

/* ---------- cancel and short-close (B03): commitments released, approval withdrawn, request reopened ---------- */
function poCloseActions(x) {
  if (!can('procurement', 'approve') || !hasProject(x.projectId)) return x.closedReason ? `<p class="note">${esc(x.status)}: ${esc(x.closedReason)}</p>` : '';
  const passed = x.grns.some(g => g.qc === 'Pass'), invoiced = S.invoices.some(i => i.poId === x.id && i.status !== 'Rejected');
  const canCancel = ['Pending approval', 'Approved'].includes(x.status) && !passed && !invoiced, canShort = x.status === 'Part received';
  if (!canCancel && !canShort) return x.closedReason ? `<p class="note">${esc(x.status)}: ${esc(x.closedReason)}</p>` : '';
  return `<form data-form="poClose" data-id="${x.id}" data-mode="${canCancel ? 'cancel' : 'short'}" class="form inline-close"><h3 class="h3">${canCancel ? 'Cancel this order' : 'Short-close this order'}</h3>
    <p class="fine">${canCancel ? 'Nothing has been accepted against it. Cancelling withdraws any pending approval, releases the commitment and sends the material request back for a new order.' : `Only ${fmtQty(sum(x.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)))} of ${fmtQty(x.qtyM)} ${esc(x.unit)} were accepted. Short-closing keeps that as the commitment and releases the balance.`}</p>
    ${field('Reason', '<input name="reason" required minlength="5" maxlength="200" placeholder="Why the order is being closed">')}
    <div class="fa"><button class="btn ${canCancel ? 'danger' : ''}">${canCancel ? 'Cancel order' : 'Short-close order'}</button></div></form>`;
}
FORM.poClose = (fd, f) => {
  const x = S.pos.find(y => y.id === f.dataset.id), reason = String(fd.get('reason') || '').trim(), mode = f.dataset.mode;
  if (reason.length < 5) { toast('Give a reason of at least 5 characters', 'bad'); return; }
  const before = poCommitP(x) + (x.status === 'Pending approval' ? x.totalP : 0);
  x.closedReason = reason; x.closedBy = me().id; x.closedAt = nowISO();
  if (mode === 'cancel') {
    x.status = 'Cancelled';
    const ap = S.approvals.find(a => a.id === x.approvalId && a.status === 'Pending'); if (ap) { ap.status = 'Withdrawn'; ap.closedAt = nowISO(); ap.steps.forEach(s => { if (!s.decision) s.skipped = true; }); }
    const mr = S.mrs.find(m => m.poId === x.id); if (mr) { mr.status = 'Quotes received'; mr.poId = null; }
  } else x.status = 'Closed';
  const released = before - poCommitP(x);
  log(mode === 'cancel' ? 'Order cancelled' : 'Order short-closed', `${x.id}: ${reason}. Commitment released ${fmtINR(released)}`, x.projectId, x.id);
  emit('commitment_released', 'release:' + x.id, x.projectId, { ref: x.id, code: x.code, amountP: released });
  toast(`${x.id} ${mode === 'cancel' ? 'cancelled' : 'short-closed'} · ${fmtINR(released)} released`); UI.modal = { name: 'po', id: x.id }; refresh();
};
