import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BorrowReview, reviewIssue, reviewTerms } from "../components/BorrowReview";
import { simulate } from "../components/Rail";
import type { ChainTable } from "../lib/join";

const column = { key: "aave-v3:1", id: "aave-v3", name: "Aave v3", chainId: 1, label: "Aave", error: null, stale: false };
const table: ChainTable = { chainId: 1, columns: [column], totals: {}, rows: [{
  holding: { token: { address: "0xweth", symbol: "WETH" }, units: 4 } as never,
  best: column.key,
  cells: { [column.key]: { kind: "capacity", market: { id: "aave-v3:1:weth", collateralPriceUsd: 3000, ltv: 0.8, liquidationThreshold: 0.825, liquidationPenalty: 0.05 } as never, capacity: { collateralUsd: 12000, maxBorrowUsd: 9600 } as never, rate: { borrowApyVariable: 0.05 } as never } },
}] };
const sim = () => simulate([table], { chainId: 1, colKey: column.key, rowKey: "0xweth" }, 5000)!;

describe("borrow review", () => {
  it("shows costs, accepted collateral and risk before the slide; never reports a loan was opened", () => {
    const html = renderToStaticMarkup(createElement(BorrowReview, { sim: sim(), onBack: () => {} }));
    expect(html).toContain("4 WETH");
    expect(html).toContain("$250.00");
    expect(html).toContain("Read-only preview");
    expect(html).toContain("Slide to borrow");
    expect(html.indexOf("Liquidation could begin")).toBeLessThan(html.indexOf("Slide to borrow"));
    expect(html).not.toContain("https://app.aave.com");
  });
  it("blocks the slide on stale, failed, unavailable rates, or immediately liquidatable estimates", () => {
    const s = sim();
    expect(reviewIssue(s)).toBeNull();
    for (const invalid of [{ ...s, col: { ...s.col, stale: true } }, { ...s, apy: null }, { ...s, hf: 1 }, { ...s, amount: 0 }]) {
      expect(reviewIssue(invalid)).not.toBeNull();
      const html = renderToStaticMarkup(createElement(BorrowReview, { sim: invalid, onBack: () => {} }));
      expect(html).not.toContain("Slide to borrow");
    }
    expect(reviewIssue(s, "Account read failed")).toBe("Account read failed");
  });
  it("invalidates changed terms while ignoring mere timestamp refreshes", () => {
    const s = sim();
    expect(reviewTerms({ ...s, amount: 5001 })).not.toBe(reviewTerms(s));
    expect(reviewTerms({ ...s, apy: 0.06 })).not.toBe(reviewTerms(s));
    expect(reviewTerms({ ...s, cell: { ...s.cell, market: { ...s.cell.market, fetchedAt: Date.now() } } })).toBe(reviewTerms(s));
  });
});
