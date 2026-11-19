'use strict';
/* Views E — units, interactive master plan, unit workspace, inspections & defects, readiness and handover, drawing links */

const ST_CLS = { 'Not started': 'ns', 'In progress': 'ip', 'Awaiting inspection': 'aw', Blocked: 'bl', Ready: 'rd', 'Handed over': 'ho' };
const STAGE_CODE = { foundation: '02', excavation: '02', structure: '03', shell: '03', platform: '03', roofing: '05', waterproofing: '05', mep_rough: '06', plaster: '04', flooring: '08', tiling: '08', painting: '08', doors_windows: '09', bathrooms: '07', bath_pod: '07', filtration: '11', furniture: '12', cleaning: '01' };
function unitContractor(u) {
  const c = S.contracts.find(c => c.unitId === u.id && c.status === 'Active'); if (c) return vendor(c.vendorId).name;
  const st = u.stages.find(s => s.status !== 'Passed'); if (!st) return '—';
  const k = S.contracts.find(c => c.projectId === u.projectId && c.code === STAGE_CODE[st.key] && c.status === 'Active'); return k ? vendor(k.vendorId).name : 'Not let';
}
const canQ = a => can('quality', a), canH = a => can('handover', a);

/* ================= UNITS & MASTER PLAN ================= */
VIEWS.units = {
  mod: 'handover', title: 'Units & master plan', allowed: () => can('handover') || can('projects'),
  render() {
    const pid = selProject('unitP'); if (!pid) return pageHead('Units & master plan') + empty('No projects in view');
    const p = proj(pid), U = S.units.filter(u => u.projectId === pid), R = Object.fromEntries(U.map(u => [u.id, readiness(u)]));
    const cnt = s => U.filter(u => R[u.id].status === s).length, F = UI.unitF || 'all', L = U.filter(u => F === 'all' || R[u.id].status === F);
    const ready = cnt('Ready') + cnt('Handed over');
    return pageHead('Units & master plan', `${esc(p.name)} · ${ready} of ${U.length} units ready or handed over · readiness comes from passed inspections, closed defects, installed FF&E and commissioning — not typed percentages`) +
      projectPicker('unitP') + `<section class="card">${masterPlan(p, U, R)}</section>
      <section class="card flush"><div class="ch pad">${tabs([['all', 'All', U.length], ...UNIT_STATUS.map(s => [s, s, cnt(s)])].filter(x => x[0] === 'all' || x[2]), F, 'unitF')}</div>
      <table class="t stack"><thead><tr><th>Unit</th><th>Status</th><th>Verified stages</th><th>Current phase</th><th>Contractor</th><th class="num">Open defects</th>${can('budget') ? '<th class="num">Budget</th><th class="num">Committed · actual</th>' : ''}<th>Est. completion</th></tr></thead><tbody>
      ${L.map(u => { const r = R[u.id], c = can('budget') ? unitCost(u) : null, eta = unitEta(u);
        return `<tr class="click" data-act="unit" data-id="${u.id}" tabindex="0"><td><b>${esc(u.code)}</b> ${esc(u.name)}<br><span class="sm muted">${esc(u.type)}</span></td><td><span class="ust ${ST_CLS[r.status]}">${r.status}</span></td><td class="w-pb">${bar(r.pct, 'ok')}<span class="sm">${r.passed}/${r.total}</span></td><td class="sm">${esc(r.phase)}</td><td class="sm">${esc(unitContractor(u))}</td><td class="num ${r.safety ? 'tbad' : ''}">${r.snags}${r.safety ? ' (safety)' : ''}</td>${c ? `<td class="num">${fmtC(c.budget)}</td><td class="num">${fmtC(c.committed)} · ${fmtC(c.actual)}</td>` : ''}<td class="nowrap">${eta ? fmtDate(eta) : '—'}</td></tr>`; }).join('') || `<tr><td colspan="9">${empty('No units match')}</td></tr>`}
      </tbody></table></section>`;
  },
  after() { bindPlan(); }
};
ACT.unitF = el => { UI.unitF = el.dataset.k; render(); };
function schematic(p) { // drawn layout for demo projects with no uploaded plan
  const isBeach = p.type.includes('pool') || p.location.includes('Alappuzha'), ring = p.type.includes('Wellness');
  return `<svg class="plan-bg" viewBox="0 0 100 62.5" preserveAspectRatio="none" aria-hidden="true">
    <rect x="1" y="1" width="98" height="60.5" rx="2" class="pb-site"/>
    ${isBeach ? '<path d="M0 54 Q25 51 50 54 T100 53 V62.5 H0Z" class="pb-sea"/><path d="M0 50 Q25 47 50 50 T100 49" class="pb-line"/><text x="3" y="60" class="pb-lbl">Sea · setback line dashed</text>' : ''}
    ${ring ? '<circle cx="50" cy="31" r="12" class="pb-court"/>' : [12, 22, 32, 42, 52].map(y => `<path d="M2 ${y} Q30 ${y - 3} 55 ${y + 1} T98 ${y - 2}" class="pb-contour"/>`).join('')}
    <path d="M50 61 C 52 48, 40 40, 48 30 S 60 12, 50 3" class="pb-road"/>
    <text x="3" y="5" class="pb-lbl">Schematic layout — upload the approved master plan to replace it</text></svg>`;
}
function masterPlan(p, U, R) {
  const z = (UI.plan && UI.plan[p.id]) || { z: 1, x: 0, y: 0 }, place = UI.placing && UI.placing.pid === p.id;
  return `<div class="ch"><div><h2 class="h2">Master plan</h2><p class="sm muted">${p.plan?.image ? `Uploaded plan · ${esc(p.plan.name || '')}` : 'Schematic layout'} · scroll or pinch to zoom, drag to pan, select a unit to open its workspace</p></div>
    <div class="ph-a"><button class="ib sm" data-act="zoom" data-d="1.25" aria-label="Zoom in">${ic('plus')}</button><button class="ib sm" data-act="zoom" data-d="0.8" aria-label="Zoom out"><svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button><button class="btn sm ghost" data-act="zoom" data-d="0">Reset</button>
    ${can('projects', 'edit') ? `<label class="btn sm">Upload plan<input type="file" accept="image/png,image/jpeg,image/webp" data-chg="planUpload" data-pid="${p.id}" class="sr"></label><button class="btn sm ${place ? 'primary' : ''}" data-act="placeMode" data-pid="${p.id}">${place ? 'Done placing' : 'Place units'}</button>` : ''}</div></div>
    ${place ? `<p class="note">Choose a unit, then tap its position on the plan. <select class="sel" data-chg="placeUnit">${U.map(u => opt(u.id, u.code + ' ' + u.name, UI.placing.unit)).join('')}</select></p>` : ''}
    <div class="plan-wrap${place ? ' placing' : ''}" id="planWrap" data-pid="${p.id}"><div class="plan-in" id="planIn" style="transform:translate(${z.x}px,${z.y}px) scale(${z.z})">
      ${p.plan?.image ? `<img class="plan-img" src="${p.plan.image}" alt="Master plan of ${esc(p.name)}">` : schematic(p)}
      ${U.map(u => { const r = R[u.id]; return `<button class="pin ${ST_CLS[r.status]} t-${u.template}" style="left:${u.x}%;top:${u.y}%" data-act="unit" data-id="${u.id}" aria-label="${esc(u.code)} ${esc(u.name)}: ${r.status}, ${r.passed} of ${r.total} stages verified"><span>${esc(u.code)}</span></button>`; }).join('')}
    </div></div>
    <p class="legend">${UNIT_STATUS.map(s => `<span><i class="ust-dot ${ST_CLS[s]}"></i>${s}</span>`).join('')}</p>
    <p class="fine">2D plan with placed units. 3D/BIM model viewing is not part of this build.</p>`;
}
function bindPlan() {
  const w = $('#planWrap'), inner = $('#planIn'); if (!w || !inner) return; const pid = w.dataset.pid;
  UI.plan = UI.plan || {}; const st = UI.plan[pid] = UI.plan[pid] || { z: 1, x: 0, y: 0 }; const pts = new Map(); let last = null, pinch = null, moved = false;
  const apply = () => { inner.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.z})`; };
  w.addEventListener('wheel', e => { e.preventDefault(); const r = w.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, nz = clamp(st.z * (e.deltaY < 0 ? 1.15 : 0.87), 1, 6); st.x = mx - (mx - st.x) * nz / st.z; st.y = my - (my - st.y) * nz / st.z; st.z = nz; apply(); }, { passive: false });
  w.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; if (pts.size === 1) last = { x: e.clientX, y: e.clientY }; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: st.z }; } });
  w.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; st.z = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 1, 6); apply(); moved = true; }
    else if (pts.size === 1 && last) { const dx = e.clientX - last.x, dy = e.clientY - last.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; st.x += dx; st.y += dy; last = { x: e.clientX, y: e.clientY }; apply(); } });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) last = null; };
  w.addEventListener('pointerup', e => {
    if (UI.placing && !moved && !e.target.closest('.pin')) { const r = inner.getBoundingClientRect(), u = S.units.find(x => x.id === UI.placing.unit); if (u) { u.x = +clamp((e.clientX - r.left) / r.width * 100, 0, 100).toFixed(2); u.y = +clamp((e.clientY - r.top) / r.height * 100, 0, 100).toFixed(2); log('Unit placed on plan', `${u.code} at ${u.x}%, ${u.y}%`, u.projectId, u.id); const i = S.units.filter(x => x.projectId === pid).indexOf(u), nx = S.units.filter(x => x.projectId === pid)[i + 1]; if (nx) UI.placing.unit = nx.id; save(); render(); } }
    up(e); });
  w.addEventListener('pointercancel', up);
  w.addEventListener('click', e => { if (moved || UI.placing) { e.stopPropagation(); e.preventDefault(); } }, true);
}
ACT.zoom = el => { const pid = $('#planWrap')?.dataset.pid; if (!pid) return; const st = (UI.plan[pid] = UI.plan[pid] || { z: 1, x: 0, y: 0 }), d = Number(el.dataset.d); if (!d) Object.assign(st, { z: 1, x: 0, y: 0 }); else { const w = $('#planWrap').getBoundingClientRect(), cx = w.width / 2, cy = w.height / 2, nz = clamp(st.z * d, 1, 6); st.x = cx - (cx - st.x) * nz / st.z; st.y = cy - (cy - st.y) * nz / st.z; st.z = nz; } $('#planIn').style.transform = `translate(${st.x}px,${st.y}px) scale(${st.z})`; };
ACT.placeMode = el => { UI.placing = UI.placing ? null : { pid: el.dataset.pid, unit: S.units.find(u => u.projectId === el.dataset.pid)?.id }; render(); };
CHG.placeUnit = el => { UI.placing.unit = el.value; };
CHG.planUpload = el => {
  const f = el.files[0], p = proj(el.dataset.pid); if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 15 * 1024 * 1024) { toast('Use a PNG, JPEG or WebP image up to 15 MB (export a PDF plan as an image first)', 'bad'); return; }
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => { const k = Math.min(1, 1800 / Math.max(img.width, img.height)), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    p.plan = { image: cv.toDataURL('image/jpeg', 0.82), name: f.name, w: cv.width, h: cv.height, at: nowISO(), by: me().id }; URL.revokeObjectURL(url);
    log('Master plan uploaded', `${f.name} (${cv.width}×${cv.height}) — place units on it`, p.id); toast('Plan uploaded — use Place units to position each unit'); refresh(false); };
  img.onerror = () => toast('That image could not be read', 'bad'); img.src = url;
};

/* ---------- unit workspace ---------- */
ACT.unit = el => showModal('unit', el.dataset.id);
MODALS.unit = id => {
  const u = S.units.find(x => x.id === id), p = proj(u.projectId), r = readiness(u), c = can('budget') ? unitCost(u) : null, eta = unitEta(u);
  const I = S.inspections.filter(i => i.unitId === u.id), snags = S.snags.filter(s => s.unitId === u.id).sort((a, b) => (a.status === 'Closed') - (b.status === 'Closed')), ffe = S.ffe.filter(f => f.unitId === u.id);
  const reqOf = (kind, key) => I.find(i => i.kind === kind && (i.stage === key || i.system === key) && i.status === 'Requested');
  const decideBtns = i => canQ('approve') && hasProject(u.projectId) && i.requestedBy !== me().id ? `<button class="btn sm" data-act="inspPass" data-id="${i.id}">Pass</button> <button class="btn sm ghost danger" data-act="inspFail" data-id="${i.id}">Fail…</button>` : `<span class="sm muted">${i.requestedBy === me().id ? 'Another inspector decides' : 'Waiting for inspector'}</span>`;
  const gate = (ok, label) => `<span class="gate ${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${label}</span>`;
  const photos = S.reports.filter(x => x.projectId === u.projectId).flatMap(x => x.photos.filter(ph => ph.unitId === u.id && BLOBS[ph.key]));
  const fin = I.find(i => i.kind === 'Final' && i.status === 'Requested');
  openModal(`${esc(u.code)} · ${esc(u.name)}`, `<div class="uhead"><span class="ust ${ST_CLS[r.status]}">${r.status}</span><span class="sm">${r.passed}/${r.total} stages verified · current phase <b>${esc(r.phase)}</b> · contractor ${esc(unitContractor(u))}${eta ? ' · est. completion ' + fmtDate(eta) : ''}</span></div>
    <div class="gates">${gate(r.passed === r.total, `Stages ${r.passed}/${r.total}`)}${gate(r.snags === 0, `Defects ${r.snags ? r.snags + ' open' : 'none open'}`)}${gate(r.ffeReady === r.ffeTotal, `FF&E ${r.ffeReady}/${r.ffeTotal}`)}${gate(r.cmPassed === r.cmTotal, `Commissioning ${r.cmPassed}/${r.cmTotal}`)}${gate(r.final, 'Final inspection')}</div>
    ${r.safety ? `<p class="note bad"><b>Blocked:</b> ${r.safety} safety-critical defect${r.safety > 1 ? 's' : ''} open. Work in this unit should not continue until it is closed.</p>` : ''}
    ${c ? `<div class="kv2"><div><span class="kl">Unit budget</span>${fmtINR(c.budget)}</div><div><span class="kl">Committed · actual (unit-tagged)</span>${fmtINR(c.committed)} · ${fmtINR(c.actual)}</div></div>` : ''}
    <h3 class="h3">Construction stages</h3><table class="t"><tbody>${u.stages.map(s => { const q = reqOf('Stage', s.key);
      return `<tr><td>${esc(s.label)}</td><td>${badge(s.status === 'Passed' ? 'Done' : s.status === 'Awaiting inspection' ? 'Pending' : s.status === 'In progress' ? 'In progress' : 'Draft', s.status)}</td><td class="sm muted">${s.status === 'Passed' ? `Verified${s.by ? ' by ' + esc(uname(s.by)) : ''}${s.at ? ' · ' + fmtDate(s.at.slice(0, 10)) : ''}` : ''}</td>
      <td class="nowrap">${q ? decideBtns(q) : s.status !== 'Passed' && canQ('create') && hasProject(u.projectId) ? `${s.status === 'Not started' ? `<button class="btn sm ghost" data-act="stageStart" data-u="${u.id}" data-k="${s.key}">Start</button> ` : ''}<button class="btn sm" data-act="inspReq" data-u="${u.id}" data-kind="Stage" data-k="${s.key}">Request inspection</button>` : ''}</td></tr>`; }).join('')}</tbody></table>
    <h3 class="h3">Commissioning</h3><table class="t"><tbody>${u.commissioning.map(cm => { const q = reqOf('Commissioning', cm.system); return `<tr><td>${esc(cm.system)}</td><td>${badge(cm.status === 'Passed' ? 'Done' : 'Draft', cm.status)}</td><td class="nowrap">${q ? decideBtns(q) : cm.status !== 'Passed' && canQ('create') && hasProject(u.projectId) ? `<button class="btn sm" data-act="inspReq" data-u="${u.id}" data-kind="Commissioning" data-k="${cm.system}">Request test</button>` : ''}</td></tr>`; }).join('')}</tbody></table>
    <h3 class="h3">FF&E (${r.ffeReady}/${r.ffeTotal} installed)</h3>${ffe.length ? `<table class="t"><tbody>${ffe.map(f => { const nx = FFE_NEXT[f.status]; return `<tr><td>${esc(f.item)} <span class="sm muted">· ${esc(f.category)}</span></td><td>${badge(['Installed', 'Tested'].includes(f.status) ? 'Done' : f.status === 'Defective' ? 'Rejected' : 'Pending', f.status)}</td><td class="nowrap">${nx && canH('edit') && hasProject(u.projectId) ? `<button class="btn sm ghost" data-act="ffeStep" data-id="${f.id}">Mark ${nx.toLowerCase()}</button>` : ''}</td></tr>`; }).join('')}</tbody></table>` : `<p class="muted">No FF&E scheduled for this unit.${canH('edit') ? ' ' : ''}</p>`}
    ${canH('edit') && hasProject(u.projectId) ? `<form data-form="ffeAdd" data-u="${u.id}" class="inline"><label class="sr" for="ffe-n">FF&E item</label><input id="ffe-n" name="item" required maxlength="60" placeholder="Add FF&E item, e.g. Bathtub"><select name="cat" class="sel">${['Furniture', 'Soft furnishings', 'Electronics', 'Appliances', 'HVAC', 'Sanitary', 'Lighting', 'Décor', 'Pool equipment', 'OS&E'].map(x => opt(x, x)).join('')}</select><button class="btn sm">Add</button></form>` : ''}
    <h3 class="h3">Defects</h3>${snags.length ? `<table class="t"><tbody>${snags.map(s => snagRow(s)).join('')}</tbody></table>` : '<p class="muted">No defects recorded.</p>'}
    ${canQ('create') && hasProject(u.projectId) ? `<div class="fa left"><button class="btn sm" data-act="snagNew" data-u="${u.id}">Raise defect</button></div>` : ''}
    <h3 class="h3">Final inspection & handover</h3>
    <p class="sm">${r.final ? 'Final inspection passed.' : fin ? 'Final inspection requested.' : r.gates ? 'All gates passed — request the final inspection.' : 'Final inspection opens when every stage, defect, FF&E item and commissioning test has passed.'}</p>
    <div class="fa left">${fin ? decideBtns(fin) : !r.final && r.gates && canQ('create') && hasProject(u.projectId) ? `<button class="btn" data-act="inspReq" data-u="${u.id}" data-kind="Final" data-k="">Request final inspection</button>` : ''}
    ${r.status === 'Ready' && canH('approve') ? `<button class="btn primary" data-act="unitHand" data-id="${u.id}">Hand over unit</button>` : ''}${u.handedOverAt ? `<span class="sm">Handed over ${fmtStamp(u.handedOverAt)}</span>` : ''}</div>
    <h3 class="h3">Latest photographs</h3>${photos.length ? `<div class="thumbs">${photos.slice(-6).map(ph => `<img src="${BLOBS[ph.key]}" alt="${esc(ph.name)}">`).join('')}</div>` : '<p class="muted">No photographs tagged to this unit yet. Supervisors tag photos to units in the daily report.</p>'}
    <h3 class="h3">Inspection history</h3>${I.length ? `<ul class="al">${I.slice().reverse().slice(0, 8).map(i => `<li><span class="sm muted nowrap">${fmtStamp(i.decidedAt || i.at)}</span><span>${esc(i.kind)} ${esc(i.stage ? u.stages.find(s => s.key === i.stage)?.label || i.stage : i.system || '')} — <b>${i.status}</b>${i.inspector ? ' by ' + esc(uname(i.inspector)) : ''}${i.notes ? ' · ' + esc(i.notes) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No inspections recorded in this demo beyond seeded passes.</p>'}`, { wide: true, sub: `${esc(p.name)} · ${esc(u.type)}` });
};
const FFE_NEXT = { Specified: 'Ordered', Ordered: 'Delivered', Delivered: 'Installed', Installed: 'Tested', Defective: 'Delivered' };
function snagRow(s) {
  const u = S.units.find(x => x.id === s.unitId), act = [];
  if (s.status === 'Open' && canQ('edit')) act.push(`<button class="btn sm ghost" data-act="snagFix" data-id="${s.id}">Mark fixed</button>`);
  if (s.status === 'Fixed' && canQ('approve')) act.push(`<button class="btn sm" data-act="snagClose" data-id="${s.id}">Close after re-inspection</button>`);
  return `<tr><td><span class="mono sm">${s.id}</span> ${esc(s.title)}<br><span class="sm muted">${u ? esc(u.code) + ' · ' : ''}${esc(s.category)}${s.vendorId ? ' · ' + esc(vendor(s.vendorId)?.name || '') : ''}${s.due ? ' · due ' + fmtDate(s.due) : ''}</span></td><td>${badge(s.severity === 'Safety-critical' ? 'Rejected' : s.severity === 'Major' ? 'Pending' : 'Draft', s.severity)}</td><td>${badge(s.status === 'Closed' ? 'Done' : s.status === 'Fixed' ? 'In progress' : 'Pending', s.status)}</td><td class="nowrap">${act.join(' ')}</td></tr>`;
}
ACT.stageStart = el => { const u = S.units.find(x => x.id === el.dataset.u), s = u.stages.find(x => x.key === el.dataset.k); s.status = 'In progress'; log('Stage started', `${u.code} ${s.label}`, u.projectId, u.id); refresh(); };
ACT.inspReq = el => {
  const u = S.units.find(x => x.id === el.dataset.u), kind = el.dataset.kind, key = el.dataset.k || null;
  if (S.inspections.some(i => i.unitId === u.id && i.kind === kind && (i.stage || i.system || '') === (key || '') && i.status === 'Requested')) { toast('An inspection for this is already requested', 'bad'); return; }
  if (kind === 'Final' && !readiness(u).gates) { toast('Final inspection opens when every gate has passed', 'bad'); return; }
  const i = { id: nid('IN'), projectId: u.projectId, unitId: u.id, kind, stage: kind === 'Stage' ? key : null, system: kind === 'Commissioning' ? key : null, requestedBy: me().id, at: nowISO(), status: 'Requested', inspector: null, decidedAt: null, notes: '' };
  S.inspections.push(i); if (kind === 'Stage') u.stages.find(s => s.key === key).status = 'Awaiting inspection';
  notify(S.users.filter(x => x.role === 'quality' && hasProject(u.projectId, x)).map(x => x.id), `${u.code}: ${kind.toLowerCase()} inspection requested`, 'quality');
  log('Inspection requested', `${i.id} ${u.code} ${kind} ${key || ''}`, u.projectId, i.id); toast('Inspection requested'); refresh();
};
function decideInsp(i, pass, notes, snags = []) {
  const u = S.units.find(x => x.id === i.unitId);
  if (i.requestedBy === me().id) { toast('The requester cannot inspect their own work', 'bad'); return false; }
  if (pass && i.kind === 'Final') { const r = readiness(u); if (!r.gates) { toast(`Final cannot pass: stages ${r.passed}/${r.total}, defects ${r.snags}, FF&E ${r.ffeReady}/${r.ffeTotal}, commissioning ${r.cmPassed}/${r.cmTotal}`, 'bad'); return false; } }
  Object.assign(i, { status: pass ? 'Passed' : 'Failed', inspector: me().id, decidedAt: nowISO(), notes });
  if (i.kind === 'Stage') { const s = u.stages.find(x => x.key === i.stage); Object.assign(s, pass ? { status: 'Passed', insp: i.id, at: nowISO(), by: me().id } : { status: 'In progress' }); }
  if (i.kind === 'Commissioning' && pass) Object.assign(u.commissioning.find(c => c.system === i.system), { status: 'Passed', insp: i.id });
  for (const sn of snags) { const s = { id: nid('SN'), projectId: u.projectId, unitId: u.id, inspection: i.id, title: sn.title, severity: sn.severity, category: sn.severity === 'Safety-critical' ? 'Safety' : 'Workmanship', vendorId: sn.vendorId || null, due: sn.due || null, status: 'Open', by: me().id, at: nowISO(), photos: [] }; S.snags.push(s); if (s.severity === 'Safety-critical') emit('safety_defect', 'snag:' + s.id, u.projectId, { title: `${u.code}: ${s.title}`, link: 'quality' }); }
  log(pass ? 'Inspection passed' : 'Inspection failed', `${i.id} ${u.code} ${i.kind} ${i.stage || i.system || ''}${notes ? ' — ' + notes : ''}${snags.length ? ` · ${snags.length} defect(s) raised` : ''}`, u.projectId, i.id);
  if (pass && readiness(u).status === 'Ready') emit('unit_ready', 'ready:' + u.id, u.projectId, { title: `${u.code} ${u.name}`, link: 'units' });
  return true;
}
ACT.inspPass = el => { if (decideInsp(S.inspections.find(i => i.id === el.dataset.id), true, 'Passed on inspection')) { toast('Inspection passed'); refresh(); } };
ACT.inspFail = el => { UI.failInsp = el.dataset.id; const back = UI.modal; openModal('Fail inspection', `<form data-form="inspFail" class="form">${field('What failed', '<textarea name="notes" class="ta" rows="2" required minlength="5" autofocus></textarea>')}
  <fieldset class="fs"><legend>Defects to raise</legend>${[0, 1, 2].map(k => `<div class="g3"><label class="fld"><span class="fl">Defect ${k + 1}</span><input name="t${k}" maxlength="100"></label><label class="fld"><span class="fl">Severity</span><select name="s${k}">${['Minor', 'Major', 'Safety-critical'].map(x => opt(x, x)).join('')}</select></label><label class="fld"><span class="fl">Assign to</span><select name="v${k}"><option value="">—</option>${S.vendors.filter(v => v.approved).map(v => opt(v.id, v.name)).join('')}</select></label></div>`).join('')}</fieldset>
  <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary danger">Fail inspection</button></div></form>`); UI.modal = null; UI.failBack = back; };
FORM.inspFail = fd => { const sn = [0, 1, 2].map(k => ({ title: String(fd.get('t' + k) || '').trim(), severity: fd.get('s' + k), vendorId: fd.get('v' + k) || null, due: addDays(todayISO(), fd.get('s' + k) === 'Safety-critical' ? 1 : 7) })).filter(x => x.title);
  if (decideInsp(S.inspections.find(i => i.id === UI.failInsp), false, String(fd.get('notes')).trim(), sn)) { toast(`Inspection failed${sn.length ? ' · ' + sn.length + ' defect(s) raised' : ''}`); UI.modal = UI.failBack; refresh(); } };
ACT.ffeStep = el => { const f = S.ffe.find(x => x.id === el.dataset.id), nx = FFE_NEXT[f.status]; const was = f.status; f.status = nx; log('FF&E updated', `${f.item} (${S.units.find(u => u.id === f.unitId)?.code}): ${was} → ${nx}`, f.projectId, f.id); refresh(); };
FORM.ffeAdd = (fd, f) => { const u = S.units.find(x => x.id === f.dataset.u); S.ffe.push({ id: nid('FF'), projectId: u.projectId, unitId: u.id, item: String(fd.get('item')).trim(), category: fd.get('cat'), qty: 1, status: 'Specified', costP: 0 }); log('FF&E item added', `${u.code}: ${fd.get('item')}`, u.projectId, u.id); refresh(); };
ACT.snagNew = el => { UI.snagUnit = el.dataset.u || null; const back = UI.modal; showModal('snagNew'); UI.snagBack = back; };
MODALS.snagNew = () => {
  const U = UI.snagUnit ? [S.units.find(u => u.id === UI.snagUnit)] : S.units.filter(u => hasProject(u.projectId));
  openModal('Raise defect', `<form data-form="snagNew" class="form">${field('Unit', `<select name="unit">${U.map(u => opt(u.id, `${u.code} ${u.name} · ${shortName(proj(u.projectId))}`)).join('')}</select>`)}${field('Defect', '<input name="title" required minlength="4" maxlength="120" autofocus>')}
    <div class="seg" role="radiogroup" aria-label="Severity">${['Minor', 'Major', 'Safety-critical'].map((s, i) => `<label class="segi"><input type="radio" name="sev" value="${s}" ${i ? '' : 'checked'}><span>${s}</span></label>`).join('')}</div>
    <div class="g2">${field('Assign to', `<select name="vendor"><option value="">—</option>${S.vendors.filter(v => v.approved).map(v => opt(v.id, v.name)).join('')}</select>`)}${field('Fix by', `<input type="date" name="due" value="${addDays(todayISO(), 7)}">`)}</div>
    ${field('Photo', '<input type="file" name="photo" accept="image/jpeg,image/png,image/webp">', 'Kept in this browser tab for the demo')}
    <p class="fine">Safety-critical defects block the unit, notify the project director and quality team at once, and can only be closed by someone with handover approval rights.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Raise defect</button></div></form>`);
};
FORM.snagNew = fd => {
  const u = S.units.find(x => x.id === fd.get('unit')), sev = fd.get('sev'), ph = fd.get('photo'), photos = [];
  if (ph && ph.size) { if (!/^image\//.test(ph.type) || ph.size > 10485760) { toast('Photo must be an image up to 10 MB', 'bad'); return; } const key = 'sn' + Date.now(); BLOBS[key] = URL.createObjectURL(ph); photos.push({ key, name: ph.name }); }
  const s = { id: nid('SN'), projectId: u.projectId, unitId: u.id, title: String(fd.get('title')).trim(), severity: sev, category: sev === 'Safety-critical' ? 'Safety' : 'Workmanship', vendorId: fd.get('vendor') || null, due: fd.get('due') || null, status: 'Open', by: me().id, at: nowISO(), photos };
  S.snags.push(s); emit(sev === 'Safety-critical' ? 'safety_defect' : 'quality_issue', 'snag:' + s.id, u.projectId, { title: `${u.code}: ${s.title}`, link: 'quality' });
  log('Defect raised', `${s.id} ${u.code}: ${s.title} (${sev})`, u.projectId, s.id); closeModal(); toast(sev === 'Safety-critical' ? 'Safety-critical defect raised — unit blocked, team alerted' : 'Defect raised'); if (UI.snagBack) UI.modal = UI.snagBack; refresh(!!UI.snagBack);
};
ACT.snagFix = el => { const s = S.snags.find(x => x.id === el.dataset.id); s.status = 'Fixed'; s.fixedAt = nowISO(); log('Defect fixed', `${s.id} ${s.title}`, s.projectId, s.id); refresh(); };
ACT.snagClose = el => { const s = S.snags.find(x => x.id === el.dataset.id); if (s.severity === 'Safety-critical' && !canH('approve')) { toast('Safety-critical defects need someone with handover approval rights to close', 'bad'); return; } s.status = 'Closed'; s.closedBy = me().id; s.closedAt = nowISO(); log('Defect closed', `${s.id} ${s.title} after re-inspection`, s.projectId, s.id); refresh(); };
ACT.unitHand = el => { const u = S.units.find(x => x.id === el.dataset.id); if (readiness(u).status !== 'Ready') { toast('Unit is not ready', 'bad'); return; } u.handedOverAt = nowISO(); log('Unit handed over', `${u.code} ${u.name}`, u.projectId, u.id); toast(`${u.code} handed over`); refresh(); };

/* ================= QUALITY: inspections & defect register ================= */
VIEWS.quality = {
  mod: 'quality', title: 'Quality',
  render() {
    const P = myProjects().filter(p => inScope(p.id)).map(p => p.id), Q = S.inspections.filter(i => P.includes(i.projectId) && i.status === 'Requested');
    const D = S.snags.filter(s => P.includes(s.projectId)), F = UI.snagF || 'open';
    const L = D.filter(s => F === 'all' || (F === 'open' ? s.status !== 'Closed' : F === 'safety' ? s.severity === 'Safety-critical' && s.status !== 'Closed' : s.status === F)).sort((a, b) => (b.severity === 'Safety-critical') - (a.severity === 'Safety-critical') || (a.at < b.at ? 1 : -1));
    const sel = UI.snagSel || (UI.snagSel = new Set());
    return pageHead('Inspections & defects', `${Q.length} inspection${Q.length === 1 ? '' : 's'} waiting · ${D.filter(s => s.status !== 'Closed').length} open defects, ${D.filter(s => s.status !== 'Closed' && s.severity === 'Safety-critical').length} safety-critical`, canQ('create') ? `<button class="btn primary" data-act="snagNew">${ic('plus')}Raise defect</button>` : '') +
      `<section class="card flush"><div class="ch pad"><h2 class="h2">Inspection requests</h2></div><table class="t stack"><thead><tr><th>Request</th><th>Unit</th><th>What</th><th>Requested by</th><th></th></tr></thead><tbody>${Q.map(i => { const u = S.units.find(x => x.id === i.unitId);
        return `<tr><td class="mono sm">${i.id}<br><span class="muted">${ago(i.at)}</span></td><td><button class="lnk" data-act="unit" data-id="${u.id}">${esc(u.code)}</button> <span class="sm muted">${esc(shortName(proj(u.projectId)))}</span></td><td>${esc(i.kind)} · ${esc(i.stage ? u.stages.find(s => s.key === i.stage)?.label : i.system || 'Final walkthrough')}</td><td>${esc(uname(i.requestedBy))}</td><td class="nowrap">${canQ('approve') && i.requestedBy !== me().id ? `<button class="btn sm" data-act="inspPass" data-id="${i.id}">Pass</button> <button class="btn sm ghost danger" data-act="inspFail" data-id="${i.id}">Fail…</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="5">${empty('No inspections waiting')}</td></tr>`}</tbody></table></section>
      <section class="card flush"><div class="ch pad">${tabs([['open', 'Open', D.filter(s => s.status !== 'Closed').length], ['safety', 'Safety-critical', D.filter(s => s.severity === 'Safety-critical' && s.status !== 'Closed').length], ['Fixed', 'Awaiting re-inspection', D.filter(s => s.status === 'Fixed').length], ['all', 'All']], F, 'snagF')}
        ${canQ('edit') ? `<div class="bulk"><span class="sm">${sel.size} selected</span><select class="sel" data-chg="bulkVendor" aria-label="Assign selected defects to"><option value="">Assign selected to…</option>${S.vendors.filter(v => v.approved).map(v => opt(v.id, v.name)).join('')}</select><button class="btn sm" data-act="bulkFixed" ${sel.size ? '' : 'disabled'}>Mark selected fixed</button></div>` : ''}</div>
      <table class="t"><tbody>${L.slice(0, 100).map(s => `<tr>${canQ('edit') ? `<td class="c"><input type="checkbox" aria-label="Select ${s.id}" data-chg="snagSel" data-id="${s.id}" ${sel.has(s.id) ? 'checked' : ''} ${s.status === 'Closed' ? 'disabled' : ''}></td>` : ''}${snagRow(s).slice(4)}`).join('') || `<tr><td>${empty('No defects match')}</td></tr>`}</tbody></table></section>`;
  }
};
ACT.snagF = el => { UI.snagF = el.dataset.k; render(); };
CHG.snagSel = el => { const s = UI.snagSel; el.checked ? s.add(el.dataset.id) : s.delete(el.dataset.id); render(); };
CHG.bulkVendor = el => { if (!el.value) return; const n = UI.snagSel.size; UI.snagSel.forEach(id => { const s = S.snags.find(x => x.id === id); s.vendorId = el.value; }); log('Defects assigned', `${n} defect(s) assigned to ${vendor(el.value).name}`); toast(`${n} defect(s) assigned`); UI.snagSel.clear(); refresh(false); };
ACT.bulkFixed = () => { let n = 0; UI.snagSel.forEach(id => { const s = S.snags.find(x => x.id === id); if (s.status === 'Open') { s.status = 'Fixed'; s.fixedAt = nowISO(); n++; } }); log('Defects fixed', `${n} defect(s) marked fixed in bulk; each still needs re-inspection to close`); toast(`${n} marked fixed — each needs re-inspection to close`); UI.snagSel.clear(); refresh(false); };

/* ================= HANDOVER ================= */
VIEWS.handover = {
  mod: 'handover', title: 'Handover',
  render() {
    const pid = selProject('hoP'); if (!pid) return pageHead('Handover') + empty('No projects in view');
    const p = proj(pid), U = S.units.filter(u => u.projectId === pid), R = U.map(readiness), H = S.handover[pid] || [], W = S.warranties.filter(w => w.projectId === pid), A = S.assets.filter(a => a.projectId === pid);
    const docs = S.docs.filter(d => d.projectId === pid && d.versions.some(v => v.status === 'Approved'));
    const blockers = [U.filter(u => !u.handedOverAt).length && `${U.filter(u => !u.handedOverAt).length} unit(s) not handed over`, H.filter(h => h.status === 'Open').length && `${H.filter(h => h.status === 'Open').length} checklist item(s) open`, S.snags.filter(s => s.projectId === pid && s.severity === 'Safety-critical' && s.status !== 'Closed').length && 'safety-critical defects open'].filter(Boolean);
    return pageHead('Pre-opening & handover', `${esc(p.name)} · ${R.filter(r => r.status === 'Ready').length} ready · ${U.filter(u => u.handedOverAt).length} handed over · ${H.filter(h => h.status !== 'Open').length}/${H.length} checklist items done`, `<button class="btn" data-act="hoPack" data-id="${pid}">Handover package</button>`) + projectPicker('hoP') +
      `<section class="card"><h2 class="h2">Unit readiness</h2><div class="rdy">${UNIT_STATUS.map(s => { const n = R.filter(r => r.status === s).length; return `<div class="rdy-i ${ST_CLS[s]}"><span class="sv">${n}</span><span class="sm">${s}</span></div>`; }).join('')}</div><p class="sm"><a href="#units">Open the master plan and unit list</a></p></section>
      <section class="card flush"><div class="ch pad"><h2 class="h2">Pre-opening checklist</h2></div><table class="t stack"><thead><tr><th>Item</th><th>Status</th><th>Evidence</th><th></th></tr></thead><tbody>
      ${H.map(h => `<tr><td>${esc(h.label)}</td><td>${badge(h.status === 'Done' ? 'Done' : h.status === 'Open' ? 'Pending' : 'Draft', h.status)}</td><td class="sm">${h.docId ? `<button class="lnk" data-act="doc" data-id="${h.docId}">${esc(S.docs.find(d => d.id === h.docId)?.title || h.docId)}</button>` : '—'}</td>
        <td>${h.status === 'Open' && canH('edit') ? `<form data-form="hoItem" data-pid="${pid}" data-k="${h.key}" class="inline"><select name="doc" class="sel" aria-label="Evidence for ${esc(h.label)}" required><option value="">Evidence document…</option>${docs.map(d => opt(d.id, d.title)).join('')}</select><button class="btn sm">Mark done</button><button type="button" class="btn sm ghost" data-act="hoNA" data-pid="${pid}" data-k="${h.key}">N/A</button></form>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="pad"><p class="fine">An item can be marked done only with an approved evidence document attached.</p></div></section>
      <div class="cols"><section class="card"><h2 class="h2">Warranty register</h2>${W.length ? `<ul class="al">${W.map(w => `<li><span class="sm nowrap">${fmtDate(w.end)}</span><span><b>${esc(w.item)}</b> · ${esc(vendor(w.vendorId)?.name || '')}<br><span class="sm muted">${esc(w.terms || '')} · from ${fmtDate(w.start)}</span></span></li>`).join('')}</ul>` : '<p class="muted">No warranties recorded.</p>'}
        ${canH('edit') ? `<form data-form="wrAdd" data-pid="${pid}" class="form boxed"><div class="g2">${field('Item', '<input name="item" required maxlength="80">')}${field('Vendor', `<select name="vendor">${S.vendors.map(v => opt(v.id, v.name)).join('')}</select>`)}</div><div class="g3">${field('Start', `<input type="date" name="start" required value="${todayISO()}">`)}${field('End', `<input type="date" name="end" required value="${addDays(todayISO(), 365)}">`)}${field('Terms', '<input name="terms" maxlength="80">')}</div><div class="fa"><button class="btn sm">Add warranty</button></div></form>` : ''}</section>
      <section class="card"><h2 class="h2">Asset register</h2>${A.length ? `<ul class="al">${A.map(a => `<li><span class="sm mono">${esc(a.serial || '')}</span><span><b>${esc(a.name)}</b>${a.warrantyId ? ' · warranty ' + esc(S.warranties.find(w => w.id === a.warrantyId)?.item || '') : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No assets recorded.</p>'}
        ${canH('edit') ? `<form data-form="asAdd" data-pid="${pid}" class="form boxed"><div class="g3">${field('Asset', '<input name="name" required maxlength="80">')}${field('Serial', '<input name="serial" maxlength="40">')}${field('Warranty', `<select name="wr"><option value="">—</option>${W.map(w => opt(w.id, w.item)).join('')}</select>`)}</div><div class="fa"><button class="btn sm">Add asset</button></div></form>` : ''}</section></div>
      <section class="card"><h2 class="h2">Final property handover</h2>${p.stage === 'Handed over' ? `<p class="note ok">Handed over ${fmtStamp(p.handedOverAt)}.</p>` : blockers.length ? `<p class="note bad"><b>Blocked:</b> ${blockers.join(' · ')}.</p>` : '<p class="note ok">Every unit, checklist item and safety defect is cleared.</p>'}
        ${p.stage !== 'Handed over' && canH('approve') ? `<div class="fa left"><button class="btn primary" data-act="hoFinal" data-id="${pid}" ${blockers.length ? 'disabled' : ''}>Record final handover</button></div>` : ''}</section>`;
  }
};
FORM.hoItem = (fd, f) => { const it = S.handover[f.dataset.pid].find(h => h.key === f.dataset.k); if (!fd.get('doc')) { toast('Attach an approved evidence document', 'bad'); return; } Object.assign(it, { status: 'Done', docId: fd.get('doc'), by: me().id, at: nowISO() }); log('Handover item done', `${it.label} — evidence ${fd.get('doc')}`, f.dataset.pid); refresh(false); };
ACT.hoNA = el => { const it = S.handover[el.dataset.pid].find(h => h.key === el.dataset.k); Object.assign(it, { status: 'Not applicable', by: me().id, at: nowISO() }); log('Handover item not applicable', it.label, el.dataset.pid); refresh(false); };
FORM.wrAdd = (fd, f) => { if (fd.get('end') <= fd.get('start')) { toast('End must be after start', 'bad'); return; } S.warranties.push({ id: nid('WR'), projectId: f.dataset.pid, unitId: null, item: String(fd.get('item')).trim(), vendorId: fd.get('vendor'), start: fd.get('start'), end: fd.get('end'), terms: String(fd.get('terms') || '') }); log('Warranty added', fd.get('item'), f.dataset.pid); refresh(false); };
FORM.asAdd = (fd, f) => { S.assets.push({ id: nid('AS'), projectId: f.dataset.pid, unitId: null, name: String(fd.get('name')).trim(), serial: String(fd.get('serial') || ''), warrantyId: fd.get('wr') || null }); log('Asset added', fd.get('name'), f.dataset.pid); refresh(false); };
ACT.hoFinal = el => { const p = proj(el.dataset.id); p.stage = 'Handed over'; p.handedOverAt = nowISO(); log('Property handed over', `${p.name}: all units, checklist items and safety defects cleared`, p.id, p.id); toast('Final handover recorded'); refresh(false); };
ACT.hoPack = el => {
  const pid = el.dataset.id, p = proj(pid), U = S.units.filter(u => u.projectId === pid);
  const rows = [['Section', 'Item', 'Status / detail', 'Reference'], ...U.map(u => ['Unit', `${u.code} ${u.name}`, readiness(u).status + (u.handedOverAt ? ' · ' + u.handedOverAt.slice(0, 10) : ''), u.id]),
    ...(S.handover[pid] || []).map(h => ['Checklist', h.label, h.status, h.docId || '']), ...S.warranties.filter(w => w.projectId === pid).map(w => ['Warranty', w.item, `${w.start} → ${w.end} · ${w.terms || ''}`, vendor(w.vendorId)?.name || '']),
    ...S.assets.filter(a => a.projectId === pid).map(a => ['Asset', a.name, a.serial || '', a.warrantyId || '']), ...S.docs.filter(d => d.projectId === pid).map(d => ['Document', d.title, (latestApproved(d) || {}).rev || 'not approved', d.id])];
  exportCSV(`handover-package-${pid}.csv`, rows, `${p.name} handover package`);
};

/* ================= drawing links & revision impact (Workflow 2) ================= */
const _docModal = MODALS.doc;
MODALS.doc = id => {
  _docModal(id); const d = S.docs.find(x => x.id === id), L = d.links || (d.links = { tasks: [], boq: [], codes: [], units: [] }), I = S.impacts.filter(x => x.docId === id), ed = can('documents', 'edit') && hasProject(d.projectId);
  const nm = { tasks: t => S.tasks.find(x => x.id === t)?.name, boq: b => { const x = S.boq.find(y => y.id === b); return x && x.ref + ' ' + x.desc; }, codes: c => c + ' ' + codeName(c), units: u => S.units.find(x => x.id === u)?.code };
  const html = `<section class="links"><h3 class="h3">Linked to</h3><p class="sm">${['tasks', 'boq', 'codes', 'units'].map(k => (L[k] || []).map(x => `<span class="chg">${esc(nm[k](x) || x)}</span>`).join(' ')).join(' ') || '<span class="muted">Nothing linked yet. Links let an approved revision flag the activities, BOQ items and open orders it affects.</span>'}</p>
    ${ed ? `<form data-form="docLink" data-id="${id}" class="inline"><select name="kind" class="sel" aria-label="Link type">${opt('tasks', 'Activity')}${opt('boq', 'BOQ item')}${opt('codes', 'Cost code')}${opt('units', 'Unit')}</select><select name="ref" class="sel" aria-label="Linked record">${S.tasks.filter(t => t.projectId === d.projectId).map(t => opt('tasks|' + t.id, 'Activity · ' + t.name)).join('')}${S.boq.filter(b => b.projectId === d.projectId).slice(0, 60).map(b => opt('boq|' + b.id, 'BOQ · ' + b.ref + ' ' + b.desc)).join('')}${S.costCodes.map(c => opt('codes|' + c.code, 'Cost code · ' + c.code + ' ' + c.name)).join('')}${S.units.filter(u => u.projectId === d.projectId).map(u => opt('units|' + u.id, 'Unit · ' + u.code)).join('')}</select><button class="btn sm">Link</button></form>` : ''}
    ${I.map(x => `<div class="note ${x.status === 'Open' ? 'bad' : 'ok'}"><b>Revision impact ${esc(x.rev)}</b> (${ago(x.at)}): ${x.tasks.length} activit${x.tasks.length === 1 ? 'y' : 'ies'}, ${x.boq.length} BOQ item(s), ${x.openPOs.length} open order(s) ${x.openPOs.map(esc).join(', ')}, ${x.openMRs.length} open request(s) to review.${x.status === 'Open' && (can('boq', 'edit') || can('schedule', 'edit')) ? ` <button class="btn sm" data-act="impactDone" data-id="${x.id}">Mark reviewed</button>` : ` ${esc(x.status)}`}</div>`).join('')}</section>`;
  $('#modal .mb .thread').insertAdjacentHTML('beforebegin', html);
};
FORM.docLink = (fd, f) => { const d = S.docs.find(x => x.id === f.dataset.id), [k, v] = String(fd.get('ref')).split('|'); d.links[k] = d.links[k] || []; if (!d.links[k].includes(v)) d.links[k].push(v); log('Document linked', `${d.title} → ${k} ${v}`, d.projectId, d.id); refresh(); };
ACT.impactDone = el => { const x = S.impacts.find(i => i.id === el.dataset.id); x.status = 'Reviewed by ' + me().name; x.tasks.forEach(t => { const tk = S.tasks.find(y => y.id === t); if (tk) delete tk.revisedBy; }); log('Revision impact reviewed', x.id, x.projectId, x.id); refresh(); };
