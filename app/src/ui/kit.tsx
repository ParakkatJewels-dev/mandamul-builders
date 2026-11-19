// Small, accessible building blocks shared by every screen: states (loading, empty, error), tables, dialogs, fields.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, rpc } from '../lib/api';

/** Load data from an api function, with loading / error / reload. */
export function useRpc<T>(fn: string | null, args: Record<string, unknown> = {}, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: !!fn });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!fn) return;
    const my = ++seq.current;
    setState(s => ({ ...s, loading: true, error: null }));
    try { const data = await rpc<T>(fn, args); if (my === seq.current) setState({ data, error: null, loading: false }); }
    catch (e) { if (my === seq.current) setState({ data: null, error: e as ApiError, loading: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, JSON.stringify(args), ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="card" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ margin: '10px 0', width: `${90 - i * 12}%` }} />)}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="state"><b>{title}</b>{children}</div>;
}
export function ErrorState({ error, retry }: { error: ApiError | Error; retry?: () => void }) {
  return <div className="card"><div className="error" role="alert">{error.message}</div>{retry && <div className="actions" style={{ marginTop: 10 }}><button className="btn" onClick={retry}>Try again</button></div>}</div>;
}
/** render data with the three states handled */
export function Async<T>({ q, empty, children }: { q: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; empty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (q.loading && q.data === null) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.reload} />;
  if (q.data === null) return <Loading />;
  if (empty && empty(q.data)) return <div className="card"><Empty title="Nothing here yet" /></div>;
  return <>{children(q.data)}</>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return <div className="ph"><div className="grow"><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>{children}</div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="dialog" role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2>{children}</div></div>;
}
const TONE: Record<string, string> = { Approved: 'ok', Passed: 'ok', Pass: 'ok', Verified: 'ok', Delivered: 'ok', Closed: 'ok', Received: 'ok', Resolved: 'ok',
  Pending: 'warn', Recorded: 'warn', 'In approval': 'warn', Billed: 'ok', Paid: 'ok', Discrepancies: 'warn', Returned: 'bad', 'Pending approval': 'warn', Submitted: 'info', 'Part received': 'info', Quoting: 'info', 'Quotes received': 'info', 'PO raised': 'info', Acknowledged: 'info',
  Rejected: 'bad', Failed: 'bad', Fail: 'bad', Cancelled: 'bad', Critical: 'bad', High: 'warn', Medium: 'info' };
export const Badge = ({ s }: { s: string | null | undefined }) => s ? <span className={`badge ${TONE[s] || ''}`}>{s}</span> : null;
export const Bar = ({ v }: { v: number }) => <div className="bar" role="img" aria-label={`${Math.round(v)}%`}><i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div>;
export const fmtDate = (d: string | null | undefined) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtTime = (d: string | null | undefined) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
