import { encodeFunctionData, maxUint256, parseAbi, type Address } from "viem";
import { COMPTROLLER_ABI, MTOKEN_ABI } from "../protocols/abis/moonwell";
import { ERC20_ABI, approveStep, fundSteps, readFunding, withHeadroom, type Executor, type PlanStep } from "./common";
import { SHORT_FOR_FULL_REPAY } from "./morpho";

/**
 * Unsigned Moonwell plans (Compound v2 fork). One mToken per asset; collateral counts only after
 * enterMarkets. mint/borrow/repayBorrow/redeem report refusal by return code, so those steps carry
 * errorCode and are checked before sending.
 * Borrow: wrap → approve → mint → enterMarkets → borrow.  Repay: approve → repayBorrow → redeem.
 */

export const MOONWELL_WRITE_ABI = parseAbi([
  "function mint(uint256 mintAmount) returns (uint256)",
  "function borrow(uint256 borrowAmount) returns (uint256)",
  "function repayBorrow(uint256 repayAmount) returns (uint256)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function enterMarkets(address[] mTokens) returns (uint256[])",
  "function balanceOf(address) view returns (uint256)",
]);

export interface MoonwellBorrowInput {
  comptroller: Address;
  mCollateral: Address;
  mLoan: Address;
  collateralToken: Address;
  /** True once the account has entered the collateral market. */
  entered: boolean;
  collateral: bigint;
  borrow: bigint;
  collateralBalance: bigint;
  allowance: bigint;
  native: bigint;
  gasReserve: bigint;
  wrappedNative: Address;
  nativeSymbol: string;
}

export function moonwellBorrowPlan(p: MoonwellBorrowInput): PlanStep[] {
  if (p.collateral <= 0n || p.borrow <= 0n) throw new Error("Collateral and borrow amounts must be positive.");
  return [
    ...fundSteps({ token: p.collateralToken, spender: p.mCollateral, spenderName: "Moonwell", amount: p.collateral, balance: p.collateralBalance,
      allowance: p.allowance, native: p.native, gasReserve: p.gasReserve, wrappedNative: p.wrappedNative, nativeSymbol: p.nativeSymbol }),
    { label: "Deposit collateral", to: p.mCollateral, value: 0n, errorCode: "uint",
      data: encodeFunctionData({ abi: MOONWELL_WRITE_ABI, functionName: "mint", args: [p.collateral] }) },
    ...(p.entered ? [] : [{ label: "Use it as collateral", to: p.comptroller, value: 0n, errorCode: "uint[]" as const,
      data: encodeFunctionData({ abi: MOONWELL_WRITE_ABI, functionName: "enterMarkets", args: [[p.mCollateral]] }) }]),
    // Borrowed funds go to the caller, the borrower's own wallet.
    { label: "Borrow", to: p.mLoan, value: 0n, errorCode: "uint",
      data: encodeFunctionData({ abi: MOONWELL_WRITE_ABI, functionName: "borrow", args: [p.borrow] }) },
  ];
}

export interface MoonwellRepayInput {
  mLoan: Address;
  loanToken: Address;
  /** Omit to repay everything and withdraw the collateral. */
  assets?: bigint;
  debt: bigint;
  loanBalance: bigint;
  allowance: bigint;
  /** mToken balances to redeem on a full close. */
  collateral: { mToken: Address; mTokens: bigint }[];
}

