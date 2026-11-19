// LOCAL DEVELOPMENT AND TEST ONLY — never deploy.
// A small stand-in for the two Supabase services the application uses, so the real application can be run and tested
// against the real local database without network access:
//   * PostgREST RPC:  POST /rest/v1/rpc/<function>   (schema `api` via the Content-Profile header, JSON named arguments)
//   * GoTrue (Auth):  password sign-in, refresh, user, TOTP factor enrol / challenge / verify (raises the session to aal2), logout
// Responses follow the shapes of the hosted services so the same application code runs against Supabase unchanged.
// Every database call runs as the `authenticated` role with the caller's JWT claims, exactly like PostgREST, so
// row-level security and the permission checks inside the `api` functions apply.
import { SQL } from 'bun';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8790);
const DB = process.env.PGDATABASE || 'mandamul_app';
const DIST = process.env.DIST || new URL('../dist/', import.meta.url).pathname;
const JWT_SECRET = process.env.LOCAL_JWT_SECRET || 'local-only-secret-never-use-in-production';
const DEV_PASSWORD = process.env.LOCAL_PASSWORD || 'Local-only-123';   // every local test user shares it; the hosted project uses real Auth
const ANON_KEY = 'local-anon-key';
const PGHOST = process.env.PGHOST || '/tmp', PGPORT = Number(process.env.PGPORT || 5544);
const sql = PGHOST.startsWith('/')
  ? new SQL({ path: `${PGHOST}/.s.PGSQL.${PGPORT}`, username: 'postgres', database: DB, max: 8 })
  : new SQL({ hostname: PGHOST, port: PGPORT, username: 'postgres', password: process.env.PGPASSWORD, database: DB, max: 8 });

// ---------- JWT (HS256) and TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----------
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
function signJwt(claims: Record<string, unknown>) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verifyJwt(token: string): Record<string, any> | null {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s || createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
  return c.exp && c.exp * 1000 < Date.now() ? null : c;
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s: string) { let bits = '', out: number[] = []; for (const ch of s.replace(/=+$/, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret: string, t = Date.now()) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', b32decode(secret)).update(c).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

// ---------- in-memory auth state (local only) ----------
type Factor = { id: string; secret: string; status: 'unverified' | 'verified'; created_at: string };
const factors = new Map<string, Factor[]>();                    // user id → factors
const refresh = new Map<string, { sub: string; email: string; aal: string }>();
const challenges = new Map<string, { factor: string; exp: number }>();

function session(sub: string, email: string, aal: 'aal1' | 'aal2') {
  const now = Math.floor(Date.now() / 1000), exp = now + 3600, rt = randomBytes(24).toString('hex');
  refresh.set(rt, { sub, email, aal });
  const access_token = signJwt({ sub, email, role: 'authenticated', aud: 'authenticated', aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }], iat: now, exp });
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user: userJson(sub, email) };
}
const userJson = (id: string, email: string) => ({ id, email, aud: 'authenticated', role: 'authenticated', factors: (factors.get(id) || []).map(f => ({ id: f.id, factor_type: 'totp', status: f.status, created_at: f.created_at })) });
const json = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const authErr = (msg: string, status = 400, code = 'invalid_credentials') => json({ code, error: code, error_description: msg, msg }, status);

async function auth(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace('/auth/v1', '');
  const body: any = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (path === '/token' && url.searchParams.get('grant_type') === 'password') {
    const [u] = await sql`select u.id::text id, u.email from auth.users u join profiles p on p.user_id = u.id where lower(u.email) = lower(${String(body.email || '')}) and p.active`;
    if (!u || body.password !== DEV_PASSWORD) return authErr('Invalid login credentials');
    return json(session(u.id, u.email, 'aal1'));
  }
  if (path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const r = refresh.get(String(body.refresh_token || '')); if (!r) return authErr('Invalid Refresh Token', 400, 'refresh_token_not_found');
    refresh.delete(String(body.refresh_token)); return json(session(r.sub, r.email, r.aal as 'aal1' | 'aal2'));
  }
  const claims = verifyJwt((req.headers.get('authorization') || '').replace(/^Bearer /, ''));
  if (!claims) return authErr('invalid JWT', 401, 'bad_jwt');
  if (path === '/user' && req.method === 'GET') return json(userJson(claims.sub, claims.email));
  if (path === '/logout') { return new Response(null, { status: 204 }); }
  if (path === '/factors' && req.method === 'POST') {
    const f: Factor = { id: randomUUID(), secret: Array.from(randomBytes(20)).map(b => B32[b % 32]).join(''), status: 'unverified', created_at: new Date().toISOString() };
    factors.set(claims.sub, [...(factors.get(claims.sub) || []).filter(x => x.status === 'verified'), f]);
    const uri = `otpauth://totp/M%20Andamul:${encodeURIComponent(claims.email)}?secret=${f.secret}&issuer=M%20Andamul`;
    return json({ id: f.id, type: 'totp', friendly_name: body.friendly_name || 'Authenticator', totp: { secret: f.secret, uri, qr_code: '' } });
  }
  const m = path.match(/^\/factors\/([0-9a-f-]+)\/(challenge|verify)$/);
  if (m && req.method === 'POST') {
    const f = (factors.get(claims.sub) || []).find(x => x.id === m[1]); if (!f) return authErr('Factor not found', 404, 'mfa_factor_not_found');
    if (m[2] === 'challenge') { const id = randomUUID(); challenges.set(id, { factor: f.id, exp: Date.now() + 300_000 }); return json({ id, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }); }
    const ch = challenges.get(String(body.challenge_id)); if (!ch || ch.factor !== f.id || ch.exp < Date.now()) return authErr('Challenge expired', 400, 'mfa_challenge_expired');
    const code = String(body.code || ''), ok = [0, -30000, 30000].some(d => totp(f.secret, Date.now() + d) === code);
    if (!ok) return authErr('Invalid TOTP code entered', 422, 'mfa_verification_failed');
    challenges.delete(String(body.challenge_id)); f.status = 'verified';
    return json(session(claims.sub, claims.email, 'aal2'));
  }
  return authErr('not supported by the local gateway', 404, 'not_found');
}

