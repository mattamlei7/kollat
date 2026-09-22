import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Rail, simulate } from "../components/Rail";
import { hf } from "../lib/format";
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
    const s = simulate([table], sel, 10_062.5)!;
    expect(s.existingDebt).toBe(0);
    expect(s.hf).toBeCloseTo((10 * 2500 * 0.83) / 10_062.5, 6);
  });
  it("same pool: existing collateral and debt share the health factor", () => {
    const s = simulate([table], sel, 10_062.5, [existing])!;
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
    const s = simulate([table], sel, 10_062.5, [iso])!;
    expect(s.existingDebt).toBe(0);
  });
  it("Euler position folds into any market under its debt vault, not others", () => {
    const eulerTable = { ...table, columns: [{ ...col, key: "euler-v2:1", id: "euler-v2" }], rows: [{ ...table.rows[0], cells: { "euler-v2:1": { ...table.rows[0].cells[col.key], market: { ...(market as object), id: "euler-v2:1:0xdebt:0xweth" } as never } }, best: "euler-v2:1" }] };
    const eulerSel = { ...sel, colKey: "euler-v2:1" };
    const same = { ...existing, protocolId: "euler-v2", position: { ...existing.position, marketId: "euler-v2:1:0xdebt" } };
    const other = { ...existing, protocolId: "euler-v2", position: { ...existing.position, marketId: "euler-v2:1:0xother" } };
    expect(simulate([eulerTable], eulerSel, 10_062.5, [same])!.existingDebt).toBe(5_000);
    expect(simulate([eulerTable], eulerSel, 10_062.5, [other])!.existingDebt).toBe(0);
    // prefix must be a whole segment: `fluid:1:1` is not `fluid:1:11`
    const near = { ...existing, protocolId: "euler-v2", position: { ...existing.position, marketId: "euler-v2:1:0xde" } };
    expect(simulate([eulerTable], eulerSel, 10_062.5, [near])!.existingDebt).toBe(0);
  });
});

describe("simulate uses accepted collateral", () => {
  it("supply cap: HF is computed on what the protocol takes, not the wallet balance", () => {
    // Wallet holds 10 WETH, cap only accepts 2 → maxBorrow 2 × 2500 × 0.805
    const capped = { ...table, rows: [{ ...table.rows[0], cells: { [col.key]: { ...table.rows[0].cells[col.key], capacity: { maxBorrowUsd: 4_025, collateralUsd: 5_000, cappedByLiquidity: true } as never } } }] };
    const s = simulate([capped], sel, 4_025)!;
    expect(s.hf).toBeCloseTo((2 * 2500 * 0.83) / 4_025, 6);
    expect(s.liq).toBeCloseTo(4_025 / (2 * 0.83), 6);
  });
});

function comparisonTable(max = 20_000): ChainTable {
  const base = table.rows[0].cells[col.key];
  if (base.kind !== "capacity") throw new Error("Expected capacity fixture");
  const alternate = { ...col, key: "spark:1", id: "spark", name: "Spark" };
  return {
    ...table,
    columns: [col, alternate],
    rows: [{ ...table.rows[0], cells: {
      [col.key]: { ...base, capacity: { ...base.capacity, maxBorrowUsd: 10_000 }, rate: { borrowApyVariable: 0.05 } as never },
      [alternate.key]: { ...base, capacity: { ...base.capacity, maxBorrowUsd: max }, rate: { borrowApyVariable: 0.03 } as never },
    } }],
  };
}

