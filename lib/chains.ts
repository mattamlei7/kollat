import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from "viem/chains";
import type { ChainId } from "./protocols/types";

/**
 * Server-side viem clients. RPC URLs come from env with public fallbacks;
 * nothing here is ever imported by client components.
 */

const PUBLIC_RPC: Record<ChainId, string[]> = {
  1: ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
  42161: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org"],
  10: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com", "https://optimism.drpc.org"],
  137: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"],
  43114: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com", "https://avalanche.drpc.org"],
};

const ENV_RPC: Record<ChainId, string | undefined> = {
  1: process.env.RPC_URL_MAINNET,
  8453: process.env.RPC_URL_BASE,
  42161: process.env.RPC_URL_ARBITRUM,
  10: process.env.RPC_URL_OPTIMISM,
  137: process.env.RPC_URL_POLYGON,
  43114: process.env.RPC_URL_AVALANCHE,
};

export const CHAINS = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism, 137: polygon, 43114: avalanche } as const;
export const CHAIN_IDS: ChainId[] = [1, 8453, 42161, 10, 137, 43114];
export const CHAIN_NAMES: Record<ChainId, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  43114: "Avalanche",
};

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
  return CHAIN_IDS.includes(n as ChainId);
}
