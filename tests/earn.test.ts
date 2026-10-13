import { decodeFunctionData, getAddress, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { AAVE_POOL_WRITE_ABI } from "../lib/execution/aave";
import { VAULT_WRITE_ABI, constrainedWithdrawalLimit, depositPlan, withdrawPlan } from "../lib/earn/execute";
import { parseAmountInput, rankOpportunities, reviewChange, reviewedTerms, withdrawalState, yearlyEarnings } from "../lib/earn/rank";
import type { Opportunity } from "../lib/earn/types";

const NOW = 1_800_000_000_000;
const usdc = { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 } as const;
const opp = (id: string, o: Partial<Opportunity> = {}): Opportunity => ({
  id, product: "morpho-vault", protocol: "Morpho", chainId: 1, name: id, operator: "Curator", asset: usdc,
  receipt: { address: "0x00000000000000000000000000000000000000aa", symbol: "v", decimals: 18, kind: "vault shares" },
  target: "0x00000000000000000000000000000000000000bb", baseApy: 0.04, rateKind: "variable", rewards: [], fees: [],
  capacity: "unlimited", liquidity: "1000000000", withdrawal: "", status: "active", usedFor: "", exposure: "", conversion: null,
  allocations: null, docsUrl: "", explorerUrl: "", fetchedAt: NOW, error: null, ...o,
});
const u = (n: number) => BigInt(Math.round(n * 1e6));

describe("ranking earn destinations", () => {
  it("ranks only fresh, known, accepting destinations by net base APY; ties break by id; nothing else is ranked", () => {
    const rows = rankOpportunities([
      opp("b", { baseApy: 0.05 }), opp("a", { baseApy: 0.05 }), opp("c", { baseApy: 0.06, fetchedAt: NOW - 20 * 60_000 }),
      opp("d", { baseApy: null, error: "API down" }), opp("e", { baseApy: 0.09, capacity: u(10).toString() }), opp("f", { baseApy: 0.03, status: "frozen" }),
    ], u(100), NOW);
    expect(rows.map((r) => [r.opp.id, r.eligible, r.reason, r.highest])).toEqual([
      ["a", true, null, true], ["b", true, null, false],
      ["c", false, "Rate out of date", false], ["d", false, "Data unavailable", false], ["e", false, "Above deposit capacity", false], ["f", false, "Deposits frozen", false],
    ]);
  });
  it("without an amount, capacity does not exclude anyone", () => {
    expect(rankOpportunities([opp("e", { capacity: "5" })], null, NOW)[0].eligible).toBe(true);
  });
  it("does not recommend full or unknown-capacity destinations before an amount is entered", () => {
    const rows = rankOpportunities([opp("full", { capacity: "0" }), opp("unknown", { capacity: null })], null, NOW);
    expect(rows.every(r => !r.eligible && !r.highest)).toBe(true);
  });
  it("withdrawal availability comes from measured liquidity, never assumed", () => {
    expect(withdrawalState(opp("a", { liquidity: null }), u(1)).state).toBe("Unavailable");
    expect(withdrawalState(opp("a", { liquidity: u(50).toString() }), u(100)).state).toBe("Limited liquidity");
    expect(withdrawalState(opp("a"), u(100)).state).toBe("Available now");
  });
  it("earnings use the displayed rate; a missing rate is unknown, not zero", () => {
    expect(yearlyEarnings(opp("a"), u(1000))).toBeCloseTo(40);
    expect(yearlyEarnings(opp("a", { baseApy: null }), u(1000))).toBeNull();
  });
  it("a material rate, status, capacity or amount change invalidates a review; block-to-block drift does not", () => {
    const r = reviewedTerms(opp("a"), u(5));
    expect(reviewChange(r, opp("a", { baseApy: 0.042 }), u(5))).toBeNull();
    expect(reviewChange(r, opp("a", { baseApy: 0.043 }), u(5))).toMatch(/4.00% to 4.30%/);
    expect(reviewChange(r, opp("a", { status: "frozen" }), u(5))).toMatch(/status/);
    expect(reviewChange(r, opp("a", { capacity: u(1).toString() }), u(5))).toMatch(/no longer accept/);
    expect(reviewChange(r, opp("a"), u(6))).toMatch(/amount/);
  });
  it("parses amounts exactly and rejects extra precision", () => {
    expect(parseAmountInput("1,234.5", 6)).toEqual({ value: 1_234_500_000n, error: null });
    expect(parseAmountInput("0.0000001", 6).error).toMatch(/6 decimal/);
    expect(parseAmountInput("abc", 6).error).toBeTruthy();
  });
  it("refuses stale or incomplete destination data at confirmation, even when the rate is unchanged", () => {
    const r = reviewedTerms(opp("a"), u(5));
    expect(reviewChange(r, opp("a", { fetchedAt: NOW - 20 * 60_000 }), u(5), NOW)).toMatch(/out of date/);
    expect(reviewChange(r, opp("a", { capacity: null }), u(5), NOW)).toMatch(/Capacity unavailable/);
    expect(reviewChange(r, opp("a", { error: "Read failed" }), u(5), NOW)).toMatch(/Data unavailable/);
    expect(rankOpportunities([opp("unknown", { status: "unknown" })], u(5), NOW)[0].eligible).toBe(false);
  });
});

describe("earn plans", () => {
  it("respects existing collateral-backed debt instead of treating all pool cash as withdrawable", async () => {
    expect(await constrainedWithdrawalLimit(1000n, async amount => amount <= 321n)).toBe(321n);
    expect(await constrainedWithdrawalLimit(1000n, async () => true)).toBe(1000n);
    expect(await constrainedWithdrawalLimit(1000n, async () => false)).toBe(0n);
    await expect(constrainedWithdrawalLimit(1000n, async () => { throw new Error("RPC unavailable"); })).rejects.toThrow("RPC unavailable");
  });
  const user = getAddress("0x00000000000000000000000000000000000000c1");
  it("approves exactly the deposit, then deposits to the user's own address", () => {
    const vault = opp("v");
    const steps = depositPlan({ dest: vault, user, amount: u(100), balance: u(150), allowance: 0n, capacity: null });
    expect(steps.map((s) => s.label)).toEqual(["Approve USDC", "Deposit"]);
    expect(decodeFunctionData({ abi: VAULT_WRITE_ABI, data: steps[1].data }).args).toEqual([u(100), user]);
    expect(depositPlan({ dest: vault, user, amount: u(100), balance: u(150), allowance: u(100), capacity: null }).map((s) => s.label)).toEqual(["Deposit"]);
    expect(() => depositPlan({ dest: vault, user, amount: u(200), balance: u(150), allowance: 0n, capacity: null })).toThrow(/Not enough/);
    expect(() => depositPlan({ dest: vault, user, amount: u(100), balance: u(150), allowance: 0n, capacity: u(50) })).toThrow(/at most 50 USDC/);
  });
  it("Aave supply goes to the pool; a full withdrawal uses max", () => {
    const pool = opp("p", { product: "aave-supply" });
    const [, supply] = depositPlan({ dest: pool, user, amount: u(10), balance: u(10), allowance: 0n, capacity: null });
    expect(decodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, data: supply.data }).functionName).toBe("supply");
    const [w] = withdrawPlan({ dest: pool, user, holding: { assets: u(10), withdrawable: u(10), shares: 0n } });
    expect(decodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, data: w.data }).args).toEqual([usdc.address, maxUint256, user]);
  });
  it("a vault exit redeems every share; a partial withdrawal is by assets; illiquid amounts are refused", () => {
    const vault = opp("v");
    const holding = { assets: u(10), withdrawable: u(10), shares: 9n * 10n ** 18n };
    expect(decodeFunctionData({ abi: VAULT_WRITE_ABI, data: withdrawPlan({ dest: vault, user, holding })[0].data })).toMatchObject({ functionName: "redeem", args: [holding.shares, user, user] });
    expect(decodeFunctionData({ abi: VAULT_WRITE_ABI, data: withdrawPlan({ dest: vault, user, amount: u(4), holding })[0].data })).toMatchObject({ functionName: "withdraw", args: [u(4), user, user] });
    expect(() => withdrawPlan({ dest: vault, user, holding: { ...holding, withdrawable: u(3) } })).toThrow(/Only part/);
    expect(() => withdrawPlan({ dest: vault, user, amount: u(4), holding: { ...holding, withdrawable: u(3) } })).toThrow(/more than can be withdrawn/);
  });
});
