"""The app and the database must grant exactly the same permissions (audit finding B02).
Compares the prototype's role matrix with public.permission_defaults in the migrated test database.
Usage: python3 tests/consistency/permissions_match.py <app-folder> [chrome-path]   (run after scripts/db-test.sh)"""
import asyncio, functools, http.server, os, subprocess, sys, threading
from playwright.async_api import async_playwright
APP = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'app-prototype'); CHROME = sys.argv[2] if len(sys.argv) > 2 else None
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(('127.0.0.1', 8798), functools.partial(Q, directory=APP)).serve_forever, daemon=True).start()
async def ui():
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else p.chromium.launch())
        pg = await b.new_page(); await pg.goto('http://127.0.0.1:8798/index.html'); await pg.wait_for_timeout(400)
        rows = await pg.evaluate("S.roles.flatMap(r => Object.entries(r.perms).flatMap(([m, a]) => Object.entries(a).filter(([, v]) => v).map(([k]) => r.id + '|' + m + '|' + k)))")
        await b.close(); return set(rows)
app = asyncio.run(ui())
out = subprocess.run(['psql', '-h', os.environ.get('PGHOST', '/tmp'), '-p', os.environ.get('PGPORT', '5544'), '-U', 'postgres', '-d', 'mandamul_test', '-At', '-c',
                      "select role_id || '|' || module || '|' || action from permission_defaults"], capture_output=True, text=True, check=True).stdout
db = set(l for l in out.split('\n') if l)
only_app, only_db = sorted(app - db), sorted(db - app)
print(f'permissions: app {len(app)} grants, database {len(db)} grants, {len(only_app)} only in app, {len(only_db)} only in database')
for x in only_app[:20]: print('  only in app:', x)
for x in only_db[:20]: print('  only in database:', x)
sys.exit(0 if not only_app and not only_db else 1)
