import { marketsOf, type Cell, type ChainTable, type Column, type PositionView, type Row } from "./join";
import { healthFactor, liquidationPrice, type CollateralLeg } from "./math/health";
import { sharesHealthFactor } from "./protocols/types";

/**
 * One rulebook for "can this route fund my loan?", shared by the route comparison, the selected-loan summary
 * and the review gate, so they never disagree. Every route is checked for the same collateral quantity and the
 * same USDC amount. Pure: reads only the joined snapshot data, never invents figures.
 */

export type CapacityCell = Extract<Cell, { kind: "capacity" }>;

/** What bounds a route's maximum: collateral at its loan-to-value, the market's available USDC, or a supply cap on collateral. */
export type Limit = "collateral" | "liquidity" | "supply-cap";

export type RouteStatus =
  /** Collateral or borrow amount not entered yet: rates are indicative only. */
  | "no-amount"
  /** Fresh data says this route can fund the request without opening at liquidation. */
  | "fundable"
  /** The route cannot lend the requested amount against this collateral. */
  | "short"
  /** Within the maximum, but existing debt (or LTV = liquidation threshold) means it would open at or past liquidation. */
  | "liquidatable"
  /** The protocol's latest read failed or is stale: no comparison is made. */
  | "no-data";

export interface RouteCheck {
  colKey: string;
  marketId: string;
  status: RouteStatus;
  /** Status in a sentence, e.g. "Can fund 5,000 USDC". Empty when there is nothing to say. */
  reason: string;
  /** The same status in a word or two: "Can fund", "Insufficient collateral", "Limited market liquidity". */
  label: string;
  /** Longer text for details and assistive technology: what limits the route and why, with the exact shortfall. */
  detail: string;
  /** Just the limiting factor. */
  limitText: string;
  /** Maximum USDC for the collateral quantity checked (or the whole accepted balance while none is entered). */
  max: number;
  shortfall: number;
  limit: Limit;
  /** Collateral checked, and what this route accepts at most (a supply cap can accept less than the wallet holds). */
  units: number;
  acceptedUnits: number;
  /** Variable borrow APY; null when the rate is unavailable. A missing rate is never treated as zero. */
  apy: number | null;
  fresh: boolean;
  hf: number;
  liq: number;
  /** Fractional move from today's price to the liquidation price (negative = drop); 0 when there is none. */
  drop: number;
  existingDebt: number;
}

const EPS = 1e-9;
export const fmtUsdc = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const fmtUnits = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** Positions the new borrow would share a health factor with: account-level ones, or the same isolated market. */
export function foldable(positions: PositionView[] | null, chainId: number, protocolId: string, marketId: string) {
  return (positions ?? []).filter(
    (p) => p.chainId === chainId && p.protocolId === protocolId && sharesHealthFactor(p.position.marketId, marketId),
  );
}

/** Health factor and liquidation price of the new collateral and debt, folded with any position sharing its health factor. */
export function riskOf(cell: CapacityCell, units: number, amount: number, existing: PositionView[]) {
  const { market } = cell;
  const existingDebt = existing.reduce((s, p) => s + p.position.debt.reduce((d, l) => d + l.usd, 0), 0);
  // Existing collateral legs only matter by USD value, so price them at $1 per USD and hold them constant.
  const legs: CollateralLeg[] = [
    { units, priceUsd: market.collateralPriceUsd, liquidationThreshold: market.liquidationThreshold, ltv: market.ltv },
    ...existing.flatMap((p) => p.position.collateral.map((l) => ({ units: l.usd, priceUsd: 1, liquidationThreshold: l.liquidationThreshold ?? 0, ltv: 0 }))),
  ];
  const debt = existingDebt + amount;
  return { existingDebt, hf: healthFactor(legs, debt), liq: liquidationPrice(legs, debt, 0) };
}

/** USDC the market can still lend, from its own available-liquidity read; null when it cannot be read. */
function liquidityUsd(cell: CapacityCell): number | null {
  const { market } = cell;
  const raw = Number(market.availableLiquidity);
  if (!Number.isFinite(raw) || !Number.isFinite(market.debtPriceUsd)) return null;
  return (raw / 10 ** market.debt.decimals) * market.debtPriceUsd;
}

