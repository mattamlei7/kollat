import { formatUnits } from "viem";
import { STALE_MS, type Opportunity } from "./types";

/** Pure helpers shared by the table, the summary rail and the review. Amounts are base-unit bigints. */

export interface Row {
  opp: Opportunity;
  /** Accepting this deposit with a fresh, known rate. Only these are ranked. */
  eligible: boolean;
  /** Why not, in a few words. */
  reason: string | null;
  stale: boolean;
  highest: boolean;
}

export const isStale = (o: Opportunity, now: number) => o.fetchedAt === null || now - o.fetchedAt > STALE_MS;

export function capacityLeft(o: Opportunity): bigint | null {
  return o.capacity === null ? null : o.capacity === "unlimited" ? null : BigInt(o.capacity);
}

function reasonFor(o: Opportunity, amount: bigint | null, stale: boolean): string | null {
  if (o.error || o.status === "unknown") return "Data unavailable";
  if (o.status === "paused") return "Not accepting deposits";
  if (o.status === "frozen") return "Deposits frozen";
  if (o.baseApy === null || !Number.isFinite(o.baseApy)) return "Rate unavailable";
  if (stale) return "Rate out of date";
  const left = capacityLeft(o);
  if (left === 0n) return "Deposit capacity reached";
  if (amount !== null && left !== null && amount > left) return "Above deposit capacity";
  if (o.capacity === null) return "Capacity unavailable";
  return null;
}

/**
 * One asset on one network: eligible destinations by net base APY (highest first, ties by id), then the rest.
 * The first eligible row is labelled "Highest base APY"; nothing is selected for the user.
 */
export function rankOpportunities(opps: Opportunity[], amount: bigint | null, now: number): Row[] {
  const rows = opps.map((opp) => {
    const stale = isStale(opp, now);
    const reason = reasonFor(opp, amount, stale);
    return { opp, eligible: reason === null, reason, stale, highest: false };
  });
  const eligible = rows.filter((r) => r.eligible).sort((a, b) => b.opp.baseApy! - a.opp.baseApy! || a.opp.id.localeCompare(b.opp.id));
  const rest = rows.filter((r) => !r.eligible).sort((a, b) => a.opp.id.localeCompare(b.opp.id));
  if (eligible[0]) eligible[0].highest = true;
  return [...eligible, ...rest];
}

export type WithdrawalState = "Available now" | "Limited liquidity" | "Unavailable";

/** What a depositor could take out right now, given the destination's free liquidity. Never inferred from the interface alone. */
export function withdrawalState(o: Opportunity, amount: bigint | null): { state: WithdrawalState; liquidity: bigint | null } {
  if (o.status === "paused" && (o.product === "aave-supply" || o.product === "sparklend-supply")) return { state: "Unavailable", liquidity: null };
  if (o.liquidity === null) return { state: "Unavailable", liquidity: null };
  const liquidity = BigInt(o.liquidity);
  if (liquidity === 0n || (amount !== null && amount > liquidity)) return { state: "Limited liquidity", liquidity };
  return { state: "Available now", liquidity };
}

/** Estimated earnings over a year at today's rate, in the deposit asset (a number for display only). */
export function yearlyEarnings(o: Opportunity, amount: bigint): number | null {
  return o.baseApy === null ? null : Number(formatUnits(amount, o.asset.decimals)) * o.baseApy;
}

/** Rates move a little with every block; a review stays valid until the change is material. */
export const MATERIAL_APY_CHANGE = 0.0025; // 0.25 percentage points

export interface Reviewed { id: string; amount: bigint; apy: number | null; status: Opportunity["status"] }
export const reviewedTerms = (o: Opportunity, amount: bigint): Reviewed => ({ id: o.id, amount, apy: o.baseApy, status: o.status });

/** Why a review no longer holds for the current data, or null if it still does. */
export function reviewChange(r: Reviewed, o: Opportunity, amount: bigint, now = Date.now()): string | null {
  if (o.id !== r.id || amount !== r.amount) return "The amount or destination changed since this review.";
  if (o.status !== r.status) return "The destination's status changed since this review.";
  if (o.baseApy === null || r.apy === null) return "The rate is no longer available.";
  if (Math.abs(o.baseApy - r.apy) >= MATERIAL_APY_CHANGE) return `The rate moved from ${(r.apy * 100).toFixed(2)}% to ${(o.baseApy * 100).toFixed(2)}% since this review.`;
  const left = capacityLeft(o);
  if (left !== null && amount > left) return "The destination can no longer accept this amount.";
  const unavailable = reasonFor(o, amount, isStale(o, now));
  if (unavailable) return `${unavailable}. Review fresh destination data before depositing.`;
  return null;
}

/** Parse a user-entered decimal into base units, rejecting more precision than the token has. */
export function parseAmountInput(text: string, decimals: number): { value: bigint | null; error: string | null } {
  const t = text.trim().replace(/,/g, "");
  if (!t) return { value: null, error: null };
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return { value: null, error: "Enter a number." };
  const [whole, frac = ""] = t.split(".");
  if (frac.length > decimals) return { value: null, error: `Use at most ${decimals} decimal places.` };
  return { value: BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0"), error: null };
}
