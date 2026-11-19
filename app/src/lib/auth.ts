// Supabase Auth (GoTrue) over HTTP: password sign-in, refresh, TOTP multi-factor step-up.
// The same calls work against the hosted project and the local gateway.
import { config } from './config';

export type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } };
export type Factor = { id: string; factor_type: string; status: 'verified' | 'unverified' };
const KEY = 'mandamul.session';

export class AuthError extends Error { constructor(message: string, public code = 'auth') { super(message); } }

let current: Session | null = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
const listeners = new Set<(s: Session | null) => void>();
function set(s: Session | null) {
  current = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage unavailable: session lives in memory */ }
  listeners.forEach(f => f(s));
}
export const onSession = (f: (s: Session | null) => void) => { listeners.add(f); return () => listeners.delete(f); };
export const getSession = () => current;

export function claims(s: Session | null = current): Record<string, any> {
  if (!s) return {};
  try { return JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
export const aal = (s: Session | null = current) => (claims(s).aal as string) || 'aal1';

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const { supabaseUrl, anonKey } = await config();
  const res = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...init,
    headers: { apikey: anonKey, 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers || {}) },
  });
  const text = await res.text(); const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new AuthError(body?.msg || body?.error_description || body?.message || `Sign-in service error ${res.status}`, body?.code || body?.error_code || String(res.status));
  return body;
}
const keep = (b: any): Session => ({ access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at || Math.floor(Date.now() / 1000) + (b.expires_in || 3600), user: { id: b.user?.id, email: b.user?.email } });

export async function signIn(email: string, password: string) {
  const b = await call('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
  set(keep(b)); return current!;
}
let refreshing: Promise<Session | null> | null = null;
export async function refresh(): Promise<Session | null> {
  if (!current) return null;
  refreshing ??= call('/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: current.refresh_token }) })
    .then(b => { set(keep(b)); return current; }).catch(() => { set(null); return null; }).finally(() => { refreshing = null; });
  return refreshing;
}
/** a valid access token, refreshed a minute before expiry */
export async function token(): Promise<string | null> {
  if (!current) return null;
  if (current.expires_at - 60 < Date.now() / 1000) await refresh();
  return current?.access_token ?? null;
}
export async function signOut() {
  const t = current?.access_token; set(null);
  if (t) await call('/logout', { method: 'POST', token: t }).catch(() => undefined);
}

// ---------- multi-factor ----------
export async function factors(): Promise<Factor[]> {
  const u = await call('/user', { method: 'GET', token: (await token())! });
  return (u?.factors || []).filter((f: Factor) => f.factor_type === 'totp');
}
export async function enrollTotp(): Promise<{ id: string; secret: string; uri: string; qr: string }> {
  const b = await call('/factors', { method: 'POST', token: (await token())!, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'M Andamul authenticator' }) });
  return { id: b.id, secret: b.totp?.secret, uri: b.totp?.uri, qr: b.totp?.qr_code || '' };
}
/** challenge + verify; on success the session becomes aal2 */
export async function verifyTotp(factorId: string, code: string) {
  const t = (await token())!;
  const ch = await call(`/factors/${factorId}/challenge`, { method: 'POST', token: t, body: '{}' });
  const b = await call(`/factors/${factorId}/verify`, { method: 'POST', token: t, body: JSON.stringify({ challenge_id: ch.id, code: code.trim() }) });
  set(keep(b)); return current!;
}