/**
 * Check one market for `amount` USDC against `units` of the holding. With no collateral quantity entered (null),
 * the route is described against the whole balance it accepts, as an indicative maximum only.
 */
export function assessRoute(
  table: ChainTable, row: Row, col: Column, amount: number, units: number | null, positions: PositionView[] | null,
  cell: CapacityCell | undefined = marketsOf(row, col.key)[0],
): RouteCheck | null {
  if (!cell) return null;
  const { market, capacity } = cell;
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const price = market.collateralPriceUsd;
  const acceptedUnits = price > 0 ? Math.min(row.holding.units, capacity.collateralUsd / price) : 0;
  const entered = units !== null && Number.isFinite(units) && units > 0;
  const want = entered ? Math.min(units as number, row.holding.units) : acceptedUnits;
  const pledged = Math.min(want, acceptedUnits);
  // The capacity read is already capped by the market's liquidity; less collateral lowers the LTV limit below it.
  const max = Math.min(capacity.maxBorrowUsd, pledged * price * market.ltv);
  const collateralMax = pledged * price * market.ltv;
  const liquidity = liquidityUsd(cell);
  const overCap = entered && want > acceptedUnits * (1 + EPS);
  const capped = acceptedUnits < row.holding.units * (1 - EPS);
  const limit: Limit = overCap ? "supply-cap" : liquidity !== null && liquidity < collateralMax - EPS ? "liquidity" : capped && !entered ? "supply-cap" : "collateral";
  const fresh = !col.error && !col.stale;
  const apy = cell.rate && Number.isFinite(cell.rate.borrowApyVariable) && cell.rate.borrowApyVariable >= 0 ? cell.rate.borrowApyVariable : null;
  const existing = foldable(positions, table.chainId, col.id, market.id);
  const { existingDebt, hf, liq } = riskOf(cell, pledged, safeAmount, existing);
  const shortfall = Math.max(0, safeAmount - max);
  const drop = liq > 0 && price > 0 ? (liq - price) / price : 0;
  const sym = row.holding.token.symbol;
  const limitText =
    limit === "liquidity"
      ? `Limited by the market's available USDC (about ${fmtUsdc(liquidity ?? 0)}), not by your collateral.`
      : limit === "supply-cap"
        ? `A supply cap lets ${col.name} accept only ${fmtUnits(acceptedUnits)} ${sym} as collateral.`
        : `Limited by your ${sym} collateral at ${Math.round(market.ltv * 1000) / 10}% loan-to-value.`;

  const base = { colKey: col.key, marketId: market.id, limitText, max, shortfall, limit, units: pledged, acceptedUnits, apy, fresh, hf, liq, drop, existingDebt };
  if (!fresh) {
    return { ...base, status: "no-data", label: "Fresh data unavailable", reason: "Fresh data unavailable", detail: `${col.name}'s latest read ${col.error ? "failed" : "is out of date"}, so this route is left out of comparisons until the account is read again.` };
  }
  if (safeAmount <= 0 || !entered) {
    return { ...base, status: "no-amount", label: "", reason: "", detail: `Up to about ${fmtUsdc(max)} USDC against ${entered ? "this collateral" : `all the ${sym} it accepts`}. ${limitText}` };
  }
  if ((units as number) > row.holding.units * (1 + EPS)) {
    return { ...base, status: "short", label: "Insufficient collateral", reason: "Collateral amount exceeds your balance", detail: `You requested ${fmtUnits(units as number)} ${sym}, but only ${fmtUnits(row.holding.units)} ${sym} is available. Edit the collateral amount before reviewing.` };
  }
  if (overCap) {
    return { ...base, status: "short", label: "Supply cap", reason: `Accepts at most ${fmtUnits(acceptedUnits)} ${sym}`, detail: `${limitText} Your ${fmtUnits(want)} ${sym} is more than it can take.` };
  }
  if (safeAmount > max + EPS) {
    const label = limit === "liquidity" ? "Limited market liquidity" : "Insufficient collateral";
    return { ...base, status: "short", label, reason: `${fmtUsdc(shortfall)} USDC below your request`, detail: `Can lend about ${fmtUsdc(max)} USDC, ${fmtUsdc(shortfall)} below your ${fmtUsdc(safeAmount)}. ${limitText}` };
  }
  if (!Number.isFinite(hf) || hf <= 1) {
    return { ...base, status: "liquidatable", label: "Would open at liquidation", reason: "Would open at or past liquidation", detail: existingDebt > 0 ? `With the ${fmtUsdc(existingDebt)} USDC already owed on ${col.name}, this amount would start at or past liquidation.` : `At this amount the loan would start at ${col.name}'s liquidation point.` };
  }
  return { ...base, status: "fundable", label: "Can fund", reason: `Can fund ${fmtUsdc(safeAmount)} USDC`, detail: `Can lend up to about ${fmtUsdc(max)} USDC against this collateral. ${limitText}` };
}

