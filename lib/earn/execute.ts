import { BaseError, ContractFunctionRevertedError, encodeFunctionData, erc20Abi, formatUnits, maxUint256, parseAbi, type Address, type PublicClient } from "viem";
import { approveStep, type PlanStep } from "../execution/common";
import { AAVE_POOL_WRITE_ABI } from "../execution/aave";
import { COMET_WRITE_ABI } from "../execution/compound";
import type { Opportunity } from "./types";

/**
 * Unsigned deposit and withdrawal plans for earn destinations. Three mechanics cover every listed product:
 * - Pools (Aave, SparkLend): approve → supply(asset, amount, you); withdraw(asset, amount | max, you).
 * - Compound v3: approve → supply(USDC, amount); withdraw(USDC, amount | max). The caller is the account.
 * - ERC-4626 vaults (Morpho, Euler, Fluid, Spark Savings): approve → deposit(amount, you); withdraw(assets) or redeem(all shares).
 * Approvals are for the exact amount. Assets always go to, and come back to, the depositor's own wallet.
 */

export const VAULT_WRITE_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

type Dest = Pick<Opportunity, "product" | "target" | "asset" | "receipt" | "name">;
const isPool = (d: Dest) => d.product === "aave-supply" || d.product === "sparklend-supply";
const isComet = (d: Dest) => d.product === "compound-supply";

const COMET_ACCOUNT_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function borrowBalanceOf(address) view returns (uint256)",
  "function isWithdrawPaused() view returns (bool)",
]);

export interface DepositInput { dest: Dest; user: Address; amount: bigint; balance: bigint; allowance: bigint; capacity: bigint | null }

export function depositPlan(p: DepositInput): PlanStep[] {
  if (p.amount <= 0n) throw new Error("Enter an amount to deposit.");
  if (p.amount > p.balance) throw new Error(`Not enough ${p.dest.asset.symbol} in the wallet.`);
  if (p.capacity !== null && p.amount > p.capacity) throw new Error(`${p.dest.name} accepts at most ${formatUnits(p.capacity, p.dest.asset.decimals)} ${p.dest.asset.symbol} more right now.`);
  const steps: PlanStep[] = [];
  if (p.allowance < p.amount) steps.push(approveStep(`Approve ${p.dest.asset.symbol}`, p.dest.asset.address, p.dest.target, p.amount));
  steps.push({
    label: "Deposit", to: p.dest.target, value: 0n,
    data: isPool(p.dest)
      ? encodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, functionName: "supply", args: [p.dest.asset.address, p.amount, p.user, 0] })
      : isComet(p.dest) ? encodeFunctionData({ abi: COMET_WRITE_ABI, functionName: "supply", args: [p.dest.asset.address, p.amount] })
      : encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "deposit", args: [p.amount, p.user] }),
  });
  return steps;
}

export interface Holding {
  withdrawalNote?: string;
  /** Position value in the deposit asset, base units. */
  assets: bigint;
  /** Of that, what can be withdrawn right now. */
  withdrawable: bigint;
  /** Vault shares held (vaults only). */
  shares: bigint;
}

const POOL_ACCOUNT_ABI = parseAbi([
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
  "function getConfiguration(address) view returns (uint256)",
]);

/** A conservative executable amount when a supplied asset also backs debt. */
export async function constrainedWithdrawalLimit(max: bigint, canWithdraw: (amount: bigint) => Promise<boolean>): Promise<bigint> {
  if (max === 0n || await canWithdraw(max)) return max;
  let low = 0n, high = max;
  for (let i = 0; i < 12 && high - low > 1n; i++) {
    const mid = (low + high) / 2n;
    if (await canWithdraw(mid)) low = mid; else high = mid;
  }
  return low;
}

export interface WithdrawInput { dest: Dest; user: Address; /** Omit to withdraw everything. */ amount?: bigint; holding: Holding }

export function withdrawPlan(p: WithdrawInput): PlanStep[] {
  const all = p.amount === undefined;
  const { assets, withdrawable, shares } = p.holding;
  if (assets === 0n) throw new Error("Nothing deposited here.");
  if (!all && p.amount! <= 0n) throw new Error("Enter an amount to withdraw.");
  if (!all && p.amount! > assets) throw new Error("That is more than this position holds.");
  if ((all ? assets : p.amount!) > withdrawable) {
    if (p.holding.withdrawalNote) throw new Error(p.holding.withdrawalNote);
    throw new Error(all ? "Only part of this position can be withdrawn right now; the rest is lent out. Withdraw the available amount, or try again later."
      : "That is more than can be withdrawn right now; the rest is lent out.");
  }
  if (isPool(p.dest)) {
    // max withdraws the whole balance including interest accrued up to inclusion.
    return [{ label: all ? "Withdraw everything" : "Withdraw", to: p.dest.target, value: 0n,
      data: encodeFunctionData({ abi: AAVE_POOL_WRITE_ABI, functionName: "withdraw", args: [p.dest.asset.address, all ? maxUint256 : p.amount!, p.user] }) }];
  }
  if (isComet(p.dest)) {
    // max withdraws the whole supply balance at inclusion. An exact amount above the balance would borrow, so it is checked above.
    return [{ label: all ? "Withdraw everything" : "Withdraw", to: p.dest.target, value: 0n,
      data: encodeFunctionData({ abi: COMET_WRITE_ABI, functionName: "withdraw", args: [p.dest.asset.address, all ? maxUint256 : p.amount!] }) }];
  }
  return [{ label: all ? "Withdraw everything" : "Withdraw", to: p.dest.target, value: 0n,
    data: all
      ? encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "redeem", args: [shares, p.user, p.user] })
      : encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "withdraw", args: [p.amount!, p.user, p.user] }) }];
}

