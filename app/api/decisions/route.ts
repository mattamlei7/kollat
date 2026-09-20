import { listDecisions, persistence } from "@/lib/db";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

/** GET /api/decisions?address=0x… — the audit timeline for one address, newest first. */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ error: "address must be a 0x address" }, { status: 400 });
  if (!persistence) return Response.json({ error: "Persistence is not configured (DATABASE_URL)" }, { status: 503 });
  return Response.json({ address: address.toLowerCase(), decisions: await listDecisions(address) }, { headers: { "cache-control": "no-store" } });
}
