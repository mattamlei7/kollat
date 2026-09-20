import { CHAIN_IDS, getClient } from "@/lib/chains";
import { PROTOCOLS } from "@/lib/protocols/registry";

export const dynamic = "force-dynamic";

const RPC_ENV = { 1: "RPC_URL_MAINNET", 8453: "RPC_URL_BASE", 42161: "RPC_URL_ARBITRUM", 10: "RPC_URL_OPTIMISM", 137: "RPC_URL_POLYGON", 43114: "RPC_URL_AVALANCHE" } as const;

/** Liveness for the uptime monitor: 200 when every chain answers, 503 otherwise. Never exposes RPC URLs. */
export async function GET() {
  const chains = await Promise.all(
    CHAIN_IDS.map(async (chainId) => {
      const t0 = Date.now();
      try {
        const block = await Promise.race([
          getClient(chainId).getBlockNumber(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8_000)),
        ]);
        return { chainId, ok: true, block: Number(block), ms: Date.now() - t0, rpc: process.env[RPC_ENV[chainId]] ? "private" : "public" };
      } catch (e) {
        return { chainId, ok: false, error: (e as Error).message, ms: Date.now() - t0, rpc: process.env[RPC_ENV[chainId]] ? "private" : "public" };
      }
    }),
  );
  const ok = chains.every((c) => c.ok);
  const body = {
    ok,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    adapters: PROTOCOLS.length,
    chains,
    at: new Date().toISOString(),
  };
  return Response.json(body, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
