import { authorized } from "@/lib/admin";
import { deliver, observe } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One monitor tick: observe tracked accounts, emit events, deliver what is due. Call every few minutes. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const now = Date.now();
  const observed = await observe(now);
  const delivered = await deliver(now);
  const body = { ...observed, ...delivered, ms: Date.now() - now };
  console.log(JSON.stringify({ kind: "monitor_tick", ...body }));
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
