import { describe, expect, it } from "vitest";
import { simulate } from "../components/Rail";
import type { ChainTable, PositionView } from "../lib/join";

// Minimal fixture: 10 WETH on one protocol. Only the fields simulate() reads are real.
const market = { id: "aave-v3:1:WETH", collateralPriceUsd: 2500, liquidationThreshold: 0.83, ltv: 0.805, liquidationPenalty: 0.05 } as never;
const col = { key: "aave-v3:1", id: "aave-v3", name: "Aave v3", chainId: 1, label: "Aave v3 · Ethereum", error: null, stale: false };
const table: ChainTable = {
  chainId: 1,
  columns: [col],
  rows: [{ holding: { token: { address: "0xweth", symbol: "WETH", decimals: 18 }, units: 10 } as never, cells: { [col.key]: { kind: "capacity", market, capacity: { maxBorrowUsd: 20_125, collateralUsd: 25_000 } as never, rate: null } }, best: col.key }],
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
  it("Euler position folds into any market under its debt vault, not others", () => {
    const eulerTable = { ...table, columns: [{ ...col, key: "euler-v2:1", id: "euler-v2" }], rows: [{ ...table.rows[0], cells: { "euler-v2:1": { ...table.rows[0].cells[col.key], market: { ...(market as object), id: "euler-v2:1:0xdebt:0xweth" } as never } }, best: "euler-v2:1" }] };
    const eulerSel = { ...sel, colKey: "euler-v2:1" };
    const same = { ...existing, protocolId: "euler-v2", position: { ...existing.position, marketId: "euler-v2:1:0xdebt" } };
    const other = { ...existing, protocolId: "euler-v2", position: { ...existing.position, marketId: "euler-v2:1:0xother" } };
    expect(simulate([eulerTable], eulerSel, 0.5, [same])!.existingDebt).toBe(5_000);
    expect(simulate([eulerTable], eulerSel, 0.5, [other])!.existingDebt).toBe(0);
    // prefix must be a whole segment: `fluid:1:1` is not `fluid:1:11`
    const near = { ...existing, protocolId: "euler-v2", position: { ...existing.position, marketId: "euler-v2:1:0xde" } };
    expect(simulate([eulerTable], eulerSel, 0.5, [near])!.existingDebt).toBe(0);
  });
});

describe("simulate uses accepted collateral", () => {
  it("supply cap: HF is computed on what the protocol takes, not the wallet balance", () => {
    // Wallet holds 10 WETH, cap only accepts 2 → maxBorrow 2 × 2500 × 0.805
    const capped = { ...table, rows: [{ ...table.rows[0], cells: { [col.key]: { ...table.rows[0].cells[col.key], capacity: { maxBorrowUsd: 4_025, collateralUsd: 5_000, cappedByLiquidity: true } as never } } }] };
    const s = simulate([capped], sel, 1)!;
    expect(s.hf).toBeCloseTo((2 * 2500 * 0.83) / 4_025, 6);
    expect(s.liq).toBeCloseTo(4_025 / (2 * 0.83), 6);
  });
});
