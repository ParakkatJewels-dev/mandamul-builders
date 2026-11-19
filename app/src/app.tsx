// Application shell: session, permissions, navigation, project choice, MFA step-up, toasts.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as auth from './lib/auth';
import { ApiError, rpc } from './lib/api';
import { config } from './lib/config';
import { Dialog, ErrorState, Field, Loading } from './ui/kit';

export type SessionInfo = {
  user: { id: string; name: string; email: string; role: string; role_name: string; all_projects: boolean };
  org: { id: string; name: string }; aal: string; mfa_actions: string[];
  permissions: Record<string, string[]>; projects: { id: string; name: string; stage: string; location: string; pm: string | null }[]; unread: number;
};
type Ctx = {
  info: SessionInfo; can: (module: string, action?: string) => boolean;
  project: string | null; setProject: (id: string) => void;
  /** run an action; if the database asks for MFA, prompt for the code and retry once */
  guard: <T>(fn: () => Promise<T>, done?: string) => Promise<T | undefined>;
  toast: (text: string, bad?: boolean) => void; refreshInfo: () => void; go: (route: string) => void;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function useRoute(): [string, string[]] {
  const [h, setH] = useState(location.hash.slice(1) || '');
  useEffect(() => { const f = () => setH(location.hash.slice(1)); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const [name, ...rest] = h.split('/');
  return [name, rest.map(decodeURIComponent)];
}

function MfaDialog({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [stage, setStage] = useState<'loading' | 'enrol' | 'code'>('loading');
  const [factor, setFactor] = useState<string>(''); const [secret, setSecret] = useState(''); const [code, setCode] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => {
    try { const f = (await auth.factors()).find(x => x.status === 'verified'); if (f) { setFactor(f.id); setStage('code'); return; }
      const e = await auth.enrollTotp(); setFactor(e.id); setSecret(e.secret); setStage('enrol'); }
    catch (e) { setErr((e as Error).message); setStage('code'); }
  })(); }, []);
  const verify = async () => {
    setBusy(true); setErr('');
    try { await auth.verifyTotp(factor, code); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <Dialog title="Confirm with your authenticator" onClose={onCancel}>
    {stage === 'loading' ? <Loading rows={2} /> : <div className="form">
      {stage === 'enrol' && <><p>Approvals, payments, budgets and settings need a second step. Add this key to your authenticator app (Google Authenticator, Microsoft Authenticator or similar), then enter the 6-digit code it shows.</p>
        <div className="secret" data-testid="totp-secret">{secret}</div></>}
      {stage === 'code' && <p>Enter the 6-digit code from your authenticator app.</p>}
      <Field label="Code"><input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} autoFocus aria-label="Authenticator code" /></Field>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="actions"><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={code.length !== 6 || busy} onClick={verify}>{busy ? 'Checking…' : 'Confirm'}</button></div>
    </div>}
  </Dialog>;
}

const NAV: { id: string; label: string; show: (c: (m: string, a?: string) => boolean, i: SessionInfo) => boolean }[] = [
  { id: 'command', label: 'Command center', show: c => c('dashboard') },
  { id: 'alerts', label: 'Action center', show: () => true },
  { id: 'approvals', label: 'Approvals', show: (_, i) => Object.values(i.permissions).some(a => a.includes('approve')) },
  { id: 'procurement', label: 'Procurement', show: c => c('procurement') },
  { id: 'site', label: 'Site reports', show: c => c('site') },
  { id: 'contracts', label: 'Contracts', show: (c, i) => c('contracts') || c('site', 'create') || i.user.role === 'vendor' },
  { id: 'payments', label: 'Payments', show: c => c('payments') },
  { id: 'cost', label: 'Cost report', show: c => c('budget') },
  { id: 'warranty', label: 'Warranty', show: c => c('handover') },
  { id: 'feasibility', label: 'Feasibility', show: c => c('projects') && c('budget') },
];

/** the screens this person's role allows (the database enforces the same rules on every call) */
export const allowedScreens = (info: SessionInfo) => NAV.filter(n => n.show((m, a = 'view') => !!info.permissions[m]?.includes(a), info)).map(n => n.id);

export function Shell({ info, refreshInfo, children, route }: { info: SessionInfo; refreshInfo: () => void; children: ReactNode; route: string }) {
  const [project, setP] = useState<string | null>(() => { const s = localStorage.getItem('mandamul.project'); return info.projects.some(p => p.id === s) ? s : info.projects[0]?.id ?? null; });
  const [toasts, setToasts] = useState<{ id: number; text: string; bad?: boolean }[]>([]);
  const [mfa, setMfa] = useState<null | { resolve: (ok: boolean) => void }>(null);
  const [menu, setMenu] = useState(false); const [env, setEnv] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('mandamul.theme') || 'auto');
  useEffect(() => { config().then(c => setEnv(c.environment)).catch(() => undefined); }, []);
  useEffect(() => { theme === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('mandamul.theme', theme); }, [theme]);
  const toast = useCallback((text: string, bad = false) => { const id = Date.now() + Math.random(); setToasts(t => [...t, { id, text, bad }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000); }, []);
  const can = useCallback((m: string, a = 'view') => !!info.permissions[m]?.includes(a), [info]);
  const askMfa = () => new Promise<boolean>(resolve => setMfa({ resolve }));
  const guard = useCallback(async <T,>(fn: () => Promise<T>, done?: string) => {
    try { const r = await fn(); if (done) toast(done); return r; }
    catch (e) {
      if (e instanceof ApiError && e.kind === 'mfa' && await askMfa()) {
        try { const r = await fn(); if (done) toast(done); return r; } catch (e2) { toast((e2 as Error).message, true); return undefined; }
      }
      toast((e as Error).message, true); return undefined;
    }
  }, [toast]);
  const setProject = (id: string) => { setP(id); localStorage.setItem('mandamul.project', id); };
  const go = (r: string) => { location.hash = r; setMenu(false); };
  const ctx = useMemo<Ctx>(() => ({ info, can, project, setProject, guard, toast, refreshInfo, go }), [info, can, project, guard, toast, refreshInfo]);
  const nav = NAV.filter(n => n.show(can, info));
  return <AppCtx.Provider value={ctx}>
    <div className="shell">
      <nav className={`side ${menu ? 'open' : ''}`} aria-label="Main">
        <div className="brand"><b>M Andamul</b><span>Development OS</span></div>
        {nav.map(n => <a key={n.id} className="nav" href={`#${n.id}`} aria-current={route === n.id ? 'page' : undefined} onClick={() => setMenu(false)}>{n.label}</a>)}
        <div className="foot"><span>{info.org.name}<br />{info.user.name} · {info.user.role_name}</span>
          <span className={`badge ${auth.aal() === 'aal2' ? 'ok' : ''}`}>{auth.aal() === 'aal2' ? 'MFA verified' : 'Password only'}</span>
          <button className="btn sm" onClick={() => auth.signOut()}>Sign out</button></div>
      </nav>
      <div className="main">
        <header className="top">
          <button className="btn ghost menu-btn" aria-label="Menu" onClick={() => setMenu(!menu)}>☰</button>
          <select className="input" style={{ maxWidth: 320 }} aria-label="Project" value={project ?? ''} onChange={e => setProject(e.target.value)}>
            {info.projects.length === 0 && <option value="">No projects</option>}
            {info.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="grow" />
          {env && env !== 'production' && <span className="env hide-sm" title="Not the production system">{env === 'local' ? 'Local test database' : 'Staging — synthetic data'}</span>}
          <span className={`badge hide-sm ${auth.aal() === 'aal2' ? 'ok' : ''}`} title="Multi-factor status of this session">{auth.aal() === 'aal2' ? 'MFA verified' : 'Password only'}</span>
          <select className="input hide-sm" style={{ width: 110 }} aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value)}><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select>
          <button className="btn sm hide-sm" onClick={() => auth.signOut()}>Sign out</button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
    {mfa && <MfaDialog onDone={() => { const r = mfa.resolve; setMfa(null); refreshInfo(); r(true); }} onCancel={() => { const r = mfa.resolve; setMfa(null); r(false); }} />}
    <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`} role={t.bad ? 'alert' : 'status'}>{t.text}</div>)}</div>
  </AppCtx.Provider>;
}

export function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await auth.signIn(email, password); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return <div className="login"><form className="card form" onSubmit={submit}>
    <div><h1>M Andamul</h1><p className="muted">Development OS · From Land to Landmark</p></div>
    <Field label="Email"><input className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
    <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
    {err && <div className="error" role="alert">{err}</div>}
    <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    <p className="sm muted">Accounts are created by your administrator. Approvals and payments ask for an authenticator code.</p>
  </form></div>;
}

/** loads the session info after sign-in; shows a clear error when the account has no profile */
export function useSessionInfo(signedIn: boolean) {
  const [info, setInfo] = useState<SessionInfo | null>(null); const [err, setErr] = useState<Error | null>(null);
  const load = useCallback(async () => {
    if (!signedIn) { setInfo(null); return; }
    try { setErr(null); setInfo(await rpc<SessionInfo>('session_info')); } catch (e) { setErr(e as Error); }
  }, [signedIn]);
  useEffect(() => { load(); }, [load]);
  return { info, err, load };
}
export const SessionError = ({ err }: { err: Error }) => <div className="login"><div style={{ width: 'min(460px,100%)' }}><ErrorState error={err} /><div className="actions" style={{ marginTop: 10 }}><button className="btn" onClick={() => auth.signOut()}>Sign out</button></div></div></div>;
