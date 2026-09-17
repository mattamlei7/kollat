import { describe, expect, it } from "vitest";
import { simulate } from "../components/Rail";
import type { ChainTable, PositionView } from "../lib/join";

// Minimal fixture: 10 WETH on one protocol. Only the fields simulate() reads are real.
const market = { id: "aave-v3:1:WETH", collateralPriceUsd: 2500, liquidationThreshold: 0.83, ltv: 0.805, liquidationPenalty: 0.05 } as never;
const col = { key: "aave-v3:1", id: "aave-v3", name: "Aave v3", chainId: 1, label: "Aave v3 · Ethereum" };
const table: ChainTable = {
  chainId: 1,
  columns: [col],
  rows: [{ holding: { token: { address: "0xweth", symbol: "WETH", decimals: 18 }, units: 10 } as never, cells: { [col.key]: { kind: "capacity", market, capacity: { maxBorrowUsd: 20_125 } as never, rate: null } }, best: col.key }],
  totals: {},
};
const sel = { chainId: 1, rowKey: "0xweth", colKey: col.key };
const existing: PositionView = {
  key: "aave-v3:1:0", protocolId: "aave-v3", name: "Aave v3", chainId: 1, label: "", stale: false,
  position: { marketId: null, collateral: [{ usd: 10_000, liquidationThreshold: 0.78 }], debt: [{ usd: 5_000 }] } as never,
};

describe("simulate folds existing positions", () => {
  it("fresh borrow: HF from the new collateral only", () => {
    const s = simulate([table], sel, 0.5)!;
    expect(s.existingDebt).toBe(0);
    expect(s.hf).toBeCloseTo((10 * 2500 * 0.83) / 10_062.5, 6);
  });
  it("same pool: existing collateral and debt share the health factor", () => {
    const s = simulate([table], sel, 0.5, [existing])!;
    expect(s.existingDebt).toBe(5_000);
    expect(s.hf).toBeCloseTo((10 * 2500 * 0.83 + 10_000 * 0.78) / 15_062.5, 6);
    // liquidation price of WETH with the old collateral held constant
    expect(s.liq).toBeCloseTo((15_062.5 - 10_000 * 0.78) / (10 * 0.83), 6);
  });
  it("at zero borrow: existing debt against existing plus newly supplied collateral", () => {
    expect(simulate([table], sel, 0, [existing])!.hf).toBeCloseTo((20_750 + 7_800) / 5_000, 6);
  });
  it("different isolated market is not folded", () => {
    const iso = { ...existing, protocolId: "morpho-blue", position: { ...existing.position, marketId: "other" } };
    const s = simulate([table], sel, 0.5, [iso])!;
    expect(s.existingDebt).toBe(0);
  });
});
