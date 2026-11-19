'use strict';
/* Views F — executive command center, filters, mobile "Today" for site teams, automation settings, AI assistant,
   global search, keyboard shortcuts, ten-measure cost panel */

/* ---------- filters shared by the command center and reports ---------- */
UI.cf = UI.cf || { district: '', pm: '', type: '', stage: '' };
function cmdProjects() { const f = UI.cf; return myProjects().filter(p => inScope(p.id) && (!f.district || p.district === f.district) && (!f.pm || p.pmId === f.pm) && (!f.type || p.type === f.type) && (!f.stage || p.stage === f.stage)); }
function filterBar() {
  const P = myProjects(), u = k => [...new Set(P.map(p => p[k]).filter(Boolean))], f = UI.cf;
  const sel = (k, label, vals, name = x => x) => `<label class="fsel"><span class="sr">${label}</span><select class="sel" data-chg="cf" data-k="${k}" aria-label="${label}">${opt('', label + ': all', f[k])}${vals.map(v => opt(v, name(v), f[k])).join('')}</select></label>`;
  return `<div class="filters" role="group" aria-label="Filters">${sel('district', 'Location', u('district'))}${sel('pm', 'Project manager', u('pmId'), uname)}${sel('type', 'Type', u('type'))}${sel('stage', 'Status', u('stage'))}
    <label class="fsel"><span class="sr">Period</span><select class="sel" data-chg="period" aria-label="Period">${[30, 60, 90].map(d => opt(d, `Next ${d} days`, UI.period || 90)).join('')}</select></label>${Object.values(f).some(Boolean) ? '<button class="btn sm ghost" data-act="cfClear">Clear filters</button>' : ''}</div>`;
}
CHG.cf = el => { UI.cf[el.dataset.k] = el.value; render(); };
CHG.period = el => { UI.period = el.value; render(); };
ACT.cfClear = () => { UI.cf = { district: '', pm: '', type: '', stage: '' }; render(); };

