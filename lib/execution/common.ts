import { encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from "viem";

/**
 * Shared shape of unsigned borrow/repay plans. Executors read chain state and build calldata only;
 * signing and submission belong to the borrower's own wallet. Nothing here holds a key or broadcasts.
 */

export interface PlanStep { label: string; to: Address; data: Hex; value: bigint }

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const WRAPPED_NATIVE_ABI = parseAbi(["function deposit() payable"]);

export const approveStep = (label: string, token: Address, spender: Address, amount: bigint): PlanStep =>
  ({ label, to: token, value: 0n, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }) });

/**
 * Gas estimates can come in just short for contracts that check gasleft() (Aave's borrow reverted on
 * forks at the estimated limit), so every step is sent with 25% on top. Unused gas isn't charged.
 */
export const withGasBuffer = (estimate: bigint) => estimate + estimate / 4n;

/** Full repays are pulled at inclusion time, after more interest; allow 0.1% on the approval. */
export const withHeadroom = (debt: bigint) => debt + debt / 1000n + 1n;

export interface FundInput {
  token: Address;
  spender: Address;
  spenderName: string;
  amount: bigint;
  /** Current wallet state, base units. */
  balance: bigint;
  allowance: bigint;
  native: bigint;
  /** Native kept back for gas when wrapping. */
  gasReserve: bigint;
  /** The chain's wrapped native token (WETH, WPOL): a shortfall in it can be wrapped from native. */
  wrappedNative: Address;
  nativeSymbol: string;
}

/** Wrap a shortfall of wrapped native, then approve the spender: whatever it takes to hand over `amount`. */
export function fundSteps(p: FundInput): PlanStep[] {
  const steps: PlanStep[] = [];
  const shortfall = p.amount - p.balance;
  if (shortfall > 0n) {
    if (p.token.toLowerCase() !== p.wrappedNative.toLowerCase()) throw new Error("Not enough collateral in the wallet.");
    if (p.native - p.gasReserve < shortfall) throw new Error("Not enough to wrap while keeping some for network fees.");
    steps.push({ label: `Wrap ${p.nativeSymbol}`, to: p.wrappedNative, data: encodeFunctionData({ abi: WRAPPED_NATIVE_ABI, functionName: "deposit" }), value: shortfall });
  }
  if (p.allowance < p.amount) steps.push(approveStep(`Allow ${p.spenderName} to take the collateral`, p.token, p.spender, p.amount));
  return steps;
}

/** Reads the wallet state fundSteps needs. */
export async function readFunding(c: PublicClient, token: Address, user: Address, spender: Address) {
  const [balance, allowance, native] = await Promise.all([
    c.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    c.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [user, spender] }),
    c.getBalance({ address: user }),
  ]);
  return { balance, allowance, native };
}

export interface PositionRef {
  /** Kollat's market id ("morpho-blue:8453:0x…", "aave-v3:8453:WETH>USDC"); pooled protocols ignore it. */
  marketId: string;
  collateralToken: Address;
  loanToken: Address;
  user: Address;
}
export interface BorrowRequest extends PositionRef {
  collateral: bigint;
  borrow: bigint;
  gasReserve: bigint;
  wrappedNative: Address;
  nativeSymbol: string;
}
export interface RepayRequest extends PositionRef {
  /** Loan asset to repay, base units. Omit to repay everything and withdraw the collateral. */
  assets?: bigint;
  /** Every collateral and debt asset on the position (pooled protocols can hold several). */
  collateralTokens: Address[];
  debtTokens: Address[];
}

/** One lending protocol's wallet flow. */
export interface Executor {
  prepareBorrow(c: PublicClient, r: BorrowRequest): Promise<PlanStep[]>;
  prepareRepay(c: PublicClient, r: RepayRequest): Promise<PlanStep[]>;
  /** Collateral held and debt owed for this collateral/loan pair, base units. */
  position(c: PublicClient, r: PositionRef): Promise<{ collateral: bigint; debt: bigint }>;
}
