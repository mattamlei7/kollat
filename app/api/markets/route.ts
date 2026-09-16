import { marketsSnapshot, parseChains, toJson } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const snapshot = await marketsSnapshot(parseChains(searchParams.get("chain")));
  return new Response(toJson(snapshot), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=30, stale-while-revalidate=300" },
  });
}
