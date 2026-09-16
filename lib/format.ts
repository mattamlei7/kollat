/** Number formatting. Tabular digits are handled by CSS; this only shapes the strings. */

const usdFull = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export function usd(n: number, opts: { cents?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  if (opts.compact && Math.abs(n) >= 1_000_000) return usdCompact.format(n);
  if (opts.cents || Math.abs(n) < 100) return usdCents.format(n);
  return usdFull.format(n);
}

export function pct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toFixed(digits) + "%";
}

export function signedPct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  const v = (n * 100).toFixed(digits);
  return (n > 0 ? "+" : "") + v.replace("-", "−") + "%";
}

/** Token amounts: enough precision to be checkable, never scientific notation. */
export function amount(units: number, symbol?: string): string {
  if (!Number.isFinite(units)) return "—";
  const abs = Math.abs(units);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.001 ? 6 : 8;
  const s = units.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return symbol ? `${s} ${symbol}` : s;
}

export function hf(n: number | null): string {
  if (n === null) return "—";
  if (!Number.isFinite(n)) return "∞";
  if (n > 99) return ">99";
  return n.toFixed(2);
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
