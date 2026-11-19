'use strict';
/* Views C — approvals, documents, settings (users, roles & permissions, rules), audit log */

/* ================= APPROVALS ================= */
function chainHTML(ap) {
  return `<div class="chain"><h3 class="h3">Approval chain ${badge(ap.status)}</h3><ol>${ap.steps.map(s => {
    const who = s.by ? `${esc(uname(s.by))} · ${fmtStamp(s.at)}${s.comment ? ' · “' + esc(s.comment) + '”' : ''}` : s.status === 'pending' ? `Waiting for ${stepUsers(ap, s).map(u => esc(u.name)).join(' or ') || 'an assigned ' + esc(roleName(s.role))}` : s.status === 'skipped' ? 'Not needed' : 'Next in line';
    return `<li class="st ${s.status}"><span class="dot" aria-hidden="true"></span><div><b>${esc(roleName(s.role))}</b> · ${esc(s.label)}<br><span class="sm muted">${who}</span></div></li>`; }).join('')}</ol>
    <p class="fine">Requested by ${esc(uname(ap.requestedBy))} · ${fmtStamp(ap.at)}. The requester cannot approve their own request, and no one approves two steps.</p></div>`;
}
function decideButtons(ap) {
  const st = curStep(ap), rej = ap.type === 'REPORT' ? 'Return to supervisor' : 'Reject';
  return `<form data-form="decide" data-id="${ap.id}" class="decide"><p class="sm"><b>Your step:</b> ${esc(st.label)}${st.module === 'budget' && ap.type === 'PO' ? ' — this order exceeds the available budget for its cost code' : ''}</p>
    <label class="sr" for="dc-${ap.id}">Comment</label><textarea id="dc-${ap.id}" name="comment" class="ta" rows="2" maxlength="400" placeholder="Comment (required to ${rej.toLowerCase()})"></textarea>
    <div class="fa"><button class="btn ghost danger" name="d" value="reject">${rej}</button><button class="btn primary" name="d" value="approve">${ap.type === 'REPORT' ? 'Verify report' : 'Approve'}</button></div></form>`;
}
function demoSwitch(ap) {
  const st = curStep(ap); if (!st) return ''; const u = stepUsers(ap, st)[0]; if (!u || u.id === me().id) return '';
  return `<p class="demo-sw">Demo: <button class="lnk" data-act="signAs" data-id="${u.id}">sign in as ${esc(u.name)} (${esc(roleName(u.role))})</button> to act on this step.</p>`;
}
FORM.decide = (fd, f, e) => {
  const d = e && e.submitter ? e.submitter.value : 'approve', c = String(fd.get('comment') || '').trim();
  if (d === 'reject' && c.length < 3) { toast('Add a comment explaining the decision', 'bad'); return; }
  const ap = S.approvals.find(a => a.id === f.dataset.id);
  if (decide(ap.id, d, c)) { toast(d === 'approve' ? (ap.status === 'Approved' ? `${ap.ref} fully approved` : `Step approved — sent to ${roleName(curStep(ap).role)}`) : `${ap.ref} ${ap.type === 'REPORT' ? 'returned' : 'rejected'}`); refresh(); }
};
VIEWS.approvals = {
  mod: 'approvals', title: 'Approvals',
  render() {
    const A = S.approvals.filter(a => inScope(a.projectId)), pend = A.filter(a => a.status === 'Pending'), mine = pend.filter(canAct), done = A.filter(a => a.status !== 'Pending').sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1));
    const L = UI.atab === 'mine' ? mine : UI.atab === 'all' ? pend : done.slice(0, 40);
    return pageHead('Approvals', `${mine.length} waiting for you · ${pend.length} open across your projects · every decision keeps its reviewer, time and comment`) +
      tabs([['mine', 'Waiting for me', mine.length], ['all', 'All open', pend.length], ['done', 'Decided']], UI.atab, 'atab') +
      `<div class="panel">${L.map(apCard).join('') || empty(UI.atab === 'mine' ? 'Nothing is waiting for you' : 'No approvals here', UI.atab === 'mine' && pend.length ? 'Open items are waiting for other roles — see All open.' : '')}${UI.atab === 'done' && done.length > 40 ? '<p class="fine">Showing the latest 40 decisions.</p>' : ''}</div>`;
  }
};
ACT.atab = el => { UI.atab = el.dataset.k; render(); };
function apCard(ap) {
  const p = proj(ap.projectId), fin = can('budget'); let ctx = '';
  if (ap.type === 'PO') { const x = S.pos.find(y => y.id === ap.ref); ctx = `${esc(vendor(x.vendorId).name)} · ${fmtQty(x.qtyM)} ${esc(x.unit)} · cost code ${x.code}${fin && x.budgetCheck ? ` · <span class="${x.budgetCheck.overBy > 0 ? 'tbad' : 'tok'}">${x.budgetCheck.overBy > 0 ? fmtINR(x.budgetCheck.overBy) + ' over available budget' : 'within available budget'}</span>` : ''}`; }
  if (ap.type === 'BUDGET') { const b = S.budgets.find(y => y.id === ap.ref); ctx = esc(b.reason) + (b.changes && b.changes.length <= 4 && fin ? ' · ' + b.changes.map(c => `${c.code} ${c.delta > 0 ? '+' : '−'}${fmtINR(Math.abs(c.delta))}`).join(', ') : ''); }
  if (ap.type === 'REPORT') { const r = S.reports.find(y => y.id === ap.ref); ctx = `${esc(uname(r.by))} · ${sum(r.labour.map(l => l.count))} workers · ${r.work.map(w => esc(S.tasks.find(t => t.id === w.taskId)?.name || '') + (w.to != null ? ' → ' + w.to + '%' : '')).join('; ')}`; }
  if (ap.type === 'DOC') { const d = S.docs.find(y => y.id === ap.ctx.docId), v = d.versions.find(y => y.rev === ap.ctx.rev); ctx = `${esc(v.file)}${v.note ? ' · ' + esc(v.note) : ''}`; }
  const open = ap.type === 'PO' ? `data-act="po" data-id="${ap.ref}"` : ap.type === 'REPORT' ? `data-act="report" data-id="${ap.ref}"` : ap.type === 'DOC' ? `data-act="doc" data-id="${ap.ctx.docId}"` : drill('boq', { btab: 'versions', boqP: ap.projectId, pf: UI.pf === 'all' ? 'all' : ap.projectId });
  return `<article class="card apc"><div class="ch"><div><p class="sm muted"><span class="bd mute">${AP_TYPE[ap.type]}</span> <span class="mono">${esc(ap.ref)}</span> · ${esc(p.name)} · ${ago(ap.at)}</p><h3 class="h3">${esc(ap.title)}</h3></div>${ap.amountP != null ? `<p class="amt">${money(ap.amountP)}</p>` : ''}</div>
    <p class="sm">${ctx}</p>
    <ol class="steps">${ap.steps.map(s => `<li class="${s.status}" title="${esc(s.label)}">${esc(roleName(s.role))}${s.by ? ' · ' + esc(uname(s.by).split(' ')[0]) : ''}</li>`).join('')}</ol>
    ${ap.status === 'Pending' && canAct(ap) ? decideButtons(ap) : ap.status === 'Pending' ? `<p class="sm muted">${esc(whyCantAct(ap))}</p>${demoSwitch(ap)}` : ''}
    <div class="fa left"><button class="btn sm ghost" ${open}>Open record ${ic('arrow')}</button></div></article>`;
}

