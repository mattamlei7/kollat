import { randomUUID } from "node:crypto";
import { z } from "zod";
import { healthFactor, uniformDrawdown, type CollateralLeg } from "./math/health";
import { sharesHealthFactor, type BorrowCapacity, type Market, type Position } from "./protocols/types";
import type { AccountSnapshot, MarketsSnapshot } from "./snapshot";

/**
 * Partner policy: deny by default. Anything not allowlisted, and any input that
 * is missing, stale or unpriced, denies. Evaluated over the same snapshots the
 * API already serves, so a decision uses exactly the numbers a partner can see.
 */
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a.toLowerCase());
export const PolicySchema = z.object({
  version: z.string().min(1),
  chains: z.array(z.number().int()).min(1),
  protocols: z.array(z.string()).min(1),
  /** Token addresses (any case); symbols are spoofable. */
  debtAssets: z.array(addr).min(1),
  collateralAssets: z.array(addr).min(1),
  /** Post-action debt / collateral value, 0..1. */
  maxLtv: z.number().gt(0).lte(1),
  minHealthFactor: z.number().gte(1),
  maxNotionalUsd: z.number().positive(),
  /** Oldest snapshot a decision may rest on. */
  maxDataAgeMs: z.number().positive(),
});
export type Policy = z.infer<typeof PolicySchema>;