/** The depositor's position at a destination, read from the chain. */
export async function readHolding(c: PublicClient, dest: Dest, user: Address): Promise<Holding> {
  if (isPool(dest)) {
    const [assets, cash, account, configuration] = await Promise.all([
      c.readContract({ address: dest.receipt.address, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
      c.readContract({ address: dest.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [dest.receipt.address] }),
      c.readContract({ address: dest.target, abi: POOL_ACCOUNT_ABI, functionName: "getUserAccountData", args: [user] }),
      c.readContract({ address: dest.target, abi: POOL_ACCOUNT_ABI, functionName: "getConfiguration", args: [dest.asset.address] }),
    ]);
    if ((configuration & (1n << 60n)) !== 0n) return { assets, withdrawable: 0n, shares: 0n, withdrawalNote: "Withdrawals are paused by this pool." };
    const liquid = assets < cash ? assets : cash;
    if (account[1] === 0n || liquid === 0n) return { assets, withdrawable: liquid, shares: 0n };
    const withdrawable = await constrainedWithdrawalLimit(liquid, async (amount) => {
      try {
        await c.simulateContract({ account: user, address: dest.target, abi: AAVE_POOL_WRITE_ABI, functionName: "withdraw", args: [dest.asset.address, amount, user] });
        return true;
      } catch (error) {
        if (error instanceof BaseError && error.walk(e => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) return false;
        throw error; // An unavailable RPC must not be presented as a zero balance or zero liquidity.
      }
    });
    return { assets, withdrawable, shares: 0n, ...(withdrawable < liquid ? { withdrawalNote: "This deposit backs an existing loan. The amount shown is a conservative withdrawal estimate checked against the pool's collateral requirements." } : {}) };
  }
  if (isComet(dest)) {
    const comet = { address: dest.target, abi: COMET_ACCOUNT_ABI } as const;
    const [assets, cash, paused] = await Promise.all([
      c.readContract({ ...comet, functionName: "balanceOf", args: [user] }),
      c.readContract({ address: dest.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [dest.target] }),
      c.readContract({ ...comet, functionName: "isWithdrawPaused" }),
    ]);
    if (paused) return { assets, withdrawable: 0n, shares: 0n, withdrawalNote: "Withdrawals are paused by this market." };
    return { assets, withdrawable: assets < cash ? assets : cash, shares: 0n };
  }
  const v = { address: dest.target, abi: VAULT_WRITE_ABI } as const;
  const [shares, withdrawable] = await Promise.all([
    c.readContract({ ...v, functionName: "balanceOf", args: [user] }),
    c.readContract({ ...v, functionName: "maxWithdraw", args: [user] }),
  ]);
  const assets = shares === 0n ? 0n : await c.readContract({ ...v, functionName: "previewRedeem", args: [shares] });
  return { assets, withdrawable: withdrawable < assets ? withdrawable : assets, shares };
}

/** Wallet balance and current allowance for a deposit into `dest`. */
export async function readFundingFor(c: PublicClient, dest: Dest, user: Address) {
  const [balance, allowance] = await Promise.all([
    c.readContract({ address: dest.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
    c.readContract({ address: dest.asset.address, abi: erc20Abi, functionName: "allowance", args: [user, dest.target] }),
  ]);
  if (isComet(dest) && await c.readContract({ address: dest.target, abi: COMET_ACCOUNT_ABI, functionName: "borrowBalanceOf", args: [user] }) > 0n) {
    // Supplying the base asset repays debt first, so this would not be a deposit.
    throw new Error("This wallet has a Compound loan in this market, so a USDC deposit would repay it instead of earning. Repay it from Borrow first.");
  }
  const capacity = isPool(dest) || isComet(dest) ? null : await c.readContract({ address: dest.target, abi: VAULT_WRITE_ABI, functionName: "maxDeposit", args: [user] });
  return { balance, allowance, capacity };
}
