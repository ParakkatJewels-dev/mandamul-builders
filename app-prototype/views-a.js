'use strict';
/* Views A — shared page parts, executive dashboard, projects, schedule */

function pageHead(title, lede = '', actions = '', crumb = '') {
  return `<header class="ph"><div class="ph-t">${crumb ? `<p class="crumb">${crumb}</p>` : ''}<h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions ? `<div class="ph-a">${actions}</div>` : ''}</header>`;
}
function tabs(list, cur, act) { return `<div class="tabs scroll" role="tablist">${list.map(([k, l, n]) => `<button role="tab" aria-selected="${k === cur}" class="tab${k === cur ? ' on' : ''}" data-act="${act}" data-k="${k}">${l}${n ? ` <span class="cnt">${n}</span>` : ''}</button>`).join('')}</div>`; }
function projectPicker(key) {
  const P = myProjects(); if (UI.pf !== 'all') return '';
  const sel = UI[key] && hasProject(UI[key]) ? UI[key] : P[0]?.id;
  return `<div class="chips scroll">${P.map(p => `<button class="chip${p.id === sel ? ' on' : ''}" data-act="pick" data-key="${key}" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>`;
}
function selProject(key) { if (UI.pf !== 'all' && hasProject(UI.pf)) return UI.pf; const P = myProjects(); return UI[key] && hasProject(UI[key]) ? UI[key] : P[0]?.id; }
ACT.pick = el => { UI[el.dataset.key] = el.dataset.id; render(); };
const shortName = p => p.name.split(' ')[0];
const varText = t => (Math.abs(t.variance) * 1000 < t.budget ? 'on budget' : t.variance < 0 ? fmtC(-t.variance) + ' over' : fmtC(t.variance) + ' under');
const projLink = pid => `<a href="#p-${pid.toLowerCase()}" class="plink">${esc(proj(pid)?.name || pid)}</a>`;

function threadHTML(eid) {
  const T = S.threads[eid] || [];
  return `<section class="thread"><h3 class="h3">Discussion</h3>${T.length ? T.map(c => `<div class="cm"><p class="cm-h"><b>${esc(uname(c.userId))}</b> · ${esc(roleName(userById(c.userId)?.role))} · ${ago(c.at)}</p><p>${esc(c.text)}</p></div>`).join('') : '<p class="muted">No comments yet.</p>'}
  <form data-form="comment" data-eid="${esc(eid)}" class="cm-f"><label class="sr" for="cm-${esc(eid)}">Add a comment</label><textarea id="cm-${esc(eid)}" name="text" rows="2" class="ta" placeholder="Add a comment for the team" required maxlength="1000"></textarea><button class="btn">Post</button></form></section>`;
}
FORM.comment = (fd, f) => {
  const t = String(fd.get('text') || '').trim(); if (!t) return; const eid = f.dataset.eid;
  (S.threads[eid] = S.threads[eid] || []).push({ id: nid('C'), userId: me().id, at: nowISO(), text: t });
  log('Comment', `On ${eid}: “${t.slice(0, 80)}”`); refresh();
};

/* ---------- derived portfolio signals ---------- */
function reportStatus(p) {
  const today = todayISO(), yest = addDays(today, -1), R = S.reports.filter(r => r.projectId === p.id && r.status !== 'Draft');
  const has = d => R.some(r => r.date === d);
  const due = p.stage === 'Construction';
  const now = new Date(), [h, m] = S.settings.cutoff.split(':').map(Number), past = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
  return { due, today: has(today), yesterday: has(yest), pastCutoff: past };
}
function exceptions(P) {
  const X = [], today = todayISO();
  for (const p of P) {
    const s = sched(p.id);
    for (const t of s.tasks) {
      const r = s.R[t.id]; if (!r.threat) continue;
      const predsDone = t.preds.every(x => S.tasks.find(y => y.id === x)?.actFinish);
      if (!r.started && !predsDone) continue;
      X.push({ sev: 3, kind: 'Schedule', text: `${t.name} is ${r.var} days late on the critical path`, sub: `${p.name} · ${t.recovery ? 'Recovery: ' + t.recovery : t.delayReason ? 'No recovery plan recorded yet' : 'No delay reason recorded'}`, go: 'p-' + p.id.toLowerCase(), set: { ptab: 'schedule' }, modal: ['task', t.id] });
    }
    if (can('budget') && cost(p.id).version) cost(p.id).lines.filter(l => flagLevel(l) === 'bad' && l.code !== '13').sort((a, b) => a.variance - b.variance).slice(0, 2).forEach(l => X.push({ sev: 2, kind: 'Cost', text: `${l.code} ${l.name} forecast ${Math.round(pctOf(l.fac, l.budget))}% of budget`, sub: `${p.name} · ${fmtC(-l.variance)} over · actual ${fmtC(l.actual)}, committed ${fmtC(l.committed)}, estimate ${fmtC(l.etc)}`, go: 'p-' + p.id.toLowerCase(), set: { ptab: 'cost' } }));
    const rs = reportStatus(p);
    if (rs.due && !rs.yesterday) X.push({ sev: 2, kind: 'Site', text: `No site report for yesterday`, sub: p.name, go: 'site', set: { srf: 'all' } });
    if (rs.due && !rs.today && rs.pastCutoff) X.push({ sev: 1, kind: 'Site', text: `Today's site report missing after ${S.settings.cutoff} cutoff`, sub: p.name, go: 'site' });
    S.docs.filter(d => d.projectId === p.id && d.expiry && diffDays(today, d.expiry) <= 30).forEach(d => X.push({ sev: diffDays(today, d.expiry) <= 14 ? 2 : 1, kind: 'Document', text: `${d.title} ${diffDays(today, d.expiry) < 0 ? 'expired' : 'expires in ' + diffDays(today, d.expiry) + ' days'}`, sub: `${p.name} · ${fmtDate(d.expiry)}`, go: 'documents', modal: ['doc', d.id] }));
  }
  S.approvals.filter(a => a.status === 'Pending' && P.some(p => p.id === a.projectId) && a.ctx && a.ctx.overBy > 0).forEach(a => X.push({ sev: 3, kind: 'Approval', text: `${a.ref} needs a budget override from the MD`, sub: `${proj(a.projectId).name} · ${can('budget') ? fmtC(a.ctx.overBy) + ' above available budget' : 'exceeds available budget'}`, go: 'approvals', set: { atab: 'all' } }));
  return X.sort((a, b) => b.sev - a.sev);
}
ACT.drill = el => { const set = el.dataset.set ? JSON.parse(el.dataset.set) : {}; Object.assign(UI, set); const m = el.dataset.modal ? JSON.parse(el.dataset.modal) : null; go(el.dataset.go); if (m) setTimeout(() => showModal(m[0], m[1]), 30); };
const drill = (goTo, set, modal) => `data-act="drill" data-go="${goTo}"${set ? ` data-set='${esc(JSON.stringify(set))}'` : ''}${modal ? ` data-modal='${esc(JSON.stringify(modal))}'` : ''}`;

