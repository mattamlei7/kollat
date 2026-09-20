import type { Address } from "viem";

/**
 * The adapter contract. Every protocol is normalised into
 * (collateral → debt) markets carrying three risk parameters — ltv,
 * liquidationThreshold, liquidationPenalty — and a USD price. That single
 * shape lets one formula compute capacity, health factor and liquidation
 * price for all protocols:
 *
 *   HF            = Σ(collateral_i_usd × liquidationThreshold_i) / debt_usd
 *   maxBorrowUsd  = Σ(collateral_i_usd × ltv_i)
 *   liqPrice      = debt_usd / (collateral_units × liquidationThreshold)
 *
 * Adapters are read-only by construction: the interface exposes no method
 * that could build or sign a transaction.
 */

export type ChainId = 1 | 8453 | 42161 | 10 | 137 | 43114;
export type ProtocolId = "aave-v3" | "spark" | "compound-v3" | "morpho-blue" | "fluid" | "euler-v2" | "moonwell";

export interface Token {
  chainId: ChainId;
  address: Address;
  symbol: string;
  decimals: number;
}

/** `unpriced`: the protocol's oracle or params could not be read — the market is listed but never quoted. */
export type MarketStatus = "active" | "paused" | "frozen" | "collateral-disabled" | "unpriced";

/** A (collateral → debt) pair on one protocol on one chain. */
export interface Market {
  /** Stable, protocol-specific id, e.g. `aave-v3:1:WETH>USDC`, `morpho-blue:8453:0x…`. */
  id: string;
  protocol: ProtocolId;
  chainId: ChainId;
  collateral: Token;
  /** USDC (or USDbC) in v1. */
  debt: Token;
  /** 0..1 — max borrow / collateral value. */
  ltv: number;
  /** 0..1 — collateral value × LT must stay above debt. */
  liquidationThreshold: number;
  /** 0..1 — bonus paid to the liquidator on seized collateral. */
  liquidationPenalty: number;
  /** Price the *protocol's own oracle* reports — the price the liquidator sees. */
  collateralPriceUsd: number;
  debtPriceUsd: number;
  /** Debt-token base units borrowable right now. */
  availableLiquidity: bigint;
  status: MarketStatus;
  fetchedAt: number;
}

/** Rates refresh more often than market params, hence a separate call. */
export interface Rate {
  marketId: string;
  /** Annual, decimal: 0.0521 = 5.21 %. */
  borrowAprVariable: number;
  /** Compounded annual rate — what a year of borrowing actually costs. */
  borrowApyVariable: number;
  supplyApr: number | null;
  /** 0..1 */
  utilization: number | null;
  fetchedAt: number;
}

export interface BorrowCapacity {
  marketId: string;
  /** Wallet balance of the collateral token (not yet supplied). */
  collateralBalance: bigint;
  /** USD value of the collateral the protocol would accept right now — the wallet balance, or less when a supply cap clamps it. */
  collateralUsd: number;
  /** collateralUsd × ltv, capped by availableLiquidity. */
  maxBorrowUsd: number;
  /** Collateral price at which a max-LTV borrow becomes liquidatable. */
  liquidationPriceAtMaxUsd: number;
  /** maxBorrowUsd was reduced by market liquidity or a supply cap. */
  cappedByLiquidity: boolean;
  /** Native ETH counted toward a WETH market (user would need to wrap). */
  nativeBalanceIncluded?: bigint;
}

export interface PositionLeg {
  token: Token;
  amount: bigint;
  usd: number;
  /** Set on collateral legs — the LT that applies to this leg. */
  liquidationThreshold?: number;
}

export interface Position {
  protocol: ProtocolId;
  chainId: ChainId;
  /**
   * The market (or pool) this position shares a health factor with; null for
   * account-level protocols (Aave, Compound, Moonwell). A prefix of a market id
   * (e.g. `euler-v2:1:<debtVault>`) means every market under that pool.
   */
  marketId: string | null;
  collateral: PositionLeg[];
  debt: PositionLeg[];
  /** null when there is no debt. */
  healthFactor: number | null;
  /** Health factor as the protocol itself reports it, when it exposes one. */
  healthFactorReported: number | null;
  /** Per collateral leg, other legs held constant. 0 = the other legs alone cover the debt. */
  liquidationPrices: { token: Token; priceUsd: number }[];
  /** Fractional drop applied to *all* collateral at once that triggers liquidation: 1 − 1/HF. null without debt. */
  uniformDrawdownToLiquidation: number | null;
  /** Caveats the UI should show, e.g. "E-mode active — thresholds differ". */
  notes: string[];
  fetchedAt: number;
}

/** Does a position with `positionMarketId` share a health factor with `marketId`? (see Position.marketId) */
export const sharesHealthFactor = (positionMarketId: string | null, marketId: string): boolean =>
  positionMarketId === null || positionMarketId === marketId || marketId.startsWith(positionMarketId + ":");

export type ProtocolErrorCode =
  | "RPC_UNAVAILABLE"
  | "UPSTREAM_API"
  | "PROTOCOL_PAUSED"
  | "UNSUPPORTED_CHAIN"
  | "INVALID_ADDRESS"
  /** A read succeeded but produced a value no risk number may be built on (see `admit` in base.ts). */
  | "INVALID_DATA"
  | "UNKNOWN";

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * Errors are values, never thrown — the UI renders them as designed states.
 * `block` is a compatibility field: observed head (or fixture contract-read pin),
 * NOT proof that all inputs came from that block. Discovery APIs and cached
 * dependencies can have different ages. Use provenance and retained inputs.
 */
export interface ReadProvenance {
  kind: "observed-head" | "pinned-contract-reads" | "unknown";
  block: number | null;
  markets?: { block: number | null; fetchedAt: number; stale: boolean; provenance?: ReadProvenance };
}

export type Result<T> =
  | { ok: true; data: T; fetchedAt: number; stale: boolean; block: number | null; provenance?: ReadProvenance }
  | { ok: false; error: ProtocolError };

/** One instance per (protocol, chain). Spark mainnet = the Aave v3 adapter with Spark addresses. */
export interface LendingProtocol {
  readonly id: ProtocolId;
  readonly name: string;
  readonly chainId: ChainId;
  getMarkets(): Promise<Result<Market[]>>;
  getRates(): Promise<Result<Rate[]>>;
  getBorrowCapacity(address: Address): Promise<Result<BorrowCapacity[]>>;
  getPositions(address: Address): Promise<Result<Position[]>>;
}

export const ok = <T>(data: T, fetchedAt = Date.now(), stale = false, block: number | null = null): Result<T> => ({
  ok: true,
  data,
  fetchedAt,
  stale,
  block,
  provenance: { kind: block === null ? "unknown" : "observed-head", block },
});

export const fail = <T>(code: ProtocolErrorCode, message: string, retryable = true): Result<T> => ({
  ok: false,
  error: { code, message, retryable },
});

/** Map any thrown error to a ProtocolError value. */
export function toProtocolError(e: unknown): ProtocolError {
  const message = e instanceof Error ? e.message : String(e);
  const lower = message.toLowerCase();
  if (
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("http request failed") ||
    lower.includes("econnrefused") ||
    lower.includes("network")
  ) {
    return { code: "RPC_UNAVAILABLE", message, retryable: true };
  }
  return { code: "UNKNOWN", message, retryable: false };
}
