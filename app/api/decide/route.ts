import { persistence, saveDecisionRecord } from "@/lib/db";
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
  // Console output is diagnostic only; it is not a durable audit record.
  console.log(JSON.stringify({ kind: "decision", decisionId: decision.decisionId, allow: decision.allow, reasons: decision.reasons }));
  let persisted = false;
  try {
    persisted = await saveDecisionRecord(decision, proposal, policy, markets, account);
  } catch {
    console.error("decision persistence failed", { decisionId: decision.decisionId });
    // A configured audit store failing must never return a usable allow decision.
    return Response.json({ error: "AUDIT_UNAVAILABLE", decisionId: decision.decisionId, allow: false, persisted: false }, { status: 503 });
  }
  // Without a configured DB this remains an explicitly non-persisted, read-only demo.
  if (persistence && !persisted) return Response.json({ error: "AUDIT_UNAVAILABLE", allow: false, persisted: false }, { status: 503 });
  return new Response(toJson({ ...decision, persisted }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