/* ---------- executive dashboard ---------- */
VIEWS.dashboard = {
  mod: 'dashboard', title: 'Executive dashboard',
  render() {
    const P = myProjects().filter(p => inScope(p.id));
    if (!P.length) return pageHead('Executive dashboard') + empty('No projects in view', 'Your account has no project access yet.');
    const rows = P.map(p => ({ p, s: sched(p.id), c: cost(p.id), rs: reportStatus(p) }));
    const fin = can('budget'), n = P.length, late = rows.filter(r => r.s.slip > 0), apr = rows.filter(r => r.c.version), prov = rows.length - apr.length, over = apr.filter(r => r.c.tot.variance < 0);
    const T = k => sum(apr.map(r => r.c.tot[k]));
    let head = late.length ? `${late.length} of ${n} project${n > 1 ? 's' : ''} forecast to hand over late` : `All ${n} projects on their baseline dates`;
    if (fin) head += over.length === 1 ? `; ${shortName(over[0].p)} is forecast ${fmtC(-over[0].c.tot.variance)} over budget` : over.length ? `; ${over.length} forecast ${fmtC(-sum(over.map(r => r.c.tot.variance)))} over budget` : '; the portfolio forecast is within approved budgets';
    const bw = sum(rows.map(r => r.c.tot.budget)) || 1;
    const earned = fin ? sum(rows.map(r => r.s.earned * r.c.tot.budget)) / bw : sum(rows.map(r => r.s.earned)) / n;
    const planned = fin ? sum(rows.map(r => r.s.planned * r.c.tot.budget)) / bw : sum(rows.map(r => r.s.planned)) / n;
    const pend = S.approvals.filter(a => a.status === 'Pending' && P.some(p => p.id === a.projectId)), mine = pend.filter(canAct);
    const dueR = rows.filter(r => r.rs.due), inR = dueR.filter(r => r.rs.today);
    const npos = S.pos.filter(x => COMMITTED.includes(x.status) && P.some(p => p.id === x.projectId)).length;
    const kp = (label, value, sub, attrs, cls = '') => `<button class="kpi ${cls}" ${attrs}><span class="kl">${label}</span><span class="kv">${value}</span><span class="ks">${sub}</span></button>`;
    const kpis = [
      kp('Active projects', n, [[P.filter(p => p.stage === 'Construction').length, 'in construction'], [P.filter(p => p.stage !== 'Construction').length, 'in other stages']].filter(x => x[0]).map(x => x.join(' ')).join(' · '), drill('projects')),
      fin && kp('Approved budget', fmtC(T('budget')), prov ? `${prov} project${prov > 1 ? 's' : ''} awaiting budget approval, not included` : 'Current approved versions', drill('boq')),
      fin && kp('Committed', fmtC(T('committed')), `${Math.round(pctOf(T('committed'), T('budget')))}% of budget · ${npos} orders`, drill('procurement', { prtab: 'po', pof: 'committed' })),
      fin && kp('Actual cost', fmtC(T('actual')), 'Goods received & work certified', drill('procurement', { prtab: 'po', pof: 'received' })),
      fin && kp('Forecast at completion', fmtC(T('fac')), `${T('variance') >= 0 ? fmtC(T('variance')) + ' under' : fmtC(-T('variance')) + ' over'} approved budget`, drill('boq'), T('variance') < 0 ? 'neg' : ''),
      kp('Progress', earned.toFixed(0) + '%', `Planned ${planned.toFixed(0)}% · ${(earned - planned >= 0 ? '+' : '−') + Math.abs(earned - planned).toFixed(1)} pts`, drill('schedule'), earned < planned - 2 ? 'neg' : ''),
      kp('Pending approvals', pend.length, mine.length ? `${mine.length} awaiting you` : 'None awaiting you', drill('approvals', { atab: mine.length ? 'mine' : 'all' }), mine.length ? 'hot' : ''),
      kp('Site reports today', `${inR.length}/${dueR.length}`, `Cutoff ${S.settings.cutoff}${dueR.filter(r => !r.rs.yesterday).length ? ' · ' + dueR.filter(r => !r.rs.yesterday).length + ' missed yesterday' : ''}`, drill('site'), dueR.some(r => !r.rs.yesterday) ? 'neg' : '')
    ].filter(Boolean).join('');
    const maxV = Math.max(...apr.map(r => Math.max(r.c.tot.budget, r.c.tot.fac + r.c.tot.pending)), 1);
    const projRows = rows.map(({ p, s, c }) => {
      const w = x => (x / maxV * 100).toFixed(2) + '%', t = c.tot;
      return `<article class="prow" ${drill('p-' + p.id.toLowerCase(), { ptab: 'overview' })} tabindex="0">
        <div class="pr-n"><p class="pr-t">${esc(p.name)}</p><p class="muted sm">${esc(p.id)} · ${esc(p.type)} · ${esc(p.location.split(',')[0])}</p></div>
        <div class="pr-s"><p class="sm"><b>${s.earned.toFixed(0)}%</b> complete <span class="muted">· planned ${s.planned.toFixed(0)}%</span></p>${bar(s.earned, s.earned < s.planned - 2 ? 'bad' : 'ok', s.planned)}
          <p class="sm ${s.slip > 0 ? 'tbad' : 'tok'}">Handover ${fmtDate(s.foreFinish)} <span class="nowrap">(${sDays(s.slip)})</span></p></div>
        ${fin && !c.version ? `<div class="pr-c"><p class="sm"><b>Initial budget ${fmtC(t.budget)} awaiting Finance and MD approval.</b> No purchase orders can be raised until it is approved.</p></div>` : fin ? `<div class="pr-c"><div class="bullet" aria-label="Cost position">
          <i class="seg a" style="width:${w(t.actual)}"></i><i class="seg o" style="width:${w(t.open)}"></i><i class="seg p" style="width:${w(t.pending)}"></i><i class="seg e" style="width:${w(t.etc)}"></i><b class="bm" style="left:${w(t.budget)}"></b></div>
          <p class="sm">FAC ${fmtC(t.fac)} vs budget ${fmtC(t.budget)} · <span class="${t.variance < 0 ? 'tbad' : 'tok'}">${varText(t)}</span></p></div>` : ''}
      </article>`;
    }).join('');
    const X = exceptions(P);
    const ms = rows.flatMap(({ p, s }) => s.tasks.filter(t => t.milestone && !s.R[t.id].done).map(t => ({ p, t, r: s.R[t.id] }))).sort((a, b) => (a.r.ff < b.r.ff ? -1 : 1)).slice(0, 6);
    return pageHead(esc(head), `As of ${fmtDate(todayISO())} · ${UI.pf === 'all' ? 'all projects you can access' : esc(proj(UI.pf).name)}${fin ? ' · cost separates actual, committed and estimated' : ''}`, can('dashboard', 'export') ? `<button class="btn" data-act="exportPortfolio">Export</button>` : '') +
      `<section class="kpis">${kpis}</section>
      <section class="card"><div class="ch"><h2 class="h2">Projects</h2>${fin ? `<p class="legend"><span><i class="lg a"></i>Actual</span><span><i class="lg o"></i>Open commitments</span><span><i class="lg p"></i>Awaiting approval</span><span><i class="lg e"></i>Estimate to complete</span><span><i class="lg bmk"></i>Budget</span></p>` : ''}</div>${projRows}</section>
      <div class="cols">
        <section class="card"><div class="ch"><h2 class="h2">Needs attention</h2><span class="muted sm">${X.length} item${X.length === 1 ? '' : 's'}</span></div>
          ${X.length ? `<ul class="xl">${X.slice(0, 9).map(x => `<li><button class="xi s${x.sev}" ${drill(x.go, x.set, x.modal)}><span class="xk">${x.kind}</span><span class="xt">${esc(x.text)}</span><span class="xs">${esc(x.sub)}</span></button></li>`).join('')}</ul>` : empty('Nothing needs attention', 'No critical delays, cost flags or expiring documents.')}</section>
        <section class="card"><div class="ch"><h2 class="h2">Upcoming milestones</h2></div>
          ${ms.length ? `<ul class="ml">${ms.map(({ p, t, r }) => `<li><button class="mi" ${drill('p-' + p.id.toLowerCase(), { ptab: 'schedule' }, ['task', t.id])}><span class="md">${fmtDate(r.ff, false)}</span><span><b>${esc(t.name)}</b><span class="muted sm"> · ${esc(shortName(p))}</span><br><span class="sm ${r.var > 0 ? 'tbad' : 'tok'}">${r.var > 0 ? r.var + ' days after baseline ' + fmtDate(t.baseFinish, false) : 'On baseline'}</span></span></button></li>`).join('')}</ul>` : empty('No open milestones')}</section>
      </div>
      <p class="fine">Cash-flow forecasts, vendor payments and contractor performance come with Phase 2 financial control; the dashboard does not estimate them.</p>`;
  }
};
ACT.exportPortfolio = () => {
  const P = myProjects().filter(p => inScope(p.id)), fin = can('budget'), rows = [['Project ID', 'Project', 'Stage', 'Earned %', 'Planned %', 'Baseline handover', 'Forecast handover', 'Slip days', ...(fin ? ['Budget ₹', 'Committed ₹', 'Actual ₹', 'Pending ₹', 'Estimate to complete ₹', 'Forecast at completion ₹', 'Variance ₹'] : [])]];
  P.forEach(p => { const s = sched(p.id), c = cost(p.id).tot; rows.push([p.id, p.name, p.stage, s.earned.toFixed(1), s.planned.toFixed(1), s.baseFinish, s.foreFinish, s.slip, ...(fin ? [c.budget, c.committed, c.actual, c.pending, c.etc, c.fac, c.variance].map(x => (x / 100).toFixed(2)) : [])]); });
  exportCSV('portfolio-' + todayISO() + '.csv', rows, 'Portfolio summary');
};

