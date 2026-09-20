import { createHmac, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { riskBand, uniformDrawdown, type RiskBand } from "./math/health";
import { PROTOCOLS } from "./protocols/registry";
import { fail, type ChainId, type Position, type ProtocolId, type Result } from "./protocols/types";
import { toJson } from "./snapshot";

/**
 * Position monitor with a durable outbox. One tick:
 *   1. read positions for every tracked account (the same reads the API serves)
 *   2. write an event when a position's risk band changes, or data stops being readable
 *   3. deliver due events: HMAC-signed POST, exponential backoff, delivery history kept
 * Observation updates are compare-and-swap; deliveries use expiring database leases.
 * The scheduler is whatever calls
 * GET /api/cron/monitor (Vercel Cron, or any pinger with the secret).
 */
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

let ready: Promise<void> | null = null;
function schema(): Promise<void> {
  if (!sql) throw new Error("DATABASE_URL is not set");
  return (ready ??= sql.transaction([
    sql`SELECT pg_advisory_xact_lock(824302)`,
    sql`CREATE TABLE IF NOT EXISTS tracked (
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
    )`,
    sql`CREATE TABLE IF NOT EXISTS events (
      id uuid PRIMARY KEY,
      tracked_id uuid NOT NULL REFERENCES tracked(id),
      kind text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE IF NOT EXISTS deliveries (
      id bigserial PRIMARY KEY,
      event_id uuid NOT NULL REFERENCES events(id),
      attempt int NOT NULL DEFAULT 0,
      next_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz,
      last_status int,
      last_error text
    )`,
    sql`CREATE INDEX IF NOT EXISTS deliveries_due_idx ON deliveries (next_at) WHERE delivered_at IS NULL`,
    sql`ALTER TABLE tracked ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0`,
    sql`ALTER TABLE tracked ADD COLUMN IF NOT EXISTS last_observed_at bigint NOT NULL DEFAULT 0`,
    sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS lease_token uuid`,
    sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS lease_until timestamptz`,
    sql`CREATE TABLE IF NOT EXISTS delivery_attempts (
      delivery_id bigint NOT NULL REFERENCES deliveries(id),
      attempt int NOT NULL,
      started_at timestamptz NOT NULL,
      completed_at timestamptz,
      status int,
      error text,
      PRIMARY KEY (delivery_id, attempt)
    )`,
  ]).then(() => undefined).catch((error) => { ready = null; throw error; }));
}

export interface Tracked {
  id: string; partner: string; address: string; chain_id: ChainId; protocol_id: ProtocolId; webhook_url: string; secret: string;
  last_band: RiskBand | null; last_hf: number | null; last_ok: boolean | null;
  revision: string | number; last_observed_at: string | number;
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
  const withDebt = positions.filter((p) => (p.healthFactorReported ?? p.healthFactor) !== null);
  if (withDebt.length === 0) return null;
  const p = withDebt.reduce((a, b) => ((b.healthFactorReported ?? b.healthFactor!) < (a.healthFactorReported ?? a.healthFactor!) ? b : a));
  const hf = p.healthFactorReported ?? p.healthFactor!;
  return { hf, band: riskBand(hf), position: p };
}

export type EventKind = "band_changed" | "data_unavailable" | "data_restored";

// Markets may be cached for 10 minutes. Reject stale fallbacks immediately and
// reject otherwise successful observations whose oldest dependency exceeds 15 minutes.
export const MAX_OBSERVATION_AGE_MS = 15 * 60_000;

export function transition(t: Tracked, res: Result<Position[]>, now: number) {
  const events: { id: string; kind: EventKind; payload: object }[] = [];
  const common = { address: t.address, chainId: t.chain_id, protocolId: t.protocol_id, at: now };
  const emit = (kind: EventKind, payload: object) => events.push({ id: randomUUID(), kind, payload: { ...common, ...payload } });
  const invalid = res.ok && res.data.some((p) => {
    const hf = p.healthFactorReported ?? p.healthFactor;
    return hf !== null && (!Number.isFinite(hf) || hf < 0);
  });
  const unavailable = !res.ok || res.stale || !Number.isFinite(res.fetchedAt) || res.fetchedAt > now || now - res.fetchedAt > MAX_OBSERVATION_AGE_MS || invalid;
  if (unavailable) {
    if (t.last_ok !== false) emit("data_unavailable", {
      error: !res.ok ? res.error : { code: invalid ? "INVALID_DATA" : "DATA_STALE", message: "Observation is stale, too old, future-dated, or invalid", retryable: true },
      ...(res.ok ? { stale: res.stale, fetchedAt: res.fetchedAt, block: res.block, provenance: res.provenance } : {}),
    });
    return { events, ok: false, band: t.last_band, hf: t.last_hf };
  }
  // The first successful observation establishes a baseline, not a fabricated change.
  const w = worst(res.data);
  const band: RiskBand = w?.band ?? "none";
  const hf = w?.hf ?? null;
  const source = { block: res.block, fetchedAt: res.fetchedAt, provenance: res.provenance };
  if (t.last_ok === false) emit("data_restored", source);
  if (t.last_band !== null && t.last_band !== band) emit("band_changed", {
    ...source, stale: false,
    previous: { band: t.last_band, healthFactor: t.last_hf },
    current: { band, healthFactor: hf, drawdownToLiquidation: hf === null ? null : uniformDrawdown(hf) },
    position: w?.position ?? null,
  });
  return { events, ok: true, band, hf };
}

/** Step 1 + 2. Returns the number of events written. */
export async function observe(now = Date.now()): Promise<{ tracked: number; events: number }> {
  await schema();
  const rows = (await sql!`SELECT * FROM tracked`) as Tracked[];
  let events = 0;
  await Promise.all(rows.map(async (t) => {
    const adapter = PROTOCOLS.find((p) => p.id === t.protocol_id && p.chainId === Number(t.chain_id));
    const res = adapter ? await adapter.getPositions(t.address as `0x${string}`) : fail<Position[]>("UNSUPPORTED_CHAIN", "Tracked adapter is unavailable");
    const next = transition(t, res, Math.max(now, Date.now()));
    // One SQL statement is one transaction: state, events and outbox either all
    // advance, or none do. A competing/older tick cannot advance this revision.
    const queued = await sql!`
      WITH advanced AS (
        UPDATE tracked SET last_band = ${next.band}, last_hf = ${next.hf}, last_ok = ${next.ok},
          revision = revision + 1, last_observed_at = ${now}
        WHERE id = ${t.id} AND revision = ${t.revision} AND last_observed_at <= ${now}
        RETURNING id
      ), emitted AS (
        INSERT INTO events (id, tracked_id, kind, payload)
        SELECT e.id, a.id, e.kind, e.payload FROM advanced a
        CROSS JOIN jsonb_to_recordset(${toJson(next.events)}::jsonb) AS e(id uuid, kind text, payload jsonb)
        RETURNING id
      )
      INSERT INTO deliveries (event_id) SELECT id FROM emitted RETURNING event_id`;
    events += queued.length;
  }));
  return { tracked: rows.length, events };
}

export const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

/** Step 3. At-least-once: a delivery is done only on a 2xx; otherwise retried with backoff up to MAX_ATTEMPTS. */
const MAX_ATTEMPTS = 8;
const LEASE_MS = 120_000; // exceeds the route's 60s lifetime and the HTTP timeout
export async function deliver(now = Date.now()): Promise<{ due: number; delivered: number }> {
  await schema();
  const lease = randomUUID();
  const due = (await sql!`
    WITH candidates AS (
      SELECT id FROM deliveries
      WHERE delivered_at IS NULL AND next_at <= to_timestamp(${now / 1000}) AND attempt < ${MAX_ATTEMPTS}
        AND (lease_until IS NULL OR lease_until <= to_timestamp(${now / 1000}))
      ORDER BY next_at LIMIT 50 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE deliveries d SET attempt = d.attempt + 1, lease_token = ${lease}, lease_until = to_timestamp(${(now + LEASE_MS) / 1000})
      FROM candidates c WHERE d.id = c.id RETURNING d.*
    ), started AS (
      INSERT INTO delivery_attempts (delivery_id, attempt, started_at)
      SELECT id, attempt, to_timestamp(${now / 1000}) FROM claimed RETURNING delivery_id
    )
    SELECT d.id, d.attempt, e.id AS event_id, e.kind, e.payload, e.created_at, t.webhook_url, t.secret, t.partner
    FROM claimed d JOIN started s ON s.delivery_id = d.id
    JOIN events e ON e.id = d.event_id JOIN tracked t ON t.id = e.tracked_id
    `) as { id: number; attempt: number; event_id: string; kind: EventKind; payload: object; created_at: string; webhook_url: string; secret: string; partner: string }[];
  let delivered = 0;
  await Promise.all(due.map(async (d) => {
    const body = JSON.stringify({ id: d.event_id, kind: d.kind, partner: d.partner, createdAt: d.created_at, attempt: d.attempt, data: d.payload });
    const signature = sign(d.secret, body);
    let status = 0; let error: string | null = null;
    try {
      const res = await fetch(d.webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-event-id": d.event_id, "x-signature": `sha256=${signature}`, "x-attempt": String(d.attempt) },
        body,
        redirect: "error", // never forward signed payloads through redirects
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch (e) { error = (e as Error).message; }
    const okay = status >= 200 && status < 300;
    const completedAt = Math.max(now, Date.now());
    const next = new Date(completedAt + 60_000 * 2 ** (d.attempt - 1));
    const finished = await sql!`
      WITH completed AS (
        UPDATE delivery_attempts SET completed_at = to_timestamp(${completedAt / 1000}), status = ${status || null}, error = ${error}
        WHERE delivery_id = ${d.id} AND attempt = ${d.attempt} RETURNING delivery_id
      )
      UPDATE deliveries SET last_status = ${status || null}, last_error = ${error}, next_at = ${next},
        delivered_at = ${okay ? new Date(completedAt) : null}, lease_token = NULL, lease_until = NULL
      WHERE id IN (SELECT delivery_id FROM completed) AND lease_token = ${lease} RETURNING id`;
    if (okay && finished.length) delivered++;
  }));
  return { due: due.length, delivered };
}

/** Delivery history for one partner — what they see in their dashboard. */
export async function history(partner: string, limit = 100) {
  await schema();
  return sql!`
    SELECT e.id, e.kind, e.created_at, d.attempt, d.delivered_at, d.last_status, d.last_error, d.next_at, t.address, t.chain_id, t.protocol_id,
      (d.delivered_at IS NULL AND d.attempt >= ${MAX_ATTEMPTS} AND (d.lease_until IS NULL OR d.lease_until <= now())) AS exhausted,
      COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attempt) FROM delivery_attempts a WHERE a.delivery_id = d.id), '[]'::jsonb) AS attempts
    FROM events e JOIN deliveries d ON d.event_id = e.id JOIN tracked t ON t.id = e.tracked_id
    WHERE t.partner = ${partner} ORDER BY e.created_at DESC LIMIT ${limit}`;
}
