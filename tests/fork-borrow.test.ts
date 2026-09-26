import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import { aaveRepayPlan } from "../lib/execution/aave";
import { compoundRepayPlan } from "../lib/execution/compound";
import { moonwellBorrowPlan } from "../lib/execution/moonwell";
import { ERC20_ABI, assertNoErrorCode, withGasBuffer, type PlanStep } from "../lib/execution/common";
import { executorFor } from "../lib/execution";
import { morphoBorrowPlan, morphoRepayPlan } from "../lib/execution/morpho";
import { MORPHO_BLUE, USDC, WNATIVE } from "../lib/protocols/addresses";
import type { ChainId } from "../lib/protocols/types";

// Runs only against a local fork. FORK_OF picks the chain (default 8453, Base); FORK_PROTOCOL the lender
// (morpho-blue, aave-v3, spark, compound-v3, moonwell). E.g.
//   anvil --fork-url https://arb1.arbitrum.io/rpc
//   FORK_RPC_URL=http://127.0.0.1:8545 FORK_OF=42161 FORK_PROTOCOL=aave-v3 npm test
const RPC = process.env.FORK_RPC_URL;
const CHAIN_ID = (Number(process.env.FORK_OF) || 8453) as ChainId;
const PROTOCOL = process.env.FORK_PROTOCOL ?? "morpho-blue";
const REAL = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism, 137: polygon, 43114: avalanche }[CHAIN_ID];
const WRAPPED = WNATIVE[CHAIN_ID];