/* ---------- projects ---------- */
VIEWS.projects = {
  mod: 'projects', title: 'Projects',
  render() {
    const P = myProjects().filter(p => inScope(p.id)), fin = can('budget');
    const rows = P.map(p => { const s = sched(p.id), cc = cost(p.id), c = cc.tot; return `<tr ${drill('p-' + p.id.toLowerCase(), { ptab: 'overview' })} class="click" tabindex="0">
      <td class="nowrap mono sm">${p.id}</td><td><b>${esc(p.name)}</b><br><span class="muted sm">${esc(p.type)} · ${esc(p.location)}</span></td>
      <td>${badge(p.stage === 'Construction' ? 'In progress' : 'Draft', p.stage)}</td><td>${esc(uname(p.pmId))}</td>
      <td class="w-pb">${bar(s.earned, s.earned < s.planned - 2 ? 'bad' : 'ok', s.planned)}<span class="sm">${s.earned.toFixed(0)}% · plan ${s.planned.toFixed(0)}%</span></td>
      <td class="nowrap">${fmtDate(s.foreFinish)}<br><span class="sm ${s.slip > 0 ? 'tbad' : 'tok'}">${sDays(s.slip)}</span></td>
      ${fin ? (cc.version ? `<td class="num">${fmtC(c.budget)}</td><td class="num ${c.variance < 0 ? 'tbad' : ''}">${fmtC(c.variance)}</td>` : `<td class="num">${fmtC(c.budget)}<br><span class="sm twarn">awaiting approval</span></td><td class="num muted">—</td>`) : ''}</tr>`; }).join('');
    return pageHead('Projects', `${P.length} project${P.length === 1 ? '' : 's'} · every project has a unique ID and its own audit trail`, can('projects', 'create') ? `<button class="btn primary" data-act="newProject">${ic('plus')}New project</button>` : '') +
      `<section class="card flush"><table class="t stack"><thead><tr><th>ID</th><th>Project</th><th>Stage</th><th>Project manager</th><th>Progress</th><th>Forecast handover</th>${fin ? '<th class="num">Budget</th><th class="num">Variance</th>' : ''}</tr></thead><tbody>${rows || `<tr><td colspan="8">${empty('No projects yet')}</td></tr>`}</tbody></table></section>`;
  }
};
ACT.newProject = () => showModal('newProject');
MODALS.newProject = () => {
  const pms = S.users.filter(u => u.role === 'pm'), team = S.users.filter(u => u.projects !== 'all' && ['pm', 'site_sup', 'architect'].includes(u.role));
  openModal('New project', `<form data-form="newProject" class="form">
    <fieldset class="fs"><legend>Property</legend><div class="g2">${field('Project name', '<input name="name" required maxlength="80" autofocus>')}${field('Property type', `<select name="type">${PROP_TYPES.map(t => opt(t, t)).join('')}</select>`)}</div>
    <div class="g3">${field('Location', '<input name="location" required maxlength="120" placeholder="Town, district, state">')}${field('District', '<input name="district" required maxlength="40">')}${field('Client / owner', `<select name="clientId">${S.clients.map(c => opt(c.id, c.name)).join('')}</select>`)}</div></fieldset>
    <fieldset class="fs"><legend>Land (regulatory items stay estimates until a local professional validates them)</legend><div class="g4">${field('Survey no.', '<input name="survey" maxlength="40">')}${field('Area (acres)', '<input name="land" inputmode="decimal" maxlength="12">')}${field('Classification', '<input name="landClass" maxlength="40" placeholder="e.g. Garden land">')}${field('Coastal zone', '<input name="crz" maxlength="30" placeholder="e.g. CRZ-III (estimate)">')}</div></fieldset>
    <fieldset class="fs"><legend>Scope and units</legend><div class="g4">${field('Keys', '<input name="keys" type="number" min="1" max="999" required inputmode="numeric">')}${field('Built-up area (sq ft)', '<input name="sqft" inputmode="numeric">')}${field('Unit type', `<select name="utype">${opt('villa', 'Villas / cottages')}${opt('room', 'Hotel rooms')}${opt('tent', 'Glamping tents')}</select>`)}${field('Unit code prefix', '<input name="prefix" maxlength="4" value="V-" required>')}</div>
    <div class="g2">${field('Amenities (comma separated)', '<input name="amen" maxlength="160" placeholder="Clubhouse, Spa, Pool">')}${field('Scope note', '<input name="units" maxlength="140" placeholder="e.g. 16 pool villas, restaurant, spa">')}</div></fieldset>
    <fieldset class="fs"><legend>Budget and plan</legend><div class="g4">${field('Requested budget (₹)', '<input name="budget" required inputmode="decimal" placeholder="e.g. 18,50,00,000">')}${field('Contingency %', '<input name="cont" type="number" min="0" max="30" step="0.5" value="5">')}${field('Client contract value (₹)', '<input name="cv" inputmode="decimal">')}${field('Planned start', `<input name="start" type="date" required value="${addDays(todayISO(), 14)}">`)}</div>
    ${field('Plan template', `<select name="tpl">${opt('resort', 'Resort / villas — 18 activities')}${opt('glamp', 'Glamping — 11 activities')}</select>`, 'Builds the WBS, milestones and baseline from the start date; the budget goes to Finance and the MD before any purchase.')}</fieldset>
    <fieldset class="fs"><legend>Team</legend><div class="g2">${field('Project manager', `<select name="pmId">${pms.map(u => opt(u.id, u.name)).join('')}</select>`)}<div></div></div><div class="checks">${team.filter(u => u.role !== 'pm').map(u => `<label class="ck"><input type="checkbox" name="team" value="${u.id}"> ${esc(u.name)} — ${esc(roleName(u.role))}</label>`).join('')}</div></fieldset>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Create project</button></div></form>`, { wide: true });
};
FORM.newProject = fd => {
  const budget = parseMoney(fd.get('budget')); if (!budget || budget < 1_00_000_00) { toast('Enter a budget of at least ₹1,00,000', 'bad'); return; }
  const keys = Number(fd.get('keys')); if (!Number.isInteger(keys) || keys < 1 || keys > 400) { toast('Keys must be a whole number from 1 to 400', 'bad'); return; }
  const contPct = Number(fd.get('cont')); if (!(contPct >= 0 && contPct <= 30)) { toast('Contingency must be 0–30%', 'bad'); return; }
  const yr = String(fd.get('start')).slice(0, 4); let n = (S.meta.seq.PRJ || 7) + 1, id;
  do { id = `MA-${yr}-${pad(n, 3)}`; n++; } while (proj(id)); S.meta.seq.PRJ = n - 1;
  const tpl = fd.get('tpl'), start = fd.get('start'), cv = parseMoney(fd.get('cv') || '') || 0;
  const p = { id, name: String(fd.get('name')).trim(), type: fd.get('type'), location: String(fd.get('location')).trim(), district: String(fd.get('district')).trim(), clientId: fd.get('clientId'), keys, units: String(fd.get('units') || '').trim(), land: fd.get('land') ? fd.get('land') + ' acres' : '', start, pmId: fd.get('pmId'), stage: 'Pre-construction', desc: '', profile: tpl, createdAt: nowISO(), builtUpSqft: Number(fd.get('sqft')) || null, contractValueP: cv, contingencyPct: contPct, plan: null,
    landInfo: { survey: String(fd.get('survey') || ''), classification: String(fd.get('landClass') || ''), crz: String(fd.get('crz') || ''), status: 'Estimate' },
    folders: ['01 Contracts', '02 Drawings', '03 BOQ & estimates', '04 Permits & approvals', '05 Purchase orders', '06 Invoices & bills', '07 Site photographs', '08 Meeting minutes', '09 Inspections & quality', '10 Handover & warranties'] };
  const tasks = TEMPLATES[tpl].map(([k, phase, name, dur, preds, ms]) => ({ id: id + '-' + k, key: k, projectId: id, phase, name, dur: ms ? 0 : dur, preds: preds.map(x => id + '-' + x), milestone: !!ms, progress: 0, actStart: null, actFinish: null, delayReason: '', recovery: '', ownerId: p.pmId }));
  baselineFrom(tasks, start); p.end = maxISO(tasks.map(t => t.baseFinish));
  S.projects.push(p); S.tasks.push(...tasks);
  const members = [me().id, p.pmId, ...fd.getAll('team')];
  for (const uid of new Set(members)) { const u = userById(uid); if (u && u.projects !== 'all' && !u.projects.includes(id)) u.projects.push(id); }
  p.team = [...new Set(members)].map(uid => ({ userId: uid, responsibility: uid === p.pmId ? 'Project manager' : uid === me().id ? 'Creator' : roleName(userById(uid).role) }));
  // budget: contingency first, the rest by profile, rounding to the largest line
  const pct = SPLIT[tpl], lines = {}, cont = Math.round(budget * contPct / 100), rest = budget - cont, tot = sum(Object.entries(pct).filter(([c]) => c !== '13').map(([, v]) => v));
  S.costCodes.forEach(({ code }) => { if (code !== '13') lines[code] = Math.round(rest * pct[code] / tot / 100) * 100; }); lines['13'] = cont;
  const big = Object.keys(lines).filter(c => c !== '13').sort((a, b) => lines[b] - lines[a])[0]; lines[big] += budget - sum(Object.values(lines));
  const bv = { id: nid('BV'), projectId: id, v: 1, lines, status: 'Pending', reason: 'Initial project budget', by: me().id, at: nowISO(), approvalId: null, changes: Object.entries(lines).map(([code, delta]) => ({ code, delta })) };
  S.budgets.push(bv); S.etc[id] = { ...lines };
  // units with readiness stages and commissioning; amenities as their own units
  const ut = fd.get('utype'), tplU = ut === 'tent' ? 'tent' : ut === 'room' ? 'room' : 'villa', prefix = String(fd.get('prefix')).trim();
  const stagesOf = t => (STAGE_TEMPLATES[t] || STAGE_TEMPLATES.villa).map(([key, label]) => ({ key, label, status: 'Not started', insp: null, at: null, by: null }));
  if (tplU === 'room' && !STAGE_TEMPLATES.room) STAGE_TEMPLATES.room = STAGE_TEMPLATES.villa.slice(3);
  const per = Math.round(lines['12'] ? (budget - cont) * 0.7 / keys / 100 : 0) * 100, cols = Math.ceil(Math.sqrt(keys * 1.6));
  for (let i = 0; i < keys; i++) S.units.push({ id: nid('UN'), projectId: id, code: prefix + pad(i + 1, 2), name: (ut === 'room' ? 'Room ' : ut === 'tent' ? 'Tent ' : 'Villa ') + (i + 1), type: ut === 'room' ? 'Guest room' : ut === 'tent' ? 'Luxury tent' : 'Villa', template: tplU, budgetP: per, x: 8 + (i % cols) * (84 / Math.max(cols - 1, 1)), y: 30 + Math.floor(i / cols) * (60 / Math.max(Math.ceil(keys / cols), 1)), stages: stagesOf(tplU), commissioning: (tplU === 'tent' ? ['Electrical', 'Plumbing'] : ['Electrical', 'HVAC', 'Plumbing', 'Fire']).map(s => ({ system: s, status: 'Pending', insp: null })), blocked: '', handedOverAt: null });
  String(fd.get('amen') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 8).forEach((a, i) => S.units.push({ id: nid('UN'), projectId: id, code: a.slice(0, 4).toUpperCase(), name: a, type: a, template: 'amenity', budgetP: 0, x: 15 + i * 12, y: 12, stages: stagesOf('amenity'), commissioning: ['Electrical', 'HVAC', 'Fire'].map(s => ({ system: s, status: 'Pending', insp: null })), blocked: '', handedOverAt: null }));
  S.handover[id] = HANDOVER_ITEMS.map(([key, label]) => ({ key, label, status: 'Open', docId: null, by: null, at: null })); S.snaps[id] = [];
  log('Project created', `${id} ${p.name} · ${p.type} · ${keys} keys · start ${fmtDate(start)} · ${tasks.length} activities baselined · ${S.units.filter(u => u.projectId === id).length} units · ${p.folders.length} document folders · team of ${p.team.length}`, id, id);
  const ap = createApproval({ type: 'BUDGET', ref: bv.id, projectId: id, title: `${p.name} — initial budget`, amountP: budget, steps: STEP_TEMPLATES.BUDGET() }); bv.approvalId = ap.id;
  closeModal(); UI.ptab = 'overview'; toast(`${id} created · budget sent for approval`); save(); go('p-' + id.toLowerCase());
};

