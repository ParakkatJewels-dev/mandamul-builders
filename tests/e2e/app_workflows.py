"""End-to-end browser tests for the M Andamul app prototype.
Drives the 12 business workflows through the screens (clicks and form fills) as different roles,
plus negative cases. Usage: python3 tests/e2e/app_workflows.py <path-to-app-folder> [chrome-path]
Writes tests/e2e/results.json and exits 1 if any check fails."""
import asyncio, json, sys, os, threading, http.server, functools, re
from playwright.async_api import async_playwright

APP = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'app-prototype')
CHROME = sys.argv[2] if len(sys.argv) > 2 else None
PORT = 8799
R = []
def check(wf, name, ok, detail=''):
    R.append({'workflow': wf, 'name': name, 'ok': bool(ok), 'detail': str(detail)[:200]})

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=APP)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), h).serve_forever()

async def main():
    threading.Thread(target=serve, daemon=True).start()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        J = pg.evaluate
        async def wait(ms=150): await pg.wait_for_timeout(ms)
        async def login(uid): await J(f"closeModal(); S.session={{userId:'{uid}'}}; save(); render()"); await wait()
        async def go(h): await J(f"location.hash='{h}'"); await wait()
        async def toast(): t = await pg.locator('#toasts .toast').all_inner_texts(); return t[-1] if t else ''
        async def pick_site(pid='MA-2026-001'):
            if not await pg.locator('#modal input[name=lab_Mason]').count(): await pg.select_option('#modal select[data-chg=rfProject]', pid); await wait()
        async def approve(text, comment='Checked'):
            await go('approvals'); card = pg.locator('article.apc', has_text=text).first
            if not await card.count(): return 'no card'
            await card.locator('textarea[name=comment]').fill(comment); await card.locator('button[name=d][value=approve]').click(); await wait(); return await toast()

        await pg.goto(f'http://127.0.0.1:{PORT}/index.html'); await wait(500)
        a0 = await J("S.audit.length")
        # ---- sign-in with MFA
        await pg.click('button.person[data-id="u02"]'); await pg.fill('input[name=code]', '111111'); await pg.click('button:has-text("Verify")'); await wait()
        check('S Security', 'wrong MFA code is refused', 'not valid' in await toast())
        await pg.fill('input[name=code]', '246810'); await pg.click('button:has-text("Verify")'); await wait()
        check('S Security', 'MD signs in with MFA and lands on the command center', await J("location.hash") == '#dashboard')

        # ---- W1 new project (Project Director)
        await login('u03'); await go('projects'); await pg.click('button:has-text("New project")'); await wait()
        f = '#modal form'
        for n, v in [('name', 'Kovalam Boutique Hotel'), ('location', 'Kovalam, Thiruvananthapuram, Kerala'), ('district', 'Thiruvananthapuram'), ('survey', '112/4'), ('land', '3.2'), ('crz', 'CRZ-III (estimate)'), ('keys', '8'), ('sqft', '30000'), ('prefix', 'K-'), ('amen', 'Clubhouse, Spa'), ('budget', '100'), ('cv', '14,00,00,000')]:
            await pg.fill(f'{f} [name={n}]', v)
        await pg.locator(f'{f} input[name=team]').first.check(); await pg.click(f'{f} button:has-text("Create project")'); await wait()
        check('W1 New project', 'budget below ₹1 lakh is rejected', 'at least' in await toast())
        await pg.fill(f'{f} [name=budget]', '12,00,00,000'); await pg.click(f'{f} button:has-text("Create project")'); await wait(300)
        pid = (await J("location.hash")).replace('#p-', '').upper()
        check('W1 New project', 'unique project ID generated', re.match(r'^MA-\d{4}-\d{3}$', pid), pid)
        st = await J(f"(() => {{ const id='{pid}', b=S.budgets.find(x=>x.projectId===id); return {{ tasks: S.tasks.filter(t=>t.projectId===id).length, units: S.units.filter(u=>u.projectId===id).length, lines: Object.keys(b.lines).length, total: sum(Object.values(b.lines)), cont: b.lines['13'], status: b.status, ho: S.handover[id].length, folders: proj(id).folders.length, team: proj(id).team.length, ap: S.approvals.find(a=>a.ref===b.id).status }}; }})()")
        check('W1 New project', '18 activities baselined from the plan template', st['tasks'] == 18, st)
        check('W1 New project', '8 keys + 2 amenities created as units with readiness stages', st['units'] == 10)
        check('W1 New project', 'budget split into 13 cost codes, total exact, 5% contingency', st['lines'] == 13 and st['total'] == 12000000000 and st['cont'] == 600000000)
        check('W1 New project', 'document folders, handover checklist and team set up', st['folders'] == 10 and st['ho'] == 11 and st['team'] >= 3)
        check('W1 New project', 'initial budget sent for approval', st['status'] == 'Pending' and st['ap'] == 'Pending')
        check('W1 New project', 'project dashboard opens on creation', 'Kovalam Boutique Hotel' in await pg.inner_text('main'))

        # ---- W2 budget approval
        await login('u03'); t = await approve('Kovalam Boutique Hotel — initial budget')
        check('W2 Budget', 'Project Director cannot take the Finance step', t == 'no card', t)
        await login('u10'); t = await approve('Kovalam Boutique Hotel — initial budget', 'Matches feasibility')
        check('W2 Budget', 'Finance review passes the budget to the MD', 'Managing Director' in t, t)
        await login('u02'); t = await approve('Kovalam Boutique Hotel — initial budget', 'Approved')
        check('W2 Budget', 'MD approval puts budget v1 in force', await J(f"!!currentBudget('{pid}')"), t)
        await login('u08'); await go(f'p-{pid.lower()}'); await J("UI.ptab='cost'; render()"); await wait()
        await pg.click('button:has-text("Request budget revision")'); await wait()
        await pg.select_option('#modal select[name=mode]', 'transfer'); await pg.select_option('#modal select[name=from]', '13'); await pg.select_option('#modal select[name=to]', '11')
        await pg.fill('#modal input[name=amt]', '25,00,000'); await pg.fill('#modal textarea[name=reason]', 'Pool redesign moved from contingency'); await pg.click('#modal button:has-text("Send for approval")'); await wait()
        check('W2 Budget', 'QS requests a revision; current budget unchanged until approved', await J(f"currentBudget('{pid}').v") == 1 and 'sent to Finance' in await toast())

        # ---- W3 schedule
        await login('u04'); tid = await J(f"S.tasks.find(t=>t.projectId==='{pid}'&&t.key==='T01').id"); await J(f"showModal('task','{tid}')"); await wait()
        await pg.fill('#modal input[name=progress]', '40'); await pg.click('#modal button:has-text("Save update")'); await wait()
        check('W3 Schedule', 'PM updates activity progress; actual start recorded', await J(f"(t=>t.progress===40&&!!t.actStart)(S.tasks.find(t=>t.id==='{tid}'))"))
        await login('u05'); late = await J("S.tasks.find(t=>t.projectId==='MA-2025-007'&&t.key==='T11').id"); await J(f"showModal('task','{late}')"); await wait()
        await pg.fill('#modal input[name=progress]', '93'); await pg.fill('#modal textarea[name=delayReason]', ''); await pg.click('#modal button:has-text("Save update")'); await wait()
        check('W3 Schedule', 'late activity cannot be updated without a delay reason', 'delay reason' in await toast())
        await pg.fill('#modal textarea[name=delayReason]', 'Tile batch replaced after shade variation'); await pg.click('#modal button:has-text("Save update")'); await wait()
        check('W3 Schedule', 'update saved once the reason is given, and logged', await J(f"S.tasks.find(t=>t.id==='{late}').progress") == 93 and await J("S.audit[0].action") == 'Activity updated')

        # ---- W4 purchase request → quotes → PO approval
        await login('u06'); await go('procurement'); await pg.click('main button:has-text("Material request")'); await wait()
        await pg.select_option('#modal select[name=projectId]', 'MA-2026-001'); await pg.select_option('#modal select[name=code]', '09')
        await pg.fill('#modal input[name=item]', 'Teak wood door frames'); await pg.fill('#modal input[name=qty]', '40'); await pg.select_option('#modal select[name=unit]', 'nos'); await pg.click('#modal button:has-text("Submit request")'); await wait()
        mr = await J("S.mrs[S.mrs.length-1].id"); check('W4 Purchase', 'site supervisor raises a material request', 'submitted' in await toast(), mr)
        await pg.click('main button:has-text("Material request")'); await wait(); await pg.select_option('#modal select[name=projectId]', 'MA-2026-001')
        await pg.fill('#modal input[name=item]', 'Teak wood door frames'); await pg.fill('#modal input[name=qty]', '10'); await pg.click('#modal button:has-text("Submit request")'); await wait()
        check('W4 Purchase', 'duplicate request is flagged and needs a reason', await pg.locator('#modal .note.bad').count() == 1)
        await J("closeModal()")
        await login('u09'); await J(f"showModal('mr','{mr}')"); await wait(); await pg.click('#modal button:has-text("Review & request quotations")'); await wait()
        await pg.click('#modal button:has-text("Quotation")'); await wait(); await pg.select_option('#modal select[name=vendorId]', 'V06'); await pg.fill('#modal input[name=rate]', '52,000'); await pg.click('#modal button:has-text("Add quotation")'); await wait()
        await pg.click('#modal button:has-text("Compare & raise PO")'); await wait(); await pg.click('#modal button:has-text("Raise PO")'); await wait()
        po = await J(f"S.mrs.find(m=>m.id==='{mr}').poId"); steps = await J(f"S.approvals.find(a=>a.ref==='{po}').steps.map(s=>s.role).join('>')")
        check('W4 Purchase', 'PO raised from the L1 quotation with the threshold route', po and steps == 'pm>pd', f'{po} {steps}')
        await login('u04'); await approve(po); await login('u03'); await approve(po)
        check('W4 Purchase', 'PO approved after PM and PD; commitment recorded', await J(f"S.pos.find(x=>x.id==='{po}').status") == 'Approved')

        # ---- W5 goods receipt
        await login('u06'); await J(f"showModal('po','{po}')"); await wait(); await pg.click('#modal button:has-text("Record goods receipt")'); await wait()
        await pg.fill('#modal input[name=qty]', '25'); await pg.click('#modal button:has-text("Record receipt")'); await wait()
        check('W5 Receipt', 'partial receipt accepted', await J(f"S.pos.find(x=>x.id==='{po}').status") == 'Part received')
        await pg.click('#modal button:has-text("Record goods receipt")'); await wait(); await pg.fill('#modal input[name=qty]', '20'); await pg.click('#modal button:has-text("Record receipt")'); await wait()
        check('W5 Receipt', 'over-receipt is blocked', 'more than ordered' in await toast())
        await J(f"closeModal(); showModal('po','{po}')"); await wait(); mt = await pg.inner_text('#modal'); await J("closeModal()")
        check('W5 Receipt', 'site supervisor sees no prices on the order', '₹' not in mt and 'Rate' not in mt and 'Value' not in mt, mt[:120])

        # ---- W6 progress from the daily report
        await login('u06'); await go('site'); await pg.click('main button:has-text("New daily report")'); await wait(); await pick_site()
        t07 = 'MA-2026-001-T07'; cur = await J(f"S.tasks.find(t=>t.id==='{t07}').progress")
        await pg.fill('#modal input[name=lab_Mason]', '10'); await pg.fill(f'#modal input[name="to_{t07}"]', str(cur + 4)); await pg.click('#modal button[value=submit]'); await wait()
        dr = await J("S.reports[S.reports.length-1].id")
        check('W6 Progress', 'supervisor submits today\'s report', await J(f"S.reports.find(r=>r.id==='{dr}').status") == 'Submitted', dr)
        await pg.click('main button:has-text("New daily report")'); await wait(); await pick_site(); await pg.fill('#modal input[name=lab_Mason]', '3'); await pg.click('#modal button[value=submit]'); await wait()
        check('W6 Progress', 'second report for the same day is refused', 'already covers' in await toast())
        await J("closeModal()")
        check('W6 Progress', 'unverified report does not move progress', await J(f"S.tasks.find(t=>t.id==='{t07}').progress") == cur)
        await login('u04'); await approve('Daily site report — ' + await J(f"fmtDate(todayISO())"))
        check('W6 Progress', 'PM verification moves the activity to the reported progress', await J(f"S.tasks.find(t=>t.id==='{t07}').progress") == cur + 4)

        # ---- W7 contractor work certification
        wo = await J("S.contracts.find(c=>c.projectId==='MA-2026-001'&&c.code==='04').id")
        await login('u06'); await J(f"showModal('contract','{wo}')"); await wait(); await pg.click('#modal button:has-text("Record measurement")'); await wait()
        await pg.fill('#modal input[name=qty]', '12.5'); await pg.click('#modal button:has-text("Record")'); await wait()
        mid = await J("S.measurements[S.measurements.length-1].id"); check('W7 Contractor', 'supervisor records a measurement', await J(f"S.measurements.find(m=>m.id==='{mid}').status") == 'Recorded')
        await pg.click('#modal button:has-text("Record measurement")'); await wait(); await pg.fill('#modal input[name=qty]', '999999'); await pg.click('#modal button:has-text("Record")'); await wait()
        check('W7 Contractor', 'measurement beyond contract quantity is refused', 'Exceeds contract quantity' in await toast()); await J("closeModal()")
        await login('u04'); await J(f"showModal('contract','{wo}')"); await wait(); await pg.locator(f'#modal button[data-act=mVerify][data-id="{mid}"][data-ok="1"]').click(); await wait()
        check('W7 Contractor', 'a different engineer verifies it', await J(f"S.measurements.find(m=>m.id==='{mid}').status") == 'Verified')
        await login('u03'); await J(f"showModal('contract','{wo}')"); await wait(); await pg.click('#modal button:has-text("Prepare running bill")'); await wait(); await pg.click('#modal button:has-text("Submit for certification")'); await wait()
        bill = await J(f"(c=>c.bills[c.bills.length-1])(S.contracts.find(c=>c.id==='{wo}'))")
        ok = bill['netP'] == bill['grossP'] + bill['gstP'] - bill['retentionP'] - bill['advRecP'] - bill['tdsP'] - bill['otherP']
        check('W7 Contractor', 'running bill computes net = gross + GST − retention − advance − TDS', ok, {k: bill[k] for k in ['grossP', 'gstP', 'retentionP', 'advRecP', 'tdsP', 'netP']})
        for u, lbl in [('u04', 'engineer'), ('u08', 'QS'), ('u10', 'finance')]:
            await login(u); await approve(bill['id'], f'{lbl} ok')
        extra = await J(f"S.approvals.find(a=>a.ref==='{bill['id']}').steps.length")
        if extra > 3: await login('u03'); await approve(bill['id'])
        check('W7 Contractor', 'bill certified through engineer → QS → finance', await J(f"(c=>c.bills.find(b=>b.id==='{bill['id']}').status)(S.contracts.find(c=>c.id==='{wo}'))") == 'Approved')

        # ---- W8 approve and pay invoices
        await login('u10'); await J(f"showModal('bill','{bill['id']}')"); await wait(); await pg.click('#modal button:has-text("Record payment")'); await wait()
        await pg.fill('#modal input[name=ref]', 'UTR-E2E-RA'); await pg.click('#modal button:has-text("Record payment")'); await wait()
        check('W8 Invoice', 'approved contractor bill paid in full', await J(f"(c=>c.bills.find(b=>b.id==='{bill['id']}').status)(S.contracts.find(c=>c.id==='{wo}'))") == 'Paid')
        await login('u14'); await go('payments'); await J(f"UI.invPo='{po}'"); await pg.click('main button:has-text("Record vendor invoice")'); await wait()
        await pg.fill('#modal input[name=no]', 'ERN/2026/551'); await pg.fill('#modal input[name=qty]', '25'); await pg.click('#modal button:has-text("Record & match")'); await wait()
        inv = await J("S.invoices[S.invoices.length-1]")
        check('W8 Invoice', 'invoice three-way matched and sent for approval', inv['status'] == 'Pending approval' and not inv['match'], inv['id'])
        await J(f"UI.invPo='{po}'"); await pg.click('main button:has-text("Record vendor invoice")'); await wait()
        await pg.fill('#modal input[name=no]', 'ern/2026/ 551'); await pg.fill('#modal input[name=qty]', '1'); await pg.click('#modal button:has-text("Record & match")'); await wait()
        check('W8 Invoice', 'duplicate invoice number is refused', 'Duplicate' in await toast()); await J("closeModal()")
        await J(f"UI.invPo='{po}'"); await pg.click('main button:has-text("Record vendor invoice")'); await wait()
        await pg.fill('#modal input[name=no]', 'ERN/2026/560'); await pg.fill('#modal input[name=qty]', '5'); await pg.fill('#modal input[name=rate]', '54,000'); await pg.click('#modal button:has-text("Record & match")'); await wait()
        check('W8 Invoice', 'rate and quantity mismatch puts the invoice on hold', await J("S.invoices[S.invoices.length-1].status") == 'On hold')
        await login('u10'); await approve(inv['id'])
        if await J(f"S.invoices.find(i=>i.id==='{inv['id']}').status") != 'Approved': await login('u03'); await approve(inv['id'])
        check('W8 Invoice', 'invoice approved by finance (and PD above ₹5 L)', await J(f"S.invoices.find(i=>i.id==='{inv['id']}').status") == 'Approved')
        await login('u14'); await J(f"showModal('inv','{inv['id']}')"); await wait(); await pg.click('#modal button:has-text("Record payment")'); await wait(); await pg.fill('#modal input[name=ref]', 'UTR-E2E-1'); await pg.click('#modal button:has-text("Record payment")'); await wait()
        check('W8 Invoice', 'the person who booked the invoice cannot pay it', 'cannot also pay' in await toast()); await J("closeModal()")
        await login('u10'); await J(f"showModal('inv','{inv['id']}')"); await wait(); await pg.click('#modal button:has-text("Record payment")'); await wait(); await pg.fill('#modal input[name=amt]', '99,99,99,999'); await pg.fill('#modal input[name=ref]', 'UTR-E2E-2'); await pg.click('#modal button:has-text("Record payment")'); await wait()
        check('W8 Invoice', 'overpayment is refused', 'Overpayment' in await toast())
        await pg.fill('#modal input[name=amt]', await J(f"moneyInput(S.invoices.find(i=>i.id==='{inv['id']}').totalP)")); await pg.click('#modal button:has-text("Record payment")'); await wait()
        check('W8 Invoice', 'invoice paid', await J(f"S.invoices.find(i=>i.id==='{inv['id']}').status") == 'Paid')
        await go('payments'); await J("UI.paytab='paid'; render()"); await wait(); await pg.locator('main button:has-text("Reconcile")').first.click(); await wait()
        check('W8 Invoice', 'payment reconciled against the bank statement', 'Reconciled' in await toast())

        # ---- W9 financial report
        await login('u02'); await go('reports'); await J("UI.rtab='cost'; render()"); await wait()
        mt = await pg.inner_text('main')
        check('W9 Financial report', 'cost report shows the ten measures per project', all(h in mt for h in ['Original budget', 'Approved changes', 'Accrued unpaid', 'Uncommitted forecast', 'Contingency available']))
        idv = await J("S.projects.flatMap(p=>cost(p.id).lines).filter(l=>l.actual!==l.paid+l.accrued+l.retention||l.fac!==l.committed+l.etc||l.actual>l.committed).length")
        check('W9 Financial report', 'no double counting on any cost code (actual = paid + accrued + retention; forecast = committed + estimate)', idv == 0, idv)
        cash = await J("cashReq(S.projects.map(p=>p.id),90).buckets.map(b=>b.label)")
        check('W9 Financial report', 'cash requirement in 30/60/90-day buckets', len(cash) == 3, cash)
        await J("UI.rtab='hospitality'; render()"); await wait(); check('W9 Financial report', 'hospitality metrics: cost per key and FF&E per key', 'cost per key' in (await pg.inner_text('main')).lower())

        # ---- W10 villa inspection
        insp = await J("S.inspections.find(i=>i.status==='Requested'&&i.kind==='Stage'&&i.projectId==='MA-2026-001')")
        await login('u06'); await J(f"showModal('unit','{insp['unitId']}')"); await wait()
        check('W10 Inspection', 'requester cannot pass their own inspection', await pg.locator(f'#modal button[data-act=inspPass][data-id="{insp["id"]}"]').count() == 0)
        await login('u13'); await J(f"showModal('unit','{insp['unitId']}')"); await wait(); await pg.locator(f'#modal button[data-act=inspPass][data-id="{insp["id"]}"]').click(); await wait()
        check('W10 Inspection', 'quality engineer passes the stage; stage verified with reviewer and time', await J(f"(u=>{{const s=u.stages.find(x=>x.key==='{insp['stage']}');return s.status==='Passed'&&s.by==='u13'&&!!s.at}})(S.units.find(u=>u.id==='{insp['unitId']}'))"))

        # ---- W11 defects
        c02 = await J("S.units.find(u=>u.code==='C-02').id")
        await login('u06'); await J(f"UI.snagUnit='{c02}'; showModal('snagNew')"); await wait()
        await pg.fill('#modal input[name=title]', 'Open shaft without cover at level 1'); await pg.locator('#modal .segi', has_text='Safety-critical').click(); await pg.click('#modal button:has-text("Raise defect")'); await wait()
        sn = await J("S.snags[S.snags.length-1].id")
        check('W11 Defects', 'safety-critical defect blocks the unit', await J(f"readiness(S.units.find(u=>u.id==='{c02}')).status") == 'Blocked')
        await login('u04'); await go('quality'); await J("UI.snagF='safety'; render()"); await wait(); await pg.locator(f'main button[data-act=snagFix][data-id="{sn}"]').click(); await wait()
        check('W11 Defects', 'contractor fix recorded by the PM', await J(f"S.snags.find(s=>s.id==='{sn}').status") == 'Fixed')
        await J("UI.snagF='Fixed'; render()"); await wait(); btn = pg.locator(f'main button[data-act=snagClose][data-id="{sn}"]')
        if await btn.count(): await btn.click(); await wait(); t = await toast()
        else: t = 'no close button'
        check('W11 Defects', 'PM cannot close a safety-critical defect', await J(f"S.snags.find(s=>s.id==='{sn}').status") == 'Fixed' and ('handover approval rights' in t or t == 'no close button'), t)
        await login('u13'); await go('quality'); await J("UI.snagF='Fixed'; render()"); await wait(); await pg.locator(f'main button[data-act=snagClose][data-id="{sn}"]').click(); await wait()
        check('W11 Defects', 'quality engineer closes it after re-inspection; unit unblocked', await J(f"S.snags.find(s=>s.id==='{sn}').status") == 'Closed' and await J(f"readiness(S.units.find(u=>u.id==='{c02}')).status") != 'Blocked')

        # ---- W12 readiness and handover
        w01 = await J("S.units.find(u=>u.code==='W-01').id"); w04 = await J("S.units.find(u=>u.code==='W-04').id")
        check('W12 Handover', 'W-01 is Ready only because every gate and the final inspection passed', await J(f"(r=>r.status==='Ready'&&r.gates&&r.final)(readiness(S.units.find(u=>u.id==='{w01}')))"))
        check('W12 Handover', 'W-04 with civil works done but open defects is not ready', await J(f"readiness(S.units.find(u=>u.id==='{w04}')).status") != 'Ready')
        await login('u03'); await J(f"showModal('unit','{w04}')"); await wait()
        check('W12 Handover', 'no hand-over action on a unit that is not ready', await pg.locator('#modal button:has-text("Hand over unit")').count() == 0)
        await J(f"showModal('unit','{w01}')"); await wait(); await pg.click('#modal button:has-text("Hand over unit")'); await wait()
        check('W12 Handover', 'ready unit handed over', await J(f"!!S.units.find(u=>u.id==='{w01}').handedOverAt"))
        await J("UI.hoP='MA-2025-007'"); await go('handover')
        check('W12 Handover', 'final property handover blocked while units and checklist items are open', 'Blocked' in await pg.inner_text('main') and await pg.locator('main button:has-text("Record final handover")').is_disabled())

        # ---- B1 critical fixes: cancel / short-close, completing receipt, rejected PO, error guard
        await login('u09'); await go('procurement'); await J("UI.prtab='mr'; render()")
        await pg.click('main button:has-text("Material request")'); await wait(); await pg.select_option('#modal select[name=projectId]', 'MA-2026-001')
        await pg.fill('#modal input[name=item]', 'Brass door hinges'); await pg.fill('#modal input[name=qty]', '2'); await pg.click('#modal button:has-text("Submit request")'); await wait()
        mr2 = await J("S.mrs[S.mrs.length-1].id"); await J(f"showModal('mr','{mr2}')"); await wait(); await pg.click('#modal button:has-text("Review & request quotations")'); await wait()
        await pg.click('#modal button:has-text("Quotation")'); await wait(); await pg.select_option('#modal select[name=vendorId]', 'V06'); await pg.fill('#modal input[name=rate]', '10.25'); await pg.click('#modal button:has-text("Add quotation")'); await wait()
        await pg.click('#modal button:has-text("Compare & raise PO")'); await wait(); await pg.click('#modal button:has-text("Raise PO")'); await wait()
        po2 = await J(f"S.mrs.find(m=>m.id==='{mr2}').poId")
        await login('u04'); await J(f"showModal('po','{po2}')"); await wait()
        await pg.fill('#modal form[data-form=poClose] input[name=reason]', 'Hinges supplied by the door vendor'); await pg.click('#modal form[data-form=poClose] button'); await wait()
        st = await J(f"(()=>{{const x=S.pos.find(p=>p.id==='{po2}'), a=S.approvals.find(a=>a.id===x.approvalId), m=S.mrs.find(m=>m.id==='{mr2}'); return [x.status,a.status,m.status]}})()")
        check('B1 Critical fixes', 'pending order cancelled: approval withdrawn, request reopened', st == ['Cancelled', 'Withdrawn', 'Quotes received'], st)
        await login('u09'); await J(f"showModal('mr','{mr2}')"); await wait(); await pg.click('#modal button:has-text("Compare & raise PO")'); await wait(); await pg.click('#modal button:has-text("Raise PO")'); await wait()
        po3 = await J(f"S.mrs.find(m=>m.id==='{mr2}').poId"); check('B1 Critical fixes', 'the reopened request is ordered again', po3 and po3 != po2, po3)
        await login('u04'); await approve(po3)
        await login('u06')
        for q in ['1', '1']:
            await J(f"showModal('grn','{po3}')"); await wait(); await pg.fill('#modal input[name=qty]', q); await pg.click('#modal button:has-text("Record receipt")'); await wait()
        r = await J(f"(x=>[acceptedP(x), x.totalP])(S.pos.find(p=>p.id==='{po3}'))")
        check('B1 Critical fixes', 'two receipts of 1 at ₹10.25 + 18% add up to the order total exactly', r[0] == r[1], r)
        await login('u04'); po4 = await J("S.pos.find(p=>p.status==='Part received'&&hasProject(p.projectId)).id"); await J(f"showModal('po','{po4}')"); await wait()
        c0 = await J(f"(x=>poCommitP(x))(S.pos.find(p=>p.id==='{po4}'))")
        await pg.fill('#modal form[data-form=poClose] input[name=reason]', 'Balance not required'); await pg.click('#modal form[data-form=poClose] button'); await wait()
        c1 = await J(f"(x=>[x.status, poCommitP(x), acceptedP(x)])(S.pos.find(p=>p.id==='{po4}'))")
        check('B1 Critical fixes', 'short-closed order commits only what was accepted', c1[0] == 'Closed' and c1[1] == c1[2] and c1[1] < c0, [c0] + c1)
        await login('u04'); await go('dashboard'); name0 = await J("S.projects[0].name")
        await J("ACT.__boom = () => { S.projects[0].name = 'BROKEN'; throw new Error('test failure'); }; const b=document.createElement('button'); b.dataset.act='__boom'; b.id='boom'; document.querySelector('main').appendChild(b)")
        nerr = len(errs); await pg.click('#boom'); await wait()
        check('B1 Critical fixes', 'a failing action is rolled back and explained', await J("S.projects[0].name") == name0 and 'nothing was changed' in await toast())
        del errs[nerr:]   # only the deliberate failure's own log line is discarded
        # ---- security, automation, AI fallback
        await login('u06'); await go('boq'); check('S Security', 'site supervisor has no access to BOQ & budgets', 'No access' in await pg.inner_text('main'))
        await go('dashboard'); check('S Security', 'site supervisor has no access to the command center', 'No access' in await pg.inner_text('main'))
        await login('u07'); await go('projects'); check('S Security', 'supervisor of Marari cannot see Vagamon', 'Vagamon' not in await pg.inner_text('main'))
        await login('u01'); await J("UI.stab='automation'; location.hash='settings'; render()"); await wait()
        await pg.click('main button:has-text("Run checks now")'); await wait(); t1 = await toast()
        await pg.click('main button:has-text("Run checks now")'); await wait(); t2 = await toast()
        check('S Automation', 'repeat scans create no duplicate events', t2.startswith('0 new event'), f'{t1} | {t2}')
        check('S Automation', 'email and WhatsApp deliveries recorded as not configured, never as sent', await J("S.events.some(e=>e.results.some(r=>r.ch!=='in_app'&&r.status==='not configured'))&&!S.events.some(e=>e.results.some(r=>r.ch!=='in_app'&&r.status==='delivered'))"))
        check('S Automation', 'approval waits are escalated to the MD once', await J("S.notifs.some(n=>n.text.startsWith('Escalation:'))"))
        await login('u02'); await J("showModal('ask')"); await wait(); await pg.locator('#modal .chip').nth(0).click(); await wait()
        txt = await pg.inner_text('#modal')
        check('S AI', 'without the Claude runtime the assistant says so and answers presets from data', 'Data answer' in txt and 'Marari' in txt)
        # ===== Phase 3: action center, twin, finance intelligence, scores, planning, executive reports, AI, mobile =====
        await J("alertScan(); save()"); await login('u02'); await go('alerts')
        cards = pg.locator('main article.alert'); n_cards = await cards.count(); first = await cards.first.inner_text() if n_cards else ''
        check('P3 Action center', 'open alerts each show owner, urgency, records and next action', n_cards > 0 and all(k in first for k in ['Responsible', 'Urgency', 'Records', 'Next action']), f'{n_cards} cards')
        check('P3 Action center', 'no duplicate alerts: one per condition key', await J("(()=>{const k=S.alerts.filter(a=>['Open','Acknowledged'].includes(a.status)).map(a=>a.key);return k.length===new Set(k).size})()"))
        check('P3 Action center', 'a delay carried in from an open late predecessor is not alerted again (alerts go to the driving activity)', await J("""(()=>S.alerts.filter(a=>a.key.startsWith('delay:')&&['Open','Acknowledged'].includes(a.status)).every(a=>{const t=S.tasks.find(x=>x.id===a.key.slice(6)),s=sched(t.projectId);return s.R[t.id].var-Math.max(0,...t.preds.filter(x=>!s.R[x].done).map(x=>s.R[x].var))>=2}))()"""))
        check('P3 Action center', 'cost-code overruns produce at most one budget alert per project', await J("(()=>{const b=S.alerts.filter(a=>a.cat==='Budget'&&a.key.startsWith('budget:')&&a.status==='Open');return b.every(a=>a.key.split(':').length===2)&&new Set(b.map(a=>a.pid)).size===b.length})()"))
        await login('u04'); await go('alerts'); await J("UI.altab='mine'; render()"); await wait()
        ack = pg.locator('main button[data-act=alAck]').first
        if await ack.count(): await ack.click(); await wait()
        check('P3 Action center', 'the owner acknowledges an alert; it is audited and stays open until the condition clears', await J("S.alerts.some(a=>a.status==='Acknowledged'&&a.ackBy==='u04')&&S.audit.some(a=>a.action==='Alert acknowledged'&&a.userId==='u04')"))
        await J("(()=>{const a=S.alerts.find(a=>a.status==='Acknowledged'&&a.ackBy==='u04'); a.sev='Critical'; a.at=new Date(Date.now()-5*36e5).toISOString(); a.status='Open'; a.escalated=false; save()})()")
        await J("alertScan(); alertScan(); save()")
        check('P3 Action center', 'an unacknowledged critical alert escalates to the MD once', await J("(()=>{const a=S.alerts.find(a=>a.ackBy==='u04'&&a.escalated);return !!a&&S.notifs.filter(n=>n.userId==='u02'&&n.link==='alerts'&&n.text.startsWith('Escalation [Critical]: '+a.title)).length===1})()"))
        # digital twin
        await login('u02'); await J("UI.twin=null; location.hash='twin'; render()"); await wait()
        for _ in range(5):
            row = pg.locator('main tr[data-act=twinGo]')
            if not await row.count(): break
            await row.first.click(); await wait(80)
        leaf = await pg.inner_text('main')
        check('P3 Digital twin', 'drill-down Property → zone → building → floor → unit shows status, verified completion, contractor, dates, cost, defects, inspections, photos, handover',
              all(k in leaf for k in ['Verified completion', 'Contractor', 'Planned', 'Current budget', 'Open defects', 'Inspections', 'Handover']), (await pg.inner_text('nav.crumbs')).replace('\n', ' '))
        await login('u06'); await J("UI.twin=null; location.hash='twin'; render()"); await wait()
        check('P3 Digital twin', 'a site supervisor sees progress in the twin but no cost figures', '₹' not in await pg.inner_text('main') and 'Verified completion' in await pg.inner_text('main'))
        # schedule what-if
        wi = await J("""(()=>{const p='MA-2026-001',s=sched(p),t=s.tasks.find(t=>!s.R[t.id].done&&s.R[t.id].critical&&!t.milestone);const w=whatIf(p,t.id,15);return {n:t.name,max:Math.max(0,...w.map(x=>x.extra)),same:JSON.stringify(sched(p).R)===JSON.stringify(s.R)}})()""")
        check('P3 Schedule', 'what-if: a 15-day delay on a critical activity moves a dependent milestone 15 days; the live schedule is unchanged', wi['max'] == 15 and wi['same'], wi)
        # financial intelligence
        fi = await J("(()=>{const f=finIntel('MA-2026-001');const s=f.scen.map(x=>x.fc);return {ok:s.length===3&&s[0]<=s[1]&&s[1]<=s[2]&&Number.isInteger(s[0])&&s.every(Number.isInteger),names:f.scen.map(x=>x.name)}})()")
        check('P3 Finance', 'best ≤ base ≤ worst scenarios, in whole paise', fi['ok'], fi)
        await login('u02'); await J("UI.rtab='intel'; location.hash='reports'; render()"); await wait(); t_int = await pg.inner_text('main')
        check('P3 Finance', 'recorded figures are shown apart from projections, with assumptions', 'Recorded' in t_int and 'Projected' in t_int and 'assumption' in t_int.lower())
        await login('u06'); await go('reports'); t6 = await pg.inner_text('main')
        check('P3 Finance', 'roles without budget rights do not get the financial intelligence tab', 'Financial intelligence' not in t6)
        # contractor scores
        sc = await J("contractorScores(S.projects.map(p=>p.id)).map(r=>({n:r.v.name,score:r.score,cmp:r.comparable,used:r.used,cover:Math.round(r.cover)}))")
        check('P3 Contractors', 'scores are weighted from measured components; a contractor is comparable only with 4+ components and 60%+ of the weight measured',
              len(sc) > 0 and all((r['score'] is None) or (0 <= r['score'] <= 100) for r in sc) and all(r['cmp'] == (r['used'] >= 4 and r['cover'] >= 60) for r in sc) and any(not r['cmp'] for r in sc), sc)
        # procurement planning and RFQ draft
        await login('u09'); await J("UI.prtab='planning'; location.hash='procurement'; render()"); await wait()
        pos0 = await J("S.pos.length"); rfq0 = await J("(S.rfqs||[]).length")
        btn = pg.locator('main button[data-act=rfqDraft]').first
        if await btn.count(): await btn.click(); await wait()
        if await pg.locator('#modal form').count(): await pg.locator('#modal form button.primary').click(); await wait()
        check('P3 Procurement', 'planning lists demand with order-by dates; a draft RFQ is created without creating an order', await pg.locator('main table').count() > 0 and await J("(S.rfqs||[]).length") == rfq0 + 1 and await J("S.pos.length") == pos0 and await J("S.rfqs[0].status==='Draft'"))
        # executive reports: generate → review by someone else → distribute
        await login('u03'); await J("UI.rtab='exec'; UI.runId=null; location.hash='reports'; render()"); await wait()
        await pg.click('main button:has-text("Generate daily executive report")'); await wait()
        own_review = await pg.locator('main button[data-act=runReview]').count()
        rid = await J("S.reportRuns[0].id")
        await login('u02'); await J(f"UI.rtab='exec'; UI.runId='{rid}'; location.hash='reports'; render()"); await wait()
        await pg.click('main button[data-act=runReview]'); await wait(); await pg.click('main button[data-act=runSend]'); await wait()
        rr = await J("(()=>{const r=S.reportRuns[0];return {s:r.status,rev:r.reviewedBy,email:r.sent&&r.sent.email,wa:r.sent&&r.sent.wa,secs:r.sections.map(x=>x.title)}})()")
        check('P3 Reports', 'the daily report is generated as a draft, cannot be reviewed by its author, is reviewed by the MD and only then distributed', own_review == 0 and rr['s'] == 'Distributed' and rr['rev'] == 'u02', rr)
        check('P3 Reports', 'email and WhatsApp distribution shown as not configured, never as sent', rr['email'] == 'not configured' and rr['wa'] == 'not configured')
        check('P3 Reports', 'the daily report covers progress, delays, site issues, shortages, approvals, contractors and cash', all(any(k in x for x in rr['secs']) for k in ['progress', 'delays', 'site issues', 'shortages', 'approvals', 'Contractor', 'cash']), rr['secs'])
        # AI assistant: the seven management questions answered from records, read-only
        snap = await J("JSON.stringify([S.pos.length,S.approvals.length,S.budgets.length,S.payments?S.payments.length:0])")
        await login('u02'); answers = await J("ASK_PRESETS.map((q,i)=>({q, a: presetAnswer(i).replace(/<[^>]+>/g,' ')}))")
        check('P3 AI', 'all seven management questions are answered from records', len(answers) == 7 and all(len(x['a'].strip()) > 20 for x in answers), [x['q'][:30] for x in answers])
        check('P3 AI', 'answers carry record references and state assumptions where they project', '[' in answers[1]['a'] and 'Assumptions' in answers[3]['a'] and 'Method' in answers[5]['a'], answers[5]['a'][:160])
        check('P3 AI', 'asking changes nothing: no approval, payment, order or budget is created', await J("JSON.stringify([S.pos.length,S.approvals.length,S.budgets.length,S.payments?S.payments.length:0])") == snap)
        await login('u06'); a6 = await J("presetAnswer(3)")
        check('P3 AI', 'the assistant respects permissions: cost answers are refused for a site supervisor', 'restricted' in a6)
        # mobile: activity done goes into the draft report, not straight into progress
        await login('u06'); await J("UI.todayP='MA-2026-001'; location.hash='today'; render()"); await wait()
        t0 = await J("(()=>{const s=sched('MA-2026-001');const t=s.tasks.find(t=>!t.milestone&&s.R[t.id].started&&!s.R[t.id].done);return t?{id:t.id,p:t.progress}:null})()")
        if t0:
            await pg.click('main button[data-act=quickDone]'); await wait(); await pg.locator(f'#modal button[data-id="{t0["id"]}"]').click(); await wait()
        check('P3 Mobile', 'activity marked done on the phone lands in today\'s draft report; progress changes only after verification',
              t0 is not None and await J(f"todayDraft('MA-2026-001').work.some(w=>w.taskId==='{t0['id'] if t0 else ''}'&&w.to===100)") and await J(f"S.tasks.find(t=>t.id==='{t0['id'] if t0 else ''}').progress") == (t0 or {}).get('p'), t0)
        # cost memo is invalidated by every save
        cm = await J("(()=>{const a=cost('MA-2026-001').tot.committed; const x=S.pos.find(p=>p.projectId==='MA-2026-001'&&p.status==='Approved'); const old=x.status; x.status='Cancelled'; save(); const b=cost('MA-2026-001').tot.committed; x.status=old; save(); return {a,b,c:cost('MA-2026-001').tot.committed}})()")
        check('P3 Performance', 'cached cost figures refresh on every saved change', cm['b'] < cm['a'] and cm['c'] == cm['a'], cm)
        check('S Integrity', 'money stays in whole paise', await J("S.pos.every(x=>Number.isInteger(x.totalP))&&S.invoices.every(i=>Number.isInteger(i.totalP))&&S.contracts.every(c=>c.bills.every(b=>Number.isInteger(b.netP)))"))
        need = ['Signed in', 'Project created', 'Approval requested', 'Budget version live', 'Budget revision requested', 'Activity updated', 'Material request raised', 'Quotation recorded', 'Purchase order raised', 'Site report submitted', 'Progress verified', 'Measurement recorded', 'Running bill prepared', 'Invoice recorded', 'Payment recorded', 'Payment reconciled', 'Defect raised', 'Defect closed', 'Unit handed over']
        got = await J(f"S.audit.slice(0, S.audit.length - {a0}).map(a=>a.action)")
        miss = [n for n in need if n not in got]
        check('S Integrity', 'each workflow step written to the audit log with user, role and time', not miss and await J("S.audit.every(a=>a.at&&a.userId&&a.role)"), f'{len(got)} new entries; missing {miss}')
        check('S Integrity', 'no JavaScript errors during the run', not errs, errs[:3])
        await b.close()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.json')
    json.dump(R, open(out, 'w'), indent=1, ensure_ascii=False)
    wfs = []
    for r in R:
        if r['workflow'] not in wfs: wfs.append(r['workflow'])
    for w in wfs:
        rs = [r for r in R if r['workflow'] == w]; print(f"{w:22} {sum(r['ok'] for r in rs):3} passed {sum(not r['ok'] for r in rs):3} failed")
    for r in R:
        if not r['ok']: print('FAIL', r['workflow'], '|', r['name'], '|', r['detail'])
    print(f"app e2e: {sum(r['ok'] for r in R)}/{len(R)} passed")
    sys.exit(0 if all(r['ok'] for r in R) else 1)

asyncio.run(main())
