import { createHmac, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { riskBand, uniformDrawdown, type RiskBand } from "./math/health";
import { PROTOCOLS } from "./protocols/registry";
import type { ChainId, Position, ProtocolId } from "./protocols/types";
import { toJson } from "./snapshot";

/**
 * Position monitor with a durable outbox. One tick:
 *   1. read positions for every tracked account (the same reads the API serves)
 *   2. write an event when a position's risk band changes, or data stops being readable
 *   3. deliver due events: HMAC-signed POST, exponential backoff, delivery history kept
 * The tick is idempotent and cheap to call often; the scheduler is whatever calls
 * GET /api/cron/monitor (Vercel Cron, or any pinger with the secret).
 */
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

let ready: Promise<void> | null = null;
function schema(): Promise<void> {
  if (!sql) return Promise.resolve();
  return (ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS tracked (
      id uuid PRIMARY KEY,
      partner text NOT NULL,
      address text NOT NULL,
      chain_id int NOT NULL,
      protocol_id text NOT NULL,
      webhook_url text NOT NULL,
      secret text NOT NULL,
      last_band text,
      last_hf double precision,
      last_ok boolean,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (partner, address, chain_id, protocol_id)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS events (
      id uuid PRIMARY KEY,
      tracked_id uuid NOT NULL REFERENCES tracked(id),
      kind text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS deliveries (
      id bigserial PRIMARY KEY,
      event_id uuid NOT NULL REFERENCES events(id),
      attempt int NOT NULL DEFAULT 0,
      next_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz,
      last_status int,
      last_error text
    )`;
    await sql`CREATE INDEX IF NOT EXISTS deliveries_due_idx ON deliveries (next_at) WHERE delivered_at IS NULL`;
  })());
}

export interface Tracked {
  id: string; partner: string; address: string; chain_id: ChainId; protocol_id: ProtocolId; webhook_url: string; secret: string;
  last_band: RiskBand | null; last_hf: number | null; last_ok: boolean | null;
}

export async function track(t: { partner: string; address: string; chainId: ChainId; protocolId: ProtocolId; webhookUrl: string; secret: string }): Promise<string> {
  if (!sql) throw new Error("DATABASE_URL is not set");
  await schema();
  const id = randomUUID();
  const rows = await sql`INSERT INTO tracked (id, partner, address, chain_id, protocol_id, webhook_url, secret)
    VALUES (${id}, ${t.partner}, ${t.address.toLowerCase()}, ${t.chainId}, ${t.protocolId}, ${t.webhookUrl}, ${t.secret})
    ON CONFLICT (partner, address, chain_id, protocol_id) DO UPDATE SET webhook_url = EXCLUDED.webhook_url, secret = EXCLUDED.secret
    RETURNING id`;
  return rows[0].id as string;
}

/** The worst position on the account for this protocol — one band per tracked tuple keeps the event stream readable. */
export function worst(positions: Position[]): { hf: number; band: RiskBand; position: Position } | null {
  const withDebt = positions.filter((p) => p.healthFactor !== null);
  if (withDebt.length === 0) return null;
  const p = withDebt.reduce((a, b) => ((b.healthFactorReported ?? b.healthFactor!) < (a.healthFactorReported ?? a.healthFactor!) ? b : a));
  const hf = p.healthFactorReported ?? p.healthFactor!;
  return { hf, band: riskBand(hf), position: p };
}

export type EventKind = "band_changed" | "data_unavailable" | "data_restored";

async function emit(t: Tracked, kind: EventKind, payload: object) {
  const id = randomUUID();
  await sql!`INSERT INTO events (id, tracked_id, kind, payload) VALUES (${id}, ${t.id}, ${kind}, ${JSON.parse(toJson(payload))})`;
  await sql!`INSERT INTO deliveries (event_id) VALUES (${id})`;
  return id;
}

/** Step 1 + 2. Returns the number of events written. */
export async function observe(now = Date.now()): Promise<{ tracked: number; events: number }> {
  if (!sql) return { tracked: 0, events: 0 };
  await schema();
  const rows = (await sql`SELECT * FROM tracked`) as Tracked[];
  let events = 0;
  await Promise.all(rows.map(async (t) => {
    const adapter = PROTOCOLS.find((p) => p.id === t.protocol_id && p.chainId === Number(t.chain_id));
    if (!adapter) return;
    const res = await adapter.getPositions(t.address as `0x${string}`);
    if (!res.ok) {
      if (t.last_ok !== false) {
        await emit(t, "data_unavailable", { address: t.address, chainId: t.chain_id, protocolId: t.protocol_id, error: res.error, at: now });
        await sql`UPDATE tracked SET last_ok = false WHERE id = ${t.id}`;
        events++;
      }
      return;
    }
    const w = worst(res.data);
    const band: RiskBand = w?.band ?? "none";
    const hf = w?.hf ?? null;
    if (t.last_ok === false) { await emit(t, "data_restored", { address: t.address, chainId: t.chain_id, protocolId: t.protocol_id, at: now, block: res.block }); events++; }
    if (t.last_band !== null && t.last_band !== band) {
      await emit(t, "band_changed", {
        address: t.address, chainId: t.chain_id, protocolId: t.protocol_id, at: now, block: res.block, stale: res.stale,
        previous: { band: t.last_band, healthFactor: t.last_hf },
        current: { band, healthFactor: hf, drawdownToLiquidation: hf === null ? null : uniformDrawdown(hf) },
        position: w?.position ?? null,
      });
      events++;
    }
    await sql`UPDATE tracked SET last_band = ${band}, last_hf = ${hf}, last_ok = true WHERE id = ${t.id}`;
  }));
  return { tracked: rows.length, events };
}

export const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

/** Step 3. At-least-once: a delivery is done only on a 2xx; otherwise retried with backoff up to MAX_ATTEMPTS. */
const MAX_ATTEMPTS = 8;
export async function deliver(now = Date.now()): Promise<{ due: number; delivered: number }> {
  if (!sql) return { due: 0, delivered: 0 };
  await schema();
  const due = (await sql`
    SELECT d.id, d.attempt, e.id AS event_id, e.kind, e.payload, e.created_at, t.webhook_url, t.secret, t.partner
    FROM deliveries d JOIN events e ON e.id = d.event_id JOIN tracked t ON t.id = e.tracked_id
    WHERE d.delivered_at IS NULL AND d.next_at <= to_timestamp(${now / 1000}) AND d.attempt < ${MAX_ATTEMPTS}
    ORDER BY d.next_at LIMIT 50`) as { id: number; attempt: number; event_id: string; kind: EventKind; payload: object; created_at: string; webhook_url: string; secret: string; partner: string }[];
  let delivered = 0;
  await Promise.all(due.map(async (d) => {
    const body = JSON.stringify({ id: d.event_id, kind: d.kind, partner: d.partner, createdAt: d.created_at, attempt: d.attempt + 1, data: d.payload });
    const signature = sign(d.secret, body);
    let status = 0; let error: string | null = null;
    try {
      const res = await fetch(d.webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-event-id": d.event_id, "x-signature": `sha256=${signature}`, "x-attempt": String(d.attempt + 1) },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch (e) { error = (e as Error).message; }
    const okay = status >= 200 && status < 300;
    // ponytail: backoff 1,2,4,…128 min; a dead-letter view once someone needs to see MAX_ATTEMPTS failures.
    const next = new Date(now + 60_000 * 2 ** d.attempt);
    await sql`UPDATE deliveries SET attempt = ${d.attempt + 1}, last_status = ${status || null}, last_error = ${error}, next_at = ${next},
      delivered_at = ${okay ? new Date(now) : null} WHERE id = ${d.id}`;
    if (okay) delivered++;
  }));
  return { due: due.length, delivered };
}

/** Delivery history for one partner — what they see in their dashboard. */
export async function history(partner: string, limit = 100) {
  if (!sql) return [];
  await schema();
  return sql`
    SELECT e.id, e.kind, e.created_at, d.attempt, d.delivered_at, d.last_status, d.last_error, d.next_at, t.address, t.chain_id, t.protocol_id
    FROM events e JOIN deliveries d ON d.event_id = e.id JOIN tracked t ON t.id = e.tracked_id
    WHERE t.partner = ${partner} ORDER BY e.created_at DESC LIMIT ${limit}`;
}
