/**
 * Pure position math shared by every adapter and the simulator.
 * Everything here is in USD floats; adapters convert from base units.
 */

export interface CollateralLeg {
  units: number; // human units (e.g. 12.5 WETH)
  priceUsd: number;
  liquidationThreshold: number; // 0..1
  ltv: number; // 0..1
}

export type RiskBand = "none" | "comfortable" | "watch" | "danger" | "liquidatable";

export const BAND_THRESHOLDS = { comfortable: 1.5, watch: 1.2, danger: 1.0 } as const;

export function collateralUsd(legs: CollateralLeg[]): number {
  return legs.reduce((s, l) => s + l.units * l.priceUsd, 0);
}

/** Σ(collateral × LT) — the "liquidation-weighted" collateral value. */
export function weightedCollateralUsd(legs: CollateralLeg[]): number {
  return legs.reduce((s, l) => s + l.units * l.priceUsd * l.liquidationThreshold, 0);
}

export function maxBorrowUsd(legs: CollateralLeg[]): number {
  return legs.reduce((s, l) => s + l.units * l.priceUsd * l.ltv, 0);
}

/** Health factor; Infinity when there is no debt. */
export function healthFactor(legs: CollateralLeg[], debtUsd: number): number {
  if (debtUsd <= 0) return Infinity;
  return weightedCollateralUsd(legs) / debtUsd;
}

/**
 * Price of collateral leg `i` at which HF hits 1, holding every other leg's
 * price constant. Returns 0 when the other legs alone cover the debt.
 */
export function liquidationPrice(legs: CollateralLeg[], debtUsd: number, i = 0): number {
  if (debtUsd <= 0) return 0;
  const leg = legs[i];
  if (!leg || leg.units <= 0 || leg.liquidationThreshold <= 0) return 0;
  const others = legs
    .filter((_, j) => j !== i)
    .reduce((s, l) => s + l.units * l.priceUsd * l.liquidationThreshold, 0);
  const needed = debtUsd - others;
  if (needed <= 0) return 0;
  return needed / (leg.units * leg.liquidationThreshold);
}

/** Single-collateral shortcut used for the capacity table. */
export function liquidationPriceSingle(
  units: number,
  liquidationThreshold: number,
  debtUsd: number,
): number {
  if (units <= 0 || liquidationThreshold <= 0 || debtUsd <= 0) return 0;
  return debtUsd / (units * liquidationThreshold);
}

/** Uniform drop across all collateral that brings HF to 1: 1 − 1/HF (0 when already ≤ 1). */
export function uniformDrawdown(hf: number): number {
  if (!Number.isFinite(hf) || hf <= 0) return 0;
  return Math.max(0, 1 - 1 / hf);
}

/** Fractional price move (negative = drop) from current price to liquidation. */
export function distanceToLiquidation(currentPrice: number, liqPrice: number): number {
  if (currentPrice <= 0) return 0;
  return (liqPrice - currentPrice) / currentPrice;
}

export function riskBand(hf: number): RiskBand {
  if (!Number.isFinite(hf)) return "none";
  if (hf < BAND_THRESHOLDS.danger) return "liquidatable";
  if (hf < BAND_THRESHOLDS.watch) return "danger";
  if (hf < BAND_THRESHOLDS.comfortable) return "watch";
  return "comfortable";
}

/** Per-second compounding of a simple annual rate — what a year actually costs. */
export function aprToApy(apr: number, periodsPerYear = 31_536_000): number {
  return Math.pow(1 + apr / periodsPerYear, periodsPerYear) - 1;
}

/** Annual dollar cost difference of borrowing `amountUsd` at `aprA` instead of `aprB`. */
export function annualCostDelta(amountUsd: number, aprA: number, aprB: number): number {
  return amountUsd * (aprA - aprB);
}

/** Apply a fractional price shock (−0.3 = 30 % drop) to every leg. */
export function shockLegs(legs: CollateralLeg[], shock: number): CollateralLeg[] {
  return legs.map((l) => ({ ...l, priceUsd: l.priceUsd * (1 + shock) }));
}

/**
 * What a liquidation event does, using a protocol's close factor
 * (fraction of debt a liquidator may repay in one call) and the market's
 * liquidation penalty. Single-collateral model.
 */
export interface LiquidationOutcome {
  debtRepaidUsd: number;
  collateralSeizedUnits: number;
  collateralSeizedUsd: number;
  collateralRemainingUnits: number;
  debtRemainingUsd: number;
}

export function liquidationOutcome(
  units: number,
  priceAtLiquidation: number,
  debtUsd: number,
  liquidationPenalty: number,
  closeFactor: number,
): LiquidationOutcome {
  const debtRepaidUsd = Math.min(debtUsd, debtUsd * closeFactor);
  const seizedUsd = debtRepaidUsd * (1 + liquidationPenalty);
  const seizedUnits = priceAtLiquidation > 0 ? Math.min(units, seizedUsd / priceAtLiquidation) : 0;
  return {
    debtRepaidUsd,
    collateralSeizedUnits: seizedUnits,
    collateralSeizedUsd: seizedUnits * priceAtLiquidation,
    collateralRemainingUnits: Math.max(0, units - seizedUnits),
    debtRemainingUsd: Math.max(0, debtUsd - debtRepaidUsd),
  };
}
