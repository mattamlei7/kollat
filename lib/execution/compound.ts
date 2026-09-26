import { encodeFunctionData, maxUint256, parseAbi, type Address } from "viem";
import { COMET_ABI } from "../protocols/abis/compound";
import { ERC20_ABI, approveStep, fundSteps, readFunding, withHeadroom, type Executor, type PlanStep } from "./common";
import { SHORT_FOR_FULL_REPAY } from "./morpho";

/**
 * Unsigned Compound v3 plans. One Comet per chain with USDC as its base asset: collateral is
 * supplied into it, and withdrawing USDC beyond your supply is the loan. Supplying USDC repays it;
 * supply(max) repays the whole borrow balance at inclusion time.
 * Borrow: wrap → approve → supply(collateral) → withdraw(USDC).  Repay: approve → supply(USDC) → withdraw(collateral).
 */

export const COMET_WRITE_ABI = parseAbi([
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
]);

export interface CompoundBorrowInput {
  comet: Address;
  collateralToken: Address;
  loanToken: Address;
  collateral: bigint;
  borrow: bigint;
  collateralBalance: bigint;
  allowance: bigint;
  native: bigint;
  gasReserve: bigint;
  wrappedNative: Address;
  nativeSymbol: string;
}

export function compoundBorrowPlan(p: CompoundBorrowInput): PlanStep[] {
  if (p.collateral <= 0n || p.borrow <= 0n) throw new Error("Collateral and borrow amounts must be positive.");
  return [
    ...fundSteps({ token: p.collateralToken, spender: p.comet, spenderName: "Compound", amount: p.collateral, balance: p.collateralBalance,
      allowance: p.allowance, native: p.native, gasReserve: p.gasReserve, wrappedNative: p.wrappedNative, nativeSymbol: p.nativeSymbol }),
    { label: "Deposit collateral", to: p.comet, value: 0n,
      data: encodeFunctionData({ abi: COMET_WRITE_ABI, functionName: "supply", args: [p.collateralToken, p.collateral] }) },
    // Withdrawing the base asset past your supply borrows it, to the caller's own wallet.
    { label: "Borrow", to: p.comet, value: 0n,
      data: encodeFunctionData({ abi: COMET_WRITE_ABI, functionName: "withdraw", args: [p.loanToken, p.borrow] }) },
  ];
}

export interface CompoundRepayInput {
  comet: Address;
  loanToken: Address;
  /** Omit to repay everything and withdraw the collateral. */
  assets?: bigint;
  debt: bigint;
  loanBalance: bigint;
  allowance: bigint;
  collateral: { token: Address; amount: bigint }[];
}

export function compoundRepayPlan(p: CompoundRepayInput): PlanStep[] {
  const all = p.assets === undefined;
  if (!all && (p.assets! <= 0n || p.assets! >= p.debt)) throw new Error("Enter an amount below the full debt, or repay everything.");
  const steps: PlanStep[] = [];
  if (p.debt > 0n) {
    if (p.loanBalance < (all ? p.debt : p.assets!)) throw new Error(all ? SHORT_FOR_FULL_REPAY : "Not enough in the wallet to repay that amount.");
    const pull = all ? withHeadroom(p.debt) : p.assets!;
    if (p.allowance < pull) steps.push(approveStep("Allow Compound to take the repayment", p.loanToken, p.comet, pull));
    steps.push({ label: all ? "Repay the full debt" : "Repay part of the debt", to: p.comet, value: 0n,
      data: encodeFunctionData({ abi: COMET_WRITE_ABI, functionName: "supply", args: [p.loanToken, all ? maxUint256 : p.assets!] }) });
  }
  if (all) {
    // Collateral withdrawals take exact amounts (max is not accepted for collateral).
    for (const c of p.collateral.filter((c) => c.amount > 0n)) {
      steps.push({ label: "Withdraw collateral", to: p.comet, value: 0n,
        data: encodeFunctionData({ abi: COMET_WRITE_ABI, functionName: "withdraw", args: [c.token, c.amount] }) });
    }
  }
  if (steps.length === 0) throw new Error("Nothing to repay or withdraw.");
  return steps;
}

export function compoundExecutor(comet: Address): Executor {
  type Client = Parameters<Executor["position"]>[0];
  const collateralOf = (c: Client, user: Address, token: Address) => c.readContract({ address: comet, abi: COMET_ABI, functionName: "collateralBalanceOf", args: [user, token] });
  const debtOf = (c: Client, user: Address) => c.readContract({ address: comet, abi: COMET_ABI, functionName: "borrowBalanceOf", args: [user] });
  return {
    async prepareBorrow(c, r) {
      const f = await readFunding(c, r.collateralToken, r.user, comet);
      return compoundBorrowPlan({ comet, collateralToken: r.collateralToken, loanToken: r.loanToken, collateral: r.collateral, borrow: r.borrow,
        collateralBalance: f.balance, allowance: f.allowance, native: f.native, gasReserve: r.gasReserve, wrappedNative: r.wrappedNative, nativeSymbol: r.nativeSymbol });
    },
    async prepareRepay(c, r) {
      const [debt, loanBalance, allowance, collateral] = await Promise.all([
        debtOf(c, r.user),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [r.user] }),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "allowance", args: [r.user, comet] }),
        Promise.all(r.collateralTokens.map(async (token) => ({ token, amount: await collateralOf(c, r.user, token) }))),
      ]);
      return compoundRepayPlan({ comet, loanToken: r.loanToken, assets: r.assets, debt, loanBalance, allowance, collateral });
    },
    async position(c, r) {
      const [collateral, debt] = await Promise.all([collateralOf(c, r.user, r.collateralToken), debtOf(c, r.user)]);
      return { collateral, debt };
    },
  };
}