// ---------- PostgREST-style RPC ----------
const argCache = new Map<string, { names: string[]; types: string[]; set: boolean; void: boolean }>();
async function signature(fn: string) {
  if (argCache.has(fn)) return argCache.get(fn)!;
  const [r] = await sql`select p.proargnames names, array(select format_type(t, null) from unnest(p.proargtypes) t) types, p.proretset rs,
                               format_type(p.prorettype, null) = 'void' isvoid, p.pronargs n
                          from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'api' and p.proname = ${fn}`;
  if (!r) return null;
  const sig = { names: (r.names || []).slice(0, r.n), types: r.types, set: r.rs, void: r.isvoid };
  argCache.set(fn, sig); return sig;
}
function pgError(e: any) {
  const code = e?.errno || e?.code || 'XX000', message = e?.message || String(e);
  const status = code === '42501' ? 403 : code === '23505' ? 409 : code === 'P0003' ? 409 : code === 'PGRST202' ? 404 : 400;
  return json({ code, message, details: e?.detail || null, hint: e?.hint || null }, status);
}
async function rpc(req: Request, fn: string): Promise<Response> {
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return json({ code: 'PGRST202', message: 'bad function name' }, 404);
  if ((req.headers.get('content-profile') || 'public') !== 'api') return json({ code: 'PGRST106', message: 'The schema must be one of the following: api' }, 406);
  if (req.headers.get('apikey') !== ANON_KEY) return json({ message: 'Invalid API key' }, 401);
  const claims = verifyJwt((req.headers.get('authorization') || '').replace(/^Bearer /, ''));
  if (!claims) return json({ code: 'PGRST301', message: 'JWT expired or invalid' }, 401);
  const sig = await signature(fn); if (!sig) return json({ code: 'PGRST202', message: `Could not find the function api.${fn}` }, 404);
  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const parts: string[] = [];
  for (const k of Object.keys(body)) {
    const i = sig.names.indexOf(k); if (i < 0) return json({ code: 'PGRST202', message: `api.${fn} has no argument ${k}` }, 404);
    const t = sig.types[i];
    parts.push(`${k} => ${t === 'jsonb' ? `($1::text::jsonb -> '${k}')` : t.endsWith('[]') ? `(select array_agg(x) from jsonb_array_elements_text($1::text::jsonb -> '${k}') x)::${t}` : `($1::text::jsonb ->> '${k}')::${t}`}`);
  }
  const call = `api.${fn}(${parts.join(', ')})`;
  const q = sig.void ? `select ${call} is null as _` : sig.set ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as v from ${call} r` : `select to_jsonb(${call}) as v`;
  try {
    const out = await sql.begin(async tx => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('request.jwt.claim.sub', ${claims.sub}, true)`;
      await tx.unsafe('set local role authenticated');
      const rows = parts.length ? await tx.unsafe(q, [JSON.stringify(body)]) : await tx.unsafe(q);
      return sig.void ? undefined : rows[0]?.v;
    });
    return sig.void ? new Response(null, { status: 204 }) : json(out ?? null);
  } catch (e) { return pgError(e); }
}

// ---------- static files ----------
async function file(url: URL) {
  if (url.pathname === '/env.json') return json({ supabaseUrl: url.origin, anonKey: ANON_KEY, environment: 'local' });
  const p = url.pathname === '/' || !url.pathname.includes('.') ? 'index.html' : url.pathname.slice(1);
  const f = Bun.file(DIST + p.replace(/\.\./g, ''));
  return (await f.exists()) ? new Response(f) : new Response('not found', { status: 404 });
}

Bun.serve({
  port: PORT, hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/auth/v1/')) return await auth(req, url);
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
      if (m && req.method === 'POST') return await rpc(req, m[1]);
      if (url.pathname.startsWith('/rest/v1/')) return json({ message: 'only RPC is used by this application' }, 404);
      return await file(url);
    } catch (e) { return json({ message: String(e) }, 500); }
  },
});
console.log(`local gateway on http://127.0.0.1:${PORT} (database ${DB}) — LOCAL ONLY`);
