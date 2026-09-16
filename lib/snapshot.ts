import { isAddress, type Address } from "viem";
import { normalize } from "viem/ens";
import { CHAIN_IDS, getClient } from "./chains";
import { PROTOCOLS } from "./protocols/registry";
import type {
  BorrowCapacity,
  ChainId,
  LendingProtocol,
  Market,
  Position,
  ProtocolId,
  Rate,
  Result,
  Token,
} from "./protocols/types";

/**
 * Assembles what the UI needs in one shape. Route handlers call these;
 * bigint fields are serialised to strings by `toJson`.
 */

export interface ProtocolMarkets {
  id: ProtocolId;
  name: string;
  chainId: ChainId;
  markets: Result<Market[]>;
  rates: Result<Rate[]>;
}

export interface ProtocolAccount {
  id: ProtocolId;
  name: string;
  chainId: ChainId;
  capacity: Result<BorrowCapacity[]>;
  positions: Result<Position[]>;
}

export interface Holding {
  token: Token;
  balance: bigint;
  units: number;
  /** Display price — the first active market's oracle price for this token on this chain. */
  priceUsd: number;
  usd: number;
  nativeIncluded?: bigint;
}

export interface MarketsSnapshot {
  chains: ChainId[];
  protocols: ProtocolMarkets[];
  generatedAt: number;
}

export interface AccountSnapshot {
  input: string;
  address: Address;
  ens: string | null;
  chains: ChainId[];
  protocols: ProtocolAccount[];
  holdings: Holding[];
  generatedAt: number;
}

export function parseChains(param: string | null): ChainId[] {
  if (!param || param === "all") return CHAIN_IDS;
  const n = Number(param);
  return CHAIN_IDS.includes(n as ChainId) ? [n as ChainId] : CHAIN_IDS;
}

function selected(chains: ChainId[]): LendingProtocol[] {
  return PROTOCOLS.filter((p) => chains.includes(p.chainId));
}

export async function marketsSnapshot(chains: ChainId[]): Promise<MarketsSnapshot> {
  const protocols = await Promise.all(
    selected(chains).map(async (p) => {
      const [markets, rates] = await Promise.all([p.getMarkets(), p.getRates()]);
      return { id: p.id, name: p.name, chainId: p.chainId, markets, rates };
    }),
  );
  return { chains, protocols, generatedAt: Date.now() };
}

export async function resolveInput(input: string): Promise<{ address: Address; ens: string | null } | null> {
  const trimmed = input.trim();
  if (isAddress(trimmed)) return { address: trimmed, ens: null };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(trimmed)) {
    const address = await getClient(1).getEnsAddress({ name: normalize(trimmed) });
    return address ? { address, ens: trimmed } : null;
  }
  return null;
}

export async function accountSnapshot(input: string, chains: ChainId[]): Promise<AccountSnapshot | null> {
  const resolved = await resolveInput(input);
  if (!resolved) return null;
  const { address, ens } = resolved;

  const protocols = await Promise.all(
    selected(chains).map(async (p) => {
      const [capacity, positions] = await Promise.all([p.getBorrowCapacity(address), p.getPositions(address)]);
      return { id: p.id, name: p.name, chainId: p.chainId, capacity, positions };
    }),
  );

  // Holdings = union of collateral tokens with a non-zero wallet balance.
  const holdings = new Map<string, Holding>();
  for (const p of protocols) {
    if (!p.capacity.ok) continue;
    const markets = await PROTOCOLS.find((x) => x.id === p.id && x.chainId === p.chainId)!.getMarkets();
    if (!markets.ok) continue;
    const byId = new Map(markets.data.map((m) => [m.id, m]));
    for (const c of p.capacity.data) {
      if (c.collateralBalance === 0n) continue;
      const m = byId.get(c.marketId);
      if (!m) continue;
      const key = `${m.chainId}:${m.collateral.address.toLowerCase()}`;
      if (holdings.has(key)) continue;
      const units = Number(c.collateralBalance) / 10 ** m.collateral.decimals;
      holdings.set(key, {
        token: m.collateral,
        balance: c.collateralBalance,
        units,
        priceUsd: m.collateralPriceUsd,
        usd: units * m.collateralPriceUsd,
        nativeIncluded: c.nativeBalanceIncluded,
      });
    }
  }

  return {
    input,
    address,
    ens,
    chains,
    protocols,
    holdings: [...holdings.values()].sort((a, b) => b.usd - a.usd),
    generatedAt: Date.now(),
  };
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}