/* ================= DOCUMENTS ================= */
VIEWS.documents = {
  mod: 'documents', title: 'Documents',
  render() { return pageHead('Documents', 'Drawings, contracts, permits and records with revisions, approvals and expiry reminders', can('documents', 'create') ? `<button class="btn primary" data-act="upload">${ic('up')}Upload document</button>` : '') + docsList(myProjects().filter(p => inScope(p.id)).map(p => p.id)); }
};
function docsPanel(pid) { return `<div class="ph-a end">${can('documents', 'create') ? `<button class="btn primary" data-act="upload" data-pid="${pid}">${ic('up')}Upload document</button>` : ''}</div>` + docsList([pid]); }
const latest = d => d.versions[d.versions.length - 1], latestApproved = d => [...d.versions].reverse().find(v => v.status === 'Approved');
function docsList(pids) {
  const q = norm(UI.docq), today = todayISO();
  let D = S.docs.filter(d => pids.includes(d.projectId));
  if (UI.doct === 'expiring') D = D.filter(d => d.expiry && diffDays(today, d.expiry) <= 30); else if (UI.doct !== 'all') D = D.filter(d => d.type === UI.doct);
  if (q) D = D.filter(d => norm(d.title + ' ' + d.tags.join(' ') + ' ' + d.versions.map(v => v.file).join(' ')).includes(q));
  const types = [...new Set(S.docs.filter(d => pids.includes(d.projectId)).map(d => d.type))];
  return `<div class="toolbar"><form data-form="docSearch" class="search"><label class="sr" for="dq">Search documents</label>${ic('search')}<input id="dq" name="q" value="${esc(UI.docq)}" placeholder="Search title, tag or file name" inputmode="search"></form>
    <label class="sr" for="dt">Filter by type</label><select id="dt" data-chg="doct" class="sel">${opt('all', 'All types', UI.doct)}${opt('expiring', 'Expiring within 30 days', UI.doct)}${types.map(t => opt(t, t, UI.doct)).join('')}</select></div>
  <section class="card flush"><table class="t stack"><thead><tr><th>Document</th><th>Type</th><th>Project</th><th>Latest</th><th>Approved for use</th><th>Expiry</th></tr></thead><tbody>
  ${D.map(d => { const l = latest(d), a = latestApproved(d), ex = d.expiry ? diffDays(today, d.expiry) : null;
    return `<tr class="click" data-act="doc" data-id="${d.id}" tabindex="0"><td><b>${esc(d.title)}</b><br><span class="sm muted">${d.tags.map(esc).join(' · ')}</span></td><td>${esc(d.type)}</td><td>${esc(shortName(proj(d.projectId)))}</td><td class="nowrap"><span class="mono sm">${esc(l.rev)}</span> ${badge(l.status)}</td><td class="nowrap">${a ? `<span class="mono sm">${esc(a.rev)}</span>` : '<span class="muted">—</span>'}</td><td class="nowrap ${ex != null && ex <= 14 ? 'tbad' : ex != null && ex <= 30 ? 'twarn' : ''}">${d.expiry ? fmtDate(d.expiry) + (ex <= 30 ? ` · ${ex < 0 ? 'expired' : ex + ' days'}` : '') : '—'}</td></tr>`; }).join('') || `<tr><td colspan="6">${empty('No documents match')}</td></tr>`}
  </tbody></table></section>`;
}
FORM.docSearch = fd => { UI.docq = String(fd.get('q') || ''); render(); };
CHG.doct = el => { UI.doct = el.value; render(); };
ACT.doc = el => showModal('doc', el.dataset.id);
MODALS.doc = id => {
  const d = S.docs.find(x => x.id === id), p = proj(d.projectId), a = latestApproved(d), l = latest(d), ed = can('documents', 'edit') && hasProject(d.projectId);
  const ap = S.approvals.find(x => x.type === 'DOC' && x.ctx.docId === d.id && x.status === 'Pending');
  openModal(esc(d.title), `<div class="kv2"><div><span class="kl">Type</span>${esc(d.type)}</div><div><span class="kl">Approved for use</span>${a ? `<b>${esc(a.rev)}</b> · ${esc(a.file)}` : 'None yet'}</div><div><span class="kl">Expiry</span>${d.expiry ? fmtDate(d.expiry) : '—'}</div><div><span class="kl">Tags</span>${d.tags.map(esc).join(', ') || '—'}</div></div>
    ${a && l !== a && l.status !== 'Superseded' ? `<p class="note">Site teams should keep using <b>${esc(a.rev)}</b> until ${esc(l.rev)} is approved.</p>` : ''}
    <h3 class="h3">Revisions</h3><table class="t"><thead><tr><th>Rev</th><th>File</th><th>Status</th><th>Uploaded</th><th>Note</th></tr></thead><tbody>${[...d.versions].reverse().map(v => `<tr><td class="mono">${esc(v.rev)}</td><td class="sm">${esc(v.file)}<br><span class="muted">${v.sizeKB.toLocaleString('en-IN')} KB${v.blobKey && BLOBS[v.blobKey] ? ' · held in this tab' : ''}</span></td><td>${badge(v.status)}</td><td class="sm nowrap">${esc(uname(v.by))}<br>${fmtStamp(v.at)}</td><td class="sm">${esc(v.note)}</td></tr>`).join('')}</tbody></table>
    ${l.blobKey && BLOBS[l.blobKey] && /\.(png|jpe?g|webp)$/i.test(l.file) ? `<img class="preview" src="${BLOBS[l.blobKey]}" alt="${esc(l.file)}">` : ''}
    ${ap ? chainHTML(ap) + (canAct(ap) ? decideButtons(ap) : demoSwitch(ap)) : ''}
    <div class="fa">${ed && !ap && l.status === 'Draft' ? `<button class="btn" data-act="docSubmit" data-id="${d.id}">Submit ${esc(l.rev)} for approval</button>` : ''}${ed ? `<button class="btn primary" data-act="upload" data-doc="${d.id}">${ic('up')}New revision</button>` : ''}</div>
    ${threadHTML(d.id)}`, { wide: true, sub: `${esc(p.name)} · ${esc(d.id)}` });
};
ACT.docSubmit = el => { const d = S.docs.find(x => x.id === el.dataset.id), l = latest(d); l.status = 'Pending'; d.status = d.versions.some(v => v.status === 'Approved') ? 'Approved' : 'Pending'; createApproval({ type: 'DOC', ref: d.id + ' ' + l.rev, projectId: d.projectId, title: `${d.title}, revision ${l.rev}`, steps: STEP_TEMPLATES.DOC(), ctx: { docId: d.id, rev: l.rev } }); toast(`${l.rev} sent for approval`); refresh(); };
ACT.upload = el => { UI.up = { pid: el.dataset.pid || (UI.pf !== 'all' ? UI.pf : null), doc: el.dataset.doc || null, file: null }; showModal('upload'); };
MODALS.upload = () => {
  const u = UI.up, d = u.doc ? S.docs.find(x => x.id === u.doc) : null, next = d ? nextRev(latest(d).rev) : 'R0';
  openModal(d ? `New revision · ${esc(d.title)}` : 'Upload document', `<form data-form="upload" class="form">
    ${d ? '' : `<div class="g2">${field('Project', `<select name="pid">${myProjects().map(p => opt(p.id, p.name, u.pid)).join('')}</select>`)}${field('Type', `<select name="type">${DOC_TYPES.map(t => opt(t, t)).join('')}</select>`)}</div>${field('Title', '<input name="title" required maxlength="120" autofocus>')}<div class="g2">${field('Tags', '<input name="tags" maxlength="120" placeholder="comma separated, e.g. structural, cottages">')}${field('Expiry date', '<input type="date" name="expiry">', 'Permits, insurance, warranties')}</div>`}
    ${field('File', `<input type="file" name="file" required data-chg="upFile" accept="${UPLOAD_EXT.map(e => '.' + e).join(',')}">`, `${UPLOAD_EXT.join(', ')} · up to ${S.settings.maxMB} MB. ${u.file ? `<b>${esc(u.file.name)}</b> ready.` : ''}`)}
    <div class="g2">${field('Revision', `<input name="rev" required maxlength="6" value="${next}">`)}${field('Revision note', '<input name="note" maxlength="160" placeholder="What changed">')}</div>
    <label class="ck"><input type="checkbox" name="approve" ${!d || d.type === 'Drawing' ? 'checked' : ''}> Send for approval (Project Director) — until approved, the previous approved revision stays in use</label>
    <p class="fine">In this demo the file stays in this browser tab. Production stores it in private object storage with signed links, virus scanning and project-scoped access.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Upload</button></div></form>`, { wide: true });
};
function nextRev(r) { const m = /^([A-Za-z]*)(\d+)$/.exec(r); return m ? m[1] + (Number(m[2]) + 1) : r + '.1'; }
function checkFile(f) { const ext = f.name.split('.').pop().toLowerCase(); if (!UPLOAD_EXT.includes(ext)) return `.${ext} files are not allowed`; if (f.size > S.settings.maxMB * 1024 * 1024) return `File is over ${S.settings.maxMB} MB`; if (f.size === 0) return 'File is empty'; return ''; }
CHG.upFile = el => { const f = el.files[0]; if (!f) return; const err = checkFile(f); if (err) { el.value = ''; toast(err, 'bad'); UI.up.file = null; return; } UI.up.file = f; };
FORM.upload = fd => {
  const u = UI.up, f = u.file || fd.get('file'); if (!f || !f.name) { toast('Choose a file', 'bad'); return; }
  const err = checkFile(f); if (err) { toast(err, 'bad'); return; }
  let d = u.doc ? S.docs.find(x => x.id === u.doc) : null; const rev = String(fd.get('rev')).trim();
  if (d && d.versions.some(v => v.rev === rev)) { toast(`${rev} already exists — revisions are never overwritten`, 'bad'); return; }
  const key = 'f' + Date.now(); BLOBS[key] = URL.createObjectURL(f);
  const v = { rev, status: fd.get('approve') ? 'Pending' : 'Draft', file: f.name.replace(/[^\w.\- ]+/g, '_').slice(0, 100), sizeKB: Math.max(1, Math.round(f.size / 1024)), at: nowISO(), by: me().id, note: String(fd.get('note') || '').trim(), blobKey: key };
  if (!d) { const pid = fd.get('pid'); if (!hasProject(pid)) { toast('No access to that project', 'bad'); return; } d = { id: nid('DOC'), projectId: pid, title: String(fd.get('title')).trim(), type: fd.get('type'), tags: String(fd.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean), expiry: fd.get('expiry') || null, status: v.status, versions: [], clientVisible: false }; S.docs.push(d); }
  d.versions.push(v); log('Document uploaded', `${d.title} ${rev} (${v.file}, ${v.sizeKB} KB)`, d.projectId, d.id);
  if (v.status === 'Pending') createApproval({ type: 'DOC', ref: d.id + ' ' + rev, projectId: d.projectId, title: `${d.title}, revision ${rev}`, steps: STEP_TEMPLATES.DOC(), ctx: { docId: d.id, rev } });
  UI.up = null; toast(v.status === 'Pending' ? `${rev} uploaded and sent for approval` : `${rev} uploaded as draft`); UI.modal = { name: 'doc', id: d.id }; refresh();
};

