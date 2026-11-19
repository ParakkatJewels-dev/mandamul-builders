// Every read and write goes through a permission-checked `api` function via PostgREST RPC
// (POST /rest/v1/rpc/<name>, schema selected by the Content-Profile header). No table is written directly.
import { config } from './config';
import { token, refresh } from './auth';

export type ErrorKind = 'mfa' | 'permission' | 'validation' | 'conflict' | 'auth' | 'network' | 'server';
export class ApiError extends Error {
  constructor(message: string, public kind: ErrorKind, public code = '', public status = 0) { super(message); }
}

/** Turn a database error into something a person can act on. */
export function classify(status: number, body: any): ApiError {
  const msg: string = body?.message || body?.msg || `Request failed (${status})`, code: string = body?.code || '';
  if (/multi-factor sign-in required/i.test(msg)) return new ApiError('This action needs your authenticator code.', 'mfa', code, status);
  if (status === 401) return new ApiError('Your session has ended. Please sign in again.', 'auth', code, status);
  const pd = msg.match(/^permission denied: (\w+) on (\w+)/);
  if (pd) return new ApiError(`Your role does not have the "${pd[1]}" right for ${pd[2]}.`, 'permission', code, status);
  if (code === '42501' || status === 403) return new ApiError(msg, 'permission', code, status);
  if (code === '23505' || code === 'P0003' || status === 409) return new ApiError(msg, 'conflict', code, status);
  if (status >= 500) return new ApiError('The server had a problem. Nothing was saved; try again in a moment.', 'server', code, status);
  return new ApiError(msg, 'validation', code, status);
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}, retried = false): Promise<T> {
  const { supabaseUrl, anonKey } = await config();
  const t = await token();
  if (!t) throw new ApiError('Please sign in.', 'auth');
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', 'Content-Profile': 'api', 'Accept-Profile': 'api', Accept: 'application/json' },
      body: JSON.stringify(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))),
    });
  } catch {
    throw new ApiError('No connection. Nothing was sent; check the network and try again.', 'network');
  }
  if (res.status === 401 && !retried && (await refresh())) return rpc<T>(fn, args, true);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw classify(res.status, body);
  return body as T;
}
