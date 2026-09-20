import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_OBSERVATION_AGE_MS, sign, transition, worst, type Tracked } from "../lib/monitor";
import { fail, ok, type Position } from "../lib/protocols/types";

const pos = (healthFactor: number | null, healthFactorReported: number | null = null): Position =>
  ({ protocol: "aave-v3", chainId: 1, marketId: null, collateral: [], debt: [], healthFactor, healthFactorReported, liquidationPrices: [], uniformDrawdownToLiquidation: null, notes: [], fetchedAt: 0 });

const NOW = 1_800_000_000_000;
const tracked: Tracked = { id: "test", partner: "test", address: "0x0", chain_id: 1, protocol_id: "aave-v3", webhook_url: "https://example.test/hook", secret: "test", last_band: "comfortable", last_hf: 2, last_ok: true, revision: 0, last_observed_at: 0 };

describe("monitor", () => {
  it("tracks the worst position, preferring the protocol's own health factor", () => {
    expect(worst([])).toBeNull();
    expect(worst([pos(null)])).toBeNull();
    const w = worst([pos(2.0), pos(1.4, 1.15), pos(1.3)]);
    expect(w?.hf).toBe(1.15);
    expect(w?.band).toBe("danger");
  });
  it("signs bodies the way the receiver snippet verifies them", () => {
    const body = JSON.stringify({ id: "evt", kind: "band_changed" });
    expect(sign("s3cret", body)).toBe(createHmac("sha256", "s3cret").update(body).digest("hex"));
    expect(sign("other", body)).not.toBe(sign("s3cret", body));
  });
  it.each([
    ["stale", ok([pos(2)], NOW, true)],
    ["too old", ok([pos(2)], NOW - MAX_OBSERVATION_AGE_MS - 1)],
    ["future dated", ok([pos(2)], NOW + 1)],
    ["invalid HF", ok([pos(2, NaN)], NOW)],
    ["upstream failure", fail<Position[]>("RPC_UNAVAILABLE", "offline")],
  ])("treats %s as unavailable and retains the last good band", (_label, result) => {
    const next = transition(tracked, result, NOW);
    expect(next).toMatchObject({ ok: false, band: "comfortable", hf: 2 });
    expect(next.events.map((e) => e.kind)).toEqual(["data_unavailable"]);
    expect(transition({ ...tracked, last_ok: false }, result, NOW).events).toEqual([]);
  });
  it("can use a valid reported HF even when no computed HF is available", () => {
    expect(worst([pos(null, 1.15)])?.band).toBe("danger");
  });
});