/** Whether a check may be ranked: it funds the request, on fresh data, with a known rate. Every route is checked on the same collateral. */
export const rankable = (check: RouteCheck) => check.status === "fundable" && check.fresh && check.apy !== null;

export interface Route {
  /** Unique per market: protocol column plus market. */
  key: string;
  col: Column;
  cell: CapacityCell;
  /** "Morpho · 86% liq. threshold" when a protocol lists several markets for this collateral; else the protocol name. */
  label: string;
  check: RouteCheck;
}

export interface RouteList {
  /** Routes that can fund the request, lowest variable APY first. Before amounts are entered: every route with a fresh rate, lowest first. */
  eligible: Route[];
  /** Everything else, with its reason: insufficient collateral, liquidity, stale data, missing rate. */
  other: Route[];
  /** Protocols with no active market for this collateral, and why. */
  unsupported: { col: Column; reason: string }[];
  /** Keys tied for the lowest variable APY among eligible routes; empty until amounts are entered. */
  lowest: string[];
  /** True once both a collateral quantity and a borrow amount are entered. */
  specified: boolean;
}

export const routeKeyOf = (colKey: string, marketId: string) => `${colKey}|${marketId}`;

export function routesFor(table: ChainTable, row: Row, amount: number, units: number | null, positions: PositionView[] | null): RouteList {
  const specified = amount > 0 && units !== null && units > 0;
  const all: Route[] = [];
  const unsupported: RouteList["unsupported"] = [];
  for (const col of table.columns) {
    const markets = marketsOf(row, col.key);
    if (!markets.length) {
      const cell = row.cells[col.key];
      unsupported.push({ col, reason: col.error ? "Fresh data unavailable" : cell?.kind === "unavailable" ? cell.reason : "not listed" });
      continue;
    }
    for (const cell of markets) {
      const check = assessRoute(table, row, col, amount, units, positions, cell)!;
      const label = markets.length > 1 ? `${col.name} · ${Math.round(cell.market.liquidationThreshold * 1000) / 10}% liq. threshold` : col.name;
      all.push({ key: routeKeyOf(col.key, cell.market.id), col, cell, label, check });
    }
  }
  const byApy = (a: Route, b: Route) => (a.check.apy as number) - (b.check.apy as number) || a.label.localeCompare(b.label);
  const eligible = (specified ? all.filter((r) => rankable(r.check)) : all.filter((r) => r.check.fresh && r.check.apy !== null)).sort(byApy);
  const other = all.filter((r) => !eligible.includes(r));
  const min = specified && eligible.length ? (eligible[0].check.apy as number) : null;
  // Ties within a hundredth of a basis point share the label, so equal rates are never split arbitrarily.
  const lowest = min === null ? [] : eligible.filter((r) => (r.check.apy as number) - min <= 1e-6).map((r) => r.key);
  return { eligible, other, unsupported, lowest, specified };
}

/** Parse a typed amount. Empty is zero; anything else must be a plain non-negative number below the ceiling. */
export const AMOUNT_CEILING = 1_000_000_000_000;
export function parseAmount(text: string): { value: number | null; error: string | null } {
  const cleaned = text.replace(/[,\s_]/g, "");
  if (cleaned === "") return { value: 0, error: null };
  if (cleaned.startsWith("-")) return { value: null, error: "Enter an amount of zero or more." };
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return { value: null, error: "Use digits and at most one decimal point." };
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { value: null, error: "Use digits and at most one decimal point." };
  if (value > AMOUNT_CEILING) return { value: null, error: `Enter an amount up to ${fmtUsdc(AMOUNT_CEILING)}.` };
  return { value, error: null };
}
