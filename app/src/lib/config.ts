// Runtime configuration comes from /env.json, written at deploy time (Vercel) or served by the local gateway.
// Only the public project URL and the publishable (anon) key are ever sent to the browser.
export type Config = { supabaseUrl: string; anonKey: string; environment: 'local' | 'staging' | 'production' | string };
let cached: Promise<Config> | null = null;
export function config(): Promise<Config> {
  cached ??= fetch('/env.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('configuration missing'); return r.json(); });
  return cached;
}
