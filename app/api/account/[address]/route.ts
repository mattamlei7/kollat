import { accountSnapshot, parseChains, toJson } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
// Vercel Hobby defaults to 10s per function; the fan-out over 26 adapters on cold public RPCs needs more.
export const maxDuration = 60;

/** Hard deadline for the whole fan-out; a slow public RPC must not hold the request open. Rate limiting lives at the edge. */
const DEADLINE_MS = 30_000;

export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), DEADLINE_MS));
  const snapshot = await Promise.race([accountSnapshot(decodeURIComponent(address), parseChains(searchParams.get("chain"))), timeout]);
  if (snapshot === "timeout") {
    return Response.json({ error: "Upstream RPCs did not answer in time; retry shortly" }, { status: 504 });
  }
  if (!snapshot) {
    return Response.json({ error: "Not a valid address or ENS name" }, { status: 400 });
  }
  return new Response(toJson(snapshot), {
    headers: { "content-type": "application/json", "cache-control": "private, max-age=15" },
  });
}