export function moonwellRepayPlan(p: MoonwellRepayInput): PlanStep[] {
  const all = p.assets === undefined;
  if (!all && (p.assets! <= 0n || p.assets! >= p.debt)) throw new Error("Enter an amount below the full debt, or repay everything.");
  const steps: PlanStep[] = [];
  if (p.debt > 0n) {
    if (p.loanBalance < (all ? p.debt : p.assets!)) throw new Error(all ? SHORT_FOR_FULL_REPAY : "Not enough in the wallet to repay that amount.");
    const pull = all ? withHeadroom(p.debt) : p.assets!;
    if (p.allowance < pull) steps.push(approveStep("Allow Moonwell to take the repayment", p.loanToken, p.mLoan, pull));
    // max repays the whole borrow balance at inclusion, interest included.
    steps.push({ label: all ? "Repay the full debt" : "Repay part of the debt", to: p.mLoan, value: 0n, errorCode: "uint",
      data: encodeFunctionData({ abi: MOONWELL_WRITE_ABI, functionName: "repayBorrow", args: [all ? maxUint256 : p.assets!] }) });
  }
  if (all) {
    for (const c of p.collateral.filter((c) => c.mTokens > 0n)) {
      steps.push({ label: "Withdraw collateral", to: c.mToken, value: 0n, errorCode: "uint",
        data: encodeFunctionData({ abi: MOONWELL_WRITE_ABI, functionName: "redeem", args: [c.mTokens] }) });
    }
  }
  if (steps.length === 0) throw new Error("Nothing to repay or withdraw.");
  return steps;
}

export function moonwellExecutor(comptroller: Address): Executor {
  type Client = Parameters<Executor["position"]>[0];
  /** underlying (lower-cased) → mToken, read from the comptroller. */
  let markets: Promise<Map<string, Address>> | null = null;
  const mTokenFor = async (c: Client, underlying: Address) => {
    markets ??= (async () => {
      const all = await c.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getAllMarkets" });
      const under = await c.multicall({ contracts: all.map((m) => ({ address: m, abi: MTOKEN_ABI, functionName: "underlying" as const })), allowFailure: true });
      return new Map(all.flatMap((m, i) => under[i].status === "success" ? [[(under[i].result as Address).toLowerCase(), m] as const] : []));
    })();
    const m = (await markets).get(underlying.toLowerCase());
    if (!m) throw new Error("Moonwell has no market for this asset.");
    return m;
  };
  /** Underlying held as collateral, and debt, via the mToken's account snapshot. */
  const snapshot = async (c: Client, mToken: Address, user: Address) => {
    const [, mTokens, borrow, rate] = await c.readContract({ address: mToken, abi: MTOKEN_ABI, functionName: "getAccountSnapshot", args: [user] });
    return { mTokens, underlying: (mTokens * rate) / 10n ** 18n, borrow };
  };
  return {
    async prepareBorrow(c, r) {
      const [mCollateral, mLoan] = await Promise.all([mTokenFor(c, r.collateralToken), mTokenFor(c, r.loanToken)]);
      const [f, entered] = await Promise.all([
        readFunding(c, r.collateralToken, r.user, mCollateral),
        c.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getAssetsIn", args: [r.user] }),
      ]);
      return moonwellBorrowPlan({ comptroller, mCollateral, mLoan, collateralToken: r.collateralToken,
        entered: entered.some((m) => m.toLowerCase() === mCollateral.toLowerCase()), collateral: r.collateral, borrow: r.borrow,
        collateralBalance: f.balance, allowance: f.allowance, native: f.native, gasReserve: r.gasReserve, wrappedNative: r.wrappedNative, nativeSymbol: r.nativeSymbol });
    },
    async prepareRepay(c, r) {
      const mLoan = await mTokenFor(c, r.loanToken);
      const [loan, loanBalance, allowance, collateral] = await Promise.all([
        snapshot(c, mLoan, r.user),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [r.user] }),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "allowance", args: [r.user, mLoan] }),
        Promise.all(r.collateralTokens.map(async (token) => {
          const mToken = await mTokenFor(c, token);
          return { mToken, mTokens: (await snapshot(c, mToken, r.user)).mTokens };
        })),
      ]);
      return moonwellRepayPlan({ mLoan, loanToken: r.loanToken, assets: r.assets, debt: loan.borrow, loanBalance, allowance, collateral });
    },
    async position(c, r) {
      const [col, loan] = await Promise.all([
        mTokenFor(c, r.collateralToken).then((m) => snapshot(c, m, r.user)),
        mTokenFor(c, r.loanToken).then((m) => snapshot(c, m, r.user)),
      ]);
      return { collateral: col.underlying, debt: loan.borrow };
    },
  };
}
