import { marketsSnapshot, parseChains, toJson } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
// Vercel Hobby defaults to 10s per function; the fan-out over 26 adapters on cold public RPCs needs more.
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const snapshot = await marketsSnapshot(parseChains(searchParams.get("chain")));
  return new Response(toJson(snapshot), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=30, stale-while-revalidate=300" },
  });
}
