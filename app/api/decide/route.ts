import { persistence, saveDecision, saveSnapshot } from "@/lib/db";
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
  // The record: the decision and the snapshot it rested on. Logged as well so nothing is lost without a database.
  console.log(JSON.stringify({ kind: "decision", ...decision, proposal }));
  const persisted = persistence && (await Promise.all([saveDecision(decision, proposal), saveSnapshot(account)]).then(() => true, (e) => { console.error("persist failed", e); return false; }));
  return new Response(toJson({ ...decision, persisted }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
