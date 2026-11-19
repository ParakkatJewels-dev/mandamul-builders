'use strict';
/* Main — shell, sign-in, routing, global events */

const NAV = [['dashboard', 'Command center', 'dash'], ['alerts', 'Action center', 'bell'], ['today', 'Today', 'today'], ['projects', 'Projects', 'proj'], ['schedule', 'Schedule', 'cal'], ['units', 'Units & master plan', 'unit'], ['twin', 'Digital twin', 'layers'], ['site', 'Site reports', 'site'], ['quality', 'Quality', 'shield'], ['boq', 'BOQ & budgets', 'boq'], ['procurement', 'Procurement', 'cart'], ['contracts', 'Contracts', 'hard'], ['payments', 'Payments', 'wallet'], ['handover', 'Handover', 'key'], ['approvals', 'Approvals', 'check'], ['documents', 'Documents', 'doc'], ['reports', 'Reports', 'chart'], ['settings', 'Settings', 'gear'], ['audit', 'Audit log', 'log']];
const allowed = (v, r) => (v.allowed ? v.allowed(r) : can(v.mod));
const HOME = { site_sup: 'today', finance: 'payments', qs: 'contracts', proc: 'procurement', architect: 'documents', quality: 'quality' };  // role-specific home screens
function defaultRoute() { const h = me() && HOME[me().role]; return [h, 'dashboard', 'today', 'approvals', 'documents', 'projects'].filter(Boolean).find(n => VIEWS[n] && allowed(VIEWS[n], {})) || 'projects'; }
function parseRoute() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (/^p-ma-\d{4}-\d{3}$/.test(h)) return { name: h, view: 'project', pid: h.slice(2).toUpperCase() };
  return VIEWS[h] && h !== 'project' ? { name: h, view: h } : { name: defaultRoute(), view: defaultRoute() };
}
function go(name) { if (location.hash.slice(1) === name) render(); else location.hash = name; }
let lastRoute = '';

const MARK = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M4 32h32" /><path d="M9 32V19a11 11 0 0122 0v13" /><path d="M15 32V21a5 5 0 0110 0v11" /><circle cx="20" cy="8" r="1.6" class="sun"/></svg>`;

