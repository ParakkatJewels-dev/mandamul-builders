'use strict';
/* DEMO SEED v2 — adds contracts & running bills, invoices & payments, units with readiness gates, defects, FF&E,
   handover checklists, automation rules and cost history to the fictional demo portfolio. */

const STAGE_TEMPLATES = {
  villa: [['foundation', 'Foundation'], ['structure', 'Structure'], ['roofing', 'Roofing'], ['mep_rough', 'MEP rough-in'], ['plaster', 'Plastering'], ['flooring', 'Flooring'], ['painting', 'Painting'], ['doors_windows', 'Doors and windows'], ['bathrooms', 'Bathroom installation'], ['furniture', 'Furniture installation'], ['cleaning', 'Final cleaning']],
  amenity: [['foundation', 'Foundation'], ['structure', 'Structure'], ['roofing', 'Roofing'], ['mep_rough', 'MEP rough-in'], ['plaster', 'Plastering'], ['flooring', 'Flooring'], ['painting', 'Painting'], ['doors_windows', 'Doors and windows'], ['furniture', 'Furniture & equipment'], ['cleaning', 'Final cleaning']],
  pool: [['excavation', 'Excavation'], ['shell', 'Shell & structure'], ['waterproofing', 'Waterproofing'], ['tiling', 'Tiling & coping'], ['filtration', 'Filtration plant']],
  tent: [['platform', 'Deck platform'], ['structure', 'Tent structure'], ['bath_pod', 'Bathroom pod'], ['furniture', 'Furniture installation'], ['cleaning', 'Final cleaning']]
};
const HANDOVER_ITEMS = [['fire_noc', 'Fire safety NOC'], ['occupancy', 'Occupancy / completion certificate'], ['utilities', 'Power, water and sewer connections'], ['wtp_stp', 'Water and sewage treatment commissioned'], ['it', 'Internet, Wi-Fi and IT infrastructure'], ['pms_pos', 'PMS and POS ready'], ['staff', 'Staff facilities complete'], ['asbuilt', 'As-built drawings'], ['om', 'O&M manuals'], ['warranty_register', 'Warranty and asset registers'], ['walkthrough', 'Owner walkthrough signed']];
const FFE_KIT = [['King bed', 'Furniture', 6200000], ['Mattress & bedding', 'Soft furnishings', 2400000], ['Wardrobe', 'Furniture', 3800000], ['Lounge chairs', 'Furniture', 2600000], ['Smart TV 55"', 'Electronics', 6400000], ['Minibar', 'Appliances', 1900000], ['Split AC 2 TR', 'HVAC', 7200000], ['Bathroom fittings set', 'Sanitary', 5500000]];
const ROLE_SPEC = [ // mirrors app.bootstrap_org in the database
  ['super_admin', 'dashboard projects schedule site boq budget procurement contracts payments quality handover documents settings audit', 'view create edit export'], ['super_admin', 'approvals', 'view'],
  ['md', 'dashboard projects schedule site boq budget procurement contracts payments quality handover approvals documents audit', 'view export'], ['md', 'budget procurement contracts payments documents approvals handover', 'approve'], ['md', 'projects', 'create'],
  ['pd', 'dashboard projects schedule site boq budget procurement contracts payments quality handover approvals documents audit', 'view export'], ['pd', 'projects schedule documents contracts', 'create edit'], ['pd', 'schedule site procurement contracts payments documents approvals quality handover', 'approve'], ['pd', 'budget', 'create'],
  ['pm', 'dashboard projects schedule site boq budget procurement contracts quality handover approvals documents', 'view'], ['pm', 'schedule site procurement contracts documents quality handover', 'create edit'], ['pm', 'site procurement contracts approvals quality', 'approve'], ['pm', 'budget', 'create'], ['pm', 'projects', 'edit'],
  ['architect', 'projects schedule documents approvals quality', 'view'], ['architect', 'documents', 'create edit export'],
  ['site_sup', 'projects schedule site procurement documents quality handover', 'view'], ['site_sup', 'site procurement quality', 'create'], ['site_sup', 'procurement site', 'edit'],
  ['qs', 'dashboard projects schedule site boq budget procurement contracts approvals documents', 'view'], ['qs', 'boq budget contracts', 'create edit export'], ['qs', 'boq approvals', 'approve'],
  ['proc', 'dashboard projects boq budget procurement approvals documents', 'view'], ['proc', 'procurement', 'create edit export'], ['proc', 'documents', 'create'],
  ['finance', 'dashboard projects boq budget procurement contracts payments approvals documents audit', 'view'], ['finance', 'payments', 'create edit export'], ['finance', 'budget payments approvals', 'approve'], ['finance', 'budget audit dashboard', 'export'],
  ['quality', 'projects schedule site quality handover documents approvals', 'view'], ['quality', 'quality handover', 'create edit approve'], ['quality', 'approvals', 'approve'],
  ['interior', 'projects documents handover', 'view'], ['interior', 'documents handover', 'create edit'], ['civil', 'projects schedule site quality', 'view'], ['civil', 'site quality', 'create'],
  ['store', 'projects procurement', 'view'], ['store', 'procurement', 'edit'], ['hr', 'projects site', 'view'], ['vendor', 'documents', 'view'], ['client', 'projects', 'view']
];

