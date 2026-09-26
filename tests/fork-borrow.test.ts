import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther, parseUnits, type Address, type Hex } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import { ERC20_ABI, MORPHO_WRITE_ABI, morphoBorrowPlan, morphoRepayPlan, toAssetsUp, type PlanStep } from "../lib/execution/morpho";
import { MORPHO_BLUE, USDC, WNATIVE } from "../lib/protocols/addresses";
import type { ChainId } from "../lib/protocols/types";

// Runs only against a local fork of the chain in FORK_OF (default 8453, Base), e.g.
//   anvil --fork-url https://arb1.arbitrum.io/rpc   then   FORK_RPC_URL=http://127.0.0.1:8545 FORK_OF=42161 npm test
const RPC = process.env.FORK_RPC_URL;
const CHAIN_ID = (Number(process.env.FORK_OF) || 8453) as ChainId;
const REAL = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism, 137: polygon }[CHAIN_ID as 1]!;
const WRAPPED = WNATIVE[CHAIN_ID];

describe.skipIf(!RPC)(`Morpho borrow on a ${REAL.name} fork`, () => {
  it("borrow → partial repay → full repay → collateral back in the wallet", async () => {
    // Prefer a market against the chain's native coin (exercises the wrap step); otherwise the deepest USDC market.
    const query = async (collateral: string) => {
      const res = await fetch("https://blue-api.morpho.org/graphql", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `{ markets(first: 1, orderBy: SupplyAssetsUsd, orderDirection: Desc, where: { chainId_in: [${CHAIN_ID}], loanAssetAddress_in: ["${USDC[CHAIN_ID]}"]${collateral}, listed: true }) { items { marketId collateralAsset { decimals priceUsd } } } }` }),
      });
      return (await res.json()).data.markets.items[0] as { marketId: Hex; collateralAsset: { decimals: number; priceUsd: number } } | undefined;
    };
    const native = await query(`, collateralAssetAddress_in: ["${WRAPPED}"]`);
    const picked = native ?? await query("");
    expect(picked, `no listed USDC Morpho market on ${REAL.name}`).toBeTruthy();
    const marketId = picked!.marketId;

    // The fork may run under its own chain id (NEXT_PUBLIC_FORK_CHAIN_ID); contracts are the real chain's either way.
    const transport = http(RPC, { timeout: 60_000 });
    const chain = defineChain({ ...REAL, id: await createPublicClient({ transport }).getChainId() });
    const f = createPublicClient({ chain, transport });
    const user = `0x${[...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Address; // fresh, impersonated
    await createTestClient({ chain, mode: "anvil", transport }).impersonateAccount({ address: user });
    await createTestClient({ chain, mode: "anvil", transport }).setBalance({ address: user, value: parseEther("100000") });
    const w = createWalletClient({ chain, transport });
    const morpho = MORPHO_BLUE[CHAIN_ID]!;

    const [loanToken, collateralToken, oracle, irm, lltv] = await f.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "idToMarketParams", args: [marketId] });
    const read = (token: typeof loanToken) => f.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [user] });
    // About $5,000 of collateral backs the $500 loan comfortably.
    const { decimals, priceUsd } = picked!.collateralAsset;
    const collateral = parseUnits((5000 / priceUsd).toFixed(Math.min(decimals, 8)), decimals);
    if (!native) await f.request({ method: "anvil_dealERC20" as never, params: [user, collateralToken, `0x${collateral.toString(16)}`] as never });
    const borrow = parseUnits("500", 6);
    const steps = morphoBorrowPlan({
      morpho, market: { loanToken, collateralToken, oracle, irm, lltv }, user, collateral, borrow,
      collateralBalance: await read(collateralToken), allowance: 0n, native: parseEther("100000"), gasReserve: parseEther("0.01"),
      wrappedNative: WRAPPED, nativeSymbol: REAL.nativeCurrency.symbol,
    });
    expect(steps.map((s) => s.label)).toEqual([...(native ? [`Wrap ${REAL.nativeCurrency.symbol}`] : []), "Allow Morpho to take the collateral", "Deposit collateral", "Borrow"]);

    const before = await read(loanToken);
    const [, , collateralBefore] = await f.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "position", args: [marketId, user] });
    const send = async (plan: PlanStep[]) => {
      for (const s of plan) {
        const hash = await w.sendTransaction({ account: user, to: s.to, data: s.data, value: s.value });
        expect((await f.waitForTransactionReceipt({ hash })).status).toBe("success");
      }
    };
    await send(steps);
    const [, borrowShares, collateralAfter] = await f.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "position", args: [marketId, user] });
    expect(await read(loanToken) - before).toBe(borrow);
    expect(collateralAfter - collateralBefore).toBe(collateral);
    expect(borrowShares).toBeGreaterThan(0n);

    const market = { loanToken, collateralToken, oracle, irm, lltv };
    const state = async () => {
      const [[, shares, coll], [, , totalAssets, totalShares]] = await Promise.all([
        f.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "position", args: [marketId, user] }),
        f.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "market", args: [marketId] }),
      ]);
      const allowance = await f.readContract({ address: loanToken, abi: ERC20_ABI, functionName: "allowance", args: [user, morpho] });
      return { morpho, market, user, borrowShares: shares, debt: toAssetsUp(shares, totalAssets, totalShares), collateral: coll, loanBalance: await read(loanToken), allowance };
    };

    // Partial repay leaves the collateral in place.
    await send(morphoRepayPlan({ ...(await state()), assets: parseUnits("200", 6) }));
    const mid = await state();
    expect(mid.debt).toBeLessThan(parseUnits("301", 6));
    expect(mid.collateral).toBe(collateralAfter);

    // Interest accrues, so top the wallet up slightly before closing (a real borrower needs a little extra too).
    await f.request({ method: "anvil_dealERC20" as never, params: [user, loanToken, `0x${(mid.loanBalance + parseUnits("1", 6)).toString(16)}`] as never });
    const wethBefore = await read(collateralToken);
    await send(morphoRepayPlan(await state()));
    const end = await state();
    expect(end.borrowShares).toBe(0n);
    expect(end.collateral).toBe(collateralBefore);
    expect(await read(collateralToken) - wethBefore).toBe(collateral);
  }, 300_000);
});

describe("Morpho borrow plan", () => {
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
  it("closes a loan by shares, with approval headroom for accrued interest, then withdraws everything", () => {
    expect(morphoRepayPlan(r).map((s) => s.label)).toEqual(["Allow Morpho to take the repayment", "Repay the full debt", "Withdraw collateral"]);
  });
  it("partial repay keeps collateral and refuses amounts at or above the debt or beyond the wallet", () => {
    expect(morphoRepayPlan({ ...r, assets: 400n, allowance: 400n }).map((s) => s.label)).toEqual(["Repay part of the debt"]);
    expect(() => morphoRepayPlan({ ...r, assets: 1000n })).toThrow(/below the full debt/);
    expect(() => morphoRepayPlan({ ...r, assets: 400n, loanBalance: 100n })).toThrow(/Not enough/);
  });
});