function shell(r) {
  const u = me(), myN = S.notifs.filter(n => n.userId === u.id), unread = myN.filter(n => !n.read).length;
  const pendMine = S.approvals.filter(a => a.status === 'Pending' && canAct(a)).length;
  const nav = NAV.filter(([n]) => allowed(VIEWS[n], {})).map(([n, l, i]) => `<a href="#${n}" class="nv${r.view === n || (r.view === 'project' && n === 'projects') ? ' on' : ''}" ${r.view === n ? 'aria-current="page"' : ''}>${ic(i)}<span>${l}</span>${n === 'approvals' && pendMine ? `<span class="nc">${pendMine}</span>` : ''}</a>`).join('');
  const P = myProjects();
  return `<div class="demo-strip" role="note"><span><b>Demo environment</b> — fictional projects, people and vendors<span class="dl-long">. Changes stay in this browser</span>.</span><button class="lnk" data-act="resetAsk">Reset demo</button></div>
  <div class="app">
    <aside class="side" id="side" aria-label="Main navigation">
      <div class="brand">${MARK}<div><p class="bn">M Andamul</p><p class="bs">Development OS</p></div></div>
      <nav class="nav">${nav}</nav>
      <div class="later"><p class="sm"><b>Prototype v2</b></p><p class="sm muted">Not in this build: stock ledger, land feasibility calculator, accounting and bank integration, email/WhatsApp delivery, 3D/BIM. The production database is in the platform repository.</p></div>
    </aside>
    <div class="scrimnav" data-act="navClose"></div>
    <div class="mainwrap">
      <header class="top">
        <button class="ib menu" data-act="navOpen" aria-label="Open navigation">${ic('menu')}</button>
        <div class="tb-brand">${MARK}<span>M Andamul</span></div>
        <div class="gs"><label class="sr" for="gsearch">Search</label>${ic('search')}<input id="gsearch" placeholder="Search  /" autocomplete="off"><ul id="gresults" class="pop gres" hidden></ul></div>
        <label class="pf"><span class="sr">Project filter</span><select data-chg="pf" aria-label="Project filter">${opt('all', 'All my projects (' + P.length + ')', UI.pf)}${P.map(p => opt(p.id, p.name, UI.pf)).join('')}</select></label>
        <div class="tb-r">
          ${can('dashboard') ? `<button class="ib" data-act="ask" aria-label="Ask about the portfolio" title="Ask">${ic('spark')}</button>` : ''}
          <button class="ib" data-act="pop" data-k="notif" aria-label="Notifications${unread ? ', ' + unread + ' unread' : ''}" aria-expanded="${UI.pop === 'notif'}">${ic('bell')}${unread ? `<span class="dotn">${unread}</span>` : ''}</button>
          <button class="who" data-act="pop" data-k="user" aria-expanded="${UI.pop === 'user'}"><span class="av">${esc(u.name.split(' ').map(x => x[0]).join('').slice(0, 2))}</span><span class="wn"><b>${esc(u.name)}</b><span>${esc(roleName(u.role))}</span></span></button>
        </div>
        ${UI.pop === 'notif' ? `<div class="pop" role="dialog" aria-label="Notifications"><p class="h3">Notifications</p>${myN.length ? `<ul class="nl">${myN.slice(0, 12).map(n => `<li><button class="${n.read ? '' : 'unread'}" data-act="notifGo" data-id="${n.id}"><span>${esc(n.text)}</span><span class="sm muted">${ago(n.at)}</span></button></li>`).join('')}</ul>` : '<p class="muted sm">Nothing new.</p>'}</div>` : ''}
        ${UI.pop === 'user' ? `<div class="pop" role="dialog" aria-label="Account"><p><b>${esc(u.name)}</b><br><span class="sm muted">${esc(u.title)} · ${esc(roleName(u.role))}</span></p><p class="sm">Projects: ${u.projects === 'all' ? 'all' : u.projects.map(id => esc(shortName(proj(id)))).join(', ')}</p><p class="sm">Sign-in: ${u.mfa ? 'password + authenticator (MFA)' : 'password'}</p><div class="fa left"><button class="btn sm" data-act="signOut">Switch user</button></div></div>` : ''}
      </header>
      <main id="main" tabindex="-1"></main>
    </div>
  </div>`;
}

