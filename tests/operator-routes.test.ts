import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ observe: vi.fn(), deliver: vi.fn(), save: vi.fn(), list: vi.fn(), evaluate: vi.fn() }));
vi.mock("../lib/monitor", () => ({ observe: mocks.observe, deliver: mocks.deliver }));
vi.mock("../lib/db", () => ({ persistence: true, saveDecisionRecord: mocks.save, listDecisions: mocks.list }));
vi.mock("../lib/snapshot", () => ({ marketsSnapshot: async () => ({}), accountSnapshot: async () => ({}), toJson: JSON.stringify }));
vi.mock("../lib/policy", async (original) => ({ ...await original<typeof import("../lib/policy")>(), evaluate: mocks.evaluate }));

import { authorized } from "../lib/admin";
import { GET as tick, HEAD } from "../app/api/cron/monitor/route";
import { POST as decide } from "../app/api/decide/route";
import { GET as decisions } from "../app/api/decisions/route";

const secret = "operator-test-secret";
const ADDRESS = "0x000000000000000000000000000000000000dead";
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.clearAllMocks();
  mocks.evaluate.mockReturnValue({ decisionId: "test-decision", allow: true, reasons: [], post: { healthFactor: 2 } });
  mocks.save.mockResolvedValue(true);
  mocks.observe.mockResolvedValue({ tracked: 1, events: 0 });
  mocks.deliver.mockResolvedValue({ due: 0, delivered: 0 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const request = () => new Request("https://local.test/api/decide", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ policy: { version: "v1", chains: [1], protocols: ["aave-v3"], debtAssets: [ADDRESS], collateralAssets: [ADDRESS], maxLtv: 0.4, minHealthFactor: 1.5, maxNotionalUsd: 1000, maxDataAgeMs: 60_000 }, proposal: { address: ADDRESS, chainId: 1, protocolId: "aave-v3", marketId: "test", borrowUsd: 100 } }),
});

describe("operator endpoints and fail-closed persistence", () => {
  it("requires a bearer header, rejects query-string secrets and missing configuration", () => {
    expect(authorized(new Request(`https://local.test/?key=${secret}`))).toBe(false);
    expect(authorized(new Request("https://local.test/", { headers: { authorization: `Bearer ${secret}` } }))).toBe(true);
    expect(authorized(new Request("https://local.test/", { headers: { authorization: "Bearer wrong" } }))).toBe(false);
    vi.stubEnv("CRON_SECRET", "");
    expect(authorized(new Request("https://local.test/", { headers: { authorization: "Bearer " } }))).toBe(false);
  });
  it("does not run a tick on HEAD or unauthorized GET", async () => {
    expect(HEAD().status).toBe(405);
    expect((await tick(new Request("https://local.test/api/cron/monitor"))).status).toBe(401);
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("reports a missing or failed database as unhealthy instead of successful empty work", async () => {
    mocks.observe.mockRejectedValue(new Error("DATABASE_URL is not set"));
    const response = await tick(new Request("https://local.test/api/cron/monitor", { headers: { authorization: `Bearer ${secret}` } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "MONITOR_UNAVAILABLE" });
  });
  it("does not expose full audit evidence to public address lookups", async () => {
    const response = await decisions(new Request(`https://local.test/api/decisions?address=${ADDRESS}`));
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("returns no usable allow decision when the audit write fails", async () => {
    mocks.save.mockRejectedValue(new Error("DB unavailable"));
    const response = await decide(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AUDIT_UNAVAILABLE", decisionId: "test-decision", allow: false, persisted: false });
  });
  it("passes the exact policy and both snapshots to the atomic record writer", async () => {
    const response = await decide(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ allow: true, persisted: true });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ decisionId: "test-decision" }), expect.objectContaining({ address: ADDRESS }), expect.objectContaining({ maxLtv: 0.4 }), {}, {});
  });
});
