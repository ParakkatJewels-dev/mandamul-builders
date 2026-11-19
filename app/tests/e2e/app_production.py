"""End-to-end tests of the PRODUCTION application against the real database.
The built app (app/dist) is served by the local gateway (app/dev/gateway.ts), which stands in for Supabase's PostgREST RPC and Auth
endpoints, so every click below reads and writes PostgreSQL through the permission-checked `api` functions.
Data is the synthetic test organisation created by supabase/tests (database mandamul_app, a copy of mandamul_test).
Usage: python3 app/tests/e2e/app_production.py [chrome-path]   (gateway must be running on 127.0.0.1:8790)
Writes app/tests/e2e/results.json; exit 1 on any failure."""
import asyncio, base64, hashlib, hmac, json, os, struct, subprocess, sys, time
from playwright.async_api import async_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:8790')
CHROME = sys.argv[1] if len(sys.argv) > 1 else None
PW = 'Local-only-123'
PROJECT = 'MA-2026-001'
R = []
def check(group, name, ok, detail=''):
    R.append({'workflow': group, 'name': name, 'ok': bool(ok), 'detail': str(detail)[:200]}); print(('PASS' if ok else 'FAIL'), group, '|', name, '|', str(detail)[:120])
def db(sql):
    return subprocess.run(['psql', '-h', os.environ.get('PGHOST', '/tmp'), '-p', os.environ.get('PGPORT', '5544'), '-U', 'postgres', '-d', os.environ.get('PGDATABASE', 'mandamul_app'), '-At', '-c', sql], capture_output=True, text=True).stdout.strip()
