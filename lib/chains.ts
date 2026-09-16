import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { base, mainnet } from "viem/chains";
import type { ChainId } from "./protocols/types";

/**
 * Server-side viem clients. RPC URLs come from env with public fallbacks;
 * nothing here is ever imported by client components.
 */

const PUBLIC_RPC: Record<ChainId, string[]> = {
  1: ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
};

const ENV_RPC: Record<ChainId, string | undefined> = {
  1: process.env.RPC_URL_MAINNET,
  8453: process.env.RPC_URL_BASE,
};

export const CHAINS = { 1: mainnet, 8453: base } as const;
export const CHAIN_IDS: ChainId[] = [1, 8453];
export const CHAIN_NAMES: Record<ChainId, string> = { 1: "Ethereum", 8453: "Base" };

const clients = new Map<ChainId, PublicClient>();

export function getClient(chainId: ChainId): PublicClient {
  let c = clients.get(chainId);
  if (c) return c;
  const urls = [ENV_RPC[chainId], ...PUBLIC_RPC[chainId]].filter((u): u is string => !!u);
  c = createPublicClient({
    chain: CHAINS[chainId],
    transport: fallback(
      urls.map((u) => http(u, { timeout: 15_000, retryCount: 1, batch: true })),
      { rank: false },
    ),
    batch: { multicall: { wait: 16 } },
  }) as PublicClient;
  clients.set(chainId, c);
  return c;
}

export function isChainId(n: number): n is ChainId {
  return n === 1 || n === 8453;
}
