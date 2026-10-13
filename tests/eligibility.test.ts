import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewIssue, reviewTerms } from "../components/BorrowReview";
import { AmountInput, formatAmount } from "../components/AmountInput";
import { groupHoldings } from "../components/HoldingsPicker";
import { simulate } from "../components/Rail";
import { assessRoute, parseAmount, routesFor } from "../lib/eligibility";
import type { ChainTable, Column, Row } from "../lib/join";

/**
 * Test data, labelled as such: 10 WETH at $2,500 (ltv 0.8) on up to four protocols. Each route can set its rate,
 * available USDC, accepted collateral (a supply cap) and freshness; a protocol can list more than one market.
 */
interface Route {
  id: string;
  apy?: number | null;
  liquidity?: number;
  acceptedUsd?: number;
  stale?: boolean;
  error?: string | null;
  /** Extra markets for the same collateral on this protocol, by liquidation threshold. */
  extra?: { lt: number; apy: number }[];
}
const market = (id: string, lt: number, liquidity: number) => ({
  id, collateralPriceUsd: 2500, ltv: 0.8, liquidationThreshold: lt, liquidationPenalty: 0.05,
  availableLiquidity: String(liquidity * 1e6), debtPriceUsd: 1, debt: { decimals: 6, symbol: "USDC" }, collateral: { symbol: "WETH" },
});
function tableOf(routes: Route[]): ChainTable {
  const columns: Column[] = routes.map((r) => ({ key: `${r.id}:1`, id: r.id, name: r.id, chainId: 1, label: r.id, error: r.error ?? null, stale: r.stale ?? false }));
  const options = Object.fromEntries(routes.map((r) => {
    const liquidity = r.liquidity ?? 1_000_000;
    const acceptedUsd = r.acceptedUsd ?? 25_000;
    const capacity = { maxBorrowUsd: Math.min(acceptedUsd * 0.8, liquidity), collateralUsd: acceptedUsd };
    const main = { kind: "capacity", market: market(`${r.id}:1:weth`, 0.83, liquidity), capacity, rate: r.apy === null ? null : { borrowApyVariable: r.apy ?? 0.05 } };
    const extra = (r.extra ?? []).map((x, i) => ({ kind: "capacity", market: market(`${r.id}:1:weth:${i}`, x.lt, liquidity), capacity, rate: { borrowApyVariable: x.apy } }));
    return [`${r.id}:1`, [main, ...extra]];
  }));
  const cells = Object.fromEntries(Object.entries(options).map(([k, v]) => [k, v[0]]));
  return {
    chainId: 1, columns, totals: {},
    rows: [{ holding: { token: { address: "0xweth", symbol: "WETH" }, units: 10, usd: 25_000 } as never, status: "supported", cells: cells as never, options: options as never, best: columns[0].key }],
  };
}
const row = (t: ChainTable) => t.rows[0];
const sel = (id: string, marketId?: string) => ({ chainId: 1, rowKey: "0xweth", colKey: `${id}:1`, marketId });

describe("the request stays the borrower's", () => {
  it("keeps the amount and collateral across route changes, even when a route cannot fund them", () => {
    const t = tableOf([{ id: "aave", liquidity: 3_000 }, { id: "spark" }]);
    for (const id of ["aave", "spark", "aave"]) {
      const s = simulate([t], sel(id), 5_000, null, 4)!;
      expect(s.amount).toBe(5_000);
      expect(s.units).toBe(4);
    }
    expect(simulate([t], sel("aave"), 5_000, null, 4)!.withinCapacity).toBe(false);
  });

  it("parses typed amounts without NaN: empty, zero, grouped, malformed, negative and oversized", () => {
    expect(parseAmount("")).toEqual({ value: 0, error: null });
    expect(parseAmount("5,000.25")).toEqual({ value: 5000.25, error: null });
    for (const bad of ["abc", "1.2.3", ".", "1e5", "$5"]) expect(parseAmount(bad).value).toBeNull();
    expect(parseAmount("-5").error).toMatch(/zero or more/);
    expect(parseAmount("9".repeat(16)).error).toMatch(/up to/);
  });

  it("formats USDC to cents and collateral to six places, and shows zero as empty", () => {
    expect(formatAmount(0)).toBe("");
    expect(formatAmount(1234567.891)).toBe("1,234,567.89");
    expect(formatAmount(7.23561234, 6)).toBe("7.235612");
    expect(renderToStaticMarkup(createElement(AmountInput, { id: "x", value: 0, onChange: () => {} }))).toContain('value=""');
  });
});