/* ================= SETTINGS ================= */
VIEWS.settings = {
  mod: 'settings', title: 'Settings',
  render() {
    const body = UI.stab === 'roles' ? rolesPanel() : UI.stab === 'rules' ? rulesPanel() : usersPanel();
    return pageHead('Users, roles & settings', 'Access is configured here as data — screens read permissions, nothing is hard-coded per role') + tabs([['users', 'Users & access'], ['roles', 'Roles & permissions'], ['rules', 'Approval rules & controls']], UI.stab, 'stab') + `<div class="panel">${body}</div>`;
  }
};
ACT.stab = el => { UI.stab = el.dataset.k; render(); };
function usersPanel() {
  const ed = can('settings', 'edit'), act = S.roles.filter(r => r.active);
  return `<div class="ph-a end">${can('settings', 'create') ? `<button class="btn primary" data-act="newUser">${ic('plus')}User</button>` : ''}</div><section class="card flush"><table class="t stack"><thead><tr><th>Name</th><th>Role</th><th>Project access</th><th>Multi-factor</th></tr></thead><tbody>
  ${S.users.map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="sm muted">${esc(u.title)} · ${esc(u.email)}</span></td>
    <td>${ed && u.id !== me().id ? `<label class="sr" for="ur-${u.id}">Role for ${esc(u.name)}</label><select id="ur-${u.id}" class="sel" data-chg="userRole" data-id="${u.id}">${act.map(r => opt(r.id, r.name, u.role)).join('')}</select>` : esc(roleName(u.role)) + (u.id === me().id ? ' <span class="muted sm">(you)</span>' : '')}</td>
    <td class="sm">${u.projects === 'all' ? 'All projects' : u.projects.map(id => esc(shortName(proj(id) || { name: id }))).join(', ') || 'None'}${ed ? ` <button class="btn sm ghost" data-act="userProjects" data-id="${u.id}">Edit</button>` : ''}</td>
    <td>${PRIVILEGED.includes(u.role) ? badge('Active', 'Required') : '<span class="muted sm">Optional</span>'}</td></tr>`).join('')}</tbody></table></section>
  <p class="fine">Multi-factor sign-in is enforced for Super Admin, Managing Director, Project Director and Finance. You cannot change your own role.</p>`;
}
CHG.userRole = el => {
  const u = userById(el.dataset.id), was = u.role, r = roleById(el.value);
  if (was === 'super_admin' && S.users.filter(x => x.role === 'super_admin').length < 2) { toast('Keep at least one Super Admin', 'bad'); render(); return; }
  u.role = r.id; u.mfa = PRIVILEGED.includes(r.id); log('Role changed', `${u.name}: ${roleName(was)} → ${r.name}`); toast(`${u.name} is now ${r.name}`); refresh(false);
};
ACT.userProjects = el => showModal('userProjects', el.dataset.id);
MODALS.userProjects = id => {
  const u = userById(id);
  openModal(`Project access · ${esc(u.name)}`, `<form data-form="userProjects" data-id="${id}" class="form"><label class="ck"><input type="checkbox" name="all" ${u.projects === 'all' ? 'checked' : ''}> All projects, including future ones</label>
    <fieldset class="fs"><legend>Or specific projects</legend><div class="checks">${S.projects.map(p => `<label class="ck"><input type="checkbox" name="p" value="${p.id}" ${u.projects !== 'all' && u.projects.includes(p.id) ? 'checked' : ''}> ${esc(p.name)} <span class="muted sm mono">${p.id}</span></label>`).join('')}</div></fieldset>
    <p class="fine">Project scope is enforced on every list, total and approval: people never see records from projects outside their access.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Save access</button></div></form>`);
};
FORM.userProjects = (fd, f) => { const u = userById(f.dataset.id), was = u.projects === 'all' ? 'all' : u.projects.join(', '); u.projects = fd.get('all') ? 'all' : fd.getAll('p'); log('Access changed', `${u.name}: ${was || 'none'} → ${u.projects === 'all' ? 'all' : u.projects.join(', ') || 'none'}`); closeModal(); toast('Access updated'); refresh(false); };
ACT.newUser = () => openModal('New user', `<form data-form="newUser" class="form"><div class="g2">${field('Full name', '<input name="name" required maxlength="60" autofocus>')}${field('Email', '<input name="email" type="email" required maxlength="80">')}</div><div class="g2">${field('Job title', '<input name="title" maxlength="60">')}${field('Role', `<select name="role">${S.roles.filter(r => r.active).map(r => opt(r.id, r.name, 'site_sup')).join('')}</select>`, 'Only active roles can be assigned')}</div>
  <fieldset class="fs"><legend>Project access</legend><div class="checks">${S.projects.map(p => `<label class="ck"><input type="checkbox" name="p" value="${p.id}"> ${esc(p.name)}</label>`).join('')}</div></fieldset>
  <p class="fine">Production sends an invitation through Supabase Auth; privileged roles must enrol an authenticator app at first sign-in.</p><div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Add user</button></div></form>`);
FORM.newUser = fd => { const email = String(fd.get('email')).trim().toLowerCase(); if (S.users.some(u => u.email === email)) { toast('That email already has an account', 'bad'); return; } const u = { id: 'u' + pad(S.users.length + 1, 2), name: String(fd.get('name')).trim(), email, title: String(fd.get('title') || '').trim(), role: fd.get('role'), projects: fd.getAll('p'), mfa: PRIVILEGED.includes(fd.get('role')) }; S.users.push(u); log('User added', `${u.name} (${roleName(u.role)}) · ${u.projects.length} project(s)`); closeModal(); toast(`${u.name} added`); refresh(false); };
function rolesPanel() {
  const ed = can('settings', 'edit'), r = roleById(UI.roleSel) || S.roles[0], locked = r.id === 'super_admin', n = S.users.filter(u => u.role === r.id).length;
  return `<div class="roles"><nav class="rl" aria-label="Roles">${S.roles.map(x => `<button class="rli${x.id === r.id ? ' on' : ''}" data-act="roleSel" data-id="${x.id}"><span>${esc(x.name)}</span><span class="sm muted nowrap">${x.active ? (k => k + ' user' + (k === 1 ? '' : 's'))(S.users.filter(u => u.role === x.id).length) : 'Inactive'}</span></button>`).join('')}</nav>
  <section class="card"><div class="ch"><div><h2 class="h2">${esc(r.name)}</h2><p class="sm muted">${n} user${n === 1 ? '' : 's'} · ${r.active ? 'Active' : 'Not yet activated — activate once the core workflows are stable'}</p></div>${ed && !locked ? `<button class="btn sm" data-act="roleActive" data-id="${r.id}" ${r.active && n ? 'disabled title="Reassign its users first"' : ''}>${r.active ? 'Deactivate' : 'Activate role'}</button>` : ''}</div>
    <div class="scroll"><table class="t matrix"><thead><tr><th>Module</th>${ACTIONS.map(a => `<th>${a[0].toUpperCase() + a.slice(1)}</th>`).join('')}</tr></thead><tbody>
    ${MODULES.map(([m, label]) => `<tr><td>${label}${m === 'budget' ? '<br><span class="sm muted">Sensitive — controls all cost figures</span>' : ''}</td>${ACTIONS.map(a => `<td class="c"><input type="checkbox" aria-label="${esc(r.name)} ${a} ${label}" data-chg="perm" data-role="${r.id}" data-mod="${m}" data-a="${a}" ${r.perms[m][a] ? 'checked' : ''} ${!ed || (locked && m === 'settings') ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <p class="fine">Changes apply immediately and are written to the audit log. Approve rights decide who can act on an approval step; the step's role and the person's project access must also match.${locked ? ' Super Admin keeps settings access so the system cannot be locked out, and holds no approval rights by default.' : ''}</p></section></div>`;
}
ACT.roleSel = el => { UI.roleSel = el.dataset.id; render(); };
CHG.perm = el => { const r = roleById(el.dataset.role), { mod, a } = el.dataset; if (r.id === 'super_admin' && mod === 'settings') return; r.perms[mod][a] = el.checked; log('Permission changed', `${r.name}: ${a} on ${MODULES.find(x => x[0] === mod)[1]} ${el.checked ? 'granted' : 'removed'}`); toast('Permission saved'); refresh(false); };
ACT.roleActive = el => { const r = roleById(el.dataset.id); if (r.active && S.users.some(u => u.role === r.id)) { toast('Reassign this role’s users first', 'bad'); return; } r.active = !r.active; log(r.active ? 'Role activated' : 'Role deactivated', r.name); refresh(false); };
function rulesPanel() {
  const ed = can('settings', 'edit'), s = S.settings, t = s.thresholds, ex = [3_00_000_00, 12_00_000_00, 40_00_000_00];
  const dis = ed ? '' : 'disabled';
  return `<section class="card"><form data-form="rules" class="form"><h2 class="h2">Purchase order approval limits</h2>
    <div class="g2">${field('Project Manager approves up to (₹)', `<input name="pm" inputmode="decimal" required value="${moneyInput(t.pm)}" ${dis}>`)}${field('Project Director approves up to (₹)', `<input name="pd" inputmode="decimal" required value="${moneyInput(t.pd)}" ${dis}>`, 'Above this the Managing Director also approves')}</div>
    <p class="sm">Routes today: ${ex.map(a => `<span class="chg">${fmtINR(a)} → ${poSteps(a, 0).map(x => roleName(x.role)).join(' → ')}</span>`).join(' ')}</p>
    <h2 class="h2">Cost control flags</h2><div class="g2">${field('Warn when commitments reach (% of budget)', `<input name="warn" type="number" min="50" max="100" value="${s.warnPct}" ${dis}>`)}${field('Flag when forecast exceeds (% of budget)', `<input name="flag" type="number" min="90" max="150" value="${s.flagPct}" ${dis}>`)}</div>
    <h2 class="h2">Site reporting & files</h2><div class="g2">${field('Daily report cutoff', `<input name="cutoff" type="time" value="${s.cutoff}" ${dis}>`)}${field('Maximum upload size (MB)', `<input name="maxMB" type="number" min="1" max="100" value="${s.maxMB}" ${dis}>`, 'Allowed types: ' + UPLOAD_EXT.join(', '))}</div>
    ${ed ? '<div class="fa"><button class="btn primary">Save controls</button></div>' : '<p class="fine">Only roles with settings edit rights can change these.</p>'}</form></section>
    <section class="card"><h2 class="h2">Controls enforced in this build</h2><ul class="rules">
      <li>No purchase order is committed without its full approval chain; orders above the available cost-code budget add an MD override.</li>
      <li>Budgets change only through versioned revisions approved by Finance and the MD; earlier versions are kept.</li>
      <li>Requesters cannot approve their own requests, and one person cannot approve two steps.</li>
      <li>Site progress and BOQ quantities update only after a project manager verifies the daily report.</li>
      <li>Material counts as stock and actual cost only after a goods receipt passes quality check.</li>
      <li>Cost reports keep actual, committed and estimated figures separate; estimates are labelled as estimates.</li>
      <li>Money is stored in whole paise and quantities in thousandths, so totals never drift from floating-point rounding.</li>
      <li>Uploads are limited by type and size; document revisions are never overwritten.</li>
      <li>Every administrative and financial action is written to the audit log with user, role and time.</li></ul></section>`;
}
FORM.rules = fd => {
  const pm = parseMoney(fd.get('pm')), pd = parseMoney(fd.get('pd')), warn = Number(fd.get('warn')), flag = Number(fd.get('flag')), cutoff = fd.get('cutoff'), maxMB = Number(fd.get('maxMB'));
  if (!pm || !pd || pm >= pd) { toast('Project Director limit must be higher than the Project Manager limit', 'bad'); return; }
  if (!(warn >= 50 && warn <= 100 && flag >= 90 && flag <= 150)) { toast('Check the flag percentages', 'bad'); return; }
  const s = S.settings, ch = [];
  if (pm !== s.thresholds.pm) ch.push(`PM limit ${fmtINR(s.thresholds.pm)} → ${fmtINR(pm)}`); if (pd !== s.thresholds.pd) ch.push(`PD limit ${fmtINR(s.thresholds.pd)} → ${fmtINR(pd)}`);
  if (warn !== s.warnPct) ch.push(`warn ${s.warnPct}% → ${warn}%`); if (flag !== s.flagPct) ch.push(`flag ${s.flagPct}% → ${flag}%`); if (cutoff !== s.cutoff) ch.push(`cutoff ${s.cutoff} → ${cutoff}`); if (maxMB !== s.maxMB) ch.push(`upload limit ${s.maxMB} → ${maxMB} MB`);
  Object.assign(s, { thresholds: { pm, pd }, warnPct: warn, flagPct: flag, cutoff, maxMB });
  if (ch.length) log('Settings changed', ch.join('; ')); toast(ch.length ? 'Controls saved' : 'No changes'); refresh(false);
};

/* ================= AUDIT LOG ================= */
VIEWS.audit = {
  mod: 'audit', title: 'Audit log',
  render() {
    const q = norm(UI.auditq), A = S.audit.filter(a => (a.projectId ? inScope(a.projectId) : UI.pf === 'all') && (!q || norm(a.action + ' ' + a.detail + ' ' + uname(a.userId)).includes(q)));
    return pageHead('Audit log', `${A.length} entr${A.length === 1 ? 'y' : 'ies'} · append-only record of who did what, when`, can('audit', 'export') ? '<button class="btn" data-act="exportAudit">Export</button>' : '') +
      `<div class="toolbar"><form data-form="auditSearch" class="search"><label class="sr" for="aq">Search audit log</label>${ic('search')}<input id="aq" name="q" value="${esc(UI.auditq)}" placeholder="Search action, person or detail" inputmode="search"></form></div>
      <section class="card flush"><table class="t stack"><thead><tr><th>When</th><th>Who</th><th>Project</th><th>Action</th><th>Detail</th></tr></thead><tbody>
      ${A.slice(0, 150).map(a => `<tr><td class="nowrap sm">${fmtStamp(a.at)}</td><td>${esc(uname(a.userId))}<br><span class="sm muted">${esc(roleName(a.role))}</span></td><td class="sm">${a.projectId ? esc(shortName(proj(a.projectId) || { name: a.projectId })) : '<span class="muted">System</span>'}</td><td><b>${esc(a.action)}</b></td><td class="sm">${esc(a.detail)}</td></tr>`).join('') || `<tr><td colspan="5">${empty('No entries match')}</td></tr>`}
      </tbody></table>${A.length > 150 ? `<p class="fine pad">Showing the latest 150 of ${A.length}. Export for the full record.</p>` : ''}</section>`;
  }
};
FORM.auditSearch = fd => { UI.auditq = String(fd.get('q') || ''); render(); };
ACT.exportAudit = () => { const rows = [['Timestamp', 'User', 'Role', 'Project', 'Action', 'Detail']]; S.audit.filter(a => !a.projectId || hasProject(a.projectId)).forEach(a => rows.push([a.at, uname(a.userId), roleName(a.role), a.projectId || '', a.action, a.detail])); exportCSV('audit-log-' + todayISO() + '.csv', rows, 'Audit log'); };
