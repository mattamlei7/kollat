import { listDecisions, persistence } from "@/lib/db";
import { authorized } from "@/lib/admin";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

/** GET /api/decisions?address=0x… — the audit timeline for one address, newest first. */
export async function GET(request: Request) {
  // Full policy/snapshot evidence is operator data, not a public address lookup.
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ error: "address must be a 0x address" }, { status: 400 });
  if (!persistence) return Response.json({ error: "Persistence is not configured (DATABASE_URL)" }, { status: 503 });
  try {
    return Response.json({ address: address.toLowerCase(), decisions: await listDecisions(address) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "AUDIT_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
