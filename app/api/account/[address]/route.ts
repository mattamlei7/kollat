import { accountSnapshot, parseChains, toJson } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const snapshot = await accountSnapshot(decodeURIComponent(address), parseChains(searchParams.get("chain")));
  if (!snapshot) {
    return Response.json({ error: "Not a valid address or ENS name" }, { status: 400 });
  }
  return new Response(toJson(snapshot), {
    headers: { "content-type": "application/json", "cache-control": "private, max-age=15" },
  });
}
