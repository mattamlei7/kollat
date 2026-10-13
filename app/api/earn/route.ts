import { readEarn } from "@/lib/earn/read";
import { EARN_CHAINS } from "@/lib/earn/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Every configured deposit destination with its current rate, capacity and liquidity. Wallet data is read in the browser. */
export async function GET() {
  const snapshot = await readEarn(EARN_CHAINS);
  return Response.json(snapshot, { headers: { "cache-control": "public, max-age=30" } });
}
