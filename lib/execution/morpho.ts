import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { ERC20_ABI, approveStep, fundSteps, readFunding, withHeadroom, type Executor, type PlanStep } from "./common";

/**
 * Unsigned Morpho Blue plans. Borrow: wrap → approve → supplyCollateral → borrow.
 * Repay: approve → repay → withdrawCollateral. Isolated markets: one collateral, one loan asset.
 */

export const MORPHO_WRITE_ABI = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
  "function withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)",
  "function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)",
  "function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
]);

export interface MarketParams { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint }

export interface PlanInput {
  morpho: Address;
  market: MarketParams;
  user: Address;
  /** Collateral to deposit, base units. */
  collateral: bigint;
  /** Loan asset to receive, base units. */
  borrow: bigint;
  /** Current wallet state, base units. */
  collateralBalance: bigint;
  allowance: bigint;
  native: bigint;
  /** Native kept back for gas when wrapping. */
  gasReserve: bigint;
  wrappedNative: Address;
  nativeSymbol: string;
}

export function morphoBorrowPlan(p: PlanInput): PlanStep[] {
  if (p.collateral <= 0n || p.borrow <= 0n) throw new Error("Collateral and borrow amounts must be positive.");
  return [
    ...fundSteps({ token: p.market.collateralToken, spender: p.morpho, spenderName: "Morpho", amount: p.collateral, balance: p.collateralBalance,
      allowance: p.allowance, native: p.native, gasReserve: p.gasReserve, wrappedNative: p.wrappedNative, nativeSymbol: p.nativeSymbol }),
    { label: "Deposit collateral", to: p.morpho, value: 0n,
      data: encodeFunctionData({ abi: MORPHO_WRITE_ABI, functionName: "supplyCollateral", args: [p.market, p.collateral, p.user, "0x"] }) },
    // Receiver is the borrower: proceeds never pass through a Kollat account.
    { label: "Borrow", to: p.morpho, value: 0n,
      data: encodeFunctionData({ abi: MORPHO_WRITE_ABI, functionName: "borrow", args: [p.market, p.borrow, 0n, p.user, p.user] }) },
  ];
}

export interface RepayInput {
  morpho: Address;
  market: MarketParams;
  user: Address;
  /** Loan asset to repay, base units. Omit to repay everything and withdraw all collateral. */
  assets?: bigint;
  /** Current position and wallet state, base units. `debt` is toAssetsUp(borrowShares). */
  borrowShares: bigint;
  debt: bigint;
  collateral: bigint;
  loanBalance: bigint;
  allowance: bigint;
}

export const SHORT_FOR_FULL_REPAY = "Not enough in the wallet to repay everything. Interest has built up since you borrowed, so you owe a little more than you received.";

export function morphoRepayPlan(p: RepayInput): PlanStep[] {
  const all = p.assets === undefined;
  if (!all && (p.assets! <= 0n || p.assets! >= p.debt)) throw new Error("Enter an amount below the full debt, or repay everything.");
  const steps: PlanStep[] = [];
  if (p.borrowShares > 0n) {
    if (p.loanBalance < (all ? p.debt : p.assets!)) throw new Error(all ? SHORT_FOR_FULL_REPAY : "Not enough in the wallet to repay that amount.");
    // A full repay is by shares, so interest accrued before inclusion is pulled too.
    const pull = all ? withHeadroom(p.debt) : p.assets!;
    if (p.allowance < pull) steps.push(approveStep("Allow Morpho to take the repayment", p.market.loanToken, p.morpho, pull));
    steps.push({ label: all ? "Repay the full debt" : "Repay part of the debt", to: p.morpho, value: 0n,
      data: encodeFunctionData({ abi: MORPHO_WRITE_ABI, functionName: "repay", args: [p.market, all ? 0n : p.assets!, all ? p.borrowShares : 0n, p.user, "0x"] }) });
  }
  if (all && p.collateral > 0n) {
    steps.push({ label: "Withdraw collateral", to: p.morpho, value: 0n,
      data: encodeFunctionData({ abi: MORPHO_WRITE_ABI, functionName: "withdrawCollateral", args: [p.market, p.collateral, p.user, p.user] }) });
  }
  if (steps.length === 0) throw new Error("Nothing to repay or withdraw.");
  return steps;
}

/** Morpho's share accounting adds virtual shares/assets. */
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

/** Morpho's SharesMathLib.toAssetsUp — borrow shares → assets owed, rounded against the borrower. */
export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (shares === 0n) return 0n;
  const num = shares * (totalAssets + VIRTUAL_ASSETS);
  const den = totalShares + VIRTUAL_SHARES;
  return (num + den - 1n) / den;
}

const idOf = (marketId: string) => marketId.slice(marketId.lastIndexOf(":") + 1) as Hex;

export function morphoExecutor(morpho: Address): Executor {
  const params = async (c: Parameters<Executor["position"]>[0], id: Hex): Promise<MarketParams> => {
    const [loanToken, collateralToken, oracle, irm, lltv] = await c.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "idToMarketParams", args: [id] });
    return { loanToken, collateralToken, oracle, irm, lltv };
  };
  const state = async (c: Parameters<Executor["position"]>[0], id: Hex, user: Address) => {
    const [[, borrowShares, collateral], [, , totalBorrowAssets, totalBorrowShares]] = await Promise.all([
      c.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "position", args: [id, user] }),
      c.readContract({ address: morpho, abi: MORPHO_WRITE_ABI, functionName: "market", args: [id] }),
    ]);
    return { borrowShares, collateral, debt: toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares) };
  };
  return {
    async prepareBorrow(c, r) {
      const market = await params(c, idOf(r.marketId));
      const f = await readFunding(c, market.collateralToken, r.user, morpho);
      return morphoBorrowPlan({ morpho, market, user: r.user, collateral: r.collateral, borrow: r.borrow, collateralBalance: f.balance,
        allowance: f.allowance, native: f.native, gasReserve: r.gasReserve, wrappedNative: r.wrappedNative, nativeSymbol: r.nativeSymbol });
    },
    async prepareRepay(c, r) {
      const id = idOf(r.marketId);
      const market = await params(c, id);
      const [s, loanBalance, allowance] = await Promise.all([
        state(c, id, r.user),
        c.readContract({ address: market.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [r.user] }),
        c.readContract({ address: market.loanToken, abi: ERC20_ABI, functionName: "allowance", args: [r.user, morpho] }),
      ]);
      return morphoRepayPlan({ morpho, market, user: r.user, assets: r.assets, ...s, loanBalance, allowance });
    },
    async position(c, r) {
      const { collateral, debt } = await state(c, idOf(r.marketId), r.user);
      return { collateral, debt };
    },
  };
}