describe("route eligibility", () => {
  it("does not rank or allow review when the requested collateral exceeds the wallet balance", () => {
    const t = tableOf([{ id: "aave" }]);
    const check = assessRoute(t, row(t), t.columns[0], 1_000, 11, null)!;
    expect(check.status).toBe("short");
    expect(check.reason).toMatch(/exceeds your balance/);
    expect(routesFor(t, row(t), 1_000, 11, null).eligible).toHaveLength(0);
    expect(reviewIssue(simulate([t], sel("aave"), 1_000, null, 11)!)).not.toBeNull();
  });
  it("distinguishes insufficient collateral from limited market liquidity, with the exact shortfall in details", () => {
    const t = tableOf([{ id: "liq", liquidity: 3_000 }, { id: "col" }]);
    const liq = assessRoute(t, row(t), t.columns[0], 5_000, 10, null)!;
    const col = assessRoute(t, row(t), t.columns[1], 5_000, 2, null)!;
    expect(liq.label).toBe("Limited market liquidity");
    expect(liq.detail).toMatch(/2,000 below your 5,000/);
    expect(col.label).toBe("Insufficient collateral");
    expect(col.detail).toMatch(/1,000 below your 5,000/);
  });

  it("checks every route for the same collateral quantity, and names a supply cap that cannot take it", () => {
    const t = tableOf([{ id: "capped", acceptedUsd: 5_000 }, { id: "open" }]);
    const capped = assessRoute(t, row(t), t.columns[0], 1_000, 4, null)!;
    const open = assessRoute(t, row(t), t.columns[1], 1_000, 4, null)!;
    expect(capped.label).toBe("Supply cap");
    expect(capped.reason).toBe("Accepts at most 2 WETH");
    expect(open.units).toBe(4);
    expect(open.status).toBe("fundable");
  });

  it("is indicative until both amounts are entered: fresh priced routes, no lowest-rate label", () => {
    const t = tableOf([{ id: "a", apy: 0.03 }, { id: "b", apy: 0.02 }, { id: "c", apy: null }]);
    const list = routesFor(t, row(t), 0, null, null);
    expect(list.specified).toBe(false);
    expect(list.eligible.map((r) => r.col.id)).toEqual(["b", "a"]);
    expect(list.lowest).toEqual([]);
    expect(routesFor(t, row(t), 5_000, null, null).specified).toBe(false);
  });

  it("lists one route per market, so different collateral terms on one protocol stay separate", () => {
    const t = tableOf([{ id: "morpho", apy: 0.05, extra: [{ lt: 0.915, apy: 0.04 }] }]);
    const list = routesFor(t, row(t), 5_000, 4, null);
    expect(list.eligible.map((r) => r.label)).toEqual(["morpho · 91.5% liq. threshold", "morpho · 83% liq. threshold"]);
    expect(new Set(list.eligible.map((r) => r.key)).size).toBe(2);
  });
});

describe("lowest rate", () => {
  it("leaves stale and failed routes out of the ranking and says why", () => {
    const t = tableOf([{ id: "stale", apy: 0.01, stale: true }, { id: "failed", apy: 0.01, error: "RPC down" }, { id: "fresh", apy: 0.05 }]);
    const list = routesFor(t, row(t), 5_000, 4, null);
    expect(list.eligible.map((r) => r.col.id)).toEqual(["fresh"]);
    expect(list.lowest).toEqual(["fresh:1|fresh:1:weth"]);
    expect(list.other.map((r) => r.check.label)).toEqual(["Fresh data unavailable", "Fresh data unavailable"]);
  });

  it("never lets a missing rate win", () => {
    const t = tableOf([{ id: "norate", apy: null }, { id: "priced", apy: 0.09 }]);
    const list = routesFor(t, row(t), 5_000, 4, null);
    expect(list.eligible.map((r) => r.col.id)).toEqual(["priced"]);
    expect(list.other.map((r) => r.col.id)).toEqual(["norate"]);
  });

  it("ranks only routes that can fund the request", () => {
    const t = tableOf([{ id: "cheap", apy: 0.01, liquidity: 1_000 }, { id: "dear", apy: 0.06 }]);
    expect(routesFor(t, row(t), 5_000, 4, null).eligible.map((r) => r.col.id)).toEqual(["dear"]);
  });

  it("shares the label between tied rates, and has none when nothing can fund the request", () => {
    const t = tableOf([{ id: "a", apy: 0.04 }, { id: "b", apy: 0.04 }, { id: "c", apy: 0.05 }]);
    expect(routesFor(t, row(t), 5_000, 4, null).lowest).toHaveLength(2);
    const none = routesFor(t, row(t), 50_000, 4, null);
    expect(none.eligible).toEqual([]);
    expect(none.lowest).toEqual([]);
  });

  it("offers a lower-rate alternative only if it can fund the same loan, and points at a route the borrower can select", () => {
    const short = tableOf([{ id: "sel", apy: 0.06 }, { id: "alt", apy: 0.02, liquidity: 1_000 }]);
    expect(simulate([short], sel("sel"), 5_000, null, 4)!.cheaper).toBeNull();
    const fair = tableOf([{ id: "sel", apy: 0.06 }, { id: "alt", apy: 0.02 }]);
    const cheaper = simulate([fair], sel("sel"), 5_000, null, 4)!.cheaper!;
    expect(cheaper.selection).toEqual({ chainId: 1, rowKey: "0xweth", colKey: "alt:1", marketId: "alt:1:weth" });
    expect(cheaper.saving).toBeCloseTo(200);
    expect(simulate([fair], cheaper.selection, 5_000, null, 4)!.col.id).toBe("alt");
  });
});

