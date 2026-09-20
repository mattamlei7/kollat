import { evaluate, PolicySchema, ProposalSchema } from "@/lib/policy";
import { accountSnapshot, marketsSnapshot, toJson } from "@/lib/snapshot";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ policy: PolicySchema, proposal: ProposalSchema });

/** POST { policy, proposal } → Decision. Reads only; the partner keeps the signer. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { policy, proposal } = parsed.data;
  const chains = [proposal.chainId as 1];
  const [markets, account] = await Promise.all([marketsSnapshot(chains), accountSnapshot(proposal.address, chains)]);
  if (!account) return Response.json({ error: "Unresolvable address" }, { status: 400 });
  const decision = evaluate(policy, proposal, markets, account);
  // ponytail: stdout is the decision log until snapshot persistence (plan3.0 §5 #5) lands.
  console.log(JSON.stringify({ kind: "decision", ...decision, proposal }));
  return new Response(toJson(decision), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
