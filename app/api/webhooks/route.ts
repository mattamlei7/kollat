import { authorized } from "@/lib/admin";
import { history } from "@/lib/monitor";

export const dynamic = "force-dynamic";

/** GET /api/webhooks?partner=… — events and their delivery attempts, newest first. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const partner = new URL(request.url).searchParams.get("partner");
  if (!partner) return Response.json({ error: "partner is required" }, { status: 400 });
  return Response.json({ partner, deliveries: await history(partner) }, { headers: { "cache-control": "no-store" } });
}