/** Morpho: prefer a market against the native coin (exercises the wrap step); otherwise the deepest USDC market. */
async function morphoMarket() {
  const query = async (collateral: string) => {
    const res = await fetch("https://blue-api.morpho.org/graphql", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ markets(first: 1, orderBy: SupplyAssetsUsd, orderDirection: Desc, where: { chainId_in: [${CHAIN_ID}], loanAssetAddress_in: ["${USDC[CHAIN_ID]}"]${collateral}, listed: true }) { items { marketId collateralAsset { address decimals priceUsd } } } }` }),
    });
    return (await res.json()).data.markets.items[0] as { marketId: Hex; collateralAsset: { address: Address; decimals: number; priceUsd: number } } | undefined;
  };
  const m = (await query(`, collateralAssetAddress_in: ["${WRAPPED}"]`)) ?? (await query(""));
  expect(m, `no listed USDC Morpho market on ${REAL.name}`).toBeTruthy();
  const { address, decimals, priceUsd } = m!.collateralAsset;
  // About $5,000 of collateral backs the $500 loan comfortably.
  return { marketId: `morpho-blue:${CHAIN_ID}:${m!.marketId}`, collateralToken: address, collateral: parseUnits((5000 / priceUsd).toFixed(Math.min(decimals, 8)), decimals) };
}

/** Aave, Spark, Compound and Moonwell lend against the wrapped native coin everywhere; roughly $5,000 of it. */
const NATIVE_FOR_5K: Record<number, string> = { 137: "20000", 43114: "300" };

describe.skipIf(!RPC)(`${PROTOCOL} wallet flow on a ${REAL?.name} fork`, () => {
  it("borrow → partial repay → full repay → collateral back in the wallet", async () => {
    const exec = executorFor(PROTOCOL, CHAIN_ID);
    expect(exec, `${PROTOCOL} has no wallet flow on ${REAL.name}`).toBeTruthy();
    const target = PROTOCOL === "morpho-blue" ? await morphoMarket()
      : { marketId: "", collateralToken: WRAPPED, collateral: parseEther(NATIVE_FOR_5K[CHAIN_ID] ?? "2") };

    // The fork may run under its own chain id (NEXT_PUBLIC_FORK_CHAIN_ID); contracts are the real chain's either way.
    const transport = http(RPC, { timeout: 60_000 });
    const chain = defineChain({ ...REAL, id: await createPublicClient({ transport }).getChainId() });
    const f = createPublicClient({ chain, transport }) as PublicClient;
    const t = createTestClient({ chain, mode: "anvil", transport });
    const w = createWalletClient({ chain, transport });
    const user = `0x${[...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Address; // fresh, impersonated
    await t.impersonateAccount({ address: user });
    await t.setBalance({ address: user, value: parseEther("100000") });
    const deal = (token: Address, amount: bigint) => f.request({ method: "anvil_dealERC20" as never, params: [user, token, `0x${amount.toString(16)}`] as never });
    const native = target.collateralToken.toLowerCase() === WRAPPED.toLowerCase();
    if (!native) await deal(target.collateralToken, target.collateral);

    const loanToken = USDC[CHAIN_ID];
    const ref = { marketId: target.marketId, collateralToken: target.collateralToken, loanToken, user };
    const balance = (token: Address) => f.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [user] });
    const send = async (plan: PlanStep[]) => {
      for (const s of plan) {
        // Same as the wallet screens: check return codes, estimate (simulates the step), then send with a buffer.
        await assertNoErrorCode(f, user, s);
        const gas = withGasBuffer(await f.estimateGas({ account: user, to: s.to, data: s.data, value: s.value }));
        const hash = await w.sendTransaction({ account: user, to: s.to, data: s.data, value: s.value, gas });
        expect((await f.waitForTransactionReceipt({ hash })).status, s.label).toBe("success");
      }
    };

    const borrow = parseUnits("500", 6);
    const steps = await exec!.prepareBorrow(f, { ...ref, collateral: target.collateral, borrow, gasReserve: parseEther("0.01"), wrappedNative: WRAPPED, nativeSymbol: REAL.nativeCurrency.symbol });
    expect(steps.map((s) => s.label)).toEqual([...(native ? [`Wrap ${REAL.nativeCurrency.symbol}`] : []), expect.stringMatching(/^Allow .* to take the collateral$/), "Deposit collateral",
      ...(PROTOCOL === "moonwell" ? ["Use it as collateral"] : []), "Borrow"]);
    const usdcBefore = await balance(loanToken);
    await send(steps);
    const opened = await exec!.position(f, ref);
    expect(await balance(loanToken) - usdcBefore).toBe(borrow);
    // Share-based deposits (Aave aTokens, Moonwell mTokens) can round down by a few millionths.
    const dust = target.collateral / 1_000_000n + 1n;
    expect(opened.collateral).toBeGreaterThanOrEqual(target.collateral - dust);
    expect(opened.debt).toBeGreaterThanOrEqual(borrow);

    const tokens = { collateralTokens: [target.collateralToken], debtTokens: [loanToken] };
    // Partial repay leaves the collateral in place.
    await send(await exec!.prepareRepay(f, { ...ref, ...tokens, assets: parseUnits("200", 6) }));
    const mid = await exec!.position(f, ref);
    expect(mid.debt).toBeLessThan(parseUnits("301", 6));
    expect(mid.collateral).toBeGreaterThanOrEqual(opened.collateral - dust);

    // Interest accrues, so top the wallet up slightly before closing (a real borrower needs a little extra too).
    await deal(loanToken, (await balance(loanToken)) + parseUnits("1", 6));
    const collateralBefore = await balance(target.collateralToken);
    const nativeBefore = await f.getBalance({ address: user });
    await send(await exec!.prepareRepay(f, { ...ref, ...tokens }));
    const end = await exec!.position(f, ref);
    expect(end).toEqual({ collateral: 0n, debt: 0n });
    // Collateral comes back as the token, or unwrapped to the native coin (Moonwell's mWETH pays out ETH); allow for fees.
    const returned = (await balance(target.collateralToken) - collateralBefore) + (native ? await f.getBalance({ address: user }) - nativeBefore : 0n);
    expect(returned).toBeGreaterThanOrEqual(target.collateral - dust - (native ? parseEther("0.01") : 0n));
  }, 300_000);
});