/* ---------- project detail ---------- */
const PTABS = [['overview', 'Overview', 'projects'], ['schedule', 'Schedule', 'schedule'], ['cost', 'Cost', 'budget'], ['boq', 'BOQ', 'boq'], ['procurement', 'Procurement', 'procurement'], ['reports', 'Site reports', 'site'], ['documents', 'Documents', 'documents'], ['activity', 'Activity', 'projects']];
VIEWS.project = {
  mod: 'projects', title: 'Project',
  allowed: r => can('projects') && hasProject(r.pid),
  render(r) {
    const p = proj(r.pid); if (!p) return empty('Project not found');
    const T = PTABS.filter(t => can(t[2])); if (!T.some(t => t[0] === UI.ptab)) UI.ptab = 'overview';
    const s = sched(p.id), c = cost(p.id), fin = can('budget'), open = S.approvals.filter(a => a.projectId === p.id && a.status === 'Pending').length;
    const st = (l, v, sub, cls = '') => `<div class="stat ${cls}"><span class="kl">${l}</span><span class="sv">${v}</span><span class="ks">${sub}</span></div>`;
    const body = { overview: overviewPanel, schedule: schedulePanel, cost: costPanel, boq: boqPanel, procurement: procPanel, reports: reportsPanel, documents: docsPanel, activity: activityPanel }[UI.ptab](p.id);
    return pageHead(esc(p.name), `${esc(p.type)} · ${esc(p.location)} · ${esc(S.clients.find(x => x.id === p.clientId)?.name || '')}`, '', `<a href="#projects">Projects</a> / <span class="mono">${p.id}</span>`) +
      `<section class="stats">${st('Progress', s.earned.toFixed(0) + '%', `Planned ${s.planned.toFixed(0)}%`, s.earned < s.planned - 2 ? 'neg' : '')}${st('Forecast handover', fmtDate(s.foreFinish), sDays(s.slip) + ' vs baseline', s.slip > 0 ? 'neg' : '')}
      ${fin ? st('Approved budget', c.version ? fmtC(c.tot.budget) : 'Awaiting approval', c.version ? `v${c.version.v} · ${fmtDate(c.version.at.slice(0, 10))}` : 'No purchases until approved', c.version ? '' : 'neg') + st('Forecast at completion', fmtC(c.tot.fac), c.tot.variance < 0 ? fmtC(-c.tot.variance) + ' over' : fmtC(c.tot.variance) + ' under', c.tot.variance < 0 ? 'neg' : '') : ''}
      ${st('Open approvals', open, open ? 'In approval chains' : 'Nothing waiting')}</section>` +
      tabs(T.map(t => [t[0], t[1]]), UI.ptab, 'ptab') + `<div class="panel">${body}</div>`;
  }
};
ACT.ptab = el => { UI.ptab = el.dataset.k; render(); };
function overviewPanel(pid) {
  const p = proj(pid), s = sched(pid), c = cost(pid), fin = can('budget');
  const ms = s.tasks.filter(t => t.milestone);
  const top = fin ? [...c.lines].filter(l => l.budget).sort((a, b) => a.variance - b.variance).slice(0, 5) : [];
  const recent = S.audit.filter(a => a.projectId === pid).slice(0, 6);
  return `<div class="cols">
    <section class="card"><h2 class="h2">About</h2><dl class="dl">
      <dt>Project ID</dt><dd class="mono">${p.id}</dd><dt>Scope</dt><dd>${esc(p.units || '—')}</dd><dt>Keys</dt><dd>${p.keys}</dd><dt>Land</dt><dd>${esc(p.land || '—')}</dd>
      <dt>Project manager</dt><dd>${esc(uname(p.pmId))}</dd>${p.team ? `<dt>Team</dt><dd>${p.team.map(t => esc(uname(t.userId)) + ' <span class="muted sm">(' + esc(t.responsibility) + ')</span>').join(', ')}</dd>` : ''}${p.landInfo ? `<dt>Land</dt><dd>${esc([p.landInfo.survey && 'Survey ' + p.landInfo.survey, p.landInfo.classification, p.landInfo.crz].filter(Boolean).join(' · ') || '—')} <span class="bd warn">Estimate — validate locally</span></dd>` : ''}${p.folders ? `<dt>Folders</dt><dd class="sm">${p.folders.map(esc).join(' · ')}</dd>` : ''}<dt>Baseline</dt><dd>${fmtDate(p.start)} → ${fmtDate(s.baseFinish)}</dd><dt>Stage</dt><dd>${esc(p.stage)}${can('projects', 'edit') ? ` <button class="btn sm ghost" data-act="stage" data-id="${pid}">Change</button>` : ''}</dd></dl>
      ${p.desc ? `<p>${esc(p.desc)}</p>` : ''}</section>
    <section class="card"><h2 class="h2">Milestones</h2><ul class="ml">${ms.map(t => { const r = s.R[t.id]; return `<li><button class="mi" data-act="task" data-id="${t.id}"><span class="md">${fmtDate(r.ff, false)}</span><span><b>${esc(t.name)}</b><br><span class="sm ${r.done ? 'tok' : r.var > 0 ? 'tbad' : 'muted'}">${r.done ? 'Achieved ' + fmtDate(t.actFinish) : r.var > 0 ? r.var + ' days after baseline' : 'Baseline ' + fmtDate(t.baseFinish)}</span></span></button></li>`; }).join('')}</ul></section>
  </div>
  ${fin ? `<section class="card"><div class="ch"><h2 class="h2">Largest cost variances</h2><button class="btn sm ghost" data-act="ptab" data-k="cost">All cost codes</button></div>${top.map(l => `<div class="vr"><span class="sm"><b>${l.code}</b> ${esc(l.name)}</span>${bar(pctOf(l.fac, l.budget * 1.25), flagLevel(l) || 'ok', 80)}<span class="sm num ${l.variance < 0 ? 'tbad' : ''}">${Math.round(pctOf(l.fac, l.budget))}% · ${l.variance < 0 ? fmtC(-l.variance) + ' over' : fmtC(l.variance) + ' under'}</span></div>`).join('')}<p class="fine">Bar scale runs to 125% of each code's budget; the tick marks 100%.</p></section>` : ''}
  <section class="card"><div class="ch"><h2 class="h2">Recent activity</h2><button class="btn sm ghost" data-act="ptab" data-k="activity">Full history</button></div>${auditList(recent)}</section>`;
}
ACT.stage = el => {
  const p = proj(el.dataset.id);
  openModal('Project stage', `<form data-form="stage" data-id="${p.id}" class="form">${field('Stage', `<select name="stage">${['Pre-construction', 'Construction', 'Pre-opening', 'Handed over', 'On hold'].map(s => opt(s, s, p.stage)).join('')}</select>`, 'Daily site reports are required while a project is in Construction.')}<div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Save</button></div></form>`);
};
FORM.stage = (fd, f) => { const p = proj(f.dataset.id), was = p.stage; p.stage = fd.get('stage'); log('Stage changed', `${p.name}: ${was} → ${p.stage}`, p.id, p.id); closeModal(); refresh(false); };
function auditList(A) { return A.length ? `<ul class="al">${A.map(a => `<li><span class="sm muted nowrap">${fmtStamp(a.at)}</span><span><b>${esc(a.action)}</b> — ${esc(a.detail)}<br><span class="sm muted">${esc(uname(a.userId))} · ${esc(roleName(a.role))}</span></span></li>`).join('')}</ul>` : empty('No activity recorded yet'); }
function activityPanel(pid) {
  const A = S.audit.filter(a => a.projectId === pid);
  return `<section class="card">${auditList(A.slice(0, 80))}${A.length > 80 ? `<p class="fine">Showing the latest 80 of ${A.length} entries. The full log is in Audit log.</p>` : ''}</section>`;
}

/* ---------- schedule ---------- */
VIEWS.schedule = {
  mod: 'schedule', title: 'Schedule',
  render() {
    const pid = selProject('schP'); if (!pid) return pageHead('Schedule') + empty('No projects in view');
    const P = myProjects().filter(p => inScope(p.id));
    const crit = P.flatMap(p => { const s = sched(p.id); return s.tasks.filter(t => s.R[t.id].threat && (s.R[t.id].started || t.preds.every(x => S.tasks.find(y => y.id === x)?.actFinish))).map(t => ({ p, t, r: s.R[t.id] })); });
    return pageHead('Schedule & tasks', `${crit.length} critical activit${crit.length === 1 ? 'y is' : 'ies are'} running late across ${UI.pf === 'all' ? 'the portfolio' : esc(proj(UI.pf).name)}`) +
      (crit.length && UI.pf === 'all' ? `<section class="card"><h2 class="h2">Threatening handover</h2><table class="t stack"><thead><tr><th>Project</th><th>Activity</th><th>Progress</th><th>Forecast finish</th><th>Late by</th><th>Delay reason</th></tr></thead><tbody>${crit.map(({ p, t, r }) => `<tr class="click" data-act="task" data-id="${t.id}" tabindex="0"><td>${esc(shortName(p))}</td><td><b>${esc(t.name)}</b></td><td>${t.progress}%</td><td class="nowrap">${fmtDate(r.ff)}</td><td class="tbad nowrap">${r.var} days</td><td class="sm">${esc(t.delayReason || 'Not recorded')}</td></tr>`).join('')}</tbody></table></section>` : '') +
      projectPicker('schP') + schedulePanel(pid);
  }
};
function schedulePanel(pid) {
  const p = proj(pid), s = sched(pid); if (!s.tasks.length) return empty('No activities yet');
  const start = minISO([p.start, ...s.tasks.map(t => s.R[t.id].fs)]), end = addDays(maxISO([s.baseFinish, s.foreFinish]), 12), span = Math.max(diffDays(start, end), 30);
  const x = d => (diffDays(start, d) / span * 100).toFixed(2), today = todayISO();
  const months = []; { let [y, m] = start.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } let dd = `${y}-${pad(m, 2)}-01`; while (dd < end) { months.push(dd); m++; if (m > 12) { m = 1; y++; } dd = `${y}-${pad(m, 2)}-01`; } }
  const phases = [...new Set(s.tasks.map(t => t.phase))], editable = can('schedule', 'edit');
  const look = s.tasks.filter(t => !s.R[t.id].done && !t.milestone && s.R[t.id].fs <= addDays(today, 21)).sort((a, b) => (s.R[a.id].fs < s.R[b.id].fs ? -1 : 1));
  const wbs = {}; phases.forEach((ph, i) => s.tasks.filter(t => t.phase === ph).forEach((t, j) => (wbs[t.id] = `${i + 1}.${j + 1}`)));
  const rows = phases.map((ph, i) => `<div class="g-row gph"><div class="g-l"><b>${i + 1}</b> ${esc(ph)}</div><div class="g-r"></div></div>` + s.tasks.filter(t => t.phase === ph).map(t => {
    const r = s.R[t.id], cls = r.done ? 'done' : r.threat ? 'crit' : r.late ? 'late' : r.started ? 'run' : 'ns';
    const base = t.milestone ? '' : `<i class="g-base" style="left:${x(t.baseStart)}%;width:${Math.max(0.3, x(t.baseFinish) - x(t.baseStart)).toFixed(2)}%"></i>`;
    const fc = t.milestone ? `<i class="g-ms ${cls}" style="left:${x(r.ff)}%" title="${esc(t.name)}"></i>` : `<i class="g-bar ${cls}" style="left:${x(r.fs)}%;width:${Math.max(0.4, x(r.ff) - x(r.fs)).toFixed(2)}%"><i style="width:${t.progress}%"></i></i>`;
    return `<div class="g-row click" data-act="task" data-id="${t.id}" tabindex="0" aria-label="${esc(t.name)}, ${r.status}"><div class="g-l"><span class="wbs">${wbs[t.id]}</span><span class="gn">${esc(t.name)}</span><span class="gp ${r.late ? 'tbad' : ''}">${t.milestone ? (r.done ? '✓' : '◆') : t.progress + '%'}</span></div><div class="g-r">${base}${fc}</div></div>`;
  }).join('')).join('');
  return `<section class="card">
    <div class="ch"><div><h2 class="h2">${esc(p.name)}</h2><p class="sm muted">Baseline ${fmtDate(p.start)} → ${fmtDate(s.baseFinish)} · Forecast handover <b class="${s.slip > 0 ? 'tbad' : 'tok'}">${fmtDate(s.foreFinish)} (${sDays(s.slip)})</b> · Earned ${s.earned.toFixed(1)}% vs planned ${s.planned.toFixed(1)}%</p></div>
      <div class="ph-a">${can('schedule', 'export') ? `<button class="btn sm" data-act="exportSchedule" data-id="${pid}">Export</button>` : ''}${can('schedule', 'create') ? `<button class="btn sm" data-act="addTask" data-id="${pid}">${ic('plus')}Activity</button>` : ''}</div></div>
    <p class="legend"><span><i class="lg base"></i>Baseline</span><span><i class="lg run"></i>Forecast</span><span><i class="lg crit"></i>Late on critical path</span><span><i class="lg late"></i>Late, has float</span><span><i class="lg done"></i>Done</span><span><i class="lg today"></i>Today</span></p>
    <div class="scroll gantt-wrap"><div class="gantt">
      <div class="g-row g-head"><div class="g-l">Activity</div><div class="g-r">${months.map(m => `<span class="g-m" style="left:${x(m)}%">${MON[Number(m.slice(5, 7)) - 1]}${m.slice(5, 7) === '01' ? ' ' + m.slice(2, 4) : ''}</span>`).join('')}</div></div>
      ${rows}
      <div class="g-today" style="--x:${x(today)}"></div>
    </div></div>
    <p class="fine">Forecast uses finish-to-start logic: started work finishes when its remaining share of duration is done; unstarted work waits for its predecessors. Critical = no float to the forecast handover. ${editable ? 'Select an activity to update progress.' : ''}</p></section>
  <section class="card"><h2 class="h2">Look-ahead · next 3 weeks</h2>${look.length ? `<table class="t stack"><thead><tr><th>WBS</th><th>Activity</th><th>Forecast start</th><th>Forecast finish</th><th>Status</th></tr></thead><tbody>${look.map(t => { const r = s.R[t.id]; return `<tr class="click" data-act="task" data-id="${t.id}" tabindex="0"><td class="mono sm">${wbs[t.id]}</td><td>${esc(t.name)}</td><td class="nowrap">${fmtDate(r.fs)}</td><td class="nowrap">${fmtDate(r.ff)}</td><td>${badge(r.status)}${r.critical ? ' <span class="bd bad">Critical</span>' : ''}</td></tr>`; }).join('')}</tbody></table>` : empty('Nothing starts or runs in the next 3 weeks')}</section>`;
}
ACT.task = el => showModal('task', el.dataset.id);
MODALS.task = id => {
  const t = S.tasks.find(x => x.id === id), p = proj(t.projectId), s = sched(p.id), r = s.R[t.id];
  const ed = can('schedule', 'edit') && hasProject(p.id) && !r.done, preds = t.preds.map(x => S.tasks.find(y => y.id === x)).filter(Boolean);
  openModal(esc(t.name), `<div class="kv2">
    <div><span class="kl">Status</span>${badge(r.status)}${r.critical ? ' <span class="bd bad">Critical path</span>' : ''}</div>
    <div><span class="kl">Progress</span><b>${t.progress}%</b></div>
    <div><span class="kl">Baseline</span>${fmtDate(t.baseStart)} → ${fmtDate(t.baseFinish)}</div>
    <div><span class="kl">Forecast</span>${fmtDate(r.fs)} → ${fmtDate(r.ff)}</div>
    <div><span class="kl">Variance</span><b class="${r.var > 0 ? 'tbad' : 'tok'}">${sDays(r.var)}</b></div>
    <div><span class="kl">Total float</span>${r.done ? '—' : r.float + ' days'}</div>
    <div><span class="kl">Duration</span>${t.milestone ? 'Milestone' : t.dur + ' days'}</div>
    <div><span class="kl">Owner</span>${esc(uname(t.ownerId))}</div>
    <div class="span2"><span class="kl">Predecessors</span>${preds.length ? preds.map(x => esc(x.name) + (x.actFinish ? ' ✓' : '')).join(' · ') : 'None'}</div>
  </div>
  ${t.delayReason ? `<p class="note"><b>Delay reason:</b> ${esc(t.delayReason)}</p>` : ''}${t.recovery ? `<p class="note ok"><b>Recovery plan:</b> ${esc(t.recovery)}</p>` : ''}
  ${ed ? `<form data-form="task" data-id="${t.id}" class="form boxed"><h3 class="h3">Update</h3>
    ${t.milestone ? `<div class="g2">${field('Achieved on', `<input type="date" name="actFinish" value="${t.actFinish || ''}" max="${todayISO()}">`)}</div>` : `
    <div class="g3">${field('Progress %', `<input type="number" name="progress" min="0" max="100" step="1" value="${t.progress}" required inputmode="numeric">`)}${field('Actual start', `<input type="date" name="actStart" value="${t.actStart || ''}" max="${todayISO()}">`)}${field('Actual finish', `<input type="date" name="actFinish" value="${t.actFinish || ''}" max="${todayISO()}">`)}</div>`}
    ${field('Delay reason', `<textarea name="delayReason" rows="2" class="ta" maxlength="400">${esc(t.delayReason)}</textarea>`, r.late ? 'Required — this activity is forecast late.' : '')}
    ${field('Recovery plan', `<textarea name="recovery" rows="2" class="ta" maxlength="400">${esc(t.recovery)}</textarea>`, r.threat ? 'Expected for late work on the critical path.' : '')}
    <p class="fine">Site progress normally arrives through verified daily reports. Direct edits are logged with before and after values.</p>
    <div class="fa"><button class="btn primary">Save update</button></div></form>` : ''}
  ${threadHTML(t.id)}`, { sub: `${esc(p.name)} · ${esc(t.phase)}`, wide: true });
};
FORM.task = (fd, f) => {
  const t = S.tasks.find(x => x.id === f.dataset.id), before = { ...t }, today = todayISO();
  if (t.milestone) { const af = fd.get('actFinish') || null; t.actFinish = af; t.actStart = af; t.progress = af ? 100 : 0; }
  else {
    const pr = Number(fd.get('progress')); if (!Number.isInteger(pr) || pr < 0 || pr > 100) { toast('Progress must be a whole number from 0 to 100', 'bad'); return; }
    let as = fd.get('actStart') || null, af = fd.get('actFinish') || null;
    if (pr > 0 && !as) as = today; if (pr === 100 && !af) af = today; if (pr < 100) af = null;
    if (af && as && af < as) { toast('Actual finish cannot be before actual start', 'bad'); return; }
    t.progress = pr; t.actStart = as; t.actFinish = af;
  }
  t.delayReason = String(fd.get('delayReason') || '').trim(); t.recovery = String(fd.get('recovery') || '').trim();
  const r = sched(t.projectId).R[t.id];
  if (r.late && !t.delayReason) { Object.assign(t, before); toast('Add a delay reason — this activity is forecast late', 'bad'); return; }
  const ch = ['progress', 'actStart', 'actFinish', 'delayReason', 'recovery'].filter(k => before[k] !== t[k]).map(k => `${k} ${before[k] || '—'} → ${t[k] || '—'}`);
  if (ch.length) log('Activity updated', `${t.name}: ${ch.join('; ')}`, t.projectId, t.id);
  toast('Activity updated'); refresh();
};
ACT.addTask = el => showModal('addTask', el.dataset.id);
MODALS.addTask = pid => {
  const T = S.tasks.filter(t => t.projectId === pid), phases = [...new Set(T.map(t => t.phase))];
  openModal('New activity', `<form data-form="addTask" data-id="${pid}" class="form">
    ${field('Activity name', '<input name="name" required maxlength="90" autofocus>')}
    <div class="g3">${field('Phase', `<select name="phase">${phases.map(p => opt(p, p)).join('')}</select>`)}${field('Duration (days)', '<input name="dur" type="number" min="0" max="900" value="10" required inputmode="numeric">', '0 makes a milestone')}${field('Owner', `<select name="owner">${S.users.filter(u => hasProject(pid, u) && ['pm', 'pd', 'site_sup', 'architect'].includes(u.role)).map(u => opt(u.id, u.name + ' — ' + roleName(u.role), proj(pid).pmId)).join('')}</select>`)}</div>
    <fieldset class="fs"><legend>Predecessors (finish-to-start)</legend><div class="checks">${T.map(t => `<label class="ck"><input type="checkbox" name="preds" value="${t.id}"> ${esc(t.name)}</label>`).join('')}</div></fieldset>
    <p class="fine">The baseline for a new activity is set from its predecessors' baseline finish and recorded as added after the original baseline.</p>
    <div class="fa"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Add activity</button></div></form>`, { wide: true });
};
FORM.addTask = (fd, f) => {
  const pid = f.dataset.id, p = proj(pid), dur = Number(fd.get('dur')); if (!Number.isInteger(dur) || dur < 0) { toast('Duration must be a whole number of days', 'bad'); return; }
  const preds = fd.getAll('preds'), pf = preds.map(x => S.tasks.find(y => y.id === x).baseFinish);
  const t = { id: pid + '-A' + pad((S.meta.seq.TA = (S.meta.seq.TA || 0) + 1), 3), key: 'A', projectId: pid, phase: fd.get('phase'), name: String(fd.get('name')).trim(), dur, preds, milestone: dur === 0, progress: 0, actStart: null, actFinish: null, delayReason: '', recovery: '', ownerId: fd.get('owner'), addedAfterBaseline: true };
  t.baseStart = pf.length ? maxISO([p.start, ...pf]) : p.start; t.baseFinish = addDays(t.baseStart, dur);
  S.tasks.push(t); log('Activity added', `${t.name} (${dur} days) after ${preds.length ? preds.length + ' predecessor(s)' : 'project start'}`, pid, t.id);
  closeModal(); toast('Activity added'); refresh(false);
};
ACT.exportSchedule = el => {
  const s = sched(el.dataset.id), rows = [['Activity', 'Phase', 'Duration', 'Baseline start', 'Baseline finish', 'Forecast start', 'Forecast finish', 'Variance days', 'Float days', 'Critical', 'Progress %', 'Delay reason']];
  s.tasks.forEach(t => { const r = s.R[t.id]; rows.push([t.name, t.phase, t.dur, t.baseStart, t.baseFinish, r.fs, r.ff, r.var, r.done ? '' : r.float, r.critical ? 'Yes' : 'No', t.progress, t.delayReason]); });
  exportCSV(`schedule-${el.dataset.id}.csv`, rows, 'Schedule');
};
