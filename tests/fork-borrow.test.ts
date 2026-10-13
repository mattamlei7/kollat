import { decodeFunctionData, maxUint256, minInt256, zeroAddress, createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import { aaveRepayPlan } from "../lib/execution/aave";
import { compoundRepayPlan } from "../lib/execution/compound";
import { moonwellBorrowPlan } from "../lib/execution/moonwell";
import { eulerBorrowPlan, eulerRepayPlan, EVC_WRITE_ABI } from "../lib/execution/euler";
import { fluidBorrowPlan, fluidRepayPlan } from "../lib/execution/fluid";
import { ERC20_ABI, assertNoErrorCode, withGasBuffer, type PlanStep } from "../lib/execution/common";
import { executorFor } from "../lib/execution";
import { morphoBorrowPlan, morphoRepayPlan } from "../lib/execution/morpho";
import { EULER_EVC, MORPHO_BLUE, USDC, WNATIVE } from "../lib/protocols/addresses";
import { EulerV2Adapter } from "../lib/protocols/euler-v2";
import { FluidAdapter } from "../lib/protocols/fluid";
import type { ChainId } from "../lib/protocols/types";

// Runs only against a local fork. FORK_OF picks the chain (default 8453, Base); FORK_PROTOCOL the lender
// (morpho-blue, aave-v3, spark, compound-v3, moonwell, fluid, euler-v2). E.g.
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

/** Fluid and Euler: the live WETH → USDC market with the most room to borrow, read from the real chain by Kollat's adapter. */
async function adapterMarket() {
  const adapter = PROTOCOL === "fluid" ? new FluidAdapter(CHAIN_ID) : new EulerV2Adapter({ chainId: CHAIN_ID, evc: EULER_EVC[CHAIN_ID]! });
  const markets = await adapter.getMarkets();
  expect(markets.ok, `${PROTOCOL} markets on ${REAL.name}`).toBe(true);
  const live = (markets.ok ? markets.data : []).filter((x) => x.status === "active").sort((a, b) => Number(b.availableLiquidity - a.availableLiquidity));
  const wrapped = live.find((x) => x.collateral.address.toLowerCase() === WRAPPED.toLowerCase());
  if (wrapped) return { marketId: wrapped.id, collateralToken: WRAPPED, collateral: parseEther(NATIVE_FOR_5K[CHAIN_ID] ?? "2") };
  // No market against the native coin (Euler on Avalanche): the deepest one, with ~$5,000 of its collateral dealt in.
  const m = live[0];
  expect(m, `no live ${PROTOCOL} USDC market on ${REAL.name}`).toBeTruthy();
  const { address, decimals } = m.collateral;
  return { marketId: m.id, collateralToken: address as Address, collateral: parseUnits((5000 / m.collateralPriceUsd).toFixed(Math.min(decimals, 8)), decimals) };
}

/** Aave, Spark, Compound and Moonwell lend against the wrapped native coin everywhere; roughly $5,000 of it. */
const NATIVE_FOR_5K: Record<number, string> = { 137: "20000", 43114: "300" };

describe.skipIf(!RPC)(`${PROTOCOL} wallet flow on a ${REAL?.name} fork`, () => {
  it("borrow → partial repay → full repay → collateral back in the wallet", async ({ task }) => {
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(RPC!).hostname);
    const forkClient = createPublicClient({ transport: http(RPC) });
    expect(await forkClient.request({ method: "web3_clientVersion" as never })).toMatch(/anvil/i);
    const exec = executorFor(PROTOCOL, CHAIN_ID);
    expect(exec, `${PROTOCOL} has no wallet flow on ${REAL.name}`).toBeTruthy();
    const target = PROTOCOL === "morpho-blue" ? await morphoMarket()
      : PROTOCOL === "fluid" || PROTOCOL === "euler-v2" ? await adapterMarket()
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
    let fees = 0n; // native spent on gas, so returned collateral can be checked exactly
    const send = async (plan: PlanStep[]) => {
      for (const s of plan) {
        // Same as the wallet screens: check return codes, estimate (simulates the step), then send with a buffer.
        await assertNoErrorCode(f, user, s);
        const gas = withGasBuffer(await f.estimateGas({ account: user, to: s.to, data: s.data, value: s.value }));
        const hash = await w.sendTransaction({ account: user, to: s.to, data: s.data, value: s.value, gas });
        const receipt = await f.waitForTransactionReceipt({ hash });
        expect(receipt.status, s.label).toBe("success");
        fees += receipt.gasUsed * receipt.effectiveGasPrice;
      }
    };

    const borrow = parseUnits("500", 6);
    const steps = await exec!.prepareBorrow(f, { ...ref, collateral: target.collateral, borrow, gasReserve: parseEther("0.01"), wrappedNative: WRAPPED, nativeSymbol: REAL.nativeCurrency.symbol });
    expect(steps.map((s) => s.label)).toEqual(
      PROTOCOL === "fluid" ? ["Deposit collateral and borrow"] // native-ETH vault: the wallet's ETH goes in as msg.value
      : PROTOCOL === "euler-v2" ? [...(native ? [`Wrap ${REAL.nativeCurrency.symbol}`] : []), "Allow Euler to take the collateral", "Deposit collateral and borrow"]
      : [...(native ? [`Wrap ${REAL.nativeCurrency.symbol}`] : []), expect.stringMatching(/^Allow .* to take the collateral$/), "Deposit collateral",
        ...(PROTOCOL === "moonwell" ? ["Use it as collateral"] : []), "Borrow"]);
    const usdcBefore = await balance(loanToken);
    await send(steps);
    const opened = await exec!.position(f, ref);
    expect(await balance(loanToken) - usdcBefore).toBe(borrow);
    // Share-based deposits (Aave aTokens, Moonwell mTokens) can round down by a few millionths.
    const dust = target.collateral / 1_000_000n + 1n;
    expect(opened.collateral).toBeGreaterThanOrEqual(target.collateral - dust);
    expect(opened.debt).toBeGreaterThanOrEqual(borrow);
    const stages: object[] = [];
    (task.meta as { lifecycle?: object[] }).lifecycle = stages;
    const evidence = (stage: string, position: { collateral: bigint; debt: bigint }, extra = {}) => {
      const record = { protocol: PROTOCOL, chainId: CHAIN_ID, marketId: ref.marketId, collateralToken: ref.collateralToken, user, stage, collateral: position.collateral.toString(), debt: position.debt.toString(), ...extra };
      stages.push(record);
      console.log("LIFECYCLE", JSON.stringify(record));
    };
    evidence("borrow", opened, { receivedUsdc: borrow.toString() });

    const tokens = { collateralTokens: [target.collateralToken], debtTokens: [loanToken] };
    // Partial repay leaves the collateral in place.
    const beforePartial = await balance(loanToken);
    await send(await exec!.prepareRepay(f, { ...ref, ...tokens, assets: parseUnits("200", 6) }));
    const mid = await exec!.position(f, ref);
    expect(beforePartial - await balance(loanToken)).toBe(parseUnits("200", 6));
    expect(mid.debt).toBeGreaterThan(0n);
    expect(mid.debt).toBeLessThan(opened.debt);
    expect(mid.debt).toBeLessThan(parseUnits("301", 6));
    expect(mid.collateral).toBeGreaterThanOrEqual(opened.collateral - dust);
    evidence("partial-repay", mid);

    // Interest accrues, so top the wallet up slightly before closing (a real borrower needs a little extra too).
    await deal(loanToken, (await balance(loanToken)) + parseUnits("1", 6));
    const collateralBefore = await balance(target.collateralToken);
    const nativeBefore = await f.getBalance({ address: user });
    fees = 0n;
    await send(await exec!.prepareRepay(f, { ...ref, ...tokens }));
    const end = await exec!.position(f, ref);
    expect(end).toEqual({ collateral: 0n, debt: 0n });
    // Collateral comes back as the token, or unwrapped to the native coin (Moonwell's mWETH pays out ETH); allow for fees.
    const returned = (await balance(target.collateralToken) - collateralBefore) + (native ? await f.getBalance({ address: user }) + fees - nativeBefore : 0n);
    expect(returned).toBeGreaterThanOrEqual(target.collateral - dust);
    evidence("closed", end, { returnedCollateral: returned.toString(), expectedCollateral: target.collateral.toString(), tolerance: dust.toString() });
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
  it("Fluid native-ETH vault: sends ETH as value, unwraps only the shortfall beyond the gas reserve, closes with int256.min", () => {
    const f = { vault: weth, nativeVault: true, collateralToken: weth, user: weth, collateral: 10n, borrow: 5n, collateralBalance: 10n, allowance: 0n, native: 7n, gasReserve: 1n, wrappedNative: weth, nativeSymbol: "ETH" };
    const plan = fluidBorrowPlan(f);
    expect(plan.map((s) => s.label)).toEqual(["Unwrap WETH", "Deposit collateral and borrow"]);
    expect(plan[1].value).toBe(10n);
    expect(() => fluidBorrowPlan({ ...f, collateralBalance: 3n })).toThrow(/network fees/);
    const close = fluidRepayPlan({ vault: weth, loanToken: USDC[8453], user: weth, nftId: 7n, debt: 100n, collateral: 10n, loanBalance: 101n, allowance: 0n });
    expect(close.map((s) => s.label)).toEqual(["Allow Fluid to take the repayment", "Repay the full debt and withdraw collateral"]);
    expect(close[1].data).toContain(minInt256.toString(16).replace("-", "").slice(1, 8));
  });
  it("Euler: one EVC batch deposits into the sub-account, enables both vaults and borrows to the wallet; closing redeems everything", () => {
    const [evc, dv, cv, user, sub] = [weth, USDC[8453], MORPHO_BLUE[8453]!, "0x00000000000000000000000000000000000000a0", "0x00000000000000000000000000000000000000a1"] as Address[];
    const plan = eulerBorrowPlan({ evc, debtVault: dv, collateralVault: cv, collateralToken: weth, user, account: sub, collateral: 10n, borrow: 5n, collateralBalance: 10n, allowance: 10n, native: 0n, gasReserve: 1n, wrappedNative: weth, nativeSymbol: "ETH" });
    expect(plan.map((s) => s.label)).toEqual(["Deposit collateral and borrow"]);
    const [items] = decodeFunctionData({ abi: EVC_WRITE_ABI, data: plan[0].data }).args as unknown as [{ targetContract: Address; onBehalfOfAccount: Address }[]];
    const lower = (a: Address[]) => a.map((x) => x.toLowerCase());
    expect(items.map((i) => lower([i.targetContract, i.onBehalfOfAccount]))).toEqual([[cv, user], [evc, zeroAddress], [evc, zeroAddress], [dv, sub]].map(lower));
    const close = eulerRepayPlan({ evc, debtVault: dv, loanToken: USDC[8453], user, account: sub, debt: 100n, loanBalance: 101n, allowance: maxUint256, collateralVaults: [cv] });
    const [closing] = decodeFunctionData({ abi: EVC_WRITE_ABI, data: close[0].data }).args as unknown as [{ onBehalfOfAccount: Address }[]];
    expect(lower(closing.map((i) => i.onBehalfOfAccount))).toEqual(lower([user, sub, sub])); // repay from the wallet, then disable controller and redeem
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
