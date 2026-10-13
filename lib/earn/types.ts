import type { Address } from "viem";

/**
 * One place a user can deposit an asset to earn: an Aave or SparkLend supply market, a Morpho vault, or a
 * Spark Savings vault. JSON-safe: token amounts are base-unit integer strings. Unknown is null, never zero.
 */
export type EarnProduct = "aave-supply" | "sparklend-supply" | "morpho-vault" | "spark-savings";

export const PRODUCT_LABEL: Record<EarnProduct, string> = {
  "aave-supply": "Aave supply",
  "sparklend-supply": "SparkLend supply",
  "morpho-vault": "Morpho vault",
  "spark-savings": "Spark Savings",
};

export interface EarnToken { address: Address; symbol: string; decimals: number }

export interface Opportunity {
  /** Stable: product, chain and the contract that holds the deposit. */
  id: string;
  product: EarnProduct;
  protocol: "Aave" | "Morpho" | "Spark";
  chainId: number;
  /** Market or vault name, e.g. "USDC market" or "Gauntlet USDC Prime". */
  name: string;
  /** Curator or operator, where one decides where funds go. */
  operator: string | null;
  asset: EarnToken;
  /** What the depositor holds afterwards: aTokens / spTokens, or vault shares. */
  receipt: EarnToken & { kind: "interest-bearing token" | "vault shares" };
  /** Contract the deposit call goes to; also the approval spender. */
  target: Address;

  /** Annualized yield after the protocol's or vault's ongoing fees; token incentives excluded. */
  baseApy: number | null;
  rateKind: "variable" | "governance-set";
  /** Separate incentive components (APR), only where the source computes them. null = not tracked. */
  rewards: { token: string; apr: number }[] | null;
  fees: { label: string; value: string }[] | null;

  /** How much more the destination accepts, base units. "unlimited" when no cap applies. */
  capacity: "unlimited" | string | null;
  /** Deposit asset the destination could pay out right now, base units. */
  liquidity: string | null;
  withdrawal: string;

  status: "active" | "frozen" | "paused" | "unknown";
  usedFor: string;
  exposure: string;
  /** Set when the deposit is converted into another asset on the way in. */
  conversion: string | null;
  /** Where a vault's funds currently sit, largest first. */
  allocations: { label: string; share: number }[] | null;

  docsUrl: string;
  explorerUrl: string;
  /** When the rate and liquidity were observed (ms). */
  fetchedAt: number | null;
  /** Why some fields are missing, when a read failed. */
  error: string | null;
}

export interface EarnSnapshot {
  opportunities: Opportunity[];
  /** Providers that could not be read; their rows still appear with unknown fields. */
  failures: { source: string; chainId: number; message: string }[];
  fetchedAt: number;
}

/** Rates older than this are shown but not ranked. */
export const STALE_MS = 15 * 60_000;
