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

export const CHAIN_LABEL: Record<number, string> = { 1: "Ethereum", 8453: "Base" };

export function protocolKey(p: { id: string; chainId: number }) {
  return `${p.id}:${p.chainId}`;
}

/** Where a user would actually open the loan. Outbound links only; nothing here signs. */
export const PROTOCOL_URL: Record<string, string> = {
  "aave-v3": "https://app.aave.com",
  spark: "https://app.spark.fi",
  "compound-v3": "https://app.compound.finance",
  "morpho-blue": "https://app.morpho.org",
};