/* ---------- executive command center ---------- */
function phaseDone(pid) { const T = S.tasks.filter(t => t.projectId === pid && t.dur > 0); return [...new Set(T.map(t => t.phase))].map(ph => { const X = T.filter(t => t.phase === ph); return { ph, pct: sum(X.map(t => t.dur * t.progress)) / (sum(X.map(t => t.dur)) || 1) }; }); }
function dailySummary(P) {
  const ids = P.map(p => p.id), L = [], fin = can('budget');
  const late = P.flatMap(p => { const s = sched(p.id); return s.tasks.filter(t => s.R[t.id].threat && (s.R[t.id].started || t.preds.every(x => S.tasks.find(y => y.id === x)?.actFinish))).map(t => `${t.name} at ${shortName(p)} is ${s.R[t.id].var} days late on the critical path`); });
  if (late.length) L.push(['Schedule', late.slice(0, 3).join('; ')]);
  const over = P.filter(p => cost(p.id).version && cost(p.id).tot.variance < 0); if (fin && over.length) L.push(['Cost', over.map(p => `${shortName(p)} forecast ${fmtC(-cost(p.id).tot.variance)} over budget`).join('; ') + ' (forecast, not actual)']);
  const old = S.approvals.filter(a => a.status === 'Pending' && ids.includes(a.projectId) && (Date.now() - Date.parse(a.at)) / 36e5 > 24); if (old.length) L.push(['Approvals', `${old.length} waiting more than 24 h: ${old.slice(0, 4).map(a => a.ref).join(', ')}`]);
  if (fin && can('payments')) { const cr = cashReq(ids, 30).buckets[0]; L.push(['Cash', `next 30 days: ${fmtC(cr.due)} due on approved invoices and bills, ${fmtC(cr.forecast)} forecast from open orders and contracts`]); }
  const U = S.units.filter(u => ids.includes(u.projectId)).map(u => ({ u, r: readiness(u) })), bl = U.filter(x => x.r.status === 'Blocked');
  L.push(['Units', `${U.filter(x => x.r.status === 'Ready').length} ready for handover, ${U.filter(x => x.r.status === 'Awaiting inspection').length} awaiting inspection${bl.length ? `, blocked: ${bl.map(x => x.u.code).join(', ')}` : ''}`]);
  const sd = S.snags.filter(s => ids.includes(s.projectId) && s.status !== 'Closed' && s.severity === 'Safety-critical'); if (sd.length) L.push(['Safety', sd.map(s => `${s.id} ${s.title}`).join('; ')]);
  const miss = P.filter(p => { const r = reportStatus(p); return r.due && !r.yesterday; }); if (miss.length) L.push(['Site reports', `no report yesterday from ${miss.map(shortName).join(', ')}`]);
  return L;
}
VIEWS.dashboard = {
  mod: 'dashboard', title: 'Command center',
  render() {
    const P = cmdProjects(); if (!P.length) return pageHead('Command center') + filterBar() + empty('No projects match these filters');
    const ids = P.map(p => p.id), fin = can('budget'), rows = P.map(p => ({ p, s: sched(p.id), c: cost(p.id), e: earned(p.id) })), apr = rows.filter(r => r.c.version), T = k => sum(apr.map(r => r.c.tot[k]));
    const late = rows.filter(r => r.s.slip > 0), over = apr.filter(r => r.c.tot.variance < 0), n = P.length;
    let head = late.length ? `${late.length} of ${n} project${n > 1 ? 's' : ''} forecast to hand over late` : `All ${n} projects on their baseline dates`;
    if (fin) head += over.length === 1 ? `; ${shortName(over[0].p)} is forecast ${fmtC(-over[0].c.tot.variance)} over budget` : over.length ? `; ${over.length} forecast ${fmtC(-sum(over.map(r => r.c.tot.variance)))} over budget` : '; forecasts are within approved budgets';
    const bw = sum(apr.map(r => r.c.tot.budget)) || 1, phys = fin ? sum(apr.map(r => r.s.earned * r.c.tot.budget)) / bw : sum(rows.map(r => r.s.earned)) / n;
    const pend = S.approvals.filter(a => a.status === 'Pending' && ids.includes(a.projectId)), mine = pend.filter(canAct);
    const ms = rows.flatMap(({ p, s }) => s.tasks.filter(t => t.milestone && !s.R[t.id].done && s.R[t.id].ff <= addDays(todayISO(), 30)).map(t => t.id));
    const o = can('payments') ? outstanding(ids) : null, cr = can('payments') ? cashReq(ids, Number(UI.period || 90)) : null;
    const kp = (label, value, sub, attrs, cls = '') => `<button class="kpi ${cls}" ${attrs}><span class="kl">${label}</span><span class="kv">${value}</span><span class="ks">${sub}</span></button>`;
    const kpis = [
      kp('Active projects', n, `${P.filter(p => p.stage === 'Construction').length} in construction`, drill('projects')),
      fin && kp('Approved investment', fmtC(T('budget')), apr.length < n ? `${n - apr.length} awaiting budget approval, not included` : `${fmtC(T('changes'))} approved changes since original`, drill('reports', { rtab: 'cost' })),
      fin && kp('Actual spending', fmtC(T('actual')), `${fmtC(T('accrued'))} accrued, unpaid`, drill('reports', { rtab: 'cost' })),
      fin && kp('Committed', fmtC(T('committed')), `${Math.round(pctOf(T('committed'), T('budget')))}% of budget`, drill('procurement', { prtab: 'po', pof: 'committed' })),
      fin && kp('Forecast at completion', fmtC(T('fac')), `${T('variance') >= 0 ? fmtC(T('variance')) + ' under' : fmtC(-T('variance')) + ' over'} budget`, drill('reports', { rtab: 'cost' }), T('variance') < 0 ? 'neg' : ''),
      fin && kp('Remaining budget', fmtC(T('uncommitted')), 'Approved budget not yet committed', drill('boq')),
      kp('Portfolio completion', phys.toFixed(0) + '%', fin ? `Spend ${Math.round(pctOf(T('actual'), T('fac')))}% of forecast — a separate measure` : 'By activity duration', drill('reports', { rtab: 'cost' })),
      kp('Delayed projects', `${late.length}/${n}`, late.length ? late.map(r => `${shortName(r.p)} +${r.s.slip}d`).join(' · ') : 'None', drill('schedule'), late.length ? 'neg' : ''),
      kp('Upcoming milestones', ms.length, 'Next 30 days', drill('schedule')),
      o && kp('Outstanding payments', fmtC(o.total), o.overdue ? `${fmtC(o.overdue)} overdue` : `${o.rows.length} approved, unpaid`, drill('payments', { paytab: 'payables' }), o.overdue ? 'neg' : ''),
      kp('Pending approvals', pend.length, mine.length ? `${mine.length} awaiting you` : 'None awaiting you', drill('approvals', { atab: mine.length ? 'mine' : 'all' }), mine.length ? 'hot' : ''),
      cr && kp('Cash needed · 30 days', fmtC(cr.buckets[0].due + cr.buckets[0].forecast), `${fmtC(cr.buckets[0].due)} due · ${fmtC(cr.buckets[0].forecast)} forecast`, drill('reports', { rtab: 'cash' }))
    ].filter(Boolean).join('');
    const maxV = Math.max(...apr.map(r => Math.max(r.c.tot.budget, r.c.tot.fac + r.c.tot.pending)), 1);
    const prow = ({ p, s, c }) => { const w = x => (x / maxV * 100).toFixed(2) + '%', t = c.tot, ph = phaseDone(p.id);
      return `<article class="prow" ${drill('p-' + p.id.toLowerCase(), { ptab: 'overview' })} tabindex="0"><div class="pr-n"><p class="pr-t">${esc(p.name)}</p><p class="muted sm">${esc(p.id)} · ${esc(p.type)} · ${esc(p.district || '')} · PM ${esc(uname(p.pmId))}</p>
        <div class="phases" aria-label="Phase completion">${ph.map(x => `<span title="${esc(x.ph)} ${x.pct.toFixed(0)}%"><i style="height:${Math.max(4, x.pct).toFixed(0)}%"></i></span>`).join('')}</div></div>
        <div class="pr-s"><p class="sm"><b>${s.earned.toFixed(0)}%</b> complete <span class="muted">· planned ${s.planned.toFixed(0)}%</span></p>${bar(s.earned, s.earned < s.planned - 2 ? 'bad' : 'ok', s.planned)}<p class="sm ${s.slip > 0 ? 'tbad' : 'tok'}">Handover ${fmtDate(s.foreFinish)} <span class="nowrap">(${sDays(s.slip)})</span></p></div>
        ${fin && !c.version ? `<div class="pr-c"><p class="sm"><b>Initial budget ${fmtC(t.budget)} awaiting approval.</b> Purchases are blocked until then.</p></div>` : fin ? `<div class="pr-c"><div class="bullet"><i class="seg a" style="width:${w(t.actual)}"></i><i class="seg o" style="width:${w(t.committed - t.actual)}"></i><i class="seg p" style="width:${w(t.pending)}"></i><i class="seg e" style="width:${w(t.etc)}"></i><b class="bm" style="left:${w(t.budget)}"></b></div><p class="sm">Forecast ${fmtC(t.fac)} vs budget ${fmtC(t.budget)} · <span class="${t.variance < 0 ? 'tbad' : 'tok'}">${varText(t)}</span></p></div>` : ''}</article>`; };
    const X = exceptions(P), cs = contractorStats(ids).slice(0, 5), bn = bottlenecks(ids).slice(0, 5), sm = dailySummary(P);
    const msl = rows.flatMap(({ p, s }) => s.tasks.filter(t => t.milestone && !s.R[t.id].done).map(t => ({ p, t, r: s.R[t.id] }))).sort((a, b) => (a.r.ff < b.r.ff ? -1 : 1)).slice(0, 6);
    return pageHead(esc(head), `As of ${fmtDate(todayISO())} · every figure is calculated from transactions; select any card for its report`, `<button class="btn" data-act="ask">${ic('spark')}Ask</button>${can('dashboard', 'export') ? '<button class="btn" data-act="exportPortfolio">Export</button>' : ''}`) + filterBar() +
      `<section class="kpis">${kpis}</section>
      <section class="card summary"><div class="ch"><h2 class="h2">Daily management summary</h2><span class="sm muted">Generated from the data, no AI · ${fmtDate(todayISO())}</span></div><ul class="sml">${sm.map(([k, t]) => `<li><b>${k}</b> ${esc(t)}</li>`).join('')}</ul></section>
      <section class="card"><div class="ch"><h2 class="h2">Projects</h2>${fin ? `<p class="legend"><span><i class="lg a"></i>Actual</span><span><i class="lg o"></i>Committed, not yet incurred</span><span><i class="lg p"></i>Awaiting approval</span><span><i class="lg e"></i>Estimate to complete</span><span><i class="lg bmk"></i>Budget</span></p>` : ''}</div>${rows.map(prow).join('')}<p class="fine">Small bars under each name show phase completion, left to right.</p></section>
      ${fin ? `<div class="cols"><section class="card"><div class="ch"><h2 class="h2">Budget and forecast trend</h2><span class="sm muted">12 weeks · demo history</span></div><div class="fig" id="trendFig" role="img" aria-label="Budget, forecast, committed and actual over 12 weeks"><svg></svg></div><p class="legend"><span><i class="lg tl-b"></i>Approved budget</span><span><i class="lg tl-f"></i>Forecast</span><span><i class="lg tl-c"></i>Committed</span><span><i class="lg tl-a"></i>Actual</span></p></section>
        ${cr ? `<section class="card"><div class="ch"><h2 class="h2">Cash requirement</h2><button class="btn sm ghost" ${drill('reports', { rtab: 'cash' })}>Detail</button></div>${(() => { const mx = Math.max(1, ...cr.buckets.map(b => b.due + b.forecast)); return cr.buckets.map(b => `<div class="cashrow"><span class="sm"><b>${b.label}</b></span><span class="cbar"><i class="due" style="width:${(b.due / mx * 100).toFixed(1)}%"></i><i class="fc" style="width:${(b.forecast / mx * 100).toFixed(1)}%"></i></span><span class="sm num">${fmtC(b.due)} · ${fmtC(b.forecast)}</span></div>`).join(''); })()}<p class="legend"><span><i class="lg a"></i>Due (approved, unpaid)</span><span><i class="lg e"></i>Forecast</span></p></section>` : ''}</div>` : ''}
      <div class="cols"><section class="card"><div class="ch"><h2 class="h2">Needs attention</h2><span class="muted sm">${X.length} item${X.length === 1 ? '' : 's'}</span></div>${X.length ? `<ul class="xl">${X.slice(0, 8).map(x => `<li><button class="xi s${x.sev}" ${drill(x.go, x.set, x.modal)}><span class="xk">${x.kind}</span><span class="xt">${esc(x.text)}</span><span class="xs">${esc(x.sub)}</span></button></li>`).join('')}</ul>` : empty('Nothing needs attention')}</section>
        <section class="card"><div class="ch"><h2 class="h2">Upcoming milestones</h2></div>${msl.length ? `<ul class="ml">${msl.map(({ p, t, r }) => `<li><button class="mi" ${drill('p-' + p.id.toLowerCase(), { ptab: 'schedule' }, ['task', t.id])}><span class="md">${fmtDate(r.ff, false)}</span><span><b>${esc(t.name)}</b><span class="muted sm"> · ${esc(shortName(p))}</span><br><span class="sm ${r.var > 0 ? 'tbad' : 'tok'}">${r.var > 0 ? r.var + ' days after baseline' : 'On baseline'}</span></span></button></li>`).join('')}</ul>` : empty('No open milestones')}</section></div>
      <div class="cols"><section class="card"><div class="ch"><h2 class="h2">Contractor performance</h2><button class="btn sm ghost" ${drill('reports', { rtab: 'contractors' })}>All</button></div>${cs.length ? `<table class="t"><thead><tr><th>Contractor</th><th class="num">Late</th><th class="num">Defects</th><th class="num">Certification</th></tr></thead><tbody>${cs.map(r => `<tr><td class="sm">${esc(r.v.name)}</td><td class="num ${r.late ? 'tbad' : ''}">${r.late}/${r.tasks}</td><td class="num">${r.snags}</td><td class="num">${r.certDays == null ? '—' : r.certDays.toFixed(1) + ' d'}</td></tr>`).join('')}</tbody></table>` : empty('No contractors')}</section>
        <section class="card"><div class="ch"><h2 class="h2">Procurement bottlenecks</h2><button class="btn sm ghost" ${drill('reports', { rtab: 'procurement' })}>All</button></div>${bn.length ? `<ul class="al">${bn.map(b => `<li><span class="sm nowrap">${b.days} d</span><span><button class="lnk" data-act="${b.act}" data-id="${b.id}">${b.id}</button> ${esc(b.what)} · ${esc(b.kind)}</span></li>`).join('')}</ul>` : empty('No bottlenecks')}</section></div>`;
  },
  after() { drawTrend(); }
};
function drawTrend() {
  const fig = $('#trendFig'); if (!fig) return; const ids = cmdProjects().filter(p => cost(p.id).version).map(p => p.id);
  const dates = [...new Set(ids.flatMap(id => (S.snaps[id] || []).map(s => s.date)))].sort().slice(-12);
  const pick = (id, d) => { const L = (S.snaps[id] || []).filter(s => s.date <= d); return L[L.length - 1]; };
  const ser = ['budget', 'fac', 'committed', 'actual'].map(k => dates.map(d => sum(ids.map(id => (pick(id, d) || {})[k] || 0))));
  const draw = () => { const svg = fig.querySelector('svg'), W = fig.clientWidth, H = fig.clientHeight; if (!W || dates.length < 2) return;
    const mx = Math.max(...ser.flat(), 1), pl = 56, pr = 12, pt = 12, pb = 26, x = i => pl + i * (W - pl - pr) / (dates.length - 1), y = v => pt + (1 - v / mx) * (H - pt - pb);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => mx * f), cls = ['tl-b', 'tl-f', 'tl-c', 'tl-a'];
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${fmtC(t).replace('₹', '')}</text>`).join('')
      + (W > 420 ? dates.filter((_, i) => i % 3 === 0 || i === dates.length - 1).map(d => `<text x="${x(dates.indexOf(d))}" y="${H - 6}" text-anchor="middle" class="ax">${fmtDate(d, false)}</text>`).join('') : '')
      + ser.map((s, k) => `<polyline points="${s.map((v, i) => x(i) + ',' + y(v)).join(' ')}" class="tl ${cls[k]}"/>`).join(''); };
  draw(); new ResizeObserver(draw).observe(fig);
}

/* ---------- ten-measure cost panel (replaces the v1 panel) ---------- */
function costPanel(pid) {
  if (!can('budget')) return empty('Cost figures are restricted', 'Your role does not include budget visibility.');
  const c = cost(pid), k = contingency(pid), pendingRev = S.budgets.find(b => b.projectId === pid && b.status === 'Pending'), edit = can('budget', 'edit');
  const cols = [['original', 'Original budget'], ['changes', 'Approved changes'], ['budget', c.provisional ? 'Requested budget' : 'Current budget'], ['committed', 'Committed'], ['actual', 'Actual'], ['paid', 'Paid'], ['retention', 'Retention held'], ['accrued', 'Accrued unpaid'], ['pending', 'Awaiting approval'], ['etc', 'Uncommitted forecast'], ['fac', 'Forecast total'], ['variance', 'Variance']];
  return `<section class="card flush"><div class="pad"><div class="ch"><p class="sm muted">${c.version ? `Budget v${c.version.v} in force (${esc(c.version.reason)})` : 'No approved budget yet — purchases and work orders are blocked until Finance and the MD approve one.'}${pendingRev ? ` · <b>v${pendingRev.v} awaiting approval</b>` : ''} · contingency available ${fmtINR(k.available)} after ${fmtINR(k.overruns)} of overruns</p>
    <div class="ph-a">${can('budget', 'export') ? `<button class="btn sm" data-act="exportCost" data-id="${pid}">Export</button>` : ''}${can('budget', 'create') && c.version ? `<button class="btn sm primary" data-act="budgetRev" data-id="${pid}">Request budget revision</button>` : ''}</div></div></div>
    <div class="scroll"><table class="t wide cost"><thead><tr><th>Cost code</th>${cols.map(x => `<th class="num">${x[1]}</th>`).join('')}<th>Forecast vs budget</th></tr></thead><tbody>
    ${c.lines.map(l => { const fl = flagLevel(l); return `<tr class="${fl ? 'r-' + fl : ''}"><td><b class="mono">${l.code}</b> ${esc(l.name)}</td>${cols.map(([key]) => key === 'etc' ? `<td class="num est">${edit ? `<button class="lnk" data-act="etc" data-pid="${pid}" data-code="${l.code}">${fmtINR(l.etc)}</button>` : fmtINR(l.etc)}</td>` : key === 'committed' ? `<td class="num"><a href="#procurement" data-act="drill" data-go="procurement" data-set='${esc(JSON.stringify({ prtab: 'po', pof: 'committed', pcode: l.code, pf: pid }))}'>${fmtINR(l.committed)}</a></td>` : `<td class="num ${key === 'variance' && l.variance < 0 ? 'tbad' : ''}">${key === 'pending' && !l.pending ? '—' : fmtINR(l[key])}</td>`).join('')}<td class="w-pb">${l.budget ? bar(pctOf(l.fac, l.budget * 1.25), fl || 'ok', 80) : ''}<span class="sm">${l.budget ? Math.round(pctOf(l.fac, l.budget)) + '%' : '—'}</span></td></tr>`; }).join('')}
    </tbody><tfoot><tr><td>Total</td>${cols.map(([key]) => `<td class="num">${fmtINR(c.tot[key])}</td>`).join('')}<td><span class="sm">${c.tot.budget ? Math.round(pctOf(c.tot.fac, c.tot.budget)) + '%' : ''}</span></td></tr></tfoot></table></div>
    <div class="pad"><p class="fine">Actual = paid + retention held + accrued unpaid on every row. Committed already contains actual, so forecast total = committed + uncommitted forecast (the QS estimate, in italics). Amber: commitments reached ${S.settings.warnPct}% of budget. Red: forecast above ${S.settings.flagPct}%.</p></div></section>`;
}

/* ---------- mobile-first "Today" for site supervisors ---------- */
VIEWS.today = {
  mod: 'site', title: 'Today',
  render() {
    const P = myProjects().filter(p => p.stage !== 'Handed over'), pid = UI.todayP && hasProject(UI.todayP) ? UI.todayP : P[0]?.id; if (!pid) return pageHead('Today') + empty('No assigned projects');
    UI.todayP = pid; const p = proj(pid), s = sched(pid), rs = reportStatus(p), today = todayISO(), mine = me().id;
    const draft = S.reports.find(r => r.projectId === pid && r.date === today && r.by === mine && r.status === 'Draft'), sub = S.reports.find(r => r.projectId === pid && r.date === today && r.status !== 'Draft');
    const tasks = s.tasks.filter(t => !t.milestone && !s.R[t.id].done && s.R[t.id].fs <= addDays(today, 7));
    const myItems = [...S.reports.filter(r => r.by === mine && r.projectId === pid).slice(-3).map(r => [r.id, 'Daily report ' + fmtDate(r.date, false), r.status]), ...S.mrs.filter(m => m.requestedBy === mine && m.projectId === pid).slice(-3).map(m => [m.id, m.item, m.status]),
      ...S.measurements.filter(m => m.by === mine).slice(-3).map(m => [m.id, 'Measurement ' + fmtQty(m.qtyM), m.status]), ...S.snags.filter(x => x.by === mine && x.projectId === pid).slice(-3).map(x => [x.id, x.title, x.status])];
    const pendMe = S.approvals.filter(a => a.status === 'Pending' && a.projectId === pid && canAct(a));
    const tile = (act, label, sub2, extra = '') => `<button class="tile" data-act="${act}" ${extra}><span class="tl-t">${label}</span><span class="tl-s">${sub2}</span></button>`;
    return `<header class="ph"><div class="ph-t"><p class="crumb">${fmtDate(today)} · ${esc(me().name)}</p><h1>Today at ${esc(shortName(p))}</h1></div></header>
      ${P.length > 1 ? `<div class="chips scroll">${P.map(x => `<button class="chip${x.id === pid ? ' on' : ''}" data-act="todayP" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      <section class="card today-rep ${sub ? 'ok' : rs.pastCutoff ? 'bad' : 'warn'}"><p class="pr-t">${sub ? `Report ${sub.id} ${sub.status === 'Submitted' ? 'sent for verification' : sub.status.toLowerCase()}` : draft ? 'Draft started — finish and submit' : `Daily report due by ${S.settings.cutoff}`}</p>
        ${sub ? '' : `<button class="btn primary big" data-act="${draft ? 'editReport' : 'newReport'}" data-id="${draft ? draft.id : ''}" data-pid="${pid}">${draft ? 'Continue today’s report' : 'Start today’s report'}</button>`}</section>
      <section class="tiles">${tile('quickAtt', 'Attendance', 'Headcount by trade', `data-pid="${pid}"`)}${tile('quickCrew', 'Contractor activity', 'Crews and work by contractor', `data-pid="${pid}"`)}${tile('quickQty', 'Record quantities', 'Measurement for contractor billing', `data-pid="${pid}"`)}${tile('quickShort', 'Material shortage', 'Raises an urgent request', `data-pid="${pid}"`)}${tile('snagNew', 'Quality issue', 'Defect with photo')}${tile('quickInsp', 'Request inspection', 'Unit stage or test', `data-pid="${pid}"`)}</section>
      <section class="card"><h2 class="h2">Today’s work</h2>${tasks.length ? `<ul class="al">${tasks.map(t => { const r = s.R[t.id]; return `<li><span class="sm nowrap">${t.progress}%</span><span><b>${esc(t.name)}</b>${t.revisedBy ? ` <span class="bd warn">Drawing revised</span>` : ''}<br><span class="sm ${r.late ? 'tbad' : 'muted'}">${r.status} · finish ${fmtDate(r.ff, false)}${r.critical ? ' · critical' : ''}</span></span></li>`; }).join('')}</ul>` : empty('No activities this week')}</section>
      ${pendMe.length ? `<section class="card"><h2 class="h2">Waiting for you</h2><ul class="al">${pendMe.map(a => `<li><span class="sm">${AP_TYPE[a.type]}</span><span><a href="#approvals">${esc(a.title)}</a></span></li>`).join('')}</ul></section>` : ''}
      <section class="card"><h2 class="h2">My recent submissions</h2>${myItems.length ? `<ul class="al">${myItems.map(([id, t, st]) => `<li><span class="sm mono">${id}</span><span>${esc(t)} ${badge(st)}</span></li>`).join('')}</ul>` : empty('Nothing submitted yet')}</section>`;
  }
};
ACT.todayP = el => { UI.todayP = el.dataset.id; render(); };
function todayDraft(pid) { const t = todayISO(); let r = S.reports.find(x => x.projectId === pid && x.date === t && x.by === me().id && x.status === 'Draft'); if (!r) { r = { id: nid('DR'), projectId: pid, date: t, by: me().id, at: nowISO(), status: 'Draft', weather: 'Clear', labour: [], work: [], materials: [], issues: '', safety: '', photos: [], contractors: [] }; S.reports.push(r); } r.contractors = r.contractors || []; return r; }
ACT.quickAtt = el => { const r = S.reports.find(x => x.projectId === el.dataset.pid && x.date === todayISO() && x.by === me().id && x.status === 'Draft'), cur = t => r?.labour.find(l => l.trade === t)?.count || 0;
  openModal('Attendance', `<form data-form="quickAtt" data-pid="${el.dataset.pid}" class="form">${TRADES.map(t => `<div class="stepper"><span>${t}</span><button type="button" class="ib" data-act="step" data-d="-1" aria-label="Fewer ${t}">−</button><input name="${t}" type="number" min="0" max="999" value="${cur(t)}" inputmode="numeric" aria-label="${t} headcount"><button type="button" class="ib" data-act="step" data-d="1" aria-label="More ${t}">+</button></div>`).join('')}
  <p class="fine">Saved into today’s draft report on this device.</p><div class="fa"><button class="btn primary">Save attendance</button></div></form>`, { sub: 'Tap + and − to count' }); };
ACT.step = el => { const i = el.parentElement.querySelector('input'); i.value = Math.max(0, Number(i.value || 0) + Number(el.dataset.d)); };
FORM.quickAtt = (fd, f) => { const r = todayDraft(f.dataset.pid); r.labour = TRADES.map(t => ({ trade: t, count: Number(fd.get(t) || 0) })).filter(l => l.count > 0); log('Attendance recorded', `${sum(r.labour.map(l => l.count))} workers on ${r.id} (draft)`, r.projectId, r.id); closeModal(); toast('Attendance saved to today’s draft'); refresh(false); };
ACT.quickCrew = el => { const C = S.contracts.filter(c => c.projectId === el.dataset.pid && c.status === 'Active');
  openModal('Contractor activity', `<form data-form="quickCrew" data-pid="${el.dataset.pid}" class="form">${field('Contractor', `<select name="c">${C.map(c => opt(c.id, vendor(c.vendorId).name + ' · ' + c.title)).join('')}</select>`)}<div class="g2">${field('Crew on site', '<input name="crew" type="number" min="0" max="500" value="0" inputmode="numeric">')}${field('Work done', '<input name="what" maxlength="120" placeholder="e.g. Slab C5 reinforcement">')}</div><div class="fa"><button class="btn primary">Add to today’s report</button></div></form>`); };
FORM.quickCrew = (fd, f) => { const r = todayDraft(f.dataset.pid), c = S.contracts.find(x => x.id === fd.get('c')); r.contractors.push({ contractId: c.id, vendorId: c.vendorId, crew: Number(fd.get('crew') || 0), activity: String(fd.get('what') || '') }); log('Contractor activity', `${vendor(c.vendorId).name}: ${fd.get('crew')} crew · ${fd.get('what')}`, r.projectId, r.id); closeModal(); toast('Added to today’s draft'); refresh(false); };
ACT.quickQty = el => { const C = S.contracts.filter(c => c.projectId === el.dataset.pid && c.status === 'Active'); if (!C.length) { toast('No active work orders on this project', 'bad'); return; } UI.modal = null; showModal('mNew', C[0].id); };
ACT.quickShort = el => { UI.mrDraft = { projectId: el.dataset.pid, urgent: true }; showModal('newMR'); };
ACT.quickInsp = el => { const U = S.units.filter(u => u.projectId === el.dataset.pid); if (!U.length) { toast('No units on this project', 'bad'); return; }
  openModal('Request inspection', `<form data-form="quickInsp" class="form">${field('Unit', `<select name="u">${U.map(u => opt(u.id, `${u.code} ${u.name} · ${readiness(u).phase}`)).join('')}</select>`)}<p class="fine">The request goes to the next open stage of that unit. Open the unit for commissioning tests.</p><div class="fa"><button class="btn primary">Request</button></div></form>`); };
FORM.quickInsp = fd => { const u = S.units.find(x => x.id === fd.get('u')), s = u.stages.find(x => x.status === 'Not started' || x.status === 'In progress'); if (!s) { toast('No open stage to inspect on this unit', 'bad'); return; } closeModal(); ACT.inspReq({ dataset: { u: u.id, kind: 'Stage', k: s.key } }); };

/* ---------- automation settings ---------- */
function automationPanel() {
  const ed = can('settings', 'edit'), E = S.events.slice(0, 40);
  return `<section class="card"><div class="ch"><div><h2 class="h2">Automation rules</h2><p class="sm muted">Events are queued, de-duplicated by key, delivered per channel and escalated once. ${S.meta.dupes || 0} duplicate events suppressed so far.</p></div>${ed ? '<button class="btn sm" data-act="runChecks">Run checks now</button>' : ''}</div>
    <table class="t stack"><thead><tr><th>Rule</th><th>Notifies</th><th>Channels</th><th>Escalates</th><th>Risk</th><th>On</th></tr></thead><tbody>${S.rules.map((r, i) => `<tr><td><b>${esc(r.name)}</b><br><span class="sm muted mono">${r.event}</span></td><td class="sm">${r.roles.map(roleName).join(', ') || '—'}</td><td class="sm">${r.channels.map(c => c === 'in_app' ? 'In-app' : c === 'email' ? 'Email' : 'WhatsApp').join(', ')}</td><td class="sm">${r.escalateTo ? `${roleName(r.escalateTo)} after ${r.escalateHours} h` : '—'}</td><td>${r.risk ? 'Yes' : '—'}</td><td><input type="checkbox" aria-label="Enable ${esc(r.name)}" data-chg="ruleOn" data-i="${i}" ${r.enabled ? 'checked' : ''} ${ed ? '' : 'disabled'}></td></tr>`).join('')}</tbody></table></section>
  <section class="card"><h2 class="h2">Channels</h2><ul class="al"><li><span class="sm">In-app</span><span>${badge('Done', 'Delivering')}</span></li><li><span class="sm">Email</span><span>${badge('Draft', 'Not connected')} Connect an authorised email provider in production; until then these sends are recorded as “not configured”, never as sent.</span></li><li><span class="sm">WhatsApp</span><span>${badge('Draft', 'Not connected')} Needs a WhatsApp Business API provider and approved message templates.</span></li></ul></section>
  <section class="card flush"><div class="ch pad"><h2 class="h2">Event log</h2></div><table class="t stack"><thead><tr><th>When</th><th>Event</th><th>Project</th><th>Status</th><th>Deliveries</th></tr></thead><tbody>${E.map(e => `<tr><td class="sm nowrap">${fmtStamp(e.at)}</td><td><b>${esc(e.type)}</b><br><span class="sm muted mono">${esc(e.key)}</span></td><td class="sm">${e.pid ? esc(shortName(proj(e.pid) || { name: e.pid })) : '—'}</td><td>${badge(e.status === 'processed' ? 'Done' : 'Pending', e.status)}${e.attempts > 1 ? ` <span class="sm">${e.attempts} attempts</span>` : ''}</td><td class="sm">${e.results.map(r => `${r.ch}: ${r.status}${r.n != null ? ' (' + r.n + ')' : ''}`).join(' · ') || '—'}</td></tr>`).join('') || `<tr><td colspan="5">${empty('No events yet')}</td></tr>`}</tbody></table></section>`;
}
CHG.ruleOn = el => { const r = S.rules[Number(el.dataset.i)]; r.enabled = el.checked; log('Automation rule changed', `${r.name} ${r.enabled ? 'enabled' : 'disabled'}`); refresh(false); };
ACT.runChecks = () => { const d0 = S.meta.dupes || 0, n = scanExceptions(), m = processEvents(); toast(`${n} new event(s), ${(S.meta.dupes || 0) - d0} duplicate(s) suppressed, ${m} processed`); refresh(false); };
VIEWS.settings.render = function () {
  const body = UI.stab === 'roles' ? rolesPanel() : UI.stab === 'rules' ? rulesPanel() : UI.stab === 'automation' ? automationPanel() : usersPanel();
  return pageHead('Users, roles & settings', 'Access is configured here as data — screens read permissions, nothing is hard-coded per role') + tabs([['users', 'Users & access'], ['roles', 'Roles & permissions'], ['rules', 'Approval rules & controls'], ['automation', 'Automation & notifications']], UI.stab, 'stab') + `<div class="panel">${body}</div>`;
};

/* ---------- AI assistant: read-only tools over permission-filtered data ---------- */
let SAMPLE = null;
(async () => { try { if (window.claude && typeof window.claude.use === 'function') SAMPLE = await window.claude.use('sample'); } catch (e) { SAMPLE = null; } })();
const ASK_PRESETS = ['Which project is most likely to exceed its budget?', 'Which villas are delaying the project opening?', 'What is the estimated additional investment required?', 'Which contractors have missed the most deadlines?', 'Which procurement orders are blocking construction?', 'Which project activities should management prioritise today?', 'What cash is needed over the next 30, 60 and 90 days?'];
let AI_TOOLS = () => {
  const P = myProjects(), ids = P.map(p => p.id), fin = can('budget'), m = v => (fin ? Math.round(v / 100) : 'restricted');
  return [
    { name: 'portfolio_overview', description: 'Projects with stage, schedule progress, forecast handover and cost position (rupees). actual = recorded cost; committed = approved orders and contracts; forecast = committed + estimate.', execute: () => P.map(p => { const s = sched(p.id), c = cost(p.id).tot; return { id: p.id, name: p.name, stage: p.stage, progress_pct: +s.earned.toFixed(1), planned_pct: +s.planned.toFixed(1), forecast_handover: s.foreFinish, slip_days: s.slip, budget_approved: !!cost(p.id).version, budget: m(c.budget), actual: m(c.actual), committed: m(c.committed), forecast_total: m(c.fac), variance: m(c.variance) }; }) },
    { name: 'late_activities', description: 'Activities forecast late, with days late, whether on the critical path, and delay reason.', execute: () => P.flatMap(p => { const s = sched(p.id); return s.tasks.filter(t => s.R[t.id].late).map(t => ({ project: p.id, task: t.name, days_late: s.R[t.id].var, critical: s.R[t.id].critical, progress: t.progress, delay_reason: t.delayReason || null })); }) },
    { name: 'unit_readiness', description: 'Units by readiness status with blockers (open defects, pending commissioning, FF&E).', execute: () => S.units.filter(u => ids.includes(u.projectId)).map(u => { const r = readiness(u); return { project: u.projectId, unit: u.code, status: r.status, stages: `${r.passed}/${r.total}`, open_defects: r.snags, safety_defects: r.safety, ffe: `${r.ffeReady}/${r.ffeTotal}`, commissioning: `${r.cmPassed}/${r.cmTotal}`, est_completion: unitEta(u) }; }) },
    { name: 'contractor_performance', description: 'Per contractor: late activities, on-time rate, open defects, average certification days.', execute: () => contractorStats(ids).map(r => ({ contractor: r.v.name, work_orders: r.contracts, late: r.late, activities: r.tasks, on_time_pct: r.onTime, open_defects: r.snags, avg_cert_days: r.certDays })) },
    { name: 'procurement_blockers', description: 'Requests ageing, orders waiting approval, late deliveries, materials needed within 7 days with no order.', execute: () => bottlenecks(ids) },
    { name: 'cash_requirement', description: 'Cash due (approved, unpaid) and forecast outflows in 30/60/90-day buckets, rupees.', execute: () => can('payments') ? cashReq(ids, 90).buckets.map(b => ({ bucket: b.label, due: m(b.due), forecast: m(b.forecast), top_items: b.lines.sort((x, y) => y.amt - x.amt).slice(0, 4).map(l => ({ ref: l.ref, what: l.what, kind: l.k, amount: m(l.amt) })) })) : 'restricted' },
    { name: 'pending_approvals', description: 'Open approvals with waiting role and age in hours.', execute: () => S.approvals.filter(a => a.status === 'Pending' && ids.includes(a.projectId)).map(a => ({ id: a.id, ref: a.ref, type: AP_TYPE[a.type], project: a.projectId, waiting_for: roleName(curStep(a)?.role), age_hours: Math.round((Date.now() - Date.parse(a.at)) / 36e5), amount: a.amountP != null ? m(a.amountP) : null })) },
    { name: 'cost_by_code', description: 'Cost lines for one project by cost code. Input {project_id}.', inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] }, execute: x => { if (!hasProject(x.project_id) || !fin) throw new Error('restricted'); return cost(x.project_id).lines.map(l => ({ code: l.code, name: l.name, budget: m(l.budget), committed: m(l.committed), actual: m(l.actual), estimate_to_complete: m(l.etc), forecast: m(l.fac), variance: m(l.variance) })); } }
  ];
};
ACT.ask = () => showModal('ask');
MODALS.ask = () => {
  const a = UI.askState || {};
  openModal('Ask about the portfolio', `${SAMPLE ? '' : '<p class="note">The AI assistant runs when this page is open on claude.ai and you allow it to ask Claude. Here you get data answers for the preset questions, computed without AI.</p>'}
    <div class="chips wrap">${ASK_PRESETS.map((q, i) => `<button class="chip" data-act="askPreset" data-i="${i}">${esc(q)}</button>`).join('')}</div>
    <form data-form="ask" class="form"><label class="sr" for="askq">Your question</label><textarea id="askq" name="q" class="ta" rows="2" maxlength="400" placeholder="Ask about cost, schedule, units, contractors, procurement or cash">${esc(a.q || '')}</textarea><div class="fa"><button class="btn primary" ${SAMPLE ? '' : 'disabled title="Needs the Claude runtime"'}>Ask</button></div></form>
    <div id="askOut" class="ask-out" aria-live="polite">${a.html || ''}</div>
    <p class="fine">Answers use only data your role can see, cite record IDs, and keep recorded figures apart from forecasts. The assistant cannot approve, pay, certify or change anything.</p>`, { wide: true });
};
ACT.askPreset = el => { const i = Number(el.dataset.i), q = ASK_PRESETS[i]; if (SAMPLE) { UI.askState = { q }; MODALS.ask(); runAsk(q); return; } UI.askState = { q, html: `<p class="ask-q">${esc(q)}</p>${presetAnswer(i)}<p class="fine">Data answer — computed directly from the records, no AI.</p>` }; MODALS.ask(); };
FORM.ask = fd => { const q = String(fd.get('q') || '').trim(); if (q.length < 5) return; UI.askState = { q }; runAsk(q); };
async function runAsk(q) {
  const out = $('#askOut'); if (!out || !SAMPLE) return; const tools = AI_TOOLS(), used = [];
  out.innerHTML = `<p class="ask-q">${esc(q)}</p><p class="muted">Thinking…</p>`;
  const sys = `You are the project-intelligence assistant for M Andamul, a developer of resort and hospitality properties in India. Today is ${todayISO()}. The user is ${me().name}, ${roleName(me().role)}. Answer ONLY from tool results; call the tools you need. Cite record IDs or project IDs in brackets. Label every figure as Actual (recorded), Committed, or Forecast/Estimate — never present a forecast as actual. Amounts are rupees; write lakh/crore (₹1 Cr = ₹1,00,00,000). If data is missing or restricted, say so. You cannot approve, pay, certify or change records; if asked, say who must act. Lead with the answer in one sentence, then at most 5 short bullets. Under 180 words.`;
  try {
    const res = await SAMPLE([{ role: 'user', content: sys + '\n\nQuestion: ' + q }], { modelTier: 'default', cache: false,
      tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} }, execute: x => { used.push(t.name); return t.execute(x || {}); } })),
      onText: ({ text }) => { const o = $('#askOut'); if (o) o.innerHTML = `<p class="ask-q">${esc(q)}</p><div class="ask-a">${mdLite(text)}</div>`; } });
    UI.askState = { q, html: `<p class="ask-q">${esc(q)}</p><div class="ask-a">${mdLite(res.text)}</div><p class="fine">Data looked up: ${[...new Set(used)].join(', ') || 'none'}</p>` };
    const o = $('#askOut'); if (o) o.innerHTML = UI.askState.html; log('AI question', q);
  } catch (e) { const o = $('#askOut'); if (o) o.innerHTML = `<p class="ask-q">${esc(q)}</p><p class="note bad">${e && e.code === 'not_granted' ? 'Access to Claude was not granted for this page.' : e && e.code === 'rate_limited' ? 'Too many questions just now — try again in a minute.' : 'The assistant could not answer: ' + esc(e && e.message || 'error')}</p>`; if (e && e.code === 'not_granted') SAMPLE = null; }
}
const mdLite = t => esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•] (.+)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`).replace(/\n{2,}/g, '<br><br>');
function presetAnswer(i) {
  const P = myProjects(), ids = P.map(p => p.id), fin = can('budget'), li = a => `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>`;
  if (i === 0) { if (!fin) return '<p>Cost figures are restricted for your role.</p>'; const r = P.map(p => ({ p, c: cost(p.id) })).filter(x => x.c.version).sort((a, b) => a.c.tot.variance - b.c.tot.variance); const w = r[0]; return `<p><b>${esc(w.p.name)} [${w.p.id}]</b> has the weakest forecast: ${w.c.tot.variance < 0 ? fmtC(-w.c.tot.variance) + ' over' : fmtC(w.c.tot.variance) + ' under'} budget (forecast).</p>${li(w.c.lines.filter(l => l.variance < 0 && l.code !== '13').sort((a, b) => a.variance - b.variance).slice(0, 4).map(l => `${l.code} ${esc(l.name)}: forecast ${fmtC(l.fac)} vs budget ${fmtC(l.budget)}`))}`; }
  if (i === 1) { const U = S.units.filter(u => ids.includes(u.projectId)).map(u => ({ u, r: readiness(u), eta: unitEta(u) })).filter(x => !['Ready', 'Handed over'].includes(x.r.status)).sort((a, b) => (b.r.safety - a.r.safety) || ((b.eta || '') > (a.eta || '') ? 1 : -1)).slice(0, 6); return `<p>Units furthest from opening, blocked units first:</p>${li(U.map(x => `<b>${esc(x.u.code)}</b> ${esc(shortName(proj(x.u.projectId)))} — ${x.r.status}, ${x.r.passed}/${x.r.total} stages, ${x.r.snags} open defects${x.eta ? ', est. ' + fmtDate(x.eta) : ''}`))}`; }
  if (i === 2) { if (!fin) return '<p>Cost figures are restricted for your role.</p>'; const r = P.map(p => ({ p, c: cost(p.id), k: contingency(p.id) })).filter(x => x.c.version); const need = r.filter(x => x.c.tot.variance < 0); return `<p>Forecast additional investment beyond approved budgets: <b>${fmtC(-sum(need.map(x => x.c.tot.variance)))}</b> (forecast).</p>${li(r.map(x => `${esc(x.p.name)}: variance ${fmtC(x.c.tot.variance)}; contingency available ${fmtC(x.k.available)}`))}`; }
  if (i === 3) return li(contractorStats(ids).slice(0, 5).map(r => `<b>${esc(r.v.name)}</b>: ${r.late} of ${r.tasks} activities late or finished late; ${r.snags} open defects`));
  if (i === 4) { const b = bottlenecks(ids); return b.length ? li(b.slice(0, 6).map(x => `<b>${x.id}</b> ${esc(x.what)} — ${esc(x.kind)} (${x.days} days)`)) : '<p>No procurement bottlenecks.</p>'; }
  if (i === 5) return li(exceptions(P).slice(0, 6).map(x => `<b>${esc(x.kind)}</b>: ${esc(x.text)} — ${esc(x.sub)}`));
  if (i === 6) { if (!can('payments')) return '<p>Payment figures are restricted for your role.</p>'; return li(cashReq(ids, 90).buckets.map(b => `<b>${b.label}</b>: ${fmtC(b.due)} due on approved invoices and bills (actual obligations) + ${fmtC(b.forecast)} forecast`)); }
  return '';
}

/* ---------- global search and keyboard shortcuts ---------- */
function searchAll(q) {
  q = norm(q); if (q.length < 2) return []; const R = [], P = myProjects().map(p => p.id), hit = s => norm(s).includes(q);
  myProjects().filter(p => hit(p.id + ' ' + p.name + ' ' + p.location)).forEach(p => R.push(['Project', p.id, p.name, `#p-${p.id.toLowerCase()}`]));
  S.units.filter(u => P.includes(u.projectId) && hit(u.code + ' ' + u.name)).slice(0, 6).forEach(u => R.push(['Unit', u.code, `${u.name} · ${shortName(proj(u.projectId))}`, 'unit|' + u.id]));
  if (can('procurement')) { S.pos.filter(x => P.includes(x.projectId) && hit(x.id + ' ' + x.item)).slice(0, 5).forEach(x => R.push(['Purchase order', x.id, x.item, 'po|' + x.id])); S.mrs.filter(x => P.includes(x.projectId) && hit(x.id + ' ' + x.item)).slice(0, 5).forEach(x => R.push(['Request', x.id, x.item, 'mr|' + x.id])); }
  if (can('contracts')) S.contracts.filter(c => P.includes(c.projectId) && hit(c.id + ' ' + c.title + ' ' + vendor(c.vendorId).name)).slice(0, 5).forEach(c => R.push(['Work order', c.id, c.title, 'contract|' + c.id]));
  if (can('payments')) S.invoices.filter(i => P.includes(i.projectId) && hit(i.id + ' ' + i.no)).slice(0, 4).forEach(i => R.push(['Invoice', i.id, i.no, 'inv|' + i.id]));
  if (can('documents')) S.docs.filter(d => P.includes(d.projectId) && hit(d.id + ' ' + d.title + ' ' + d.tags.join(' '))).slice(0, 5).forEach(d => R.push(['Document', d.id, d.title, 'doc|' + d.id]));
  if (can('quality')) S.snags.filter(s => P.includes(s.projectId) && hit(s.id + ' ' + s.title)).slice(0, 4).forEach(s => R.push(['Defect', s.id, s.title, 'unit|' + s.unitId]));
  if (can('schedule')) S.tasks.filter(t => P.includes(t.projectId) && hit(t.name)).slice(0, 4).forEach(t => R.push(['Activity', shortName(proj(t.projectId)), t.name, 'task|' + t.id]));
  return R.slice(0, 18);
}
document.addEventListener('input', e => {
  if (e.target.id !== 'gsearch') return; const box = $('#gresults'), R = searchAll(e.target.value);
  box.innerHTML = R.length ? R.map(([k, id, t, go]) => `<li><button data-act="gopen" data-go="${esc(go)}"><span class="sm muted">${esc(k)}</span> <b>${esc(id)}</b> ${esc(t)}</button></li>`).join('') : (e.target.value.length > 1 ? '<li class="muted sm">No matches you can see</li>' : '');
  box.hidden = !e.target.value;
});
ACT.gopen = el => { const g = el.dataset.go; $('#gresults').hidden = true; $('#gsearch').value = ''; if (g.startsWith('#')) { location.hash = g.slice(1); return; } const [m, id] = g.split('|'); showModal(m, id); };
let gPending = 0;
document.addEventListener('keydown', e => {
  const t = e.target, typing = t.matches('input, textarea, select') || t.isContentEditable; if (typing || e.metaKey || e.ctrlKey || e.altKey || !me() || $('#modal').innerHTML) return;
  if (e.key === '/') { const s = $('#gsearch'); if (s) { e.preventDefault(); s.focus(); } return; }
  if (e.key === '?') { e.preventDefault(); openModal('Keyboard shortcuts', `<dl class="calc">${[['/', 'Search everything'], ['g then d', 'Command center'], ['g then t', 'Today'], ['g then p', 'Projects'], ['g then u', 'Units & master plan'], ['g then a', 'Approvals'], ['g then c', 'Contracts'], ['g then f', 'Invoices & payments'], ['g then r', 'Reports'], ['g then q', 'Quality'], ['n', 'New item on this screen'], ['Esc', 'Close a dialog']].map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')}</dl>`); return; }
  if (e.key === 'g') { gPending = Date.now(); return; }
  if (Date.now() - gPending < 1200) { const m = { d: 'dashboard', t: 'today', p: 'projects', u: 'units', a: 'approvals', c: 'contracts', f: 'payments', r: 'reports', q: 'quality', s: 'schedule' }[e.key]; gPending = 0; if (m && VIEWS[m] && (VIEWS[m].allowed ? VIEWS[m].allowed({}) : can(VIEWS[m].mod))) go(m); return; }
  if (e.key === 'n') { const r = location.hash.slice(1), a = { procurement: 'newMR', site: 'newReport', quality: 'snagNew', contracts: 'newContract', documents: 'upload', projects: 'newProject', payments: 'invNew' }[r]; const b = a && document.querySelector(`[data-act="${a}"]`); if (b) b.click(); }
});
/* run automation after every change, so events turn into notifications at once */
const _refresh0 = refresh; refresh = function (k) { processEvents(); return _refresh0(k); };
document.addEventListener('click', e => { const g = $('#gresults'); if (g && !g.hidden && !e.target.closest('.gs')) g.hidden = true; });
