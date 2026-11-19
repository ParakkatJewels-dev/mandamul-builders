'use strict';
/* DEMO ENVIRONMENT SEED — fictional projects, people and vendors for the prototype only.
   Dates are generated relative to the day the demo is opened, so the story stays current. */

const COST_CODES = [
  ['01', 'Preliminaries & site setup'], ['02', 'Earthwork & foundations'], ['03', 'Superstructure (RCC & steel)'],
  ['04', 'Masonry & plaster'], ['05', 'Roofing & waterproofing'], ['06', 'Electrical & ELV'], ['07', 'Plumbing, HVAC & fire'],
  ['08', 'Flooring, painting & finishes'], ['09', 'Doors, windows & glazing'], ['10', 'Landscape & external works'],
  ['11', 'Pools & water bodies'], ['12', 'FF&E and OS&E'], ['13', 'Contingency']
];
const SPLIT = { // % of project budget by cost code (standard profiles, editable later via budget revision)
  resort: { '01': 3.5, '02': 9, '03': 19, '04': 7, '05': 6, '06': 8, '07': 8.5, '08': 10, '09': 5, '10': 5, '11': 3, '12': 11, '13': 5 },
  glamp: { '01': 6, '02': 4, '03': 8, '04': 2, '05': 3, '06': 9, '07': 11, '08': 4, '09': 2, '10': 12, '11': 0, '12': 32, '13': 7 }
};
const TEMPLATES = {
  resort: [
    ['T01', 'Pre-construction', 'Site survey & soil investigation', 20, []],
    ['T02', 'Pre-construction', 'Building permit & statutory approvals', 45, ['T01']],
    ['M01', 'Pre-construction', 'Permit received', 0, ['T02'], 1],
    ['T03', 'Pre-construction', 'Site mobilisation & temporary works', 15, ['M01']],
    ['T04', 'Substructure', 'Earthwork & excavation', 30, ['T03']],
    ['T05', 'Substructure', 'Foundations — guest units & clubhouse', 45, ['T04']],
    ['T06', 'Superstructure', 'RCC frame — clubhouse & spa', 75, ['T05']],
    ['T07', 'Superstructure', 'RCC frame — guest units', 90, ['T05']],
    ['T08', 'Superstructure', 'Roofing & waterproofing', 45, ['T06', 'T07']],
    ['M02', 'Superstructure', 'Structure complete', 0, ['T08'], 1],
    ['T09', 'MEP & finishes', 'MEP rough-in', 60, ['T07']],
    ['T10', 'MEP & finishes', 'Masonry & plaster', 60, ['T07']],
    ['T11', 'MEP & finishes', 'Flooring, tiling & painting', 60, ['T09', 'T10']],
    ['T12', 'MEP & finishes', 'Doors, windows & glazing', 40, ['T10']],
    ['T13', 'External works', 'Landscape & external works', 60, ['M02']],
    ['T14', 'External works', 'Pools & water features', 50, ['T05']],
    ['T15', 'Handover', 'Testing & commissioning', 25, ['T11', 'T12']],
    ['M03', 'Handover', 'Ready for handover', 0, ['T13', 'T14', 'T15'], 1]
  ],
  glamp: [
    ['G01', 'Pre-construction', 'Topographic survey & tent layout', 12, []],
    ['G02', 'Pre-construction', 'Panchayat permit & forest NOC', 35, ['G01']],
    ['M01', 'Pre-construction', 'Permits received', 0, ['G02'], 1],
    ['G03', 'Site works', 'Access paths & site clearing', 20, ['M01']],
    ['G04', 'Site works', 'Timber deck platforms (10 nos)', 35, ['G03']],
    ['G05', 'Site works', 'Utilities — power, water, STP', 30, ['G03']],
    ['G06', 'Installation', 'Tent structures & fit-out', 30, ['G04']],
    ['G07', 'Installation', 'Bathroom pods & plumbing', 25, ['G04', 'G05']],
    ['G08', 'Installation', 'Landscape & lighting', 25, ['G06']],
    ['G09', 'Handover', 'Testing & soft-opening checks', 10, ['G07', 'G08']],
    ['M02', 'Handover', 'Ready for handover', 0, ['G09'], 1]
  ]
};
const BOQ_LIB = { // [description, unit, rate ₹ excl. GST (null = lump sum), weight]
  '01': [['Site office, stores & labour camp', 'LS', null, 3], ['Temporary power & water supply', 'LS', null, 2], ['Site security & safety', 'month', 185000, 3], ['Survey & setting out', 'LS', null, 1]],
  '02': [['Excavation in all soils incl. rock breaking', 'cum', 650, 3], ['PCC M10 below foundations', 'cum', 5200, 1.5], ['RCC M25 footings & plinth beams', 'cum', 8900, 4], ['Anti-termite treatment', 'sqm', 55, 0.5]],
  '03': [['RCC M30 columns, beams & slabs', 'cum', 9400, 5], ['Fe 550D TMT reinforcement', 'MT', 72000, 4], ['Shuttering & staging', 'sqm', 780, 2], ['Structural steel for canopies', 'MT', 118000, 1]],
  '04': [['Solid concrete block masonry 200 mm', 'cum', 6400, 3], ['Internal plaster 12 mm', 'sqm', 420, 2], ['External plaster 20 mm with waterproofing', 'sqm', 560, 2]],
  '05': [['Clay tile roofing on MS truss', 'sqm', 2450, 4], ['APP membrane waterproofing', 'sqm', 690, 2], ['Roof insulation 50 mm', 'sqm', 480, 1]],
  '06': [['Electrical wiring & points', 'point', 1850, 3], ['LT panels & distribution boards', 'nos', 385000, 2], ['Lighting fixtures, indoor & outdoor', 'nos', 6200, 2], ['ELV, Wi-Fi & networking', 'LS', null, 1.5]],
  '07': [['CPVC / UPVC plumbing points', 'point', 3200, 2], ['VRF air-conditioning', 'TR', 68000, 4], ['Fire hydrant & sprinkler system', 'LS', null, 1.5], ['Sewage treatment plant', 'nos', 2850000, 1]],
  '08': [['Natural stone & vitrified flooring', 'sqm', 2650, 4], ['Bathroom wall tiling', 'sqm', 1450, 2], ['Interior & exterior painting', 'sqm', 260, 2], ['Gypsum false ceiling', 'sqm', 980, 1.5]],
  '09': [['Teak wood doors with frames', 'nos', 48000, 3], ['Aluminium sliding windows & doors', 'sqm', 9800, 3], ['Toughened glass railings & partitions', 'sqm', 7200, 1.5]],
  '10': [['Internal roads & stone pathways', 'sqm', 1650, 3], ['Softscape & plantation', 'sqm', 420, 2], ['Compound wall & entrance gate', 'rmt', 9500, 2], ['Storm-water drainage', 'rmt', 2400, 1]],
  '11': [['Pool shell & finishes', 'sqm', 38000, 3], ['Pool filtration & equipment', 'set', 1850000, 1.5], ['Water feature & deck', 'LS', null, 1]],
  '12': [['Guest room FF&E package', 'key', 1450000, 4], ['Public area FF&E', 'LS', null, 2], ['Operating supplies & equipment (OS&E)', 'key', 320000, 1]]
};
const PO_LIB = { // code: [[kind, vendor, item, unit, rate ₹, share]]
  '01': [['Work order', 'V09', 'Site establishment & preliminaries', '%', null, 1]],
  '02': [['Work order', 'V09', 'Earthwork & foundation works', '%', null, 0.65], ['Material', 'V02', 'Ready-mix concrete M25', 'cum', 6900, 0.35]],
  '03': [['Work order', 'V09', 'RCC frame works — labour & shuttering', '%', null, 0.45], ['Material', 'V01', 'Fe 550D TMT steel', 'MT', 72000, 0.35], ['Material', 'V02', 'Ready-mix concrete M30', 'cum', 7400, 0.2]],
  '04': [['Work order', 'V09', 'Masonry & plastering works', '%', null, 0.6], ['Material', 'V02', 'Solid concrete blocks 200 mm', 'nos', 58, 0.4]],
  '05': [['Work order', 'V03', 'Roofing & waterproofing package', '%', null, 1]],
  '06': [['Work order', 'V04', 'Electrical & ELV installation', '%', null, 0.55], ['Material', 'V04', 'Cables, conduits & switchgear', 'LS', null, 0.45]],
  '07': [['Work order', 'V08', 'Plumbing, HVAC & fire-fighting works', '%', null, 1]],
  '08': [['Material', 'V11', 'Natural stone & vitrified tiles', 'sqm', 1900, 0.6], ['Work order', 'V09', 'Flooring & painting works', '%', null, 0.4]],
  '09': [['Material', 'V06', 'Teak doors, frames & joinery', 'nos', 52000, 1]],
  '10': [['Work order', 'V07', 'Landscape & external works', '%', null, 1]],
  '11': [['Work order', 'V05', 'Pool construction & finishes', '%', null, 1]],
  '12': [['Material', 'V10', 'Guest room FF&E package', 'key', 1450000, 1]]
};

