import type { AccountSnapshot, MarketsSnapshot } from "./snapshot";

/** Shapes after JSON transport: every bigint became a decimal string. */
export type Jsonified<T> = T extends bigint
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

export type MarketsJson = Jsonified<MarketsSnapshot>;
export type AccountJson = Jsonified<AccountSnapshot>;
export type ProtocolMarketsJson = MarketsJson["protocols"][number];
export type ProtocolAccountJson = AccountJson["protocols"][number];
export type MarketJson = Extract<ProtocolMarketsJson["markets"], { ok: true }>["data"][number];
export type RateJson = Extract<ProtocolMarketsJson["rates"], { ok: true }>["data"][number];
export type CapacityJson = Extract<ProtocolAccountJson["capacity"], { ok: true }>["data"][number];
export type PositionJson = Extract<ProtocolAccountJson["positions"], { ok: true }>["data"][number];
export type HoldingJson = AccountJson["holdings"][number];

/** Chains selectable in the UI; "all" fans out to every chain. Lives here (not in a client module) so server pages can read it. */
export const CHAIN_PARAMS = ["1", "8453", "42161", "10", "137", "43114", "all"] as const;
export type ChainParam = (typeof CHAIN_PARAMS)[number];

export const CHAIN_LABEL: Record<number, string> = { 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 10: "Optimism", 137: "Polygon", 43114: "Avalanche" };
/** Native coin per chain, for the "incl. ETH · wrap to use" hint. */
export const NATIVE_SYMBOL: Record<number, string> = { 1: "ETH", 8453: "ETH", 42161: "ETH", 10: "ETH", 137: "POL", 43114: "AVAX" };

export function protocolKey(p: { id: string; chainId: number }) {
  return `${p.id}:${p.chainId}`;
}

/** Where a user would actually open the loan. Outbound links only; nothing here signs. */
export const PROTOCOL_URL: Record<string, string> = {
  "aave-v3": "https://app.aave.com",
  spark: "https://app.spark.fi",
  "compound-v3": "https://app.compound.finance",
  "morpho-blue": "https://app.morpho.org",
  fluid: "https://fluid.io",
  "euler-v2": "https://app.euler.finance",
  moonwell: "https://moonwell.fi",
};