describe("existing debt", () => {
  it("folds existing debt into the risk and can block a route that would open at liquidation", () => {
    const t = tableOf([{ id: "aave-v3" }]);
    const debt = { key: "k", protocolId: "aave-v3", name: "", chainId: 1, label: "", stale: false, position: { marketId: null, collateral: [], debt: [{ usd: 9_000 }] } } as never;
    const check = assessRoute(t, row(t), t.columns[0], 1_000, 4, [debt])!;
    expect(check.existingDebt).toBe(9_000);
    expect(check.status).toBe("liquidatable");
  });
});

describe("holdings", () => {
  it("orders supported holdings by value and keeps small, unsupported and unreadable ones apart", () => {
    const base = tableOf([{ id: "a" }]);
    const holding = (symbol: string, usd: number, status: Row["status"]) => ({ ...base.rows[0], holding: { token: { address: `0x${symbol}`, symbol }, units: 1, usd } as never, status });
    const t: ChainTable = { ...base, rows: [holding("WBTC", 900, "supported"), holding("WETH", 25_000, "supported"), holding("DUST", 0.5, "supported"), holding("PEPE", 300, "unsupported"), holding("X", 50, "data-unavailable")] };
    const g = groupHoldings([t]);
    expect(g.main.map((h) => h.row.holding.token.symbol)).toEqual(["WETH", "WBTC"]);
    expect(g.small.map((h) => h.row.holding.token.symbol)).toEqual(["DUST"]);
    expect(g.unsupported.map((h) => h.row.holding.token.symbol)).toEqual(["PEPE"]);
    expect(g.unavailable.map((h) => h.row.holding.token.symbol)).toEqual(["X"]);
  });
});

describe("review", () => {
  // Real protocol ids: the review gate also requires a supported handoff.
  const t = tableOf([{ id: "aave-v3", apy: 0.05 }, { id: "spark", apy: 0.04 }, { id: "compound-v3", liquidity: 1_000 }]);
  const base = () => simulate([t], sel("aave-v3"), 5_000, null, 4)!;

  it("invalidates reviewed terms when the amount, collateral, route or rate changes", () => {
    const terms = reviewTerms(base());
    expect(reviewTerms(simulate([t], sel("aave-v3"), 5_001, null, 4)!)).not.toBe(terms);
    expect(reviewTerms(simulate([t], sel("aave-v3"), 5_000, null, 5)!)).not.toBe(terms);
    expect(reviewTerms(simulate([t], sel("spark"), 5_000, null, 4)!)).not.toBe(terms);
    expect(reviewTerms({ ...base(), apy: 0.07 })).not.toBe(terms);
    expect(reviewTerms(base())).toBe(terms);
  });

  it("blocks review for routes the shared check cannot fund, and for stale data", () => {
    expect(reviewIssue(base())).toBeNull();
    expect(reviewIssue(simulate([t], sel("compound-v3"), 5_000, null, 4)!)).not.toBeNull();
    const stale = tableOf([{ id: "aave-v3", stale: true }]);
    expect(reviewIssue(simulate([stale], sel("aave-v3"), 5_000, null, 4)!)).toMatch(/fresh data/);
  });
});
