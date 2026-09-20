import { neon } from "@neondatabase/serverless";
import type { Decision, Proposal } from "./policy";
import type { AccountSnapshot } from "./snapshot";
import { toJson } from "./snapshot";

/**
 * The reconciliation record: every decision, and the account snapshot it rested on.
 * Neon / Vercel Postgres over HTTP (no pool to leak on serverless). Without
 * DATABASE_URL nothing is written and callers get `persisted: false`.
 */
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
export const persistence = sql !== null;

// ponytail: CREATE IF NOT EXISTS on first use; a migrations tool when the schema changes twice.
let ready: Promise<void> | null = null;
function schema(): Promise<void> {
  if (!sql) return Promise.resolve();
  return (ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS snapshots (
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
    )`;
    await sql`CREATE INDEX IF NOT EXISTS snapshots_address_idx ON snapshots (address, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS decisions (
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
    )`;
    await sql`CREATE INDEX IF NOT EXISTS decisions_address_idx ON decisions (address, created_at DESC)`;
  })());
}

const json = (v: unknown) => JSON.parse(toJson(v)); // bigint → string before jsonb

/** One row per (protocol, chain, read) in the account snapshot. Returns rows written. */
export async function saveSnapshot(account: AccountSnapshot): Promise<number> {
  if (!sql) return 0;
  await schema();
  const address = account.address.toLowerCase();
  const rows = account.protocols.flatMap((p) =>
    (["capacity", "positions"] as const).map((read) => {
      const r = p[read];
      return r.ok
        ? { chain_id: p.chainId, protocol_id: p.id, read, ok: true, stale: r.stale, block: r.block, fetched_at: new Date(r.fetchedAt), payload: json(r.data) }
        : { chain_id: p.chainId, protocol_id: p.id, read, ok: false, stale: false, block: null, fetched_at: null, payload: json(r.error) };
    }),
  );
  await Promise.all(rows.map((r) => sql`INSERT INTO snapshots (address, chain_id, protocol_id, read, ok, stale, block, fetched_at, payload)
    VALUES (${address}, ${r.chain_id}, ${r.protocol_id}, ${r.read}, ${r.ok}, ${r.stale}, ${r.block}, ${r.fetched_at}, ${r.payload})`));
  return rows.length;
}

export async function saveDecision(decision: Decision, proposal: Proposal): Promise<boolean> {
  if (!sql) return false;
  await schema();
  await sql`INSERT INTO decisions (id, policy_version, address, chain_id, protocol_id, market_id, borrow_usd, allow, reasons, market_block, account_block, payload)
    VALUES (${decision.decisionId}, ${decision.policyVersion}, ${proposal.address}, ${proposal.chainId}, ${proposal.protocolId}, ${proposal.marketId},
            ${proposal.borrowUsd}, ${decision.allow}, ${decision.reasons}, ${decision.inputs.marketBlock}, ${decision.inputs.accountBlock}, ${json({ decision, proposal })})`;
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
  payload: { decision: Decision; proposal: Proposal };
  created_at: string;
}

/** The audit timeline for one address, newest first. */
export async function listDecisions(address: string, limit = 50): Promise<DecisionRow[]> {
  if (!sql) return [];
  await schema();
  return (await sql`SELECT * FROM decisions WHERE address = ${address.toLowerCase()} ORDER BY created_at DESC LIMIT ${limit}`) as DecisionRow[];
}
