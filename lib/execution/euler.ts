import { encodeFunctionData, maxUint256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { subAccount } from "../protocols/addresses";
import { ERC20_ABI, approveStep, fundSteps, readFunding, withHeadroom, type Executor, type PlanStep } from "./common";
import { SHORT_FOR_FULL_REPAY } from "./morpho";

/**
 * Unsigned Euler v2 (EVK) plans. Collateral sits in a collateral vault, the loan comes from a debt vault, and the
 * EVC links them per sub-account. Everything after the approval is one EVC batch, so it lands or reverts together:
 * Borrow: [wrap →] approve → batch(deposit into the sub-account, enable collateral, enable controller, borrow to the wallet).
 * Repay:  approve → batch(repay [, disable controller, redeem every collateral to the wallet]).
 */

export const EVC_WRITE_ABI = parseAbi([
  "function batch((address targetContract, address onBehalfOfAccount, uint256 value, bytes data)[] items) payable",
  "function enableCollateral(address account, address vault) payable",
  "function enableController(address account, address vault) payable",
  "function getControllers(address account) view returns (address[])",
  "function getCollaterals(address account) view returns (address[])",
]);
export const EVAULT_WRITE_ABI = parseAbi([
  "function deposit(uint256 amount, address receiver) returns (uint256)",
  "function borrow(uint256 amount, address receiver) returns (uint256)",
  "function repay(uint256 amount, address receiver) returns (uint256)",
  "function redeem(uint256 amount, address receiver, address owner) returns (uint256)",
  "function disableController()",
  "function asset() view returns (address)",
  "function debtOf(address account) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

interface Item { targetContract: Address; onBehalfOfAccount: Address; value: bigint; data: Hex }
const vaultCall = (vault: Address, account: Address, data: Hex): Item => ({ targetContract: vault, onBehalfOfAccount: account, value: 0n, data });
/** Calls to the EVC itself go in the batch with no on-behalf-of account. */
const evcCall = (evc: Address, data: Hex): Item => ({ targetContract: evc, onBehalfOfAccount: zeroAddress, value: 0n, data });
const batch = (label: string, evc: Address, items: Item[]): PlanStep =>
  ({ label, to: evc, value: 0n, data: encodeFunctionData({ abi: EVC_WRITE_ABI, functionName: "batch", args: [items] }) });

export interface EulerBorrowInput {
  evc: Address;
  debtVault: Address;
  collateralVault: Address;
  collateralToken: Address;
  user: Address;
  /** The sub-account that holds this loan: one already borrowing from this vault, or a free one. */
  account: Address;
  collateral: bigint;
  borrow: bigint;
  collateralBalance: bigint;
  allowance: bigint;
  native: bigint;
  gasReserve: bigint;
  wrappedNative: Address;
  nativeSymbol: string;
}

export function eulerBorrowPlan(p: EulerBorrowInput): PlanStep[] {
  if (p.collateral <= 0n || p.borrow <= 0n) throw new Error("Collateral and borrow amounts must be positive.");
  return [
    ...fundSteps({ token: p.collateralToken, spender: p.collateralVault, spenderName: "Euler", amount: p.collateral, balance: p.collateralBalance,
      allowance: p.allowance, native: p.native, gasReserve: p.gasReserve, wrappedNative: p.wrappedNative, nativeSymbol: p.nativeSymbol }),
    batch("Deposit collateral and borrow", p.evc, [
      // Assets come from the wallet; the shares and the debt live in the sub-account; the USDC goes to the wallet.
      vaultCall(p.collateralVault, p.user, encodeFunctionData({ abi: EVAULT_WRITE_ABI, functionName: "deposit", args: [p.collateral, p.account] })),
      evcCall(p.evc, encodeFunctionData({ abi: EVC_WRITE_ABI, functionName: "enableCollateral", args: [p.account, p.collateralVault] })),
      evcCall(p.evc, encodeFunctionData({ abi: EVC_WRITE_ABI, functionName: "enableController", args: [p.account, p.debtVault] })),
      vaultCall(p.debtVault, p.account, encodeFunctionData({ abi: EVAULT_WRITE_ABI, functionName: "borrow", args: [p.borrow, p.user] })),
    ]),
  ];
}

export interface EulerRepayInput {
  evc: Address;
  debtVault: Address;
  loanToken: Address;
  user: Address;
  account: Address;
  /** Omit to repay everything and withdraw the collateral. */
  assets?: bigint;
  debt: bigint;
  loanBalance: bigint;
  allowance: bigint;
  /** Collateral vaults the sub-account holds shares in. */
  collateralVaults: Address[];
}

export function eulerRepayPlan(p: EulerRepayInput): PlanStep[] {
  const all = p.assets === undefined;
  if (!all && (p.assets! <= 0n || p.assets! >= p.debt)) throw new Error("Enter an amount below the full debt, or repay everything.");
  const steps: PlanStep[] = [];
  const items: Item[] = [];
  if (p.debt > 0n) {
    if (p.loanBalance < (all ? p.debt : p.assets!)) throw new Error(all ? SHORT_FOR_FULL_REPAY : "Not enough in the wallet to repay that amount.");
    const pull = all ? withHeadroom(p.debt) : p.assets!;
    if (p.allowance < pull) steps.push(approveStep("Allow Euler to take the repayment", p.loanToken, p.debtVault, pull));
    // Paid from the wallet; max repays the exact debt at inclusion time.
    items.push(vaultCall(p.debtVault, p.user, encodeFunctionData({ abi: EVAULT_WRITE_ABI, functionName: "repay", args: [all ? maxUint256 : p.assets!, p.account] })));
  }
  if (all) {
    items.push(vaultCall(p.debtVault, p.account, encodeFunctionData({ abi: EVAULT_WRITE_ABI, functionName: "disableController" })));
    for (const v of p.collateralVaults) {
      items.push(vaultCall(v, p.account, encodeFunctionData({ abi: EVAULT_WRITE_ABI, functionName: "redeem", args: [maxUint256, p.user, p.account] })));
    }
  }
  if (items.length === 0) throw new Error("Nothing to repay or withdraw.");
  steps.push(batch(!all ? "Repay part of the debt" : p.debt > 0n ? "Repay the full debt and withdraw collateral" : "Withdraw collateral", p.evc, items));
  return steps;
}

const SUB_ACCOUNTS = 256;

export function eulerExecutor(evc: Address): Executor {
  type Client = Parameters<Executor["position"]>[0];
  const vaultsOf = (marketId: string) => {
    const [, , debtVault, collateralVault] = marketId.split(":");
    return { debtVault: debtVault as Address, collateralVault: collateralVault as Address | undefined };
  };
  /** Sub-accounts by their controller (debt vault), lowest index first. */
  const controllers = async (c: Client, user: Address) => {
    const subs = Array.from({ length: SUB_ACCOUNTS }, (_, i) => subAccount(user, i));
    const res = await c.multicall({ contracts: subs.map((account) => ({ address: evc, abi: EVC_WRITE_ABI, functionName: "getControllers" as const, args: [account] as const })), allowFailure: false });
    return subs.map((account, i) => ({ account, controller: res[i][0]?.toLowerCase() }));
  };
  const loanAccount = async (c: Client, user: Address, debtVault: Address) =>
    (await controllers(c, user)).find((s) => s.controller === debtVault.toLowerCase())?.account;
  const held = async (c: Client, account: Address) => {
    const vaults = await c.readContract({ address: evc, abi: EVC_WRITE_ABI, functionName: "getCollaterals", args: [account] });
    const shares = await Promise.all(vaults.map((v) => c.readContract({ address: v, abi: EVAULT_WRITE_ABI, functionName: "balanceOf", args: [account] })));
    return vaults.map((vault, i) => ({ vault, shares: shares[i] })).filter((h) => h.shares > 0n);
  };
  return {
    async prepareBorrow(c, r) {
      const { debtVault, collateralVault } = vaultsOf(r.marketId);
      if (!collateralVault) throw new Error("No Euler collateral vault for this market.");
      const [asset, debtAsset, subs] = await Promise.all([
        c.readContract({ address: collateralVault, abi: EVAULT_WRITE_ABI, functionName: "asset" }),
        c.readContract({ address: debtVault, abi: EVAULT_WRITE_ABI, functionName: "asset" }),
        controllers(c, r.user),
      ]);
      if (asset.toLowerCase() !== r.collateralToken.toLowerCase()) throw new Error("This Euler vault does not take that collateral.");
      if (debtAsset.toLowerCase() !== r.loanToken.toLowerCase()) throw new Error("This Euler vault does not lend the requested asset.");
      // A sub-account can have one controller: add to a loan from this vault, else open one in the first free sub-account.
      const account = (subs.find((s) => s.controller === debtVault.toLowerCase()) ?? subs.find((s) => !s.controller))?.account;
      if (!account) throw new Error("Every Euler sub-account on this wallet already has a loan.");
      const f = await readFunding(c, r.collateralToken, r.user, collateralVault);
      return eulerBorrowPlan({ evc, debtVault, collateralVault, collateralToken: r.collateralToken, user: r.user, account, collateral: r.collateral, borrow: r.borrow,
        collateralBalance: f.balance, allowance: f.allowance, native: f.native, gasReserve: r.gasReserve, wrappedNative: r.wrappedNative, nativeSymbol: r.nativeSymbol });
    },
    async prepareRepay(c, r) {
      const { debtVault } = vaultsOf(r.marketId);
      const account = await loanAccount(c, r.user, debtVault);
      if (!account) throw new Error("No Euler loan from this vault.");
      const [debt, collateral, loanBalance, allowance] = await Promise.all([
        c.readContract({ address: debtVault, abi: EVAULT_WRITE_ABI, functionName: "debtOf", args: [account] }),
        held(c, account),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [r.user] }),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "allowance", args: [r.user, debtVault] }),
      ]);
      return eulerRepayPlan({ evc, debtVault, loanToken: r.loanToken, user: r.user, account, assets: r.assets, debt, loanBalance, allowance, collateralVaults: collateral.map((h) => h.vault) });
    },
    async position(c, r) {
      const { debtVault } = vaultsOf(r.marketId);
      const account = await loanAccount(c, r.user, debtVault);
      if (!account) return { collateral: 0n, debt: 0n };
      const [debt, collateral] = await Promise.all([
        c.readContract({ address: debtVault, abi: EVAULT_WRITE_ABI, functionName: "debtOf", args: [account] }),
        held(c, account),
      ]);
      // Collateral in the requested token, across the sub-account's vaults for it.
      const assets = await Promise.all(collateral.map(async (h) => {
        const asset = await c.readContract({ address: h.vault, abi: EVAULT_WRITE_ABI, functionName: "asset" });
        return asset.toLowerCase() === r.collateralToken.toLowerCase()
          ? c.readContract({ address: h.vault, abi: EVAULT_WRITE_ABI, functionName: "convertToAssets", args: [h.shares] })
          : 0n;
      }));
      return { collateral: assets.reduce((a, b) => a + b, 0n), debt };
    },
  };
}
