import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sign, worst } from "../lib/monitor";
import type { Position } from "../lib/protocols/types";

const pos = (healthFactor: number | null, healthFactorReported: number | null = null): Position =>
  ({ protocol: "aave-v3", chainId: 1, marketId: null, collateral: [], debt: [], healthFactor, healthFactorReported, liquidationPrices: [], uniformDrawdownToLiquidation: null, notes: [], fetchedAt: 0 });

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
});
