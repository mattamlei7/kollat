import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate, PolicySchema, type Policy } from "../lib/policy";
import type { Position, Result } from "../lib/protocols/types";
import type { AccountSnapshot, MarketsSnapshot } from "../lib/snapshot";

const NOW = 1_800_000_000_000;
const policy: Policy = PolicySchema.parse(JSON.parse(readFileSync("policy.example.json", "utf8")));
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ok = <T>(data: T, over: Partial<Extract<Result<T>, { ok: true }>> = {}): Result<T> => ({ ok: true, data, fetchedAt: NOW - 1000, stale: false, ...over });

// Wallet holds 10 WETH @ $2,500 on Aave (ltv 0.8, LT 0.83): capacity $20,000, collateral $25,000.
const market = { id: "aave-v3:1:WETH>USDC", protocol: "aave-v3", chainId: 1, collateral: { chainId: 1, address: WETH, symbol: "WETH", decimals: 18 }, debt: { chainId: 1, address: USDC, symbol: "USDC", decimals: 6 }, ltv: 0.8, liquidationThreshold: 0.83, liquidationPenalty: 0.05, collateralPriceUsd: 2500, debtPriceUsd: 1, availableLiquidity: 10n ** 12n, status: "active", fetchedAt: NOW } as const;
const capacity = { marketId: market.id, collateralBalance: 10n * 10n ** 18n, collateralUsd: 25_000, maxBorrowUsd: 20_000, liquidationPriceAtMaxUsd: 0, cappedByLiquidity: false };

function snapshots(over: { markets?: Partial<MarketsSnapshot["protocols"][0]>; account?: Partial<AccountSnapshot["protocols"][0]> } = {}) {
  const markets: MarketsSnapshot = { chains: [1], generatedAt: NOW, protocols: [{ id: "aave-v3", name: "Aave v3", chainId: 1, markets: ok([market]), rates: ok([]), ...over.markets }] };
  const account: AccountSnapshot = { input: "x", address: "0x000000000000000000000000000000000000dEaD", ens: null, chains: [1], generatedAt: NOW, holdings: [], protocols: [{ id: "aave-v3", name: "Aave v3", chainId: 1, capacity: ok([capacity]), positions: ok([]), ...over.account }] };
  return [markets, account] as const;
}
const proposal = { address: "0x000000000000000000000000000000000000dead", chainId: 1, protocolId: "aave-v3", marketId: market.id, borrowUsd: 5_000 };

describe("policy engine", () => {
  it("allows a conservative borrow and reports post-action risk", () => {
    const d = evaluate(policy, proposal, ...snapshots(), NOW);
    expect(d.allow).toBe(true);
    expect(d.post?.ltv).toBeCloseTo(0.2);
    expect(d.post?.healthFactor).toBeCloseTo(25_000 * 0.83 / 5_000);
    expect(d.post?.drawdownToLiquidation).toBeCloseTo(1 - 5_000 / (25_000 * 0.83));
    expect(d.safeMaxUsd).toBeCloseTo(10_000); // maxLtv 0.4 × $25k binds before HF 1.5 ($13.8k) and capacity ($20k)
    expect(d.policyVersion).toBe(policy.version);
  });
  it("denies over max LTV with a stable code and the safe maximum", () => {
    const d = evaluate(policy, { ...proposal, borrowUsd: 12_000 }, ...snapshots(), NOW);
    expect(d.allow).toBe(false);
    expect(d.reasons).toEqual(["LTV_EXCEEDS_MAX"]);
    expect(d.safeMaxUsd).toBeCloseTo(10_000);
  });
  it("folds an existing position into the post-action numbers", () => {
    const position = { protocol: "aave-v3", chainId: 1, marketId: null, collateral: [{ token: market.collateral, amount: 0n, usd: 5_000, liquidationThreshold: 0.83 }], debt: [{ token: market.debt, amount: 0n, usd: 8_000 }], healthFactor: 0.52, healthFactorReported: null, liquidationPrices: [], uniformDrawdownToLiquidation: null, notes: [], fetchedAt: NOW } as Position;
    const d = evaluate(policy, proposal, ...snapshots({ account: { positions: ok([position]) } }), NOW);
    expect(d.pre).toEqual({ debtUsd: 8_000, healthFactor: expect.closeTo(5_000 * 0.83 / 8_000, 5) });
    expect(d.post?.debtUsd).toBe(13_000);
    expect(d.reasons).toEqual(["LTV_EXCEEDS_MAX"]); // 13k / 30k = 0.433 > 0.4
    expect(d.safeMaxUsd).toBeCloseTo(0.4 * 30_000 - 8_000);
  });
  it("denies by default outside the allowlists", () => {
    expect(evaluate(policy, { ...proposal, protocolId: "euler-v2" }, ...snapshots(), NOW).reasons).toEqual(["PROTOCOL_NOT_ALLOWED"]);
    expect(evaluate({ ...policy, collateralAssets: [USDC.toLowerCase()] }, proposal, ...snapshots(), NOW).reasons).toEqual(["COLLATERAL_NOT_ALLOWED"]);
  });
  it("fails closed on missing, stale or old data — never a fabricated allow", () => {
    const err: Result<never> = { ok: false, error: { code: "RPC_UNAVAILABLE", message: "boom", retryable: true } };
    expect(evaluate(policy, proposal, ...snapshots({ account: { positions: err } }), NOW).reasons).toEqual(["DATA_UNAVAILABLE"]);
    expect(evaluate(policy, proposal, ...snapshots({ markets: { markets: ok([market], { stale: true }) } }), NOW).reasons).toEqual(["DATA_STALE"]);
    expect(evaluate(policy, proposal, ...snapshots(), NOW + policy.maxDataAgeMs + 5_000).reasons).toEqual(["DATA_STALE"]);
    expect(evaluate(policy, proposal, ...snapshots({ markets: { markets: ok([{ ...market, status: "unpriced" }]) } }), NOW).reasons).toEqual(["MARKET_NOT_ACTIVE"]);
  });
});