export const ProposalSchema = z.object({
  address: addr,
  chainId: z.number().int(),
  protocolId: z.string(),
  marketId: z.string(),
  borrowUsd: z.number().positive(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export type ReasonCode =
  | "CHAIN_NOT_ALLOWED" | "PROTOCOL_NOT_ALLOWED" | "DEBT_ASSET_NOT_ALLOWED" | "COLLATERAL_NOT_ALLOWED"
  | "MARKET_NOT_FOUND" | "MARKET_NOT_ACTIVE" | "DATA_UNAVAILABLE" | "DATA_STALE"
  | "EXCEEDS_CAPACITY" | "NOTIONAL_EXCEEDS_MAX" | "LTV_EXCEEDS_MAX" | "HEALTH_FACTOR_BELOW_MIN";

export interface Decision {
  decisionId: string;
  policyVersion: string;
  allow: boolean;
  reasons: ReasonCode[];
  explanation: string[];
  evaluatedAt: number;
  /** Ages of the inputs the decision rests on, ms. */
  inputs: { marketAgeMs: number | null; accountAgeMs: number | null; stale: boolean };
  pre: { debtUsd: number; healthFactor: number | null } | null;
  /** drawdown: fractional drop across all collateral that would liquidate (1 − 1/HF). */
  post: { debtUsd: number; healthFactor: number; ltv: number; drawdownToLiquidation: number } | null;
  /** Largest borrow this policy would allow right now; 0 when nothing would. */
  safeMaxUsd: number | null;
}

const sum = (n: number[]) => n.reduce((s, x) => s + x, 0);

export function evaluate(policy: Policy, proposal: Proposal, markets: MarketsSnapshot, account: AccountSnapshot, now = Date.now()): Decision {
  const reasons: ReasonCode[] = [];
  const explanation: string[] = [];
  const deny = (code: ReasonCode, why: string) => { reasons.push(code); explanation.push(why); };
  const decision = (extra: Partial<Decision> = {}): Decision => ({
    decisionId: randomUUID(), policyVersion: policy.version, allow: reasons.length === 0, reasons, explanation, evaluatedAt: now,
    inputs: { marketAgeMs: null, accountAgeMs: null, stale: false }, pre: null, post: null, safeMaxUsd: null, ...extra,
  });

  // 1. Allowlists — cheap, and a denial here needs no data at all.
  if (!policy.chains.includes(proposal.chainId)) deny("CHAIN_NOT_ALLOWED", `chain ${proposal.chainId} is not in the policy`);
  if (!policy.protocols.includes(proposal.protocolId)) deny("PROTOCOL_NOT_ALLOWED", `${proposal.protocolId} is not in the policy`);
  if (reasons.length) return decision();

  // 2. Data — every input must be present, fresh and successfully read.
  const pm = markets.protocols.find((p) => p.id === proposal.protocolId && p.chainId === proposal.chainId);
  const pa = account.protocols.find((p) => p.id === proposal.protocolId && p.chainId === proposal.chainId);
  if (!pm || !pa) { deny("DATA_UNAVAILABLE", `no snapshot for ${proposal.protocolId} on chain ${proposal.chainId}`); return decision(); }
  if (!pm.markets.ok) deny("DATA_UNAVAILABLE", `markets: ${pm.markets.error.message}`);
  if (!pa.capacity.ok) deny("DATA_UNAVAILABLE", `capacity: ${pa.capacity.error.message}`);
  if (!pa.positions.ok) deny("DATA_UNAVAILABLE", `positions: ${pa.positions.error.message}`);
  if (!pm.markets.ok || !pa.capacity.ok || !pa.positions.ok) return decision();
  const inputs = {
    marketAgeMs: now - pm.markets.fetchedAt,
    accountAgeMs: now - Math.min(pa.capacity.fetchedAt, pa.positions.fetchedAt),
    stale: pm.markets.stale || pa.capacity.stale || pa.positions.stale,
  };
  if (Math.max(inputs.marketAgeMs, inputs.accountAgeMs) > policy.maxDataAgeMs) deny("DATA_STALE", `inputs are ${Math.max(inputs.marketAgeMs, inputs.accountAgeMs)}ms old; policy allows ${policy.maxDataAgeMs}ms`);
  if (inputs.stale) deny("DATA_STALE", "a snapshot is a stale fallback (its refresh failed)");

  const market: Market | undefined = pm.markets.data.find((m) => m.id === proposal.marketId);
  const capacity: BorrowCapacity | undefined = pa.capacity.data.find((c) => c.marketId === proposal.marketId);
  if (!market || !capacity) { deny("MARKET_NOT_FOUND", `${proposal.marketId} is not a listed market`); return decision({ inputs }); }
  if (market.status !== "active") deny("MARKET_NOT_ACTIVE", `market is ${market.status}`);
  if (!policy.debtAssets.includes(market.debt.address.toLowerCase())) deny("DEBT_ASSET_NOT_ALLOWED", `${market.debt.symbol} is not an allowed debt asset`);
  if (!policy.collateralAssets.includes(market.collateral.address.toLowerCase())) deny("COLLATERAL_NOT_ALLOWED", `${market.collateral.symbol} is not an allowed collateral`);
  if (reasons.length) return decision({ inputs });

  // 3. Risk — the proposed borrow on top of whatever already shares this health factor.
  const existing: Position[] = pa.positions.data.filter((p) => sharesHealthFactor(p.marketId, market.id));
  const preDebt = sum(existing.map((p) => sum(p.debt.map((l) => l.usd))));
  const newUnits = capacity.collateralUsd / market.collateralPriceUsd;
  const legs: CollateralLeg[] = [
    { units: newUnits, priceUsd: market.collateralPriceUsd, liquidationThreshold: market.liquidationThreshold, ltv: market.ltv },
    ...existing.flatMap((p) => p.collateral.map((l) => ({ units: l.usd, priceUsd: 1, liquidationThreshold: l.liquidationThreshold ?? 0, ltv: 0 }))),
  ];
  const collateral = sum(legs.map((l) => l.units * l.priceUsd));
  const weighted = sum(legs.map((l) => l.units * l.priceUsd * l.liquidationThreshold));
  const postDebt = preDebt + proposal.borrowUsd;
  const post = {
    debtUsd: postDebt,
    healthFactor: healthFactor(legs, postDebt),
    ltv: collateral > 0 ? postDebt / collateral : Infinity,
    drawdownToLiquidation: uniformDrawdown(healthFactor(legs, postDebt)),
  };
  // Closed form of the three limits; the tightest one is the safe maximum.
  const safeMaxUsd = Math.max(0, Math.min(
    policy.maxNotionalUsd,
    capacity.maxBorrowUsd,
    policy.maxLtv * collateral - preDebt,
    weighted / policy.minHealthFactor - preDebt,
  ));

  if (proposal.borrowUsd > policy.maxNotionalUsd) deny("NOTIONAL_EXCEEDS_MAX", `${proposal.borrowUsd} exceeds the ${policy.maxNotionalUsd} per-transaction limit`);
  if (proposal.borrowUsd > capacity.maxBorrowUsd) deny("EXCEEDS_CAPACITY", `${market.id} can lend at most ${capacity.maxBorrowUsd.toFixed(2)} against this wallet`);
  if (post.ltv > policy.maxLtv) deny("LTV_EXCEEDS_MAX", `post-action LTV ${post.ltv.toFixed(3)} exceeds ${policy.maxLtv}`);
  if (post.healthFactor < policy.minHealthFactor) deny("HEALTH_FACTOR_BELOW_MIN", `post-action health factor ${post.healthFactor.toFixed(3)} is below ${policy.minHealthFactor}`);

  return decision({ inputs, pre: { debtUsd: preDebt, healthFactor: preDebt > 0 ? healthFactor(legs.slice(1), preDebt) : null }, post, safeMaxUsd });
}
