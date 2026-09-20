import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseLendingProtocol } from "../lib/protocols/base";
import { invalidate, TTL } from "../lib/cache";
import type { ChainId, Market, Position, ProtocolId } from "../lib/protocols/types";

const rpc = vi.hoisted(() => ({ pin: undefined as bigint | undefined, head: 101n }));
vi.mock("../lib/chains", () => ({ pinnedBlock: () => rpc.pin, getClient: () => ({ getBlockNumber: async () => rpc.head }) }));
const NOW = 1_800_000_000_000;
const ADDRESS = "0x000000000000000000000000000000000000dead";
class Fake extends BaseLendingProtocol {
  id = "provenance-test" as ProtocolId;
  name = "Test";
  chainId = 1 as ChainId;
  broken = false;
  marketReads = 0;
  protected async fetchMarkets(): Promise<Market[]> { this.marketReads++; if (this.broken) throw new Error("RPC timeout"); return []; }
  protected async fetchRates() { return []; }
  protected async fetchPositions(): Promise<Position[]> { return []; }
}
beforeEach(() => { invalidate("provenance-test:"); rpc.pin = undefined; rpc.head = 101n; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("read provenance", () => {
  it("retains the older market dependency instead of stamping every input with the current head/time", async () => {
    const p = new Fake();
    await p.getMarkets();
    vi.setSystemTime(NOW + 60_000);
    rpc.head = 105n;
    const result = await p.getPositions(ADDRESS);
    expect(result).toMatchObject({ ok: true, block: 105, fetchedAt: NOW, provenance: { kind: "observed-head", block: 105, markets: { block: 101, fetchedAt: NOW } } });
  });
  it("propagates failed market-refresh staleness to dependent positions", async () => {
    const p = new Fake();
    await p.getMarkets();
    vi.setSystemTime(NOW + TTL.markets + 1);
    p.broken = true;
    expect(await p.getPositions(ADDRESS)).toMatchObject({ ok: true, stale: true, fetchedAt: NOW, provenance: { markets: { stale: true } } });
  });
  it("does not reuse cached reads from a different fixture pin", async () => {
    const p = new Fake();
    rpc.pin = 100n;
    expect(await p.getMarkets()).toMatchObject({ block: 100, provenance: { kind: "pinned-contract-reads" } });
    rpc.pin = 200n;
    expect(await p.getMarkets()).toMatchObject({ block: 200 });
    expect(p.marketReads).toBe(2);
  });
});
