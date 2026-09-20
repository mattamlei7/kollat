import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { postgresTransport } from "./support/postgres";
import { ok, type Position, type Result } from "../lib/protocols/types";
import type { AccountSnapshot, MarketsSnapshot } from "../lib/snapshot";
import type { Decision, Policy, Proposal } from "../lib/policy";

const mocks = vi.hoisted(() => ({ sql: null as unknown, positions: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => mocks.sql }));
vi.mock("../lib/protocols/registry", () => ({ PROTOCOLS: [{ id: "aave-v3", chainId: 1, getPositions: mocks.positions }] }));

const NOW = 1_800_000_000_000;
const ADDRESS = "0x000000000000000000000000000000000000dead";
const secret = "test-only-signing-secret";
const tracked = { partner: "test-wallet", address: ADDRESS, chainId: 1 as const, protocolId: "aave-v3" as const, webhookUrl: "https://receiver.example/hook", secret };
const position = (hf: number): Position => ({ protocol: "aave-v3", chainId: 1, marketId: null, collateral: [], debt: [], healthFactor: hf, healthFactorReported: hf, liquidationPrices: [], uniformDrawdownToLiquidation: null, notes: [], fetchedAt: NOW });
const fresh = (hf = 2): Result<Position[]> => ok([position(hf)], NOW, false, 26_000_000);
const completeness = { attempted: 2, ok: 2, stale: 0, failed: 0, blocks: { 1: { min: 26_000_000, max: 26_000_000 } }, errors: [] };
const account: AccountSnapshot = { address: ADDRESS, input: ADDRESS, ens: null, chains: [1], generatedAt: NOW, holdings: [], completeness, protocols: [{ id: "aave-v3", name: "Aave", chainId: 1, capacity: ok([], NOW), positions: fresh() }] };
const markets: MarketsSnapshot = { chains: [1], generatedAt: NOW, completeness, protocols: [{ id: "aave-v3", name: "Aave", chainId: 1, markets: ok([], NOW), rates: ok([], NOW) }] };
const policy: Policy = { version: "v1", chains: [1], protocols: ["aave-v3"], debtAssets: [ADDRESS], collateralAssets: [ADDRESS], maxLtv: 0.4, minHealthFactor: 1.5, maxNotionalUsd: 1000, maxDataAgeMs: 60_000 };
const proposal: Proposal = { address: ADDRESS, chainId: 1, protocolId: "aave-v3", marketId: "test-market", borrowUsd: 100 };
const decision = (): Decision => ({ decisionId: randomUUID(), policyVersion: "v1", allow: false, reasons: ["MARKET_NOT_FOUND"], explanation: ["test fixture"], evaluatedAt: NOW, inputs: { marketAgeMs: 0, accountAgeMs: 0, stale: false, marketBlock: 26_000_000, accountBlock: 26_000_000 }, pre: null, post: null, safeMaxUsd: null });

let pg: PGlite;
let monitor: typeof import("../lib/monitor");
let audit: typeof import("../lib/db");

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  mocks.sql = postgresTransport(pg);
  vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
  monitor = await import("../lib/monitor");
  audit = await import("../lib/db");
  await monitor.track(tracked); // run real additive migrations
  await audit.listDecisions(ADDRESS);
}, 30_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  mocks.positions.mockReset().mockResolvedValue(fresh());
  await pg.exec("TRUNCATE snapshots, decisions, delivery_attempts, deliveries, events, tracked RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await pg?.close();
});

async function queueChange() {
  await monitor.track(tracked);
  expect((await monitor.observe(NOW)).events).toBe(0);
  mocks.positions.mockResolvedValue(fresh(1.15));
  expect((await monitor.observe(NOW + 1)).events).toBe(1);
}

describe("Postgres audit transactions", () => {
  it("stores the policy, both complete snapshots and linked read rows", async () => {
    const d = decision();
    expect(await audit.saveDecisionRecord(d, proposal, policy, markets, account)).toBe(true);
    const [saved] = await audit.listDecisions(ADDRESS);
    expect(saved.payload).toMatchObject({ recordVersion: 2, policy, account: { completeness }, markets: { completeness } });
    const rows = (await pg.query<{ decision_id: string; read: string }>("SELECT decision_id, read, payload FROM snapshots ORDER BY read")).rows;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.decision_id === d.decisionId)).toBe(true);
    expect(rows.map((r) => r.read)).toEqual(["capacity", "markets", "positions", "rates"]);
  });

  it("rolls back the decision and all read rows when any insert fails", async () => {
    await pg.exec("ALTER TABLE snapshots ADD CONSTRAINT reject_rates CHECK (read <> 'rates')");
    try {
      await expect(audit.saveDecisionRecord(decision(), proposal, policy, markets, account)).rejects.toThrow();
      expect(await audit.listDecisions(ADDRESS)).toHaveLength(0);
      expect((await pg.query("SELECT * FROM snapshots")).rows).toHaveLength(0);
    } finally { await pg.exec("ALTER TABLE snapshots DROP CONSTRAINT reject_rates"); }
  });
});