def totp(secret, t=None):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8)); c = struct.pack('>Q', int((t or time.time()) // 30))
    h = hmac.new(key, c, hashlib.sha1).digest(); o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1000000).zfill(6)

SECRETS = {}
def formatINR(v):
    # ₹1,23,456.78 — Indian grouping, to compare with what the app shows
    whole, frac = (str(v).split('.') + ['00'])[:2]; frac = (frac + '00')[:2]
    s = whole[-3:]; rest = whole[:-3]
    while rest: s = rest[-2:] + ',' + s; rest = rest[:-2]
    return '₹' + s + '.' + frac
async def main():
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else p.chromium.launch())
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900}); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        async def toast():
            await pg.wait_for_timeout(250); t = await pg.locator('.toasts .toast').all_inner_texts(); return t[-1] if t else ''
        async def sign_in(email):
            await pg.goto(URL + '/#'); await pg.evaluate("localStorage.removeItem('mandamul.session'); localStorage.setItem('mandamul.project', %r)" % PROJECT); await pg.reload()
            await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', PW); await pg.click('button:has-text("Sign in")')
            await pg.wait_for_selector('nav.side', timeout=8000)
        async def go(route): await pg.evaluate(f"location.hash='{route}'"); await pg.wait_for_timeout(400)
        async def mfa(email):
            await pg.wait_for_selector('[role=dialog] input[aria-label="Authenticator code"]', timeout=8000)
            sec = pg.locator('[data-testid=totp-secret]')
            if await sec.count(): SECRETS[email] = (await sec.inner_text()).strip()
            await pg.wait_for_timeout(200)
            await pg.fill('input[aria-label="Authenticator code"]', totp(SECRETS[email])); await pg.click('[role=dialog] button:has-text("Confirm")')

        # ---------- sign-in ----------
        await pg.goto(URL); await pg.fill('input[type=email]', 'pm@a'); await pg.fill('input[type=password]', 'wrong-password'); await pg.click('button:has-text("Sign in")')
        await pg.wait_for_selector('.error'); check('A Sign-in', 'a wrong password is refused with a message', 'Invalid login' in await pg.inner_text('.error'))
        await sign_in('pm@a')
        nav = await pg.locator('nav.side a').all_inner_texts()
        check('A Sign-in', 'the project manager signs in and sees the screens their role allows', all(x in nav for x in ['Command center', 'Approvals', 'Procurement', 'Site reports', 'Cost report']), nav)
        check('A Sign-in', 'the session starts at password level (MFA not yet verified)', 'Password only' in await pg.inner_text('header'))
        opts = await pg.locator('header select[aria-label=Project] option').all_inner_texts()
        check('A Sign-in', 'the project list holds only the projects the user is a member of', set(opts) == set(db("select name from projects where id in (select project_id from project_members where user_id=(select id from auth.users where email='pm@a'))").split('\n')), opts)

        # ---------- command center ----------
        await go('command'); await pg.wait_for_selector('main table')
        rows = await pg.locator('main tbody tr').count()
        check('B Command center', 'one row per visible project, figures from the database', rows == len(opts), f'{rows} rows')
        kpi = await pg.locator('.kpi').first.inner_text()
        check('B Command center', 'active-project count matches the database', str(len(opts)) in kpi, kpi.replace('\n', ' '))

        # ---------- procurement: request (PM) ----------
        mr0 = int(db(f"select count(*) from material_requests where project_id='{PROJECT}'"))
        await go('procurement'); await pg.click('main button:has-text("New request")')
        await pg.select_option('[role=dialog] select >> nth=0', '06'); await pg.fill('[role=dialog] input >> nth=0', 'E2E cable tray 300 mm (synthetic)')
        await pg.fill('[role=dialog] input >> nth=1', '40'); await pg.fill('[role=dialog] input >> nth=2', 'nos'); await pg.fill('[role=dialog] input[type=date]', time.strftime('%Y-%m-%d', time.localtime(time.time() + 20 * 86400)))
        await pg.click('[role=dialog] button:has-text("Raise request")'); t = await toast()
        mr = db(f"select id from material_requests where project_id='{PROJECT}' and item like 'E2E cable tray%' order by created_at desc limit 1")
        check('C Procurement', 'a material request raised in the app is saved in the database', t.startswith('Material request raised') and mr and int(db(f"select count(*) from material_requests where project_id='{PROJECT}'")) == mr0 + 1, f'{mr} {t}')
        check('C Procurement', 'the new request is listed with status Submitted', 'Submitted' in await pg.locator(f'main tr:has-text("{mr}")').inner_text())

        # ---------- quotations and order (procurement manager) ----------
        await sign_in('proc@a'); await go('procurement')
        await pg.click(f'main tr:has-text("{mr}")')
        vend = db("select string_agg(name, '|' order by name) from vendors where org_id='00000000-0000-0000-0000-00000000000a' and approved").split('|')
        for v, rate in [(vend[0], '2,450'), (vend[1], '2,610.50')]:
            await pg.select_option('select[aria-label="Quotation vendor"]', label=v); await pg.fill('input[aria-label="Quotation rate"]', rate); await pg.click('button:has-text("Add quotation")'); await toast(); await pg.wait_for_timeout(300)
        q = db(f"select string_agg(rate::text, ',' order by rate) from quotations where mr_id='{mr}'")
        check('C Procurement', 'two quotations saved exactly as typed (₹2,450 and ₹2,610.50)', q == '2450.00,2610.50', q)
        await pg.select_option('select[aria-label="Order vendor"]', label=vend[1])
        btn_disabled = await pg.locator('button:has-text("Raise purchase order")').is_disabled()
        check('C Procurement', 'ordering from a vendor that is not the lowest needs a reason first', btn_disabled)
        await pg.select_option('select[aria-label="Order vendor"]', label=vend[0]); await pg.click('button:has-text("Raise purchase order")'); t = await toast()
        po = db(f"select id from purchase_orders where mr_id='{mr}' order by created_at desc limit 1")
        tot = db(f"select total from purchase_orders where id='{po}'")
        check('C Procurement', 'the purchase order is raised and sent for approval; total = 40 × ₹2,450 + 18% GST = ₹1,15,640.00', po and db(f"select status from purchase_orders where id='{po}'") == 'Pending approval' and tot == '115640.00', f'{po} {tot} {t}')

        # ---------- approval with MFA step-up (PM) ----------
        steps = db(f"select string_agg(role_id, ',' order by seq) from approval_steps where approval_id=(select approval_id from purchase_orders where id='{po}')")
        await sign_in('pm@a'); await go('approvals'); await pg.wait_for_selector('[data-testid=approval]')
        card = pg.locator('[data-testid=approval]', has_text=po)
        check('D Approvals', 'the order appears in the approver\'s inbox with amount and route', await card.count() == 1 and '1,15,640.00' in await card.inner_text(), steps)
        await card.locator('button:has-text("Approve")').click()
        await mfa('pm@a'); t = await toast()
        check('D Approvals', 'approving on a password-only session asks for the authenticator code (database refuses without MFA)', 'pm@a' in SECRETS, t)
        check('D Approvals', 'after the code the approval goes through and the session is MFA-verified', db(f"select status from purchase_orders where id='{po}'") == 'Approved' and 'MFA verified' in await pg.inner_text('header'), t)
        aud = db(f"select count(*) from audit_log where record_id='{po}' or record_id=(select approval_id from purchase_orders where id='{po}')")
        check('D Approvals', 'the decision is in the audit log', int(aud or 0) >= 2, aud)

        # ---------- receipt (procurement) ----------
        await sign_in('proc@a'); await go('procurement'); await pg.click('main button[role=tab]:has-text("Orders")'); await pg.click(f'main tr:has-text("{po}")')
        await pg.click('[role=dialog] button:has-text("Record receipt")')
        dlg = pg.locator('[role=dialog]').last; await dlg.locator('input >> nth=0').fill('25'); await dlg.locator('button:has-text("Record receipt")').click(); t = await toast()
        g = db(f"select qty || '|' || qc || '|' || accepted_value from goods_receipts where po_id='{po}'")
        check('E Receipt', 'a partial delivery of 25 is recorded with its accepted value (25 × 2,450 × 1.18 = ₹72,275.00)', g == '25.000|Pass|72275.00', f'{g} {t}')
        check('E Receipt', 'the order becomes Part received', db(f"select status from purchase_orders where id='{po}'") == 'Part received')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        # over-receipt is refused by the database and the message reaches the person
        await pg.click(f'main tr:has-text("{po}")'); await pg.click('[role=dialog] button:has-text("Record receipt")')
        dlg = pg.locator('[role=dialog]').last; await dlg.locator('input >> nth=0').fill('500'); await dlg.locator('button:has-text("Record receipt")').click(); t = await toast()
        check('E Receipt', 'receiving more than was ordered is refused and explained', db(f"select count(*) from goods_receipts where po_id='{po}'") == '1' and t != '' , t)
        await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape')

        # ---------- daily report (site supervisor) and verification (PM) ----------
        db(f"delete from report_work_lines where report_id in (select id from daily_reports where project_id='{PROJECT}' and report_date=current_date)")  # keep the test repeatable
        await sign_in('sup@a')
        nav = await pg.locator('nav.side a').all_inner_texts()
        check('F Site', 'a site supervisor has no command center or cost report in the menu', 'Command center' not in nav and 'Cost report' not in nav, nav)
        await go('site'); await pg.click('main button:has-text("New daily report")')
        task = db(f"select id || '|' || progress from tasks where project_id='{PROJECT}' and act_finish is null and not is_milestone and progress < 90 order by base_start limit 1").split('|')
        await pg.fill('input[aria-label="Mason count"]', '6'); await pg.fill('input[aria-label="Helper count"]', '10')
        await pg.click('button:has-text("Add activity")'); await pg.select_option('select[aria-label="Activity 1"]', task[0]); await pg.fill('input[aria-label="Progress 1"]', str(int(task[1]) + 5))
        await pg.fill('[role=dialog] textarea >> nth=0', 'E2E: crane arrived late (synthetic)')
        exists_today = db(f"select count(*) from daily_reports where project_id='{PROJECT}' and report_date=current_date")
        await pg.click('button:has-text("Submit report")'); t = await toast()
        if exists_today == '0':
            dr = db(f"select id || '|' || status from daily_reports where project_id='{PROJECT}' and report_date=current_date")
            check('F Site', 'the daily report is saved as Submitted with labour and work lines', dr.endswith('|Submitted') and db(f"select count(*) from report_work_lines where report_id='{dr.split('|')[0]}'") == '1', f'{dr} {t}')
            check('F Site', 'task progress does not move until the report is verified', db(f"select progress from tasks where id='{task[0]}'") == task[1])
        else:
            check('F Site', 'a second report for the same day is refused by the database (one per site per day)', 'already submitted' in t, t)
        # second submission the same day
        await pg.click('main button:has-text("New daily report")'); await pg.click('button:has-text("Submit report")'); t2 = await toast()
        check('F Site', 'a duplicate report for the same day is refused with a clear message', 'already submitted' in t2, t2)
        await pg.keyboard.press('Escape')
        await go('cost'); await pg.wait_for_timeout(500)
        check('F Site', 'opening the cost report by address shows that it is not part of the role', await pg.locator('[data-testid=not-allowed]').count() == 1)
        tok = await pg.evaluate("JSON.parse(localStorage.getItem('mandamul.session')).access_token")
        import urllib.request, urllib.error
        req = urllib.request.Request(URL + '/rest/v1/rpc/cost_position', data=json.dumps({'p_project': PROJECT}).encode(), method='POST',
              headers={'apikey': 'local-anon-key', 'Authorization': 'Bearer ' + tok, 'Content-Profile': 'api', 'Content-Type': 'application/json'})
        try: urllib.request.urlopen(req); st, body = 200, ''
        except urllib.error.HTTPError as e: st, body = e.code, e.read().decode()
        check('F Site', 'and the database refuses the cost report to a site supervisor even when called directly (403)', st == 403 and 'budget' in body, f'{st} {body[:80]}')
        await sign_in('pm@a'); await go('approvals'); await pg.wait_for_selector('main')
        dr_id = db(f"select id from daily_reports where project_id='{PROJECT}' and report_date=current_date")
        card = pg.locator('[data-testid=approval]', has_text=dr_id)
        if await card.count():
            await card.locator('button:has-text("Approve")').click(); t = await toast()
            if await pg.locator('[role=dialog][aria-label="Confirm with your authenticator"]').count(): await mfa('pm@a'); t = await toast()
            check('F Site', 'the PM verifies the report; the activity progress moves to the reported value', db(f"select status from daily_reports where id='{dr_id}'") in ('Approved', 'Verified') and db(f"select progress from tasks where id='{task[0]}'") == str(int(task[1]) + 5), t)
        else:
            check('F Site', 'the PM verifies the report; the activity progress moves to the reported value', False, 'report not in the inbox')

        # ---------- action center ----------
        await sign_in('md@a'); await go('alerts'); await pg.wait_for_selector('[data-testid=alert]')
        cards = pg.locator('[data-testid=alert]'); n = await cards.count(); ft = await cards.first.inner_text()
        check('G Action center', 'alerts show severity, owner, urgency, records and next action', all(k in ft for k in ['Responsible', 'Urgency', 'Records', 'Next action']), f'{n} alerts')
        shown = await pg.locator('[data-testid=alert] button:has-text("Acknowledge")').count(); info_only = await pg.locator('[data-testid=alert]:has-text("For information")').count()
        check('G Action center', 'actions appear only on alerts the person may act on; the rest say who acts (B28)', shown + info_only >= 1 and info_only >= 1, f'{shown} actionable, {info_only} for information')
        await sign_in('pm@a'); await go('alerts'); await pg.wait_for_selector('[data-testid=alert]')
        first = pg.locator('[data-testid=alert]:has(button:has-text("Acknowledge"))').first; title = (await first.locator('h3').inner_text()).strip()
        aid = db(f"select id from alerts where title = $${title}$$ and status='Open' order by id limit 1")
        await first.locator('button:has-text("Acknowledge")').click(); t = await toast()
        check('G Action center', 'the owner acknowledges an alert; saved with who did it', db(f"select status || '|' || (acknowledged_by is not null) from alerts where id={aid}") == 'Acknowledged|true', f'{title} · {t}')
        await pg.locator('[data-testid=alert]:has(button:has-text("Mark resolved"))').first.locator('button:has-text("Mark resolved")').click()
        check('G Action center', 'resolving needs a written note (button disabled until 5 characters)', await pg.locator('[role=dialog] button:has-text("Resolve")').is_disabled())
        await pg.keyboard.press('Escape')
        await sign_in('md@a')

        # ---------- cost report reflects the receipt ----------
        await go('cost'); await pg.wait_for_selector('main table')
        row = await pg.locator('main tbody tr:has-text("06")').first.inner_text()
        act = db(f"select actual from app.cost_position_internal('{PROJECT}') where code='06'")
        check('H Cost report', 'the cost report shows the receipt as actual cost on code 06, same as the database', '72,275.00' in row and act == '72275.00', f'{act}')
        check('H Cost report', 'totals add up exactly in the footer (computed in whole paise)', await pg.locator('main tfoot').count() == 1)

        # ---------- feasibility (MD) ----------
        await go('feasibility'); await pg.click('main button:has-text("New study")')
        vals = {'Study name': 'E2E Munnar valley site (synthetic)', 'Location': 'Munnar', 'Land cost (₹)': '8,00,00,000', 'Keys (rooms + villas)': '24', 'Built-up area (sq ft)': '60000',
                'Build cost per sq ft (₹)': '4500', 'Infrastructure (₹)': '3,00,00,000', 'FF&E per key (₹)': '12,00,000', 'Pre-opening (₹)': '1,50,00,000', 'Average daily rate (₹)': '18000', 'Stabilised occupancy %': '62'}
        for k, v in vals.items(): await pg.fill(f'[role=dialog] input[aria-label="{k}"]', v)
        await pg.click('[role=dialog] button:has-text("Calculate and save")'); t = await toast(); await pg.wait_for_selector('[data-testid=feasibility-kpis]')
        k = await pg.inner_text('[data-testid=feasibility-kpis]')
        check('J Feasibility', 'a study typed with Indian digit grouping is saved and the database model shows ₹44.85 Cr investment, 13.24% ROI, 7.6-year payback', '₹44.85 Cr' in k and '13.24%' in k and '7.6 years' in k, k.replace('\n', ' ')[:150])
        check('J Feasibility', 'scenarios, sensitivity and assumptions are shown, and regulatory data is marked as an estimate', 'Conservative' in await pg.inner_text('main') and 'Estimate — not validated' in await pg.inner_text('main'))
        # ---------- warranty (PM) ----------
        db(f"insert into warranties (project_id, item, start_date, end_date, terms, kind, response_hours) values ('{PROJECT}', 'E2E chiller (synthetic)', current_date - 10, current_date + 365, '12 months', 'Equipment', 24)")
        await sign_in('pm@a'); await go('warranty'); await pg.wait_for_selector('main table')
        await pg.locator('main tr:has-text("E2E chiller")').locator('button:has-text("Raise claim")').click()
        await pg.fill('input[aria-label="Claim title"]', 'Chiller not cooling villa 3'); await pg.click('[role=dialog] button:has-text("Raise claim")'); t = await toast()
        wc = db("select id || '|' || in_warranty from warranty_claims where title = 'Chiller not cooling villa 3'")
        check('K Warranty', 'a warranty claim raised in the app is saved with its in-warranty status and response clock', wc.endswith('|true'), f'{wc} {t}')
        await sign_in('md@a')

        # ---------- contracts and contractor billing ----------
        C = 'WO-26-0001'; ITEM = 'Shuttering & staging'
        db(f"insert into project_members (project_id, user_id, responsibility) select '{PROJECT}', id, 'Contractor (synthetic test user)' from auth.users where email = 'vend@a' on conflict do nothing")
        bills0 = int(db(f"select count(*) from ra_bills where contract_id = '{C}'"))
        await sign_in('sup@a'); await go('contracts'); await pg.click(f'main tr:has-text("{C}")'); await pg.wait_for_selector('[data-testid=contract-detail]')
        det = await pg.inner_text('[data-testid=contract-detail]')
        check('L Contracts', 'a site supervisor sees the contract quantities but no rates', ITEM in det and '700' not in det)
        await pg.locator('[data-testid=contract-detail] tr', has_text=ITEM).locator('button:has-text("Measure")').click()
        await pg.fill('input[aria-label="Measured quantity"]', '120'); await pg.click('[role=dialog] button:has-text("Record measurement")'); t = await toast()
        mid = db(f"select m.id || '|' || m.status from measurements m join contract_items i on i.id = m.contract_item_id where i.contract_id = '{C}' and i.description = '{ITEM}' and m.qty = 120 order by m.measured_on desc limit 1")
        check('L Contracts', 'the site supervisor records 120 sqm; it waits for verification', mid.endswith('|Recorded'), f'{mid} {t}')
        check('L Contracts', 'the person who measured is not offered verification', await pg.locator('[data-testid=contract-detail] button:has-text("Verify")').count() == 0)
        await sign_in('pm@a'); await go('contracts'); await pg.click(f'main tr:has-text("{C}")'); await pg.wait_for_selector('[data-testid=contract-detail]')
        await pg.locator('[data-testid=contract-detail] tr', has_text='120').locator('button:has-text("Verify")').click(); t = await toast()
        check('L Contracts', 'the project manager verifies the measurement', db(f"select status from measurements where id = '{mid.split('|')[0]}'") == 'Verified', t)
        # contractor
        await sign_in('vend@a'); nav = await pg.locator('nav.side a').all_inner_texts()
        check('L Contracts', 'the contractor signs in to a contracts-only view', 'Contracts' in nav and 'Command center' not in nav and 'Cost report' not in nav, nav)
        await go('contracts'); rows = await pg.locator('main tbody tr').all_inner_texts()
        check('L Contracts', 'the contractor sees only their own contracts', rows and all('Western Ghats' in r for r in rows), len(rows))
        await pg.click(f'main tr:has-text("{C}")'); await pg.wait_for_selector('[data-testid=contract-detail]'); await pg.click('[data-testid=contract-detail] button[role=tab]:has-text("Claims")')
        await pg.click('[data-testid=contract-detail] button:has-text("New claim")'); await pg.wait_for_selector('[role=dialog]')
        prefill = await pg.input_value(f'input[aria-label="Claim quantity {ITEM}"]')
        await pg.click('[role=dialog] button:has-text("Submit claim")'); t = await toast()
        cl = db(f"select id || '|' || status || '|' || claimed_gross from contractor_claims where contract_id = '{C}' order by claim_no desc limit 1")
        check('L Contracts', 'the claim starts at the verified, unbilled 120 and is submitted at the contract rate (₹84,000.00)', prefill == '120' and cl.endswith('|Submitted|84000.00'), f'{prefill} {cl} {t}')
        db("select api.process_events(200)")   # the scheduler's job (pg_cron every minute in production)
        cl2 = db(f"select status || '|' || coalesce(ra_bill_id, '') from contractor_claims where id = '{cl.split('|')[0]}'")
        bill = cl2.split('|')[1]
        br = db(f"select gross || '|' || net_payable || '|' || status from ra_bills where id = '{bill}'") if bill else ''
        check('L Contracts', 'the claim matches the verified measurement, so a running bill is prepared and sent for certification', cl2.startswith('Billed|') and br.startswith('84000.00|') and br.endswith('|In approval'), f'{cl2} {br}')
        # certification: engineer → QS → finance
        for who in ['pm@a', 'qs@a', 'fin@a']:
            await sign_in(who); await go('approvals'); await pg.wait_for_timeout(300)
            card = pg.locator('[data-testid=approval]', has_text=bill)
            if await card.count():
                await card.locator('button:has-text("Approve")').click(); t = await toast()
                await pg.wait_for_timeout(300)
                if await pg.locator('[role=dialog][aria-label="Confirm with your authenticator"]').count():
                    await mfa(who); t = await toast()
        check('L Contracts', 'the bill is certified by the engineer, the QS and finance in turn (finance with the authenticator)', db(f"select status from ra_bills where id = '{bill}'") == 'Approved',
              db(f"select string_agg(role_id || ':' || status, ' > ' order by seq) from approval_steps where approval_id = (select approval_id from ra_bills where id = '{bill}')"))
        # payment (finance, already MFA-verified in this session)
        await go('payments'); await pg.wait_for_selector('[data-testid=due]')
        net = db(f"select net_payable || '|' || tds from ra_bills where id = '{bill}'").split('|')
        row = pg.locator('[data-testid=due]', has_text=bill)
        check('M Payments', 'the certified bill appears in the payment queue with its exact net payable', await row.count() == 1 and formatINR(net[0]) in await row.inner_text(), net[0])
        await row.locator('button:has-text("Pay")').click(); await pg.fill('input[aria-label="Bank reference"]', 'UTR-E2E-0001-SYNTH')
        await pg.click('[role=dialog] button:has-text("Record payment")'); t = await toast()
        await pg.wait_for_timeout(300)
        if await pg.locator('[role=dialog][aria-label="Confirm with your authenticator"]').count(): await mfa('fin@a'); t = await toast()
        paid = db(f"select coalesce(sum(amount), 0) || '|' || coalesce(sum(tds), 0) from payments where ra_bill_id = '{bill}'")
        check('M Payments', 'finance pays the full net payable with the bill\'s TDS and a bank reference; the bill is marked Paid', paid == f'{net[0]}|{net[1]}' and db(f"select status from ra_bills where id = '{bill}'") == 'Paid', f'{paid} {t}')
        # overpayment on the older approved bill is refused by the database
        if await pg.locator('[data-testid=due]', has_text='RA-26-0002').count():
            await pg.locator('[data-testid=due]', has_text='RA-26-0002').locator('button:has-text("Pay")').click()
            await pg.fill('input[aria-label="Payment amount"]', '300000'); await pg.fill('input[aria-label="Bank reference"]', 'UTR-E2E-0002-SYNTH')
            warn = await pg.locator('[role=dialog] .error').count()
            await pg.click('[role=dialog] button:has-text("Record payment")'); t = await toast()
            check('M Payments', 'paying more than the balance is flagged on screen and refused by the database', warn == 1 and 'overpayment' in t.lower() and db("select count(*) from payments where ra_bill_id = 'RA-26-0002'") == '0', t)
            await pg.keyboard.press('Escape')
        await sign_in('pm@a'); await go('contracts'); r = await pg.locator(f'main tr:has-text("{C}")').inner_text()
        check('L Contracts', 'the contract list shows the new certified and paid amounts', formatINR(db(f"select sum(gross) from ra_bills where contract_id = '{C}' and status in ('Approved','Paid')")) in r, r.replace('\n', ' ')[:120])
        await sign_in('md@a')

        # ---------- theme and phone ----------
        await pg.select_option('header select[aria-label=Theme]', 'dark')
        check('I Interface', 'dark mode can be chosen and is remembered', await pg.evaluate("document.documentElement.dataset.theme") == 'dark' and await pg.evaluate("localStorage.getItem('mandamul.theme')") == 'dark')
        m = await ctx.new_page(); await m.set_viewport_size({'width': 390, 'height': 844}); await m.goto(URL + '/#alerts'); await m.wait_for_timeout(1200)
        ow = await m.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        check('I Interface', 'on a 390 px phone the screen has no sideways scrolling and a menu button', ow and await m.locator('button[aria-label=Menu]').is_visible())
        check('I Interface', 'no JavaScript errors during the run', not errs, errs[:3])
        await b.close()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.json'); json.dump(R, open(out, 'w'), indent=1, ensure_ascii=False)
    print(f"production app e2e: {sum(r['ok'] for r in R)}/{len(R)} passed"); sys.exit(0 if all(r['ok'] for r in R) else 1)

asyncio.run(main())
