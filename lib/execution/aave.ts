import { encodeFunctionData, maxUint256, parseAbi, type Address } from "viem";
import { PROTOCOL_DATA_PROVIDER_ABI } from "../protocols/abis/aave";
import { ERC20_ABI, approveStep, fundSteps, readFunding, withHeadroom, type Executor, type PlanStep } from "./common";
import { SHORT_FOR_FULL_REPAY } from "./morpho";

/**
 * Unsigned Aave v3 plans (Spark too: same Pool interface). One pool per chain, shared account:
 * collateral and debt are account-wide, so a full close repays the loan asset and withdraws
 * every collateral asset, and refuses if the account also owes something else.
 * Borrow: wrap → approve → supply → borrow (variable rate).  Repay: approve → repay → withdraw.
 */

export const AAVE_POOL_WRITE_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);
const VARIABLE = 2n;

export interface AaveBorrowInput {
  pool: Address;
  name: string;
  collateralToken: Address;
  loanToken: Address;
  user: Address;
  collateral: bigint;
  borrow: bigint;
  collateralBalance: bigint;
  allowance: bigint;
  native: bigint;
  gasReserve: bigint;
  wrappedNative: Address;
  nativeSymbol: string;
}

export function aaveBorrowPlan(p: AaveBorrowInput): PlanStep[] {
  if (p.collateral <= 0n || p.borrow <= 0n) throw new Error("Collateral and borrow amounts must be positive.");
  return [
    ...fundSteps({ token: p.collateralToken, spender: p.pool, spenderName: p.name, amount: p.collateral, balance: p.collateralBalance,
      allowance: p.allowance, native: p.native, gasReserve: p.gasReserve, wrappedNative: p.wrappedNative, nativeSymbol: p.nativeSymbol }),
    // First supply of an eligible asset enables it as collateral.
    { label: "Deposit collateral", to: p.pool, value: 0n,
      data: encodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, functionName: "supply", args: [p.collateralToken, p.collateral, p.user, 0] }) },
    // Borrowed funds go to the caller, the borrower's own wallet.
    { label: "Borrow", to: p.pool, value: 0n,
      data: encodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, functionName: "borrow", args: [p.loanToken, p.borrow, VARIABLE, 0, p.user] }) },
  ];
}

export interface AaveRepayInput {
  pool: Address;
  name: string;
  loanToken: Address;
  user: Address;
  /** Omit to repay everything and withdraw the collateral. */
  assets?: bigint;
  debt: bigint;
  loanBalance: bigint;
  allowance: bigint;
  /** Supplied balances to withdraw on a full close. */
  collateral: { token: Address; amount: bigint }[];
  /** True when the account also owes an asset other than the loan token. */
  otherDebt: boolean;
}

export function aaveRepayPlan(p: AaveRepayInput): PlanStep[] {
  const all = p.assets === undefined;
  if (!all && (p.assets! <= 0n || p.assets! >= p.debt)) throw new Error("Enter an amount below the full debt, or repay everything.");
  if (all && p.otherDebt) throw new Error(`This account owes other assets on ${p.name} too. Repay part here, or close the rest on ${p.name} first.`);
  const steps: PlanStep[] = [];
  if (p.debt > 0n) {
    if (p.loanBalance < (all ? p.debt : p.assets!)) throw new Error(all ? SHORT_FOR_FULL_REPAY : "Not enough in the wallet to repay that amount.");
    const pull = all ? withHeadroom(p.debt) : p.assets!;
    if (p.allowance < pull) steps.push(approveStep(`Allow ${p.name} to take the repayment`, p.loanToken, p.pool, pull));
    // max repays exactly what is owed at inclusion, interest included.
    steps.push({ label: all ? "Repay the full debt" : "Repay part of the debt", to: p.pool, value: 0n,
      data: encodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, functionName: "repay", args: [p.loanToken, all ? maxUint256 : p.assets!, VARIABLE, p.user] }) });
  }
  if (all) {
    for (const c of p.collateral.filter((c) => c.amount > 0n)) {
      steps.push({ label: "Withdraw collateral", to: p.pool, value: 0n,
        data: encodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, functionName: "withdraw", args: [c.token, maxUint256, p.user] }) });
    }
  }
  if (steps.length === 0) throw new Error("Nothing to repay or withdraw.");
  return steps;
}

export function aaveExecutor(pool: Address, dataProvider: Address, name: string): Executor {
  const reserve = (c: Parameters<Executor["position"]>[0], token: Address, user: Address) =>
    c.readContract({ address: dataProvider, abi: PROTOCOL_DATA_PROVIDER_ABI, functionName: "getUserReserveData", args: [token, user] });
  return {
    async prepareBorrow(c, r) {
      const f = await readFunding(c, r.collateralToken, r.user, pool);
      return aaveBorrowPlan({ pool, name, collateralToken: r.collateralToken, loanToken: r.loanToken, user: r.user, collateral: r.collateral, borrow: r.borrow,
        collateralBalance: f.balance, allowance: f.allowance, native: f.native, gasReserve: r.gasReserve, wrappedNative: r.wrappedNative, nativeSymbol: r.nativeSymbol });
    },
    async prepareRepay(c, r) {
      const loan = r.loanToken.toLowerCase();
      const [debtRow, loanBalance, allowance, supplied, others] = await Promise.all([
        reserve(c, r.loanToken, r.user),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [r.user] }),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "allowance", args: [r.user, pool] }),
        Promise.all(r.collateralTokens.map(async (token) => ({ token, amount: (await reserve(c, token, r.user))[0] }))),
        Promise.all(r.debtTokens.filter((t) => t.toLowerCase() !== loan).map(async (t) => (await reserve(c, t, r.user))[2])),
      ]);
      return aaveRepayPlan({ pool, name, loanToken: r.loanToken, user: r.user, assets: r.assets, debt: debtRow[2], loanBalance, allowance,
        collateral: supplied, otherDebt: others.some((d) => d > 0n) });
    },
    async position(c, r) {
      const [col, debt] = await Promise.all([reserve(c, r.collateralToken, r.user), reserve(c, r.loanToken, r.user)]);
      return { collateral: col[0], debt: debt[2] };
    },
  };
}
