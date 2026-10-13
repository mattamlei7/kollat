import { describe, expect, it } from "vitest";
import { liquidityByProtocol } from "../lib/liquidity";

const m = (id: string, usdc: number) => ({ id, availableLiquidity: BigInt(usdc * 1e6), debtPriceUsd: 1, debt: { decimals: 6 }, fetchedAt: 5 });

describe("liquidityByProtocol", () => {
  it("counts a shared pool once, isolated markets each, and Euler once per debt vault", () => {
    const r = liquidityByProtocol([
      { id: "aave-v3", name: "Aave v3", chainId: 1, markets: { ok: true, data: [m("aave-v3:1:WETH>USDC", 100), m("aave-v3:1:WBTC>USDC", 100)] } },
      { id: "aave-v3", name: "Aave v3", chainId: 8453, markets: { ok: true, data: [m("aave-v3:8453:WETH>USDC", 50)] } },
      { id: "morpho-blue", name: "Morpho", chainId: 1, markets: { ok: true, data: [m("morpho-blue:1:0xa", 30), m("morpho-blue:1:0xb", 20)] } },
      { id: "euler-v2", name: "Euler", chainId: 1, markets: { ok: true, data: [m("euler-v2:1:0xd:0xc1", 40), m("euler-v2:1:0xd:0xc2", 40), m("euler-v2:1:0xe:0xc1", 10)] } },
      { id: "fluid", name: "Fluid", chainId: 1, markets: { ok: false } },
    ]);
    expect(r.byProtocol).toEqual([{ name: "Aave v3", usd: 150 }, { name: "Morpho", usd: 50 }, { name: "Euler", usd: 50 }]);
    expect(r.liquidityUsd).toBe(250);
    expect(r.updatedAt).toBe(5);
  });
});
