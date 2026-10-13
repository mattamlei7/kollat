import { encodeFunctionData, maxInt256, minInt256, parseAbi, type Address } from "viem";
import { FLUID_VAULT_RESOLVER_ABI } from "../protocols/abis/fluid";
import { ERC20_ABI, approveStep, fundSteps, readFunding, withHeadroom, type Executor, type PlanStep } from "./common";
import { SHORT_FOR_FULL_REPAY } from "./morpho";

/**
 * Unsigned Fluid vault plans. A vault is one collateral → debt pair; each position is an NFT.
 * operate(nftId, newCol, newDebt, to) does everything in one call: nftId 0 opens a new position,
 * positive amounts deposit / borrow, negative amounts withdraw / pay back, and int256.min means "all".
 * Native-ETH vaults take ETH as msg.value (Kollat counts wallet WETH too, so a shortfall is unwrapped first).
 * Borrow: [unwrap | wrap → approve] → operate(0, +col, +debt).  Repay: approve → operate(nft, 0 | min, -assets | min).
 */

export const FLUID_VAULT_WRITE_ABI = parseAbi([
  "function operate(uint256 nftId_, int256 newCol_, int256 newDebt_, address to_) payable returns (uint256, int256, int256)",
]);
const RESOLVER_ABI = [...FLUID_VAULT_RESOLVER_ABI, ...parseAbi(["function getVaultAddress(uint256 vaultId_) view returns (address)"])];
const WETH_ABI = parseAbi(["function withdraw(uint256 wad)"]);
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const operate = (vault: Address, nftId: bigint, col: bigint, debt: bigint, to: Address, value = 0n) =>
  ({ to: vault, value, data: encodeFunctionData({ abi: FLUID_VAULT_WRITE_ABI, functionName: "operate", args: [nftId, col, debt, to] }) });

export interface FluidBorrowInput {
  vault: Address;
  /** The vault takes native ETH; collateralToken is then the wrapped native Kollat counted. */
  nativeVault: boolean;
  collateralToken: Address;
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

export function fluidBorrowPlan(p: FluidBorrowInput): PlanStep[] {
  if (p.collateral <= 0n || p.borrow <= 0n) throw new Error("Collateral and borrow amounts must be positive.");
  if (p.collateral > maxInt256 || p.borrow > maxInt256) throw new Error("Amount too large.");
  const steps: PlanStep[] = [];
  if (p.nativeVault) {
    const spendable = p.native > p.gasReserve ? p.native - p.gasReserve : 0n;
    const shortfall = p.collateral - spendable;
    if (shortfall > 0n) {
      if (p.collateralBalance < shortfall) throw new Error("Not enough collateral in the wallet while keeping some for network fees.");
      steps.push({ label: `Unwrap W${p.nativeSymbol}`, to: p.wrappedNative, value: 0n, data: encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [shortfall] }) });
    }
  } else {
    steps.push(...fundSteps({ token: p.collateralToken, spender: p.vault, spenderName: "Fluid", amount: p.collateral, balance: p.collateralBalance,
      allowance: p.allowance, native: p.native, gasReserve: p.gasReserve, wrappedNative: p.wrappedNative, nativeSymbol: p.nativeSymbol }));
  }
  // One call deposits and borrows into a new position NFT; the USDC goes to the borrower's own wallet.
  steps.push({ label: "Deposit collateral and borrow", ...operate(p.vault, 0n, p.collateral, p.borrow, p.user, p.nativeVault ? p.collateral : 0n) });
  return steps;
}

export interface FluidRepayInput {
  vault: Address;
  loanToken: Address;
  user: Address;
  nftId: bigint;
  /** Omit to repay everything and withdraw the collateral. */
  assets?: bigint;
  debt: bigint;
  collateral: bigint;
  loanBalance: bigint;
  allowance: bigint;
}

