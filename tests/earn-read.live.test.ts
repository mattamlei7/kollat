import { describe, expect, it } from "vitest";
import { readEarn } from "../lib/earn/read";

// Live read of every destination; opt-in (EARN_LIVE=1) so normal runs stay offline.
describe.skipIf(!process.env.EARN_LIVE)("earn destinations (live)", () => {
  it("reads every configured destination with a rate, capacity and liquidity", async () => {
    const s = await readEarn([1, 8453, 42161]);
    for (const o of s.opportunities) console.log(o.id, "|", o.name, "|", o.operator, "|", o.baseApy?.toFixed(4), "|", o.capacity, "|", o.liquidity, "|", o.status, "|", o.receipt.symbol, o.receipt.address, "|", o.error);
    console.log("failures", s.failures);
    expect(s.opportunities).toHaveLength(24);
    expect(s.failures).toEqual([]);
    for (const o of s.opportunities) {
      expect(o.baseApy, o.id).not.toBeNull();
      expect(o.liquidity, o.id).not.toBeNull();
      expect(o.status, o.id).toBe("active");
    }
  }, 120_000);
});
