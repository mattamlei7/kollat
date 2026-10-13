import { formatUnits } from "viem";
import type { EarnToken } from "@/lib/earn/types";

/** Display-only formatting of base-unit amounts. Transactions always use the exact bigint. */
export function fmtToken(units: bigint, token: Pick<EarnToken, "decimals" | "symbol">, digits = 2, symbol = true): string {
  const n = Number(formatUnits(units, token.decimals));
  const s = n > 0 && n < 10 ** -digits ? `<${(10 ** -digits).toFixed(digits)}` : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return symbol ? `${s} ${token.symbol}` : s;
}

export const fmtApy = (apy: number | null) => (apy === null ? "Unavailable" : `${(apy * 100).toFixed(2)}%`);

export function fmtAgo(ms: number | null, now = Date.now()) {
  if (ms === null) return "unknown";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}