export function fluidRepayPlan(p: FluidRepayInput): PlanStep[] {
  const all = p.assets === undefined;
  if (!all && (p.assets! <= 0n || p.assets! >= p.debt)) throw new Error("Enter an amount below the full debt, or repay everything.");
  if (p.debt === 0n && p.collateral === 0n) throw new Error("Nothing to repay or withdraw.");
  const steps: PlanStep[] = [];
  if (p.debt > 0n) {
    if (p.loanBalance < (all ? p.debt : p.assets!)) throw new Error(all ? SHORT_FOR_FULL_REPAY : "Not enough in the wallet to repay that amount.");
    const pull = all ? withHeadroom(p.debt) : p.assets!;
    if (p.allowance < pull) steps.push(approveStep("Allow Fluid to take the repayment", p.loanToken, p.vault, pull));
  }
  if (!all) steps.push({ label: "Repay part of the debt", ...operate(p.vault, p.nftId, 0n, -p.assets!, p.user) });
  // int256.min pays back the exact debt at inclusion time and withdraws all collateral, in one call.
  else steps.push({ label: p.debt > 0n ? "Repay the full debt and withdraw collateral" : "Withdraw collateral", ...operate(p.vault, p.nftId, minInt256, p.debt > 0n ? minInt256 : 0n, p.user) });
  return steps;
}

export function fluidExecutor(resolver: Address): Executor {
  type Client = Parameters<Executor["position"]>[0];
  const vaultOf = (c: Client, marketId: string) =>
    c.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "getVaultAddress", args: [BigInt(marketId.slice(marketId.lastIndexOf(":") + 1))] });
  // ponytail: one Kollat loan per vault — the position with the most debt (newest on ties). Pick by NFT id if borrowers open several.
  const positionOf = async (c: Client, vault: Address, user: Address) => {
    const [positions, vaults] = await c.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "positionsByUser", args: [user] });
    return positions
      .filter((p, i) => vaults[i].vault.toLowerCase() === vault.toLowerCase() && (p.supply > 0n || p.borrow > 0n))
      .reduce<{ nftId: bigint; supply: bigint; borrow: bigint } | null>((best, p) => (!best || p.borrow > best.borrow || (p.borrow === best.borrow && p.nftId > best.nftId) ? p : best), null);
  };
  return {
    async prepareBorrow(c, r) {
      const vault = await vaultOf(c, r.marketId);
      const [data] = await c.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "getVaultsEntireData", args: [[vault]] });
      if (data.constantVariables.borrowToken.token0.toLowerCase() !== r.loanToken.toLowerCase()) throw new Error("This Fluid vault does not lend the requested asset.");
      const nativeVault = data.constantVariables.supplyToken.token0.toLowerCase() === NATIVE;
      if (!nativeVault && data.constantVariables.supplyToken.token0.toLowerCase() !== r.collateralToken.toLowerCase()) throw new Error("This Fluid vault does not take that collateral.");
      const f = await readFunding(c, r.collateralToken, r.user, vault);
      return fluidBorrowPlan({ vault, nativeVault, collateralToken: r.collateralToken, user: r.user, collateral: r.collateral, borrow: r.borrow,
        collateralBalance: f.balance, allowance: f.allowance, native: f.native, gasReserve: r.gasReserve, wrappedNative: r.wrappedNative, nativeSymbol: r.nativeSymbol });
    },
    async prepareRepay(c, r) {
      const vault = await vaultOf(c, r.marketId);
      const [pos, loanBalance, allowance] = await Promise.all([
        positionOf(c, vault, r.user),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [r.user] }),
        c.readContract({ address: r.loanToken, abi: ERC20_ABI, functionName: "allowance", args: [r.user, vault] }),
      ]);
      if (!pos) throw new Error("No Fluid position in this vault.");
      return fluidRepayPlan({ vault, loanToken: r.loanToken, user: r.user, nftId: pos.nftId, assets: r.assets, debt: pos.borrow, collateral: pos.supply, loanBalance, allowance });
    },
    async position(c, r) {
      const pos = await positionOf(c, await vaultOf(c, r.marketId), r.user);
      return { collateral: pos?.supply ?? 0n, debt: pos?.borrow ?? 0n };
    },
  };
}
