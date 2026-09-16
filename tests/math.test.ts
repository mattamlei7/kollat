import { describe, expect, it } from "vitest";
import {
  annualCostDelta,
  healthFactor,
  liquidationOutcome,
  liquidationPrice,
  liquidationPriceSingle,
  maxBorrowUsd,
  riskBand,
  shockLegs,
  uniformDrawdown,
  type CollateralLeg,
} from "../lib/math/health";

const weth: CollateralLeg = { units: 10, priceUsd: 2500, liquidationThreshold: 0.83, ltv: 0.805 };
const wbtc: CollateralLeg = { units: 1, priceUsd: 80000, liquidationThreshold: 0.78, ltv: 0.73 };

describe("health factor", () => {
  it("is infinite with no debt", () => {
    expect(healthFactor([weth], 0)).toBe(Infinity);
    expect(riskBand(healthFactor([weth], 0))).toBe("none");
  });
  it("matches Aave's formula for a single asset", () => {
    // 10 WETH × $2500 × 0.83 / $10,000 = 2.075
    expect(healthFactor([weth], 10_000)).toBeCloseTo(2.075, 6);
  });
  it("sums liquidation-weighted collateral across assets", () => {
    const hf = healthFactor([weth, wbtc], 50_000);
    expect(hf).toBeCloseTo((25_000 * 0.83 + 80_000 * 0.78) / 50_000, 9);
  });
});

describe("max borrow", () => {
  it("uses LTV, not liquidation threshold", () => {
    expect(maxBorrowUsd([weth])).toBeCloseTo(25_000 * 0.805);
  });
  it("Morpho-style LTV == LT means a max borrow sits at HF exactly 1", () => {
    const morpho: CollateralLeg = { units: 1, priceUsd: 1000, liquidationThreshold: 0.86, ltv: 0.86 };
    expect(healthFactor([morpho], maxBorrowUsd([morpho]))).toBeCloseTo(1, 9);
  });
});

describe("liquidation price", () => {
  it("single asset: debt / (units × LT)", () => {
    expect(liquidationPriceSingle(10, 0.83, 10_000)).toBeCloseTo(10_000 / 8.3);
    expect(liquidationPrice([weth], 10_000)).toBeCloseTo(10_000 / 8.3);
  });
  it("multi asset: other legs held constant, 0 when they alone cover the debt", () => {
    // WBTC alone covers $50k (80k × 0.78 = 62.4k) → WETH price cannot liquidate
    expect(liquidationPrice([weth, wbtc], 50_000, 0)).toBe(0);
    // WETH covers 20.75k of 50k → WBTC must cover 29.25k → 29.25k / 0.78 = 37.5k
    expect(liquidationPrice([weth, wbtc], 50_000, 1)).toBeCloseTo(29_250 / 0.78);
  });
  it("is consistent with healthFactor: HF at the liquidation price is 1", () => {
    const p = liquidationPrice([weth, wbtc], 50_000, 1);
    expect(healthFactor([weth, { ...wbtc, priceUsd: p }], 50_000)).toBeCloseTo(1, 9);
  });
  it("uniform drawdown is 1 − 1/HF and HF after that shock is 1", () => {
    const hf = healthFactor([weth, wbtc], 50_000);
    const d = uniformDrawdown(hf);
    expect(healthFactor(shockLegs([weth, wbtc], -d), 50_000)).toBeCloseTo(1, 9);
    expect(uniformDrawdown(0.9)).toBe(0);
  });
});

describe("risk bands", () => {
  it("maps thresholds", () => {
    expect(riskBand(3)).toBe("comfortable");
    expect(riskBand(1.5)).toBe("comfortable");
    expect(riskBand(1.49)).toBe("watch");
    expect(riskBand(1.2)).toBe("watch");
    expect(riskBand(1.19)).toBe("danger");
    expect(riskBand(0.99)).toBe("liquidatable");
  });
});

describe("cost delta", () => {
  it("states the annual dollar difference", () => {
    expect(annualCostDelta(50_000, 0.0521, 0.0273)).toBeCloseTo(1240);
  });
});

describe("liquidation outcome", () => {
  it("seizes repaid debt plus penalty at the liquidation price, bounded by holdings", () => {
    const o = liquidationOutcome(10, 1204.82, 10_000, 0.05, 0.5);
    expect(o.debtRepaidUsd).toBe(5000);
    expect(o.collateralSeizedUsd).toBeCloseTo(5250, 0);
    expect(o.collateralSeizedUnits).toBeCloseTo(5250 / 1204.82, 6);
    expect(o.collateralRemainingUnits).toBeCloseTo(10 - 5250 / 1204.82, 6);
    expect(o.debtRemainingUsd).toBe(5000);
  });
});