function seedV2(st) {
  const T0 = todayISO(), d = n => addDays(T0, n);
  let rs = 20261119; const rnd = () => ((rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648);
  Object.assign(st, { contracts: [], measurements: [], invoices: [], payments: [], units: [], snags: [], ffe: [], inspections: [], handover: {}, warranties: [], assets: [], impacts: [], events: [], risks: [], snaps: {},
    channels: { email: { enabled: false, provider: '' }, whatsapp: { enabled: false, provider: '' } } });
  st.settings.billDueDays = 15; st.settings.stageTemplates = STAGE_TEMPLATES;
  /* roles mirror the database bootstrap; Quality Engineer is active */
  st.roles.forEach(r => { MODULES.forEach(([m]) => { r.perms[m] = r.perms[m] || {}; ACTIONS.forEach(a => (r.perms[m][a] = false)); }); });
  for (const [role, mods, acts] of ROLE_SPEC) { const r = st.roles.find(x => x.id === role); if (!r) continue; for (const m of mods.split(' ')) for (const a of acts.split(' ')) r.perms[m][a] = true; }
  st.roles.find(r => r.id === 'quality').active = true;
  st.users.push({ id: 'u13', name: 'Priya Das', role: 'quality', projects: 'all', title: 'Quality & Safety Engineer', email: 'priya.das@mandamul.demo', mfa: false },
                { id: 'u14', name: 'Ravi Shankar', role: 'finance', projects: 'all', title: 'Accounts Executive', email: 'ravi.shankar@mandamul.demo', mfa: true });
  const extra = { 'MA-2026-001': [96000, 42_50_00_000_00, 'Idukki'], 'MA-2026-002': [52000, 29_80_00_000_00, 'Alappuzha'], 'MA-2025-007': [61000, 24_60_00_000_00, 'Wayanad'], 'MA-2026-004': [9500, 5_20_00_000_00, 'Idukki'] };
  st.projects.forEach(p => { const [b, cv, dist] = extra[p.id]; Object.assign(p, { builtUpSqft: b, contractValueP: cv, district: dist, contingencyPct: 5, plan: null }); });
  st.vendors.forEach(v => (v.creditDays = v.category === 'Civil contractor' ? 15 : 30));
  const sup = { 'MA-2026-001': 'u06', 'MA-2026-002': 'u07', 'MA-2025-007': 'u12', 'MA-2026-004': 'u05' };
  const okAp = (type, ref, pid, title, amountP, steps, ago, by = 'u09') => {
    const ap = { id: nid('AP'), type, ref, projectId: pid, title, amountP, ctx: {}, requestedBy: by, at: stampDaysAgo(ago + 1 + Math.floor(rnd() * 6), 10), status: 'Approved', closedAt: stampDaysAgo(ago, 16),
      steps: steps.map((s, i) => ({ ...s, status: 'approved', by: { pm: proj(pid).pmId, pd: 'u03', md: 'u02', qs: 'u08', finance: 'u10' }[s.role] || 'u03', at: stampDaysAgo(ago, 12 + i), comment: '' })) };
    st.approvals.push(ap); return ap;
  };

  /* ---- work orders become contracts with measured running bills ---- */
  const WO = st.pos.filter(x => x.kind === 'Work order');
  for (const w of WO) {
    const boq = st.boq.filter(b => b.projectId === w.projectId && b.code === w.code).slice(0, 2); if (!boq.length) continue;
    const f = w.amountP / sum(boq.map(b => lineAmt(b.qtyM, b.rateP)));
    const age = diffDays(w.at.slice(0, 10), T0), start = w.at.slice(0, 10), end = maxISO([addDays(start, 120), addDays(T0, 45)]);
    const c = { id: nid('WO'), projectId: w.projectId, vendorId: w.vendorId, code: w.code, unitId: null, title: w.item, retention: 5, advanceP: 0, advRecPct: 10, tds: 2, gst: 18, start, end, status: 'Active', by: 'u08', at: w.at,
      items: boq.map(b => ({ id: nid('CI'), boqId: b.id, desc: b.desc + ' — labour & materials', unit: b.unit, qtyM: b.qtyM, rateP: Math.max(100, Math.round(b.rateP * f / 100) * 100) })), variations: [], bills: [] };
    if (contractValue(c) > 50_00_000_00) c.advanceP = Math.round(contractValue(c) * 0.05 / 1_000_00) * 1_000_00;
    c.approvalId = okAp('CONTRACT', c.id, c.projectId, c.title + ' — ' + vendor(c.vendorId).name, contractTotal(c), poSteps(contractTotal(c), 0, 'contracts'), age - 1, 'u08').id;
    st.contracts.push(c);
    if (c.advanceP) st.payments.push({ id: nid('PAY'), kind: 'advance', ref: c.id, projectId: c.projectId, vendorId: c.vendorId, amountP: c.advanceP, tdsP: 0, date: addDays(start, 7), bankRef: 'UTR' + (8000000 + Math.floor(rnd() * 999999)), reconciled: true, by: 'u10' });
    const r = w.qtyM ? sum(w.grns.map(g => g.qtyM)) / w.qtyM : 0, nb = r > 0.6 ? 3 : r > 0.25 ? 2 : r > 0 ? 1 : 0;
    for (let k = 1; k <= nb; k++) {
      const billAge = Math.max(4, Math.round(age * (1 - k / (nb + 0.6)))), last = k === nb;
      for (const it of c.items) { const q = Math.min(Math.round(it.qtyM * r / nb / 100) * 100, it.qtyM - measuredQty(it.id)); if (q > 0) st.measurements.push({ id: nid('MB'), contractId: c.id, itemId: it.id, qtyM: q, date: addDays(T0, -billAge - 3), unitId: null, note: `Running measurement ${k}`, by: sup[c.projectId], status: 'Verified', verifiedBy: proj(c.projectId).pmId, verifiedAt: stampDaysAgo(billAge + 1, 17), billId: null }); }
      const b = buildBill(c); const bill = { id: nid('RA'), no: k, ...b, at: stampDaysAgo(billAge, 11), by: 'u03', status: 'Paid', dueDate: addDays(T0, -billAge + 15) };
      delete bill.measurementIds; st.measurements.filter(m => b.measurementIds.includes(m.id)).forEach(m => (m.billId = bill.id));
      const pendingDemo = last && c.projectId === 'MA-2026-001' && c.code === '03';
      if (pendingDemo) {
        bill.status = 'In approval';
        const ap = { id: nid('AP'), type: 'RABILL', ref: bill.id, projectId: c.projectId, title: `RA bill ${k} on ${c.id}`, amountP: bill.grossP + bill.gstP, ctx: {}, requestedBy: 'u03', at: stampDaysAgo(2, 11), status: 'Pending',
          steps: billSteps(bill.grossP + bill.gstP).map((s, i) => ({ ...s, status: i === 0 ? 'approved' : i === 1 ? 'pending' : 'waiting', by: i === 0 ? 'u04' : null, at: i === 0 ? stampDaysAgo(1, 15) : null, comment: i === 0 ? 'Slab pours C1–C4 checked on site' : '' })) };
        st.approvals.push(ap); bill.approvalId = ap.id;
      } else {
        bill.approvalId = okAp('RABILL', bill.id, c.projectId, `RA bill ${k} on ${c.id}`, bill.grossP + bill.gstP, billSteps(bill.grossP + bill.gstP), billAge, 'u03').id;
        if (last && (k % 2 === 1 || billAge < 20)) { bill.status = 'Approved'; bill.dueDate = addDays(T0, 3 + Math.floor(rnd() * 20)); }
        else st.payments.push({ id: nid('PAY'), kind: 'ra_bill', ref: bill.id, projectId: c.projectId, vendorId: c.vendorId, amountP: bill.netP, tdsP: bill.tdsP, date: addDays(T0, -billAge + 12), bankRef: 'UTR' + (8000000 + Math.floor(rnd() * 999999)), reconciled: billAge > 25, by: 'u10' });
      }
      c.bills.push(bill);
    }
    if (r > 0 && r < 1 && ['MA-2026-001', 'MA-2026-002'].includes(c.projectId) && ['03', '04'].includes(c.code))
      st.measurements.push({ id: nid('MB'), contractId: c.id, itemId: c.items[0].id, qtyM: Math.round(c.items[0].qtyM * 0.03 / 100) * 100, date: d(-1), unitId: null, note: 'Measured on site yesterday', by: sup[c.projectId], status: 'Recorded', verifiedBy: null, billId: null });
    const tk = { '02': ['T04', 'T05'], '03': ['T06', 'T07'], '04': ['T10'], '05': ['T08'], '06': ['T09'], '07': ['T09'], '08': ['T11'], '10': ['T13'], '11': ['T14'] }[c.code] || [];
    st.tasks.filter(t => t.projectId === c.projectId && tk.includes(t.key)).forEach(t => (t.contractorId = c.vendorId));
  }
  st.approvals = st.approvals.filter(a => !(a.type === 'PO' && WO.some(w => w.id === a.ref)));
  st.pos = st.pos.filter(x => x.kind !== 'Work order');

  /* ---- vendor invoices and payments for received materials ---- */
  for (const po of st.pos.filter(x => x.grns.some(g => g.qc === 'Pass'))) {
    const acc = sum(po.grns.filter(g => g.qc === 'Pass').map(g => g.qtyM)), gdate = po.grns[po.grns.length - 1].date, age = diffDays(gdate, T0);
    const amountP = lineAmt(acc, po.rateP), taxP = gstOf(amountP, po.gst);
    const inv = { id: nid('INV'), poId: po.id, projectId: po.projectId, vendorId: po.vendorId, no: vendor(po.vendorId).name.split(' ')[0].toUpperCase().slice(0, 4) + '/' + (1000 + Math.floor(rnd() * 8999)), date: addDays(gdate, 2), qtyM: acc, rateP: po.rateP, gst: po.gst, amountP, taxP, totalP: amountP + taxP, match: [], status: 'Paid', by: 'u14', at: stampDaysAgo(Math.max(age - 2, 1), 12) };
    inv.dueDate = addDays(inv.date, vendor(po.vendorId).creditDays); inv.approvalId = okAp('INVOICE', inv.id, po.projectId, `Invoice ${inv.no} on ${po.id}`, inv.totalP, invoiceSteps(inv.totalP), Math.max(age - 3, 1), 'u14').id;
    if (inv.dueDate > T0 || rnd() < 0.15) inv.status = 'Approved';
    else st.payments.push({ id: nid('PAY'), kind: 'invoice', ref: inv.id, projectId: po.projectId, vendorId: po.vendorId, amountP: inv.totalP, tdsP: 0, date: inv.dueDate, bankRef: 'UTR' + (7000000 + Math.floor(rnd() * 999999)), reconciled: diffDays(inv.dueDate, T0) > 10, by: 'u10' });
    st.invoices.push(inv);
  }
  const hold = st.pos.find(x => x.projectId === 'MA-2026-002' && x.status === 'Part received');
  if (hold) { const extraM = Math.round(hold.qtyM * 0.05 / 1000) * 1000 || 1000, amountP = lineAmt(extraM, hold.rateP + 15000), taxP = gstOf(amountP, hold.gst);
    st.invoices.push({ id: nid('INV'), poId: hold.id, projectId: hold.projectId, vendorId: hold.vendorId, no: 'PRY/' + 4471, date: d(-3), qtyM: extraM, rateP: hold.rateP + 15000, gst: hold.gst, amountP, taxP, totalP: amountP + taxP, by: 'u14', at: stampDaysAgo(2, 15), status: 'On hold', dueDate: null,
      match: [`invoiced quantity exceeds accepted quantity`, `rate ${fmtINR(hold.rateP + 15000)} differs from PO ${fmtINR(hold.rateP)}`] }); }

  /* ---- units with readiness stages, master-plan positions, FF&E, defects ---- */
  const mkUnit = (pid, code, name, type, tpl, budgetP, x, y, done, extra = {}) => {
    const stages = STAGE_TEMPLATES[tpl].map(([key, label], i) => ({ key, label, status: i < done.passed ? 'Passed' : i < done.passed + (done.awaiting || 0) ? 'Awaiting inspection' : i < done.passed + (done.awaiting || 0) + (done.progress || 0) ? 'In progress' : 'Not started', insp: i < done.passed ? 'seed' : null, at: i < done.passed ? stampDaysAgo(Math.max(3, 60 - i * 5), 11) : null, by: i < done.passed ? 'u13' : null }));
    const systems = tpl === 'tent' ? ['Electrical', 'Plumbing'] : tpl === 'pool' ? ['Pool', 'Electrical'] : ['Electrical', 'HVAC', 'Plumbing', 'Fire', ...(extra.pool ? ['Pool'] : [])];
    const u = { id: nid('UN'), projectId: pid, code, name, type, template: tpl, budgetP, x, y, stages, commissioning: systems.map(s => ({ system: s, status: done.cm ? 'Passed' : 'Pending', insp: done.cm ? 'seed' : null })), blocked: '', handedOverAt: null };
    st.units.push(u);
    u.stages.filter(s => s.status === 'Awaiting inspection').forEach(s => st.inspections.push({ id: nid('IN'), projectId: pid, unitId: u.id, kind: 'Stage', stage: s.key, system: null, requestedBy: sup[pid], at: stampDaysAgo(1, 10), status: 'Requested', inspector: null, decidedAt: null, notes: '' }));
    return u;
  };
  // Vagamon: cottages on four terraces, clubhouse and spa above, infinity pool
  for (let i = 0; i < 24; i++) { const row = Math.floor(i / 6), col = i % 6; const passed = i < 20 ? 2 : 1, aw = i >= 20 && i < 22 ? 1 : 0, pr = i >= 22 ? 1 : 0;
    mkUnit('MA-2026-001', 'C-' + pad(i + 1, 2), 'Cottage ' + (i + 1), 'Cottage', 'villa', 1_10_00_000_00, 14 + col * 13.5 + (row % 2) * 6, 40 + row * 13, { passed, awaiting: aw, progress: pr }); }
  mkUnit('MA-2026-001', 'CLB', 'Clubhouse & restaurant', 'Clubhouse', 'amenity', 3_80_00_000_00, 34, 15, { passed: 2 });
  mkUnit('MA-2026-001', 'SPA', 'Spa & wellness', 'Spa', 'amenity', 1_90_00_000_00, 62, 15, { passed: 2 });
  mkUnit('MA-2026-001', 'POOL', 'Infinity pool', 'Pool', 'pool', 95_00_000_00, 80, 26, { passed: 5, cm: true });
  // Marari: twelve pool villas in two rows behind the setback line, pavilion near the beach
  for (let i = 0; i < 12; i++) { const row = Math.floor(i / 6), col = i % 6;
    mkUnit('MA-2026-002', 'V-' + pad(i + 1, 2), 'Pool villa ' + (i + 1), 'Pool villa', 'villa', 1_65_00_000_00, 12 + col * 15, 22 + row * 24, { passed: i < 4 ? 2 : 1, awaiting: i === 4 ? 1 : 0, progress: i >= 5 ? 1 : 0 }, { pool: true }); }
  mkUnit('MA-2026-002', 'PAV', 'Beach pavilion', 'Restaurant', 'amenity', 1_20_00_000_00, 50, 74, { passed: 1, progress: 1 });
  // Wayanad: eighteen keys around the spa court
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; const ready = i < 3, near = i < 12;
    const u = mkUnit('MA-2025-007', 'W-' + pad(i + 1, 2), 'Forest suite ' + (i + 1), 'Suite', 'villa', 85_00_000_00, 50 + Math.cos(a) * 34, 50 + Math.sin(a) * 32, { passed: ready ? 11 : near ? 9 : 8, awaiting: !ready && i % 4 === 1 ? 1 : 0, progress: ready ? 0 : 1, cm: ready });
    FFE_KIT.forEach(([item, cat, c], k) => st.ffe.push({ id: nid('FF'), projectId: u.projectId, unitId: u.id, item, category: cat, qty: 1, status: ready ? 'Tested' : near ? (k < 5 ? 'Installed' : 'Delivered') : (k < 3 ? 'Delivered' : 'Ordered'), costP: c }));
    if (ready) { u.commissioning.forEach(c => (c.status = 'Passed')); st.inspections.push({ id: nid('IN'), projectId: u.projectId, unitId: u.id, kind: 'Final', stage: null, system: null, requestedBy: 'u12', at: stampDaysAgo(4, 10), status: 'Passed', inspector: 'u13', decidedAt: stampDaysAgo(3, 15), notes: 'Final walkthrough clean' }); }
    else if (near) u.commissioning.forEach((c, k) => (c.status = k < 2 ? 'Passed' : 'Pending'));
  }
  mkUnit('MA-2025-007', 'SPA', 'Ayurveda spa', 'Spa', 'amenity', 2_40_00_000_00, 50, 50, { passed: 10, cm: true });
  mkUnit('MA-2025-007', 'YOGA', 'Yoga pavilion', 'Pavilion', 'amenity', 60_00_000_00, 50, 12, { passed: 9, progress: 1 });
  for (let i = 0; i < 10; i++) mkUnit('MA-2026-004', 'T-' + pad(i + 1, 2), 'Tent ' + (i + 1), 'Luxury tent', 'tent', 28_00_000_00, 12 + i * 8.5, 40 + Math.sin(i) * 18, { passed: 0 });
  const U = code => st.units.find(u => u.code === code && u.projectId === (code.startsWith('C-') || code === 'CLB' ? 'MA-2026-001' : code.startsWith('V-') ? 'MA-2026-002' : code.startsWith('W-') ? 'MA-2025-007' : ''));
  const snag = (pid, unit, title, severity, ago, status = 'Open', vendorId = 'V09') => st.snags.push({ id: nid('SN'), projectId: pid, unitId: unit.id, title, severity, category: severity === 'Safety-critical' ? 'Safety' : 'Workmanship', vendorId, due: d(severity === 'Safety-critical' ? 1 : 10 - ago), status, by: 'u13', at: stampDaysAgo(ago, 15), fixedAt: status === 'Fixed' ? stampDaysAgo(1, 12) : null, photos: [] });
  snag('MA-2026-001', U('C-07'), 'Edge protection missing at roof level, east side', 'Safety-critical', 1);
  snag('MA-2026-002', U('V-03'), 'Honeycombing at column C2', 'Major', 5); snag('MA-2026-002', U('V-04'), 'Slab level 18 mm out at bathroom', 'Major', 3);
  ['W-04 Grout gaps at shower floor', 'W-05 Paint touch-up at skirting', 'W-06 Wardrobe door misaligned', 'W-07 Loose switch plate', 'W-09 Balcony drain slope', 'W-10 Scratch on teak door', 'W-11 AC condensate leak', 'W-13 Missing silicone at vanity', 'W-14 Tile lippage in corridor']
    .forEach((s, i) => snag('MA-2025-007', U(s.slice(0, 4)), s.slice(5), i % 4 === 2 ? 'Major' : 'Minor', 2 + i, i === 0 ? 'Fixed' : 'Open', i % 3 ? 'V11' : 'V08'));
  /* ---- handover checklists, warranties, document links ---- */
  for (const p of st.projects) st.handover[p.id] = HANDOVER_ITEMS.map(([key, label]) => ({ key, label, status: 'Open', docId: null, by: null, at: null }));
  const wDocs = [['Utility connection certificates', 'utilities'], ['WTP and STP commissioning report', 'wtp_stp'], ['Network acceptance test report', 'it'], ['Staff block completion certificate', 'staff'], ['As-built drawings set', 'asbuilt']].map(([title, key]) => {
    const doc = { id: nid('DOC'), projectId: 'MA-2025-007', title, type: 'Handover', tags: ['handover'], expiry: null, status: 'Approved', versions: [{ rev: 'R0', status: 'Approved', file: title.replace(/\W+/g, '-') + '.pdf', sizeKB: 900, at: stampDaysAgo(9, 12), by: 'u05', note: '' }], links: { tasks: [], boq: [], codes: [], units: [] } };
    st.docs.push(doc); const it = st.handover['MA-2025-007'].find(x => x.key === key); Object.assign(it, { status: 'Done', docId: doc.id, by: 'u13', at: stampDaysAgo(6, 15) }); return doc; });
  st.warranties.push({ id: nid('WR'), projectId: 'MA-2025-007', unitId: null, item: 'VRF air-conditioning system', vendorId: 'V08', start: d(-20), end: d(-20 + 365 * 5), terms: 'Compressors 5 years, parts 2 years' },
                     { id: nid('WR'), projectId: 'MA-2025-007', unitId: null, item: 'Sewage treatment plant', vendorId: 'V08', start: d(-14), end: d(-14 + 365 * 2), terms: 'Comprehensive, quarterly service' });
  st.assets.push({ id: nid('AS'), projectId: 'MA-2025-007', unitId: null, name: 'VRF outdoor units (6)', serial: 'VRF-WWR-01..06', warrantyId: st.warranties[0].id }, { id: nid('AS'), projectId: 'MA-2025-007', unitId: null, name: 'STP 50 KLD', serial: 'STP-5K-2291', warrantyId: st.warranties[1].id });
  st.docs.forEach(doc => { doc.links = doc.links || { tasks: [], boq: [], codes: [], units: [] }; });
  const ga = st.docs.find(x => x.title.startsWith('Architectural GA'));
  ga.links = { tasks: st.tasks.filter(t => t.projectId === 'MA-2026-001' && ['T06', 'T08'].includes(t.key)).map(t => t.id), boq: st.boq.filter(b => b.projectId === 'MA-2026-001' && ['03.01', '09.02'].includes(b.ref)).map(b => b.id), codes: ['03', '09'], units: [U('CLB').id] };
  /* ---- automation rules (mirror the database defaults) ---- */
  st.rules = [
    ['budget_overrun', 'Budget overrun', 'pm finance', 'in_app email', 'md', 48, true], ['critical_delay', 'Critical activity late', 'pm pd', 'in_app', 'md', 72, true],
    ['missing_report', 'Missing daily site report', 'site_sup pm', 'in_app whatsapp', 'pd', 24, false], ['material_shortage', 'Material shortage reported', 'proc pm', 'in_app whatsapp', '', 0, false],
    ['approval_requested', 'Approval waiting', '', 'in_app', 'md', 48, false], ['safety_defect', 'Safety-critical defect', 'pd quality pm', 'in_app whatsapp email', 'md', 4, true],
    ['drawing_revision', 'Drawing revision approved', 'pm qs proc site_sup', 'in_app', '', 0, false], ['contractor_bill', 'Contractor bill submitted', 'qs finance', 'in_app', '', 0, false],
    ['milestone_done', 'Critical milestone completed', 'md pd', 'in_app email', '', 0, false], ['unit_ready', 'Unit ready for handover', 'pd quality', 'in_app', '', 0, false],
    ['quality_issue', 'Quality issue raised', 'pm quality', 'in_app', '', 0, false]
  ].map(([event, name, roles, channels, escalateTo, escalateHours, risk]) => ({ event, name, roles: roles ? roles.split(' ') : [], channels: channels.split(' '), escalateTo, escalateHours, risk, enabled: true }));
  /* ---- 12 weeks of cost history (demo) ---- */
  for (const p of st.projects) {
    const c = cost(p.id).tot, L = (st.snaps[p.id] = []), drift = p.id === 'MA-2026-002' ? 0.012 : p.id === 'MA-2026-001' ? 0.004 : 0.001;
    for (let k = 11; k >= 1; k--) L.push({ date: addDays(T0, -7 * k), budget: c.budget, committed: Math.round(c.committed * Math.max(0.2, 1 - 0.035 * k)), actual: Math.round(c.actual * Math.max(0.15, 1 - 0.05 * k)), fac: Math.round(c.fac * (1 - drift * k)) });
  }
}