describe("fixed requested borrow amount", () => {
  it("keeps $5,000 when switching between routes with different capacities", () => {
    const routes = comparisonTable();
    const first = simulate([routes], sel, 5_000)!;
    const second = simulate([routes], { ...sel, colKey: "spark:1" }, first.amount)!;
    expect(first.amount).toBe(5_000);
    expect(second.amount).toBe(5_000);
    expect(second.withinCapacity).toBe(true);
    expect(first.costPerYear).toBe(250);
    expect(second.costPerYear).toBe(150);
    expect(first.cheaper?.saving).toBeCloseTo(100);
  });

  it("preserves the request when a different route or refreshed capacity is too low", () => {
    const selected = { ...sel, colKey: "spark:1" };
    for (const max of [20_000, 3_000, 0, 20_000]) {
      const result = simulate([comparisonTable(max)], selected, 5_000)!;
      expect(result.amount).toBe(5_000);
      expect(result.withinCapacity).toBe(max >= 5_000);
    }
  });

  it("does not suggest a cheaper route that cannot support the same amount", () => {
    expect(simulate([comparisonTable(4_999)], sel, 5_000)!.cheaper).toBeNull();
    expect(simulate([comparisonTable(5_000)], sel, 5_000)!.cheaper?.col.id).toBe("spark");
  });

  it("does not suggest stale or failed cheaper routes", () => {
    for (const overrides of [{ stale: true }, { error: "Unavailable" }]) {
      const routes = comparisonTable();
      routes.columns[1] = { ...routes.columns[1], ...overrides };
      expect(simulate([routes], sel, 5_000)!.cheaper).toBeNull();
    }
  });

  it("preserves cents and accepts exactly the capacity without rounding up", () => {
    const selected = { ...sel, colKey: "spark:1" };
    expect(simulate([comparisonTable(5_000.25)], selected, 5_000.25)!.withinCapacity).toBe(true);
    expect(simulate([comparisonTable(5_000.25)], selected, 5_000.26)!.withinCapacity).toBe(false);
    expect(simulate([table], sel, 5_000.25)!.amount).toBe(5_000.25);
  });

  it("supports zero and rejects negative or non-finite requests", () => {
    expect(simulate([table], sel, 0)!.amount).toBe(0);
    for (const amount of [-1, Infinity, NaN]) expect(simulate([table], sel, amount)).toBeNull();
  });

  it("keeps the amount when switching collateral", () => {
    const routes = comparisonTable();
    routes.rows.push({ ...routes.rows[0], holding: { ...routes.rows[0].holding, token: { ...routes.rows[0].holding.token, address: "0xother" } } });
    expect(simulate([routes], { ...sel, rowKey: "0xother" }, 5_000)!.amount).toBe(5_000);
  });

  function renderSimulator(max: number, amount = 5_000) {
    const sim = simulate([comparisonTable(max)], { ...sel, colKey: "spark:1" }, amount)!;
    return renderToStaticMarkup(createElement(Rail, {
      sim, hint: "", positions: null, onAmount: () => {}, onSelect: () => {}, view: "sim", onView: () => {},
    }));
  }

  it("renders an over-limit warning without changing the input or offering an external handoff", () => {
    const html = renderSimulator(3_000);
    expect(html).toContain('value="5000"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("cannot support your requested $5,000.00");
    expect(html).toContain("Estimated maximum: $3,000.00");
    expect(html).toContain("below requested amount");
    expect(html).toContain("Amount exceeds this option’s limit");
    expect(html).not.toContain("Open Spark");
  });

  it("offers review before handoff within capacity, but not for zero", () => {
    expect(renderSimulator(5_000)).toContain("Review borrow");
    expect(renderSimulator(5_000)).not.toContain("Open Spark");
    expect(renderSimulator(5_000)).toContain("Know before you borrow");
    expect(renderSimulator(5_000, 0)).not.toContain("Open Spark");
    expect(renderSimulator(5_000, 0)).toContain("Enter a borrow amount");
  });

  it("caps the displayed USDC amount at two decimals without rounding simulation inputs", () => {
    const amount = 1_234.567891;
    const html = renderSimulator(5_000, amount);
    const input = html.match(/<input[^>]*id="sim-amount"[^>]*>/)?.[0];
    expect(input).toContain('value="1234.57"');
    const result = simulate([table], sel, amount)!;
    expect(result.amount).toBe(amount);
    expect(result.hf).toBeCloseTo((10 * 2500 * 0.83) / amount, 10);
  });

  it("keeps health-factor displays at the hundredth place", () => {
    expect(hf(1.23456789)).toBe("1.23");
    expect(hf(1.99999999)).toBe("2.00");
  });
});