function seedState() {
  const T0 = todayISO(), d = n => addDays(T0, n);
  const st = {
    meta: { schema: SCHEMA, demo: true, seededOn: T0, seq: {} }, session: null, drafts: {}, threads: {},
    settings: { thresholds: { pm: 500000_00, pd: 2500000_00 }, warnPct: 90, flagPct: 100, cutoff: '19:00', maxMB: 25 },
    costCodes: COST_CODES.map(([code, name]) => ({ code, name })),
    roles: [], users: [], clients: [], projects: [], tasks: [], budgets: [], etc: {}, boq: [], vendors: [], mrs: [], pos: [], reports: [], docs: [], approvals: [], audit: [], notifs: [], contracts: [], measurements: [], invoices: [], payments: [], units: [], snags: [], ffe: [], inspections: [], impacts: [], events: [], risks: [], rules: [], snaps: {}, handover: {}, channels: {}
  };
  S = st; // helpers such as nid() read the global

  /* roles & permission matrix (data, editable in Settings) */
  const P = spec => { const o = {}; MODULES.forEach(([m]) => { o[m] = {}; ACTIONS.forEach(a => (o[m][a] = !!(spec[m] && spec[m].includes(a)))); }); return o; };
  const ALL = ACTIONS;
  const roles = [
    ['super_admin', 'Super Admin', 1, Object.fromEntries(MODULES.map(([m]) => [m, m === 'approvals' ? ['view'] : ALL.filter(a => a !== 'approve')]))],
    ['md', 'Managing Director', 1, { dashboard: ['view', 'export'], projects: ['view', 'export'], schedule: ['view', 'export'], site: ['view'], boq: ['view', 'export'], budget: ['view', 'approve', 'export'], procurement: ['view', 'approve', 'export'], approvals: ['view', 'approve'], documents: ['view', 'approve', 'export'], audit: ['view', 'export'] }],
    ['pd', 'Project Director', 1, { dashboard: ['view', 'export'], projects: ['view', 'create', 'edit', 'export'], schedule: ['view', 'create', 'edit', 'approve', 'export'], site: ['view', 'approve'], boq: ['view', 'export'], budget: ['view', 'create', 'export'], procurement: ['view', 'approve', 'export'], approvals: ['view', 'approve'], documents: ['view', 'create', 'edit', 'approve', 'export'], audit: ['view'] }],
    ['pm', 'Project Manager', 1, { dashboard: ['view'], projects: ['view', 'edit'], schedule: ['view', 'create', 'edit', 'export'], site: ['view', 'create', 'approve', 'export'], boq: ['view', 'export'], budget: ['view', 'create'], procurement: ['view', 'create', 'edit', 'approve'], approvals: ['view', 'approve'], documents: ['view', 'create', 'edit'] }],
    ['architect', 'Architect', 1, { projects: ['view'], schedule: ['view'], documents: ['view', 'create', 'edit', 'export'], approvals: ['view'] }],
    ['interior', 'Interior Designer', 0, { projects: ['view'], documents: ['view', 'create', 'edit'] }],
    ['civil', 'Civil Engineer', 0, { projects: ['view'], schedule: ['view', 'edit'], site: ['view', 'create'], documents: ['view'] }],
    ['site_sup', 'Site Supervisor', 1, { projects: ['view'], schedule: ['view'], site: ['view', 'create', 'edit'], procurement: ['view', 'create', 'edit'], documents: ['view'] }],
    ['qs', 'Quantity Surveyor', 1, { dashboard: ['view'], projects: ['view'], schedule: ['view'], site: ['view'], boq: ['view', 'create', 'edit', 'export'], budget: ['view', 'create', 'edit', 'export'], procurement: ['view'], approvals: ['view'], documents: ['view', 'create'] }],
    ['proc', 'Procurement Manager', 1, { dashboard: ['view'], projects: ['view'], boq: ['view'], budget: ['view'], procurement: ['view', 'create', 'edit', 'export'], approvals: ['view'], documents: ['view', 'create'] }],
    ['finance', 'Finance Manager', 1, { dashboard: ['view', 'export'], projects: ['view'], boq: ['view', 'export'], budget: ['view', 'approve', 'export'], procurement: ['view', 'export'], approvals: ['view', 'approve'], documents: ['view'], audit: ['view', 'export'] }],
    ['store', 'Store Manager', 0, { projects: ['view'], procurement: ['view', 'edit'] }],
    ['hr', 'HR / Labour Manager', 0, { projects: ['view'], site: ['view'] }],
    ['quality', 'Quality Engineer', 0, { projects: ['view'], site: ['view'], documents: ['view', 'create'] }],
    ['vendor', 'Contractor / Vendor', 0, { documents: ['view'] }],
    ['client', 'Client / Investor', 0, { projects: ['view'] }]
  ];
  st.roles = roles.map(([id, name, active, spec]) => ({ id, name, active: !!active, perms: P(spec) }));

  st.users = [
    ['u01', 'Rahul Nair', 'super_admin', 'all', 'Head of IT & systems'], ['u02', 'Meera Varghese', 'md', 'all', 'Managing Director'],
    ['u03', 'Thomas Kurian', 'pd', 'all', 'Director — Projects'], ['u04', 'Arjun Menon', 'pm', ['MA-2026-001', 'MA-2026-002'], 'Senior Project Manager'],
    ['u05', 'Divya Pillai', 'pm', ['MA-2025-007', 'MA-2026-004'], 'Project Manager'], ['u06', 'Suresh Kumar', 'site_sup', ['MA-2026-001'], 'Site Supervisor — Vagamon'],
    ['u07', 'Joseph Mathew', 'site_sup', ['MA-2026-002'], 'Site Supervisor — Marari'], ['u08', 'Anitha Joseph', 'qs', 'all', 'Lead Quantity Surveyor'],
    ['u09', 'Faisal Rahman', 'proc', 'all', 'Procurement Manager'], ['u10', 'Lakshmi Iyer', 'finance', 'all', 'Finance Manager'],
    ['u11', 'Neha Krishnan', 'architect', 'all', 'Principal Architect'], ['u12', 'Bincy Thomas', 'site_sup', ['MA-2025-007'], 'Site Supervisor — Wayanad']
  ].map(([id, name, role, projects, title]) => ({ id, name, role, projects, title, email: name.toLowerCase().replace(/ /g, '.') + '@mandamul.demo', mfa: PRIVILEGED.includes(role) }));

  st.clients = [{ id: 'c1', name: 'Highrange Hospitality Pvt Ltd' }, { id: 'c2', name: 'Coastline Leisure LLP' }, { id: 'c3', name: 'Vythiri Wellness Holdings' }];
  st.vendors = [
    ['V01', 'Sahyadri Steel & Cement Traders', 'Steel & cement', 'Kottayam', 4.2], ['V02', 'Periyar Aggregates & RMC', 'Concrete & aggregates', 'Aluva', 4.0],
    ['V03', 'Malanad Roofing Solutions', 'Roofing', 'Thodupuzha', 3.8], ['V04', 'Kayal Electricals Pvt Ltd', 'Electrical', 'Kochi', 4.1],
    ['V05', 'Bluewave Pools & Filtration', 'Pools', 'Kochi', 3.6], ['V06', 'Ernad Timber & Joinery', 'Doors & joinery', 'Perumbavoor', 4.4],
    ['V07', 'Greenline Landscapes', 'Landscape', 'Thrissur', 4.0], ['V08', 'Coastal MEP Contractors', 'MEP works', 'Kozhikode', 3.9],
    ['V09', 'Western Ghats Builders', 'Civil contractor', 'Kottayam', 3.7], ['V10', 'Arabian Sea Interiors', 'FF&E', 'Kochi', 4.3],
    ['V11', 'Kerala Stone & Tile House', 'Flooring', 'Kochi', 4.0], ['V12', 'Vembanad Building Materials', 'Steel & cement', 'Alappuzha', 3.9],
    ['V13', 'Hilltop Tiles & Roofing', 'Roofing', 'Kattappana', 3.5]
  ].map(([id, name, category, city, rating]) => ({ id, name, category, city, rating, approved: id !== 'V13', addedOn: d(-400) }));

  /* projects */
  const PR = [
    { id: 'MA-2026-001', name: 'Vagamon Hill Resort', type: 'Hill-station resort', location: 'Vagamon, Idukki, Kerala', clientId: 'c1', keys: 24, units: '24 cottages, clubhouse, spa and infinity pool', land: '11.4 acres', budget: 38_50_00_000_00, off: -260, pm: 'u04', tpl: 'resort', scale: 1, stage: 'Construction',
      desc: 'Hill-station resort on a terraced tea-estate plot. Cottages step down the slope with valley views; clubhouse and spa at the upper level.',
      cost: { '01': [0.92, 0.85, 0.10], '02': [1.04, 1, 0], '03': [0.88, 0.70, 0.22], '04': [0.45, 0.20, 0.55], '05': [0.40, 0.05, 0.60], '06': [0.35, 0.10, 0.65], '07': [0.30, 0.10, 0.70], '08': [0.10, 0, 0.90], '09': [0.25, 0, 0.75], '10': [0, 0, 1], '11': [0.70, 0.60, 0.33], '12': [0, 0, 1], '13': [0, 0, 0.40] },
      over: { T02: { s: 0, f: 4 }, T06: { s: 2, f: 6 }, T07: { s: 3, p: 85, delay: 'Monsoon stoppage in August and two late TMT steel deliveries — about 18 working days lost', recovery: '' }, T14: { s: 5, f: 9 } } },
    { id: 'MA-2026-002', name: 'Marari Beach Pool Villas', type: 'Private pool villas', location: 'Mararikulam, Alappuzha, Kerala', clientId: 'c2', keys: 12, units: '12 private pool villas and a beach pavilion', land: '4.8 acres', budget: 27_20_00_000_00, off: -200, pm: 'u04', tpl: 'resort', scale: 0.8, stage: 'Construction',
      desc: 'Beachfront villas behind the coastal setback line. Each villa has a private plunge pool and garden court.',
      cost: { '01': [0.95, 0.80, 0.12], '02': [1.10, 1, 0], '03': [0.65, 0.40, 0.45], '04': [0.20, 0.05, 0.82], '05': [0.10, 0, 0.90], '06': [0.15, 0, 0.85], '07': [0.15, 0, 0.88], '08': [0, 0, 1], '09': [0, 0, 1], '10': [0, 0, 1.05], '11': [0.55, 0.10, 0.75], '12': [0, 0, 1], '13': [0, 0, 1] },
      over: { T02: { s: 0, f: 30 }, T03: { s: 30, f: 31 }, T04: { s: 31, f: 33 }, T05: { s: 33, f: 36 }, T06: { s: 37, p: 45, delay: 'Coastal-zone clearance arrived 30 days late; villa layouts redrawn for the revised setback', recovery: 'Second shuttering crew from 1st of next month; Sunday working on villa slabs' }, T07: { s: 41, p: 40, delay: 'Follows the late coastal-zone clearance and layout redesign', recovery: '' }, T14: { ns: true } } },
    { id: 'MA-2025-007', name: 'Wayanad Wellness Retreat', type: 'Wellness retreat', location: 'Vythiri, Wayanad, Kerala', clientId: 'c3', keys: 18, units: '18 keys, Ayurveda spa, yoga pavilion and treatment rooms', land: '7.2 acres', budget: 21_80_00_000_00, off: -330, pm: 'u05', tpl: 'resort', scale: 0.9, stage: 'Construction',
      desc: 'Forest-edge wellness retreat. Treatment block and yoga pavilion are complete; guest units are in finishes.',
      cost: { '01': [1, 0.97, 0.02], '02': [0.98, 1, 0], '03': [1, 0.98, 0], '04': [1, 0.95, 0.01], '05': [0.97, 0.90, 0.03], '06': [0.95, 0.80, 0.05], '07': [0.96, 0.75, 0.06], '08': [0.92, 0.70, 0.08], '09': [0.95, 0.80, 0.05], '10': [0.85, 0.60, 0.15], '11': [1, 0.90, 0], '12': [0.80, 0.35, 0.20], '13': [0, 0, 0.35] },
      over: { T11: { p: 92 }, T13: { f: 4 } } },
    { id: 'MA-2026-004', name: 'Thekkady Glamping Expansion', type: 'Glamping property', location: 'Kumily, Idukki, Kerala', clientId: 'c1', keys: 10, units: '10 luxury tents on timber decks', land: '2.1 acres', budget: 4_60_00_000_00, off: -40, pm: 'u05', tpl: 'glamp', scale: 1, stage: 'Pre-construction',
      desc: 'Expansion of an operating camp with ten new tents, bathroom pods and a dining deck.',
      cost: { '01': [0.60, 0.40, 0.40] }, over: { G02: { p: 70 } } }
  ];
  const T = T0, splitLines = (total, profile) => {
    const pct = SPLIT[profile], lines = {}; let acc = 0;
    COST_CODES.forEach(([c]) => { if (c === '13') return; lines[c] = Math.round(total * pct[c] / 100 / 1_00_000_00) * 1_00_000_00; acc += lines[c]; });
    lines['13'] = total - acc; return lines;
  };
  let poSeeds = [];
  for (const p of PR) {
    const start = d(p.off), D = -p.off;
    st.projects.push({ id: p.id, name: p.name, type: p.type, location: p.location, clientId: p.clientId, keys: p.keys, units: p.units, land: p.land, start, pmId: p.pm, stage: p.stage, desc: p.desc, profile: p.tpl, createdAt: stampDaysAgo(D + 30) });
    /* tasks with baseline, then actuals from the story */
    const tasks = TEMPLATES[p.tpl].map(([k, phase, name, dur, preds, ms]) => ({ id: p.id + '-' + k, key: k, projectId: p.id, phase, name, dur: ms ? 0 : Math.max(1, Math.round(dur * p.scale)), preds: preds.map(x => p.id + '-' + x), milestone: !!ms, progress: 0, actStart: null, actFinish: null, delayReason: '', recovery: '', ownerId: p.pm }));
    baselineFrom(tasks, start);
    for (const t of tasks) {
      const o = p.over[t.key] || {}, bs = diffDays(start, t.baseStart), bf = diffDays(start, t.baseFinish);
      if (o.ns) continue;
      if (o.p != null) { t.actStart = addDays(start, bs + (o.s || 0)); t.progress = o.p; }
      else if (bf + (o.f || 0) < D && bf <= D) { t.actStart = addDays(start, bs + (o.s || 0)); t.actFinish = addDays(start, bf + (o.f || 0)); t.progress = 100; }
      else if (bs + (o.s || 0) < D) { t.actStart = addDays(start, bs + (o.s || 0)); t.progress = Math.round(clamp((D - bs) / Math.max(t.dur, 1), 0, 1) * 90); }
      if (o.delay) t.delayReason = o.delay; if (o.recovery) t.recovery = o.recovery;
    }
    // successors of a not-finished task cannot have started (finish-to-start logic)
    for (const t of topo(tasks)) {
      if (t.preds.some(x => { const pt = tasks.find(y => y.id === x); return pt && !pt.actFinish; }) && !(p.over[t.key] && p.over[t.key].p != null)) { t.actStart = null; t.actFinish = null; t.progress = 0; }
      if (t.milestone) {
        const ps = t.preds.map(x => tasks.find(y => y.id === x));
        if (ps.length && ps.every(pt => pt && pt.actFinish)) { t.actStart = t.actFinish = maxISO(ps.map(pt => pt.actFinish)); t.progress = 100; }
        else { t.actStart = t.actFinish = null; t.progress = 0; }
      }
    }
    st.tasks.push(...tasks);
    p.end = maxISO(tasks.map(t => t.baseFinish)); st.projects[st.projects.length - 1].end = p.end;

    /* budget v1 (approved at project sanction) */
    const lines = splitLines(p.budget, p.tpl);
    st.budgets.push({ id: nid('BV'), projectId: p.id, v: 1, lines, status: 'Approved', reason: 'Sanctioned project budget', by: 'u08', at: stampDaysAgo(D + 20), approvalId: null });
    st.etc[p.id] = {}; p.lines = lines;

    /* BOQ generated from library against the code budget (excl. 18% GST) */
    COST_CODES.forEach(([c]) => {
      const lib = BOQ_LIB[c]; if (!lib || !lines[c]) return;
      const target = lines[c] * 100 / 118 * 0.97, tw = sum(lib.map(x => x[3])), cp = p.cost[c] || [0, 0, 1], done = clamp(cp[0] * cp[1], 0, 1);
      lib.forEach(([desc, unit, rate, w], i) => {
        const share = target * w / tw; let qtyM, rateP;
        if (rate == null) { qtyM = 1000; rateP = Math.round(share / 1_000_00) * 1_000_00; }
        else { rateP = rate * 100; const q = share / rateP; qtyM = ['nos', 'key', 'point', 'set', 'month', 'TR'].includes(unit) ? Math.max(1, Math.round(q)) * 1000 : Math.max(1, Math.round(q * 10)) * 100; }
        st.boq.push({ id: nid('BQ'), projectId: p.id, code: c, ref: c + '.' + pad(i + 1, 2), desc, unit, qtyM, rateP, gst: 18, doneM: Math.round(qtyM * done / 100) * 100 });
      });
    });

    /* committed POs / work orders that reproduce the cost position */
    COST_CODES.forEach(([c]) => {
      const cp = p.cost[c]; if (!cp || !cp[0] || !PO_LIB[c]) return;
      const committedTotal = lines[c] * cp[0];
      PO_LIB[c].forEach(([kind, v, item, unit, rate, share], i) => {
        const tgt = committedTotal * share, excl = tgt * 100 / 118; let qtyM, rateP;
        if (unit === '%') { qtyM = 100_000; rateP = Math.round(excl / 100 / 100) * 100; }
        else if (rate == null) { qtyM = 1000; rateP = Math.round(excl / 1_000_00) * 1_000_00; }
        else { rateP = rate * 100; qtyM = Math.max(1, Math.round(excl / rateP)) * 1000; }
        const age = Math.round(D * (0.15 + 0.6 * (Number(c) / 13)) + i * 6);
        poSeeds.push({ p, c, kind, v, item, unit, qtyM, rateP, recv: cp[1], age: Math.min(D - 5, Math.max(10, D - age)) });
      });
    });
  }
  /* number POs in date order and attach approval history + receipts */
  poSeeds.sort((a, b) => b.age - a.age);
  for (const s of poSeeds) {
    const amountP = lineAmt(s.qtyM, s.rateP), taxP = gstOf(amountP, 18), totalP = amountP + taxP, id = nid('PO');
    const po = { id, projectId: s.p.id, code: s.c, kind: s.kind, vendorId: s.v, item: s.item, unit: s.unit, qtyM: s.qtyM, rateP: s.rateP, gst: 18, amountP, taxP, totalP, status: 'Approved', at: stampDaysAgo(s.age, 11), by: 'u09', mrId: null, grns: [], approvalId: null, budgetCheck: null };
    const recM = Math.round(s.qtyM * s.recv / 1000) * 1000;
    if (recM > 0) {
      const valueP = lineAmt(recM, s.rateP) + gstOf(lineAmt(recM, s.rateP), 18);
      po.grns.push({ id: nid('GRN'), date: addDays(T, -Math.max(2, Math.round(s.age / 3))), qtyM: recM, qc: 'Pass', note: s.kind === 'Work order' ? 'Work certified against measurement' : 'Received at site store', by: s.p.id === 'MA-2026-001' ? 'u06' : s.p.id === 'MA-2026-002' ? 'u07' : 'u12', valueP });
      po.status = recM >= s.qtyM ? 'Received' : 'Part received';
    }
    const steps = poSteps(totalP, 0).map(x => ({ ...x, status: 'approved', by: x.role === 'pm' ? s.p.pm : x.role === 'pd' ? 'u03' : 'u02', at: stampDaysAgo(s.age - 1, 15), comment: '' }));
    const ap = { id: nid('AP'), type: 'PO', ref: id, projectId: s.p.id, title: `${s.item} — ${vendor(s.v).name}`, amountP: totalP, ctx: {}, requestedBy: 'u09', at: po.at, status: 'Approved', closedAt: steps[steps.length - 1].at, steps };
    po.approvalId = ap.id; st.pos.push(po); st.approvals.push(ap);
  }
  /* QS estimate-to-complete: uncommitted remainder needed to reach each code's forecast (rounded down to ₹1,000) */
  for (const p of PR) COST_CODES.forEach(([c]) => {
    const cp = p.cost[c] || [0, 0, 1], target = Math.round(p.lines[c] * (cp[0] + cp[2]));
    const committed = sum(st.pos.filter(x => x.projectId === p.id && x.code === c).map(x => x.totalP));
    st.etc[p.id][c] = cp[2] ? Math.max(0, Math.floor((target - committed) / 1_000_00) * 1_000_00) : 0;
  });

  /* ---- live workflow items (the demo's open threads) ---- */
  const asUser = id => { st.session = { userId: id }; };
  // 1. cement PO waiting for Project Director (PM already approved)
  asUser('u09');
  const mkPO = (pid, code, vendorId, item, unit, qtyM, rateP, mrId, age) => {
    const amountP = lineAmt(qtyM, rateP), taxP = gstOf(amountP, 18), totalP = amountP + taxP, c = cost(pid).lines.find(l => l.code === code);
    const overBy = Math.max(0, totalP - c.avail);
    const po = { id: nid('PO'), projectId: pid, code, kind: 'Material', vendorId, item, unit, qtyM, rateP, gst: 18, amountP, taxP, totalP, status: 'Pending approval', at: stampDaysAgo(age, 10), by: 'u09', mrId, grns: [], budgetCheck: { availP: c.avail, overBy, at: stampDaysAgo(age, 10) } };
    st.pos.push(po);
    const ap = createApproval({ type: 'PO', ref: po.id, projectId: pid, title: `${item} — ${vendor(vendorId).name}`, amountP: totalP, steps: poSteps(totalP, overBy), ctx: { overBy } });
    ap.at = po.at; po.approvalId = ap.id; return { po, ap };
  };
  const mr1 = { id: nid('MR'), projectId: 'MA-2026-001', code: '04', item: 'OPC 53 grade cement', qtyM: 3_200_000, unit: 'bag', neededBy: d(9), requestedBy: 'u06', at: stampDaysAgo(6, 9), status: 'PO raised', note: 'For cottage block masonry and plaster, phase 2', dupNote: '', quotes: [
    { vendorId: 'V01', rateP: 41000, gst: 18, leadDays: 4, note: 'Ex-Kottayam, unloading included' }, { vendorId: 'V12', rateP: 42500, gst: 18, leadDays: 3, note: '' }, { vendorId: 'V02', rateP: 43800, gst: 18, leadDays: 6, note: 'Part loads only' }], vendorId: 'V01', poId: null };
  st.mrs.push(mr1);
  const a1 = mkPO('MA-2026-001', '04', 'V01', 'OPC 53 grade cement', 'bag', 3_200_000, 41000, mr1.id, 3); mr1.poId = a1.po.id;
  a1.ap.steps[0] = { ...a1.ap.steps[0], status: 'approved', by: 'u04', at: stampDaysAgo(2, 17), comment: 'Rates in line with last order' }; a1.ap.steps[1].status = 'pending';
  // 2. pool equipment PO above available budget — needs MD override
  const mr2 = { id: nid('MR'), projectId: 'MA-2026-002', code: '11', item: 'Pool filtration & heat-pump package (12 villas)', qtyM: 12_000, unit: 'set', neededBy: d(40), requestedBy: 'u04', at: stampDaysAgo(9, 12), status: 'PO raised', note: 'Revised spec after pool redesign — heat pumps added', dupNote: '', quotes: [
    { vendorId: 'V05', rateP: 3_30_000_00, gst: 18, leadDays: 35, note: 'Includes commissioning & 2-year AMC' }, { vendorId: 'V08', rateP: 3_62_000_00, gst: 18, leadDays: 45, note: '' }], vendorId: 'V05', poId: null };
  st.mrs.push(mr2);
  const a2 = mkPO('MA-2026-002', '11', 'V05', 'Pool filtration & heat-pump package', 'set', 12_000, 3_30_000_00, mr2.id, 2); mr2.poId = a2.po.id;
  a2.ap.steps[0] = { ...a2.ap.steps[0], status: 'approved', by: 'u04', at: stampDaysAgo(1, 16), comment: 'Needed for revised pool design; overrun noted' }; a2.ap.steps[1].status = 'pending';
  // 3. MR with quotations ready to compare
  st.mrs.push({ id: nid('MR'), projectId: 'MA-2026-001', code: '05', item: 'Clay roof tiles, Mangalore pattern', qtyM: 2_600_000, unit: 'sqm', neededBy: d(21), requestedBy: 'u06', at: stampDaysAgo(5, 11), status: 'Quotes received', note: 'Cottage roofs, rows C–F', dupNote: '', quotes: [
    { vendorId: 'V03', rateP: 1_42_000, gst: 18, leadDays: 12, note: 'Supply only' }, { vendorId: 'V13', rateP: 1_31_000, gst: 18, leadDays: 20, note: 'Vendor not on approved list' }, { vendorId: 'V12', rateP: 1_49_500, gst: 18, leadDays: 9, note: '' }], vendorId: null, poId: null });
  st.mrs.push({ id: nid('MR'), projectId: 'MA-2025-007', code: '07', item: 'Bathroom CP fittings — 18 keys', qtyM: 18_000, unit: 'set', neededBy: d(14), requestedBy: 'u12', at: stampDaysAgo(1, 15), status: 'Submitted', note: 'As per approved fittings schedule rev C', dupNote: '', quotes: [], vendorId: null, poId: null });
  st.mrs.push({ id: nid('MR'), projectId: 'MA-2026-002', code: '03', item: 'Fe 550D TMT steel', qtyM: 42_000, unit: 'MT', neededBy: d(12), requestedBy: 'u07', at: stampDaysAgo(2, 10), status: 'Quoting', note: 'Villa slabs V5–V8', dupNote: '', quotes: [{ vendorId: 'V12', rateP: 70_500_00, gst: 18, leadDays: 5, note: '' }], vendorId: null, poId: null });
  // 4. budget revision: contingency → superstructure (QS), waiting for Finance
  asUser('u08');
  const cur1 = currentBudget('MA-2026-001'), nl = { ...cur1.lines }; nl['03'] += 78_00_000_00; nl['13'] -= 78_00_000_00;
  const bv2 = { id: nid('BV'), projectId: 'MA-2026-001', v: 2, lines: nl, status: 'Pending', reason: 'Steel price escalation on RCC frame (Fe 550D up ~11% since sanction). Transfer ₹78 L from contingency to 03 Superstructure; total unchanged.', by: 'u08', at: stampDaysAgo(1, 12), approvalId: null, changes: [{ code: '03', delta: 78_00_000_00 }, { code: '13', delta: -78_00_000_00 }] };
  st.budgets.push(bv2);
  const ab = createApproval({ type: 'BUDGET', ref: bv2.id, projectId: 'MA-2026-001', title: 'Vagamon Hill Resort — budget v2 (contingency transfer)', amountP: 78_00_000_00, steps: STEP_TEMPLATES.BUDGET() }); ab.at = bv2.at; bv2.approvalId = ab.id;

  /* site reports: last 6 days; Marari missed yesterday; today's due after cutoff */
  const W = { 'MA-2026-001': ['Mist till 9 am, light rain after 3 pm', 'Mist', 'Clear, 22°C', 'Light rain', 'Cloudy', 'Clear, 24°C'], 'MA-2026-002': ['Humid, 31°C', 'Clear', 'Cloudy', 'Light rain', 'Clear', 'Clear'], 'MA-2025-007': ['Cloudy', 'Light rain', 'Clear', 'Mist', 'Clear', 'Cloudy'] };
  const crews = { 'MA-2026-001': [['Mason', 14], ['Helper', 22], ['Bar bender', 8], ['Carpenter', 6]], 'MA-2026-002': [['Mason', 9], ['Helper', 16], ['Carpenter', 10], ['Bar bender', 6]], 'MA-2025-007': [['Tiler', 8], ['Painter', 10], ['Electrician', 4], ['Helper', 9]] };
  const sup = { 'MA-2026-001': 'u06', 'MA-2026-002': 'u07', 'MA-2025-007': 'u12' };
  for (const pid of Object.keys(sup)) {
    const live = st.tasks.filter(t => t.projectId === pid && t.actStart && !t.actFinish && !t.milestone);
    for (let k = 6; k >= 0; k--) {
      if (pid === 'MA-2026-002' && k <= 1) continue; if (k === 0 && new Date().getHours() < 13) continue; if (pid === 'MA-2026-001' && k === 0) continue;
      const pending = pid === 'MA-2026-001' && k === 1;
      const r = { id: nid('DR'), projectId: pid, date: d(-k), by: sup[pid], at: stampDaysAgo(k, k ? 18 : 12, 20), weather: W[pid][k % 6], labour: crews[pid].map(([t, n]) => ({ trade: t, count: n + ((k * 3) % 4) - 1 })),
        work: live.slice(0, 2).map(t => ({ taskId: t.id, to: Math.max(0, t.progress - (k - ({ 'MA-2026-001': 2, 'MA-2026-002': 2, 'MA-2025-007': 0 }[pid]))), boqId: null, qtyM: 0, note: '' })),
        materials: pid === 'MA-2025-007' ? [{ item: 'Wall tiles 300×600', qty: '64', unit: 'sqm' }] : [{ item: 'Ready-mix concrete M30', qty: String(14 + k), unit: 'cum' }],
        issues: pid === 'MA-2026-001' && k === 1 ? 'Concrete pump breakdown 11:30–13:00; slab C4 pour finished at 17:40. Steel for C5–C6 due Friday.' : '',
        safety: k === 3 ? 'Two workers without harness at roof edge, row B — stopped and briefed.' : 'Toolbox talk held. No incidents.', photos: [], status: pending ? 'Submitted' : 'Approved', verifiedBy: pending ? null : st.projects.find(p => p.id === pid).pmId };
      if (pending) {
        const rc = st.boq.find(b => b.projectId === pid && b.ref === '03.01');
        r.work = [{ taskId: pid + '-T07', to: 88, boqId: rc ? rc.id : null, qtyM: 18_500, note: 'Slab C4 cast (18.5 cum)' }];
        asUser('u06'); const ar = createApproval({ type: 'REPORT', ref: r.id, projectId: pid, title: `Daily site report — ${fmtDate(r.date)}`, steps: STEP_TEMPLATES.REPORT() }); ar.at = r.at; r.approvalId = ar.id;
      }
      st.reports.push(r);
    }
  }

  /* documents with revisions and expiry */
  const mkDoc = (pid, title, type, tags, revs, expiry = null) => {
    const doc = { id: nid('DOC'), projectId: pid, title, type, tags, expiry, status: revs.some(r => r[1] === 'Approved') ? 'Approved' : revs[revs.length - 1][1], versions: revs.map(([rev, status, file, kb, ago, by, note]) => ({ rev, status, file, sizeKB: kb, at: stampDaysAgo(ago, 12), by, note: note || '' })), clientVisible: false };
    st.docs.push(doc); return doc;
  };
  const g = mkDoc('MA-2026-001', 'Architectural GA — clubhouse & spa', 'Drawing', ['architectural', 'clubhouse'], [['R0', 'Superseded', 'VHR-ARC-GA-101_R0.pdf', 4210, 190, 'u11'], ['R1', 'Approved', 'VHR-ARC-GA-101_R1.pdf', 4380, 96, 'u11', 'Spa wing extended by 1.2 m'], ['R2', 'Pending', 'VHR-ARC-GA-101_R2.pdf', 4415, 2, 'u11', 'Reception canopy revised; lift shaft moved to grid C/4']]);
  asUser('u11'); const ad = createApproval({ type: 'DOC', ref: g.id + ' R2', projectId: 'MA-2026-001', title: 'Architectural GA — clubhouse & spa, revision R2', steps: STEP_TEMPLATES.DOC(), ctx: { docId: g.id, rev: 'R2' } }); ad.at = g.versions[2].at;
  mkDoc('MA-2026-001', 'Structural drawings — cottage type A', 'Drawing', ['structural', 'cottages'], [['R0', 'Superseded', 'VHR-STR-CA-201_R0.pdf', 3120, 210, 'u11'], ['R1', 'Approved', 'VHR-STR-CA-201_R1.pdf', 3190, 150, 'u11', 'Footing F3 enlarged after soil report']]);
  mkDoc('MA-2026-001', 'Building permit — Vagamon Grama Panchayat', 'Permit', ['statutory'], [['R0', 'Approved', 'VHR-permit.pdf', 880, 196, 'u03']], d(420));
  mkDoc('MA-2026-001', "Contractor's All Risk insurance policy", 'Insurance', ['insurance', 'renewal'], [['R0', 'Approved', 'VHR-CAR-policy.pdf', 1210, 250, 'u10']], d(12));
  mkDoc('MA-2026-001', 'Main civil works contract — Western Ghats Builders', 'Contract', ['contract', 'civil'], [['R0', 'Approved', 'VHR-civil-contract.pdf', 2650, 240, 'u03']]);
  mkDoc('MA-2026-001', 'Site meeting minutes — this week', 'Minutes', ['meeting'], [['R0', 'Draft', 'VHR-MoM.docx', 96, 1, 'u04']]);
  mkDoc('MA-2026-002', 'Coastal-zone clearance letter', 'Permit', ['statutory', 'CRZ', 'estimate — validate locally'], [['R0', 'Approved', 'MBV-CRZ-letter.pdf', 640, 120, 'u03']]);
  mkDoc('MA-2026-002', 'Consent to establish — pollution control board', 'Permit', ['statutory', 'renewal'], [['R0', 'Approved', 'MBV-CTE.pdf', 510, 300, 'u03']], d(21));
  mkDoc('MA-2026-002', 'Villa type V1 — revised layout (setback)', 'Drawing', ['architectural', 'villas'], [['R2', 'Superseded', 'MBV-ARC-V1_R2.pdf', 2980, 150, 'u11'], ['R3', 'Approved', 'MBV-ARC-V1_R3.pdf', 3020, 118, 'u11', 'Shifted 6 m landward']]);
  mkDoc('MA-2025-007', 'Spa MEP coordination layout', 'Drawing', ['MEP', 'spa'], [['R1', 'Superseded', 'WWR-MEP-SPA_R1.pdf', 5110, 160, 'u11'], ['R2', 'Approved', 'WWR-MEP-SPA_R2.pdf', 5260, 110, 'u11']]);
  mkDoc('MA-2025-007', 'Fire NOC application', 'Permit', ['statutory', 'pre-opening'], [['R0', 'Draft', 'WWR-fire-NOC-application.pdf', 720, 6, 'u05']]);
  mkDoc('MA-2026-004', 'Forest NOC application', 'Permit', ['statutory'], [['R0', 'Draft', 'TGE-forest-NOC.pdf', 430, 12, 'u05']]);

  seedV2(st);
  /* threads, notifications, opening audit trail */
  st.threads[mr1.id] = [{ id: nid('C'), userId: 'u06', at: stampDaysAgo(6, 9), text: 'Stock will run out by Thursday at current plastering rate.' }];
  st.threads[g.id] = [{ id: nid('C'), userId: 'u11', at: stampDaysAgo(2, 12), text: 'R2 moves the lift shaft — structural to confirm the pit depth before approval.' }];
  st.audit = []; st.session = null;
  const A = (ago, uid, pid, action, detail) => st.audit.push({ id: nid('AU'), at: stampDaysAgo(ago.d, ago.h), userId: uid, role: userById(uid).role, projectId: pid, action, entity: null, detail });
  A({ d: 1, h: 18 }, 'u06', 'MA-2026-001', 'Site report submitted', 'Daily report for yesterday sent for verification');
  A({ d: 1, h: 12 }, 'u08', 'MA-2026-001', 'Budget revision requested', 'v2 — transfer ₹78,00,000 from 13 Contingency to 03 Superstructure');
  A({ d: 2, h: 17 }, 'u04', 'MA-2026-001', 'Approved step', `${a1.po.id} cement order — review & approve`);
  A({ d: 2, h: 12 }, 'u11', 'MA-2026-001', 'Revision uploaded', 'Architectural GA — clubhouse & spa R2');
  A({ d: 3, h: 10 }, 'u09', 'MA-2026-001', 'Purchase order raised', `${a1.po.id} from ${mr1.id}`);
  A({ d: 4, h: 9 }, 'u01', null, 'Settings changed', 'PO approval thresholds confirmed: PM ≤ ₹5,00,000; Project Director ≤ ₹25,00,000; MD above');
  st.audit.sort((a, b) => (a.at < b.at ? 1 : -1));
  st.notifs = st.notifs.map(n => ({ ...n, at: stampDaysAgo(1, 9) }));
  return st;
}