/* ---------- sign-in (demo) ---------- */
function signIn() {
  if ($('#modal').innerHTML) { UI.modal = null; $('#modal').innerHTML = ''; document.body.classList.remove('locked'); }
  const pick = UI.signPick ? userById(UI.signPick) : null;
  document.body.dataset.route = 'signin';
  $('#app').innerHTML = `<div class="demo-strip" role="note"><span><b>Demo environment</b> — fictional projects, people and vendors.</span></div>
  <div class="signin"><div class="si-side"><div class="brand big">${MARK}<div><p class="bn">M Andamul</p><p class="bs">Development OS</p></div></div>
    <p class="tag">From Land to Landmark.</p>
    <p class="si-l">One system for resort and hospitality development: schedules, site reports, BOQ and budgets, procurement, documents and approvals — with cost and progress visible to leadership as they happen.</p>
    <ul class="si-f"><li>Approval chains with budget overrides</li><li>Forecast handover from verified site progress</li><li>Actual, committed and estimated cost kept apart</li><li>Every action in an audit trail</li></ul></div>
  <div class="si-card">${pick && PRIVILEGED.includes(pick.role) ? `<h1 class="h2">Verify it’s you</h1><p class="sm">${esc(pick.name)} · ${esc(roleName(pick.role))} accounts need a second factor.</p>
    <form data-form="mfa" class="form">${field('6-digit code from your authenticator app', '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus class="otp">', 'Demo code: 246810')}
    <div class="fa"><button type="button" class="btn ghost" data-act="signBack">Back</button><button class="btn primary">Verify & sign in</button></div></form>`
    : `<h1 class="h2">Sign in</h1><p class="sm">Demo sign-in — choose a person to see the platform with their role and project access.</p>
    <div class="people">${S.users.map(u => `<button class="person" data-act="signPick" data-id="${u.id}"><span class="av">${esc(u.name.split(' ').map(x => x[0]).join('').slice(0, 2))}</span><span><b>${esc(u.name)}</b><br><span class="sm muted">${esc(roleName(u.role))} · ${u.projects === 'all' ? 'all projects' : u.projects.map(id => esc(shortName(proj(id) || { name: id }))).join(', ')}</span></span>${PRIVILEGED.includes(u.role) ? `<span class="mfa" title="Multi-factor required">${ic('lock')}</span>` : ''}</button>`).join('')}</div>
    <p class="fine">Production sign-in: Supabase Auth with email and password or magic link, authenticator-app MFA for privileged roles, and row-level security that scopes every query to the person's projects.</p>`}</div></div>
`;
  setTimeout(() => { const f = $('.otp') || $('.person'); f && f.focus(); }, 30);
}
ACT.signPick = el => { const u = userById(el.dataset.id); if (PRIVILEGED.includes(u.role)) { UI.signPick = u.id; signIn(); } else startSession(u.id, false); };
ACT.signBack = () => { UI.signPick = null; signIn(); };
FORM.mfa = fd => { if (String(fd.get('code')).trim() !== '246810') { toast('That code is not valid — try 246810 in this demo', 'bad'); return; } startSession(UI.signPick, true); };
const resetView = () => Object.assign(UI, { pf: 'all', pop: null, ptab: 'overview', btab: 'cost', prtab: 'mr', atab: 'mine', pof: 'all', pcode: null, srf: 'all', docq: '', doct: 'all', boqq: '', auditq: '' });
function startSession(id, mfa) {
  S.session = { userId: id, at: nowISO() }; UI.signPick = null; resetView();
  log('Signed in', `${uname(id)} (${roleName(userById(id).role)})${mfa ? ' with MFA' : ''}`); save();
  const d = defaultRoute(); if (location.hash.slice(1) === d) render(); else location.hash = d;
}
ACT.signOut = () => { log('Signed out', uname(me().id)); S.session = null; UI.pop = null; save(); signIn(); };
ACT.signAs = el => { closeModal(); const u = userById(el.dataset.id); log('Signed out', uname(me().id) + ' (demo switch)'); S.session = { userId: u.id, at: nowISO() }; log('Signed in', `${u.name} (${roleName(u.role)}) — demo switch`); const keep = UI.pf; resetView(); if (keep !== 'all' && hasProject(keep)) UI.pf = keep; toast(`Signed in as ${u.name}`); save(); render(); };

/* ---------- render ---------- */
function render() {
  if (typeof COST_V !== 'undefined') COST_V++;   // cost cache is valid for one render (views-g)
  if (!S.session || !me()) { signIn(); return; }
  const r = parseRoute(), v = VIEWS[r.view];
  if (UI.pf !== 'all' && !hasProject(UI.pf)) UI.pf = 'all';
  const changed = r.name !== lastRoute; lastRoute = r.name;
  document.body.dataset.route = r.view;
  $('#app').innerHTML = shell(r);
  let html;
  try { html = allowed(v, r) ? v.render(r) : pageHead('No access') + empty(`Your role (${esc(roleName(me().role))}) does not include this area`, 'Ask a Super Admin to adjust permissions in Settings if you need it.'); }
  catch (e) { console.error(e); html = pageHead('Something went wrong') + empty('This screen hit an error', esc(e.message)); }
  $('#main').innerHTML = html;
  try { if (v && v.after && allowed(v, r)) v.after(r); } catch (e) { console.error(e); }
  document.title = (r.view === 'project' ? proj(r.pid)?.name || 'Project' : v.title) + ' · M Andamul';
  if (changed) { window.scrollTo(0, 0); document.body.classList.remove('navopen'); }
}

/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (UI.pop && !e.target.closest('.pop') && !(el && el.dataset.act === 'pop')) { UI.pop = null; if (!el) { render(); return; } }
  if (!el) return;
  if (el.dataset.act === 'scrim' && e.target !== el) return;
  const f = ACT[el.dataset.act]; if (f) { e.preventDefault(); guarded(() => f(el, e), el.dataset.act); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#modal') && $('#modal').innerHTML) closeModal(); else if (UI.pop) { UI.pop = null; render(); } else document.body.classList.remove('navopen'); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-act],article[data-act],.g-row[data-act]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); const h = FORM[f.dataset.form]; if (h) guarded(() => h(new FormData(f), f, e), f.dataset.form); });
document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && CHG[el.dataset.chg]) guarded(() => CHG[el.dataset.chg](el, e), el.dataset.chg); });
/* every action runs as a unit: if it throws, the data goes back to how it was and the person is told (B16) */
function guarded(fn, name) {
  const snap = JSON.stringify(S);
  try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(err => failed(err, name, null)); }
  catch (err) { failed(err, name, snap); }
}
function failed(err, name, snap) {
  console.error('[M Andamul] action failed:', name, err);
  if (snap) { S = JSON.parse(snap); save(); }
  try { render(); } catch (e2) { /* keep the error message visible */ }
  toast(snap ? 'That did not work and nothing was changed. Try again; if it keeps happening, tell IT what you clicked.' : 'Something went wrong in the background. Your saved data is unchanged.', 'bad');
  S.errors = (S.errors || []).slice(-19).concat([{ at: nowISO(), action: name, message: String(err && err.message || err) }]); save();
}
window.addEventListener('error', e => { if (S && S.session) failed(e.error || e.message, 'page', null); });
window.addEventListener('unhandledrejection', e => { if (S && S.session) failed(e.reason, 'background', null); });
window.addEventListener('hashchange', () => { if (S.session) render(); });

Object.assign(ACT, {
  closeModal: () => closeModal(), scrim: () => closeModal(),
  navOpen: () => document.body.classList.add('navopen'), navClose: () => document.body.classList.remove('navopen'),
  pop: el => { UI.pop = UI.pop === el.dataset.k ? null : el.dataset.k; if (UI.pop === 'notif') { render(); S.notifs.filter(n => n.userId === me().id).forEach(n => (n.read = true)); save(); return; } render(); },
  notifGo: el => { const n = S.notifs.find(x => x.id === el.dataset.id); UI.pop = null; n.read = true; save(); go(n.link); },
  resetAsk: () => openModal('Reset the demo?', `<p>This restores the sample projects, people and open approvals, and signs you out. Your changes in this browser will be lost.</p><div class="fa"><button class="btn ghost" data-act="closeModal">Keep my changes</button><button class="btn primary danger" data-act="resetGo">Reset demo</button></div>`),
  resetGo: () => { closeModal(); Object.keys(BLOBS).forEach(k => { try { URL.revokeObjectURL(BLOBS[k]); } catch (e) {} delete BLOBS[k]; }); S = seedState(); save(); UI.pf = 'all'; location.hash = ''; signIn(); toast('Demo reset'); }
});
CHG.pf = el => { UI.pf = el.value; render(); };

/* table cells label themselves for the stacked phone layout */
new MutationObserver(() => { for (const c of document.querySelectorAll('.stack td:not([data-l])')) { if (c.colSpan > 1) { c.dataset.l = ''; continue; } let i = 0, p = c; while ((p = p.previousElementSibling)) i += p.colSpan; c.dataset.l = c.closest('table').rows[0].cells[i]?.textContent || ''; } }).observe(document, { childList: true, subtree: true });

/* ---------- start ---------- */
S = load(); if (!S) { S = seedState(); save(); }
if (S.session && !me()) S.session = null;
/* on open: weekly cost snapshot, exception scan (de-duplicated), event processing, one daily summary per day */
try {
  ensurePhase3(); snapshot(); scanExceptions(); processEvents(); alertScan();
  if (S.meta.summaryOn !== todayISO()) { S.meta.summaryOn = todayISO(); const keep = S.session; for (const u of S.users.filter(u => ['md', 'pd'].includes(u.role))) { S.session = { userId: u.id }; const L = dailySummary(myProjects()); notify([u.id], 'Daily management summary — ' + L.map(x => x[0] + ': ' + x[1]).join(' · ').slice(0, 400), 'dashboard'); } S.session = keep; }
  save();
} catch (e) { console.error(e); }
render();
(async () => { try { if (window.claude && typeof window.claude.use === 'function') DL = await window.claude.use('downloads'); } catch (e) { DL = null; } })();