describe("monitor and outbox lifecycle", () => {
  it("keeps a first-read baseline; stale data emits unavailable only once; fresh data restores", async () => {
    await monitor.track(tracked);
    expect((await monitor.observe(NOW)).events).toBe(0);
    mocks.positions.mockResolvedValue(ok([position(1.15)], NOW, true, 26_000_000));
    expect((await monitor.observe(NOW + 1)).events).toBe(1);
    expect((await monitor.observe(NOW + 2)).events).toBe(0);
    mocks.positions.mockResolvedValue(fresh(1.15));
    expect((await monitor.observe(NOW + 3)).events).toBe(2);
    const events = (await pg.query<{ kind: string }>("SELECT kind FROM events")).rows.map((r) => r.kind);
    expect(events.sort()).toEqual(["band_changed", "data_restored", "data_unavailable"]);
    expect((await pg.query("SELECT * FROM deliveries")).rows).toHaveLength(3);
  });

  it("commits only one transition when observations overlap", async () => {
    await monitor.track(tracked);
    await monitor.observe(NOW);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = 0;
    mocks.positions.mockImplementation(async () => { if (++entered === 2) release(); await gate; return fresh(1.15); });
    const results = await Promise.all([monitor.observe(NOW + 1), monitor.observe(NOW + 1)]);
    expect(results.reduce((n, r) => n + r.events, 0)).toBe(1);
    expect((await pg.query("SELECT * FROM events")).rows).toHaveLength(1);
  });

  it("rolls back events and tracking state if enqueueing fails, then retries cleanly", async () => {
    await monitor.track(tracked);
    await monitor.observe(NOW);
    mocks.positions.mockResolvedValue(fresh(1.15));
    await pg.exec("ALTER TABLE deliveries ADD CONSTRAINT reject_delivery CHECK (false)");
    try {
      await expect(monitor.observe(NOW + 1)).rejects.toThrow();
      expect((await pg.query("SELECT * FROM events")).rows).toHaveLength(0);
      expect((await pg.query<{ last_band: string }>("SELECT last_band FROM tracked")).rows[0].last_band).toBe("comfortable");
    } finally { await pg.exec("ALTER TABLE deliveries DROP CONSTRAINT reject_delivery"); }
    expect((await monitor.observe(NOW + 2)).events).toBe(1);
  });

  it("signs actual request bytes, retries a failure and retains each attempt", async () => {
    await queueChange();
    const receiver = vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body);
      expect(new Headers(init.headers).get("x-signature")).toBe(`sha256=${monitor.sign(secret, body)}`);
      expect(init.redirect).toBe("error");
      return new Response(null, { status: receiver.mock.calls.length === 1 ? 503 : 204 });
    });
    vi.stubGlobal("fetch", receiver);
    expect(await monitor.deliver(NOW)).toEqual({ due: 1, delivered: 0 });
    expect(await monitor.deliver(NOW + 59_999)).toEqual({ due: 0, delivered: 0 });
    expect(await monitor.deliver(NOW + 60_000)).toEqual({ due: 1, delivered: 1 });
    const [history] = await monitor.history(tracked.partner);
    expect(history.attempts).toMatchObject([{ attempt: 1, status: 503 }, { attempt: 2, status: 204 }]);
    expect(JSON.parse(String(receiver.mock.calls[0][1].body)).id).toBe(JSON.parse(String(receiver.mock.calls[1][1].body)).id);
  });

  it("claims a delivery once while another worker is still sending", async () => {
    await queueChange();
    let started!: () => void;
    let finish!: () => void;
    const sending = new Promise<void>((r) => { started = r; });
    const response = new Promise<void>((r) => { finish = r; });
    const receiver = vi.fn(async () => { started(); await response; return new Response(null, { status: 200 }); });
    vi.stubGlobal("fetch", receiver);
    const first = monitor.deliver(NOW);
    await sending;
    expect(await monitor.deliver(NOW)).toEqual({ due: 0, delivered: 0 });
    finish();
    expect(await first).toEqual({ due: 1, delivered: 1 });
    expect(receiver).toHaveBeenCalledTimes(1);
  });

  it("recovers an expired lease and does not let the old worker overwrite the new result", async () => {
    await queueChange();
    let started!: () => void;
    let finish!: () => void;
    const sending = new Promise<void>((r) => { started = r; });
    const response = new Promise<void>((r) => { finish = r; });
    const receiver = vi.fn().mockImplementationOnce(async () => { started(); await response; return new Response(null, { status: 503 }); })
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", receiver);
    const abandoned = monitor.deliver(NOW);
    await sending;
    expect(await monitor.deliver(NOW + 120_001)).toEqual({ due: 1, delivered: 1 });
    finish();
    await abandoned;
    const [history] = await monitor.history(tracked.partner);
    expect(history.last_status).toBe(200);
    expect(history.delivered_at).not.toBeNull();
    expect(history.attempts).toHaveLength(2);
  });

  it("stops after eight attempts and exposes exhausted status", async () => {
    await queueChange();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    for (let n = 0; n < 8; n++) expect((await monitor.deliver(NOW + n * 10_000_000)).due).toBe(1);
    expect((await monitor.deliver(NOW + 100_000_000)).due).toBe(0);
    const [history] = await monitor.history(tracked.partner);
    expect(history.exhausted).toBe(true);
    expect(history.attempts).toHaveLength(8);
  });
});
