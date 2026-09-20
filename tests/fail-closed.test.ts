import { describe, expect, it } from "vitest";
import { BaseLendingProtocol } from "../lib/protocols/base";
import type { ChainId, Market, Position, ProtocolId, Rate } from "../lib/protocols/types";

const token = { chainId: 1 as ChainId, address: "0x0000000000000000000000000000000000000001" as const, symbol: "WETH", decimals: 18 };
const market = (over: Partial<Market>): Market => ({
  id: "fake:1:WETH>USDC", protocol: "fake" as ProtocolId, chainId: 1, collateral: token, debt: { ...token, symbol: "USDC" },
  ltv: 0.8, liquidationThreshold: 0.83, liquidationPenalty: 0.05, collateralPriceUsd: 2500, debtPriceUsd: 1,
  availableLiquidity: 10n ** 12n, status: "active", fetchedAt: 0, ...over,
});
const position = (usd: number): Position => ({
  protocol: "fake" as ProtocolId, chainId: 1, marketId: null,
  collateral: [{ token, amount: 10n ** 18n, usd, liquidationThreshold: 0.83 }],
  debt: [{ token: { ...token, symbol: "USDC" }, amount: 10n ** 6n, usd: 1 }],
  healthFactor: usd * 0.83, healthFactorReported: null, liquidationPrices: [], uniformDrawdownToLiquidation: null, notes: [], fetchedAt: 0,
});

// One adapter per case: the base class caches by (id, chain, method).
function fake(n: number, markets: Market[], positions: Position[]) {
  return new (class extends BaseLendingProtocol {
    readonly id = `fake${n}` as ProtocolId; readonly name = "Fake"; readonly chainId = 1 as ChainId;
    protected async fetchMarkets() { return markets; }
    protected async fetchRates(): Promise<Rate[]> { return []; }
    protected async fetchPositions() { return positions; }
  })();
}
const ADDR = "0x000000000000000000000000000000000000dEaD";

describe("fail-closed data contract", () => {
  it("a market with a zero, NaN or inverted risk param is listed as unpriced, not active", async () => {
    const r = await fake(1, [market({}), market({ id: "a", collateralPriceUsd: 0 }), market({ id: "b", debtPriceUsd: NaN }), market({ id: "c", ltv: 0.9 }), market({ id: "d", status: "paused", collateralPriceUsd: 0 })], []).getMarkets();
    expect(r.ok && r.data.map((m) => m.status)).toEqual(["active", "unpriced", "unpriced", "unpriced", "paused"]);
  });
  it("a position with an unpriced leg is withheld as INVALID_DATA, never returned with a wrong health factor", async () => {
    const good = await fake(2, [market({})], [position(2500)]).getPositions(ADDR);
    expect(good.ok && good.data[0].healthFactor).toBeCloseTo(2075);
    const bad = await fake(3, [market({})], [position(0)]).getPositions(ADDR);
    expect(!bad.ok && bad.error.code).toBe("INVALID_DATA");
    expect(!bad.ok && bad.error.message).toContain("WETH");
  });
});