describe("plan builders", () => {
  const weth = WNATIVE[8453];
  const market = { loanToken: USDC[8453], collateralToken: weth, oracle: weth, irm: weth, lltv: 0n };
  const p = { morpho: MORPHO_BLUE[8453]!, market, user: weth, collateral: 10n, borrow: 5n, collateralBalance: 10n, allowance: 10n, native: 0n, gasReserve: 1n, wrappedNative: weth, nativeSymbol: "ETH" };
  it("skips wrap and approve when the wallet already has both", () => {
    expect(morphoBorrowPlan(p).map((s) => s.label)).toEqual(["Deposit collateral", "Borrow"]);
  });
  it("wraps a shortfall of the chain's own wrapped native, never another token", () => {
    expect(morphoBorrowPlan({ ...p, collateralBalance: 4n, native: 20n })[0]).toMatchObject({ label: "Wrap ETH", to: weth, value: 6n });
    expect(() => morphoBorrowPlan({ ...p, collateralBalance: 4n, native: 20n, wrappedNative: USDC[8453] })).toThrow(/Not enough collateral/);
  });
  it("never wraps into the gas reserve", () => {
    expect(() => morphoBorrowPlan({ ...p, collateralBalance: 0n, native: 10n })).toThrow(/network fees/);
  });
  const r = { morpho: p.morpho, market, user: p.user, borrowShares: 100n, debt: 1000n, collateral: 7n, loanBalance: 2000n, allowance: 0n };
  it("closes a Morpho loan by shares, with approval headroom for accrued interest, then withdraws everything", () => {
    expect(morphoRepayPlan(r).map((s) => s.label)).toEqual(["Allow Morpho to take the repayment", "Repay the full debt", "Withdraw collateral"]);
  });
  it("partial repay keeps collateral and refuses amounts at or above the debt or beyond the wallet", () => {
    expect(morphoRepayPlan({ ...r, assets: 400n, allowance: 400n }).map((s) => s.label)).toEqual(["Repay part of the debt"]);
    expect(() => morphoRepayPlan({ ...r, assets: 1000n })).toThrow(/below the full debt/);
    expect(() => morphoRepayPlan({ ...r, assets: 400n, loanBalance: 100n })).toThrow(/Not enough/);
  });
  const a = { pool: weth, name: "Aave", loanToken: USDC[8453], user: weth, debt: 1000n, loanBalance: 2000n, allowance: 0n,
    collateral: [{ token: weth, amount: 7n }, { token: USDC[8453], amount: 0n }], otherDebt: false };
  it("an Aave full close repays the loan asset and withdraws each supplied asset", () => {
    expect(aaveRepayPlan(a).map((s) => s.label)).toEqual(["Allow Aave to take the repayment", "Repay the full debt", "Withdraw collateral"]);
  });
  it("a Compound full close repays with supply(max) and withdraws each collateral by exact amount", () => {
    const plan = compoundRepayPlan({ comet: weth, loanToken: USDC[8453], debt: 1000n, loanBalance: 2000n, allowance: 2000n, collateral: [{ token: weth, amount: 7n }] });
    expect(plan.map((s) => s.label)).toEqual(["Repay the full debt", "Withdraw collateral"]);
    expect(() => compoundRepayPlan({ comet: weth, loanToken: USDC[8453], debt: 1000n, loanBalance: 999n, allowance: 0n, collateral: [] })).toThrow(/Interest has built up/);
  });
  it("Moonwell steps that report failure by return code are marked for checking; entering the market is skipped once done", () => {
    const b = { comptroller: weth, mCollateral: weth, mLoan: weth, collateralToken: weth, entered: false, collateral: 10n, borrow: 5n,
      collateralBalance: 10n, allowance: 10n, native: 0n, gasReserve: 1n, wrappedNative: weth, nativeSymbol: "ETH" };
    expect(moonwellBorrowPlan(b).map((s) => [s.label, s.errorCode])).toEqual([["Deposit collateral", "uint"], ["Use it as collateral", "uint[]"], ["Borrow", "uint"]]);
    expect(moonwellBorrowPlan({ ...b, entered: true }).map((s) => s.label)).toEqual(["Deposit collateral", "Borrow"]);
  });
  it("an Aave full close refuses while the account owes something else; a partial repay is still allowed", () => {
    expect(() => aaveRepayPlan({ ...a, otherDebt: true })).toThrow(/owes other assets/);
    expect(aaveRepayPlan({ ...a, otherDebt: true, assets: 100n, allowance: 100n }).map((s) => s.label)).toEqual(["Repay part of the debt"]);
  });
});
