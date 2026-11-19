// Money arrives from PostgreSQL `numeric(18,2)` (rupees with two decimals) as JSON numbers or strings.
// It is never added or compared in floating point: every value becomes whole paise in a BigInt first.
// A JSON number is turned into paise through its two-decimal string form, which is exact for amounts below ₹10 lakh crore.

export type Paise = bigint;

export function toPaise(v: unknown): Paise | null {
  if (v === null || v === undefined || v === '') return null;
  let s: string;
  if (typeof v === 'bigint') return v * 100n;
  if (typeof v === 'number') { if (!Number.isFinite(v)) return null; s = v.toFixed(2); }
  else if (typeof v === 'string') s = v.trim();
  else return null;
  const m = s.match(/^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/);
  if (!m) return null;
  const neg = m[1] === '-', whole = BigInt(m[2]), frac = BigInt((m[3] || '').padEnd(2, '0'));
  const p = whole * 100n + frac;
  return neg ? -p : p;
}

export const sumPaise = (xs: Array<Paise | null | undefined>): Paise => xs.reduce<Paise>((a, b) => a + (b ?? 0n), 0n);

/** Indian digit grouping: 1,23,45,678 */
function groupIndian(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3), rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/** ₹1,23,456.78 — exact */
export function formatINR(p: Paise | null | undefined, opts: { paise?: boolean } = {}): string {
  if (p === null || p === undefined) return '—';
  const neg = p < 0n, a = neg ? -p : p, r = a / 100n, f = a % 100n;
  const body = groupIndian(r) + (opts.paise === false ? '' : '.' + f.toString().padStart(2, '0'));
  return (neg ? '−₹' : '₹') + body;
}

/** ₹4.25 Cr / ₹38.6 L / ₹9,500 — for summaries; rounded half away from zero, never used for arithmetic */
export function formatCompact(p: Paise | null | undefined): string {
  if (p === null || p === undefined) return '—';
  const neg = p < 0n, a = neg ? -p : p, sign = neg ? '−' : '';
  const CR = 100n * 10_000_000n, L = 100n * 100_000n;
  const scaled = (unit: bigint, digits: number) => {           // a / unit with `digits` decimals, rounded half up
    const k = 10n ** BigInt(digits), v = (a * k * 2n + unit) / (unit * 2n);
    const w = v / k, d = (v % k).toString().padStart(digits, '0');
    return digits ? `${w}.${d}` : `${w}`;
  };
  if (a >= CR) return `${sign}₹${scaled(CR, 2)} Cr`;
  if (a >= L) return `${sign}₹${scaled(L, 1)} L`;
  return sign + formatINR(a, { paise: false });
}

/** percentage for display only (one decimal) */
export function pct(part: Paise | null | undefined, whole: Paise | null | undefined): string {
  if (part == null || !whole) return '—';
  const v = (part * 10_000n * 2n + whole) / (whole * 2n);   // basis points, rounded
  return `${(Number(v) / 100).toFixed(1)}%`;
}

/** parse what a person typed into a rupee amount string for the API ("1,25,000.5" → "125000.50"); null when invalid */
export function parseRupees(input: string): string | null {
  const s = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const p = toPaise(s)!;
  return `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;
}
