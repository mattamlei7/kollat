import { neon } from "@neondatabase/serverless";
import type { Decision, Policy, Proposal } from "./policy";
import type { AccountSnapshot, MarketsSnapshot } from "./snapshot";
import { toJson } from "./snapshot";

/**
 * The reconciliation record: every decision, and the account snapshot it rested on.
 * Neon / Vercel Postgres over HTTP (no pool to leak on serverless). Without
 * DATABASE_URL nothing is written and callers get `persisted: false`.
 */
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
export const persistence = sql !== null;

// Serialize additive migrations across cold starts. Never infer evidence for legacy rows.
let ready: Promise<void> | null = null;
function schema(): Promise<void> {
  if (!sql) return Promise.resolve();
  return (ready ??= sql.transaction([
    sql`SELECT pg_advisory_xact_lock(824301)`,
    sql`CREATE TABLE IF NOT EXISTS snapshots (
      id bigserial PRIMARY KEY,
      address text NOT NULL,
      chain_id int NOT NULL,
      protocol_id text NOT NULL,
      read text NOT NULL,
      ok boolean NOT NULL,
      stale boolean NOT NULL,
      block bigint,
      fetched_at timestamptz,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX IF NOT EXISTS snapshots_address_idx ON snapshots (address, created_at DESC)`,
    sql`CREATE TABLE IF NOT EXISTS decisions (
      id uuid PRIMARY KEY,
      policy_version text NOT NULL,
      address text NOT NULL,
      chain_id int NOT NULL,
      protocol_id text NOT NULL,
      market_id text NOT NULL,
      borrow_usd numeric NOT NULL,
      allow boolean NOT NULL,
      reasons text[] NOT NULL,
      market_block bigint,
      account_block bigint,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX IF NOT EXISTS decisions_address_idx ON decisions (address, created_at DESC)`,
    // Additive migration: existing records remain readable, but cannot be retroactively linked.
    sql`ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES decisions(id)`,
    sql`CREATE INDEX IF NOT EXISTS snapshots_decision_idx ON snapshots (decision_id)`,
  ]).then(() => undefined).catch((error) => { ready = null; throw error; }));
}

const json = (v: unknown) => JSON.parse(toJson(v)); // bigint → string before jsonb

/** Commit the full evaluation evidence and its linked read rows together, or write nothing. */
export async function saveDecisionRecord(decision: Decision, proposal: Proposal, policy: Policy, markets: MarketsSnapshot, account: AccountSnapshot): Promise<boolean> {
  if (!sql) return false;
  await schema();
  const address = account.address.toLowerCase();
  const reads = [
    ...account.protocols.flatMap((p) => (["capacity", "positions"] as const).map((read) => ({ chainId: p.chainId, protocol: p.id, read, result: p[read] }))),
    ...markets.protocols.flatMap((p) => (["markets", "rates"] as const).map((read) => ({ chainId: p.chainId, protocol: p.id, read, result: p[read] }))),
  ];
  // The versioned envelope preserves policy values, complete snapshots (including failures,
  // completeness and provenance), and evaluator identity. A version label alone is not evidence.
  const payload = json({ recordVersion: 2, evaluatorVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "local", decision, proposal, policy, markets, account });
  await sql.transaction([
    sql`INSERT INTO decisions (id, policy_version, address, chain_id, protocol_id, market_id, borrow_usd, allow, reasons, market_block, account_block, payload)
      VALUES (${decision.decisionId}, ${decision.policyVersion}, ${address}, ${proposal.chainId}, ${proposal.protocolId}, ${proposal.marketId},
              ${proposal.borrowUsd}, ${decision.allow}, ${decision.reasons}, ${decision.inputs.marketBlock}, ${decision.inputs.accountBlock}, ${payload})`,
    ...reads.map(({ chainId, protocol, read, result: r }) => sql!`INSERT INTO snapshots (decision_id, address, chain_id, protocol_id, read, ok, stale, block, fetched_at, payload)
      VALUES (${decision.decisionId}, ${address}, ${chainId}, ${protocol}, ${read}, ${r.ok}, ${r.ok && r.stale},
              ${r.ok ? r.block : null}, ${r.ok ? new Date(r.fetchedAt) : null}, ${json(r)})`),
  ]);
  return true;
}

export interface DecisionRow {
  id: string;
  policy_version: string;
  address: string;
  chain_id: number;
  protocol_id: string;
  market_id: string;
  borrow_usd: string;
  allow: boolean;
  reasons: string[];
  market_block: string | null;
  account_block: string | null;
  /** Legacy records lack recordVersion and the full input evidence. */
  payload: { decision: Decision; proposal: Proposal; recordVersion?: number; policy?: Policy; markets?: unknown; account?: unknown; evaluatorVersion?: string };
  created_at: string;
}

/** The audit timeline for one address, newest first. */
export async function listDecisions(address: string, limit = 50): Promise<DecisionRow[]> {
  if (!sql) return [];
  await schema();
  return (await sql`SELECT * FROM decisions WHERE address = ${address.toLowerCase()} ORDER BY created_at DESC LIMIT ${limit}`) as DecisionRow[];
}
