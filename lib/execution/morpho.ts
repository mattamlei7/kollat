import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

/**
 * Unsigned Morpho Blue plans. Borrow: wrap → approve → supplyCollateral → borrow.
 * Repay: approve → repay → withdrawCollateral.
 * Builds calldata only. Signing and submission belong to the borrower's own wallet;
 * nothing here holds a key or broadcasts.
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
export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const WETH_ABI = parseAbi(["function deposit() payable"]);

/** Base WETH; its native ETH can be wrapped into collateral. Same as WNATIVE[8453] in lib/balances. */
export const BASE_WETH: Address = "0x4200000000000000000000000000000000000006";

export interface MarketParams { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint }

export interface PlanStep { label: string; to: Address; data: Hex; value: bigint }

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
}

export function morphoBorrowPlan(p: PlanInput): PlanStep[] {
  if (p.collateral <= 0n || p.borrow <= 0n) throw new Error("Collateral and borrow amounts must be positive.");
  const steps: PlanStep[] = [];
  const shortfall = p.collateral - p.collateralBalance;
  if (shortfall > 0n) {
    if (p.market.collateralToken.toLowerCase() !== BASE_WETH.toLowerCase()) throw new Error("Not enough collateral in the wallet.");
    if (p.native - p.gasReserve < shortfall) throw new Error("Not enough ETH to wrap while keeping some for network fees.");
    steps.push({ label: "Wrap ETH into WETH", to: BASE_WETH, data: encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }), value: shortfall });
  }
  if (p.allowance < p.collateral) {
    steps.push({ label: "Allow Morpho to take the collateral", to: p.market.collateralToken, value: 0n,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [p.morpho, p.collateral] }) });
  }
  steps.push({ label: "Deposit collateral", to: p.morpho, value: 0n,
    data: encodeFunctionData({ abi: MORPHO_WRITE_ABI, functionName: "supplyCollateral", args: [p.market, p.collateral, p.user, "0x"] }) });
  // Receiver is the borrower: proceeds never pass through a Kollat account.
  steps.push({ label: "Borrow", to: p.morpho, value: 0n,
    data: encodeFunctionData({ abi: MORPHO_WRITE_ABI, functionName: "borrow", args: [p.market, p.borrow, 0n, p.user, p.user] }) });
  return steps;
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

export function morphoRepayPlan(p: RepayInput): PlanStep[] {
  const all = p.assets === undefined;
  if (!all && (p.assets! <= 0n || p.assets! >= p.debt)) throw new Error("Enter an amount below the full debt, or repay everything.");
  const steps: PlanStep[] = [];
  if (p.borrowShares > 0n) {
    if (p.loanBalance < (all ? p.debt : p.assets!)) throw new Error("Not enough in the wallet to repay that amount.");
    // A full repay is by shares, so interest accrued before inclusion is pulled too; allow 0.1% headroom.
    const pull = all ? p.debt + p.debt / 1000n + 1n : p.assets!;
    if (p.allowance < pull) {
      steps.push({ label: "Allow Morpho to take the repayment", to: p.market.loanToken, value: 0n,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [p.morpho, pull] }) });
    }
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
