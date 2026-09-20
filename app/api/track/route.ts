import { authorized } from "@/lib/admin";
import { track } from "@/lib/monitor";
import { PROTOCOLS } from "@/lib/protocols/registry";
import type { ChainId, ProtocolId } from "@/lib/protocols/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Body = z.object({
  partner: z.string().min(1),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int(),
  protocolId: z.string(),
  webhookUrl: z.string().url().startsWith("https://"),
  secret: z.string().min(16),
});

/** Register a (partner, account, protocol, chain) to watch. Operator-gated until partner auth exists. */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  if (!PROTOCOLS.some((p) => p.id === b.protocolId && p.chainId === b.chainId)) return Response.json({ error: `no adapter for ${b.protocolId} on chain ${b.chainId}` }, { status: 400 });
  try {
    const id = await track({ ...b, chainId: b.chainId as ChainId, protocolId: b.protocolId as ProtocolId });
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
