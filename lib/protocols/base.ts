import { formatUnits, isAddress, type Address } from "viem";
import { getClient, pinnedBlock } from "../chains";
import { cachedResult, TTL } from "../cache";
import { getTokenBalances, WNATIVE } from "../balances";
import { liquidationPriceSingle } from "../math/health";
import {
  fail,
  ok,
  toProtocolError,
  type BorrowCapacity,
  type ChainId,
  type LendingProtocol,
  type Market,
  type Position,
  type ProtocolId,
  type Rate,
  type Result,
} from "./types";

/**
 * Shared plumbing so a new adapter only implements the three protocol reads.
 * - caching with stale-while-revalidate per method
 * - thrown errors → Result values
 * - default getBorrowCapacity = markets × wallet balances
 */
export abstract class BaseLendingProtocol implements LendingProtocol {
  abstract readonly id: ProtocolId;
  abstract readonly name: string;
  abstract readonly chainId: ChainId;

  protected abstract fetchMarkets(): Promise<Market[]>;
  protected abstract fetchRates(markets: Market[]): Promise<Rate[]>;
  protected abstract fetchPositions(address: Address, markets: Market[]): Promise<Position[]>;

  protected key(scope: string, extra = "") {
    const pin = pinnedBlock(this.chainId);
    return `${this.id}:${this.chainId}:${scope}${extra ? ":" + extra : ""}${pin === undefined ? "" : ":block:" + pin}`;
  }

  getMarkets(): Promise<Result<Market[]>> {
    return cachedResult(this.key("markets"), TTL.markets, () => this.guard(async () => (await this.fetchMarkets()).map(admitMarket)));
  }

  getRates(): Promise<Result<Rate[]>> {
    return cachedResult(this.key("rates"), TTL.rates, async () => {
      const markets = await this.getMarkets();
      if (!markets.ok) return markets as unknown as Result<Rate[]>;
      return this.guard(() => this.fetchRates(markets.data), markets);
    });
  }

  getPositions(address: Address): Promise<Result<Position[]>> {
    if (!isAddress(address)) return Promise.resolve(fail("INVALID_ADDRESS", "Not a valid EVM address", false));
    return cachedResult(this.key("positions", address.toLowerCase()), TTL.account, async () => {
      const markets = await this.getMarkets();
      if (!markets.ok) return markets as unknown as Result<Position[]>;
      return this.guard(async () => (await this.fetchPositions(address, markets.data)).map(admitPosition), markets);
    });
  }

  getBorrowCapacity(address: Address): Promise<Result<BorrowCapacity[]>> {
    if (!isAddress(address)) return Promise.resolve(fail("INVALID_ADDRESS", "Not a valid EVM address", false));
    return cachedResult(this.key("capacity", address.toLowerCase()), TTL.account, async () => {
      const markets = await this.getMarkets();
      if (!markets.ok) return markets as unknown as Result<BorrowCapacity[]>;
      return this.guard(() => this.computeCapacity(address, markets.data), markets);
    });
  }

  /** Default capacity: each market's collateral token balance × ltv, capped by liquidity. */
  protected async computeCapacity(address: Address, markets: Market[]): Promise<BorrowCapacity[]> {
    const tokens = markets.map((m) => m.collateral.address);
    const { erc20, native } = await getTokenBalances(this.chainId, address, tokens);
    const weth = WNATIVE[this.chainId].toLowerCase();
    return markets.map((m) => {
      const key = m.collateral.address.toLowerCase();
      const isWeth = key === weth;
      let balance = erc20.get(key) ?? 0n;
      let nativeBalanceIncluded: bigint | undefined;
      if (isWeth && native > 0n) {
        balance += native;
        nativeBalanceIncluded = native;
      }
      const units = Number(formatUnits(balance, m.collateral.decimals));
      const collateralUsd = units * m.collateralPriceUsd;
      const uncapped = m.status === "active" ? collateralUsd * m.ltv : 0;
      const liquidityUsd =
        Number(formatUnits(m.availableLiquidity, m.debt.decimals)) * m.debtPriceUsd;
      const maxBorrowUsd = Math.min(uncapped, liquidityUsd);
      return {
        marketId: m.id,
        collateralBalance: balance,
        collateralUsd,
        maxBorrowUsd,
        liquidationPriceAtMaxUsd: liquidationPriceSingle(units, m.liquidationThreshold, maxBorrowUsd),
        cappedByLiquidity: uncapped > liquidityUsd,
        nativeBalanceIncluded,
      };
    });
  }

  private async guard<T>(fn: () => Promise<T>, markets?: Extract<Result<Market[]>, { ok: true }>): Promise<Result<T>> {
    try {
      // This is an observation, not an exact state anchor. Contract reads are only
      // pinned in fixture mode; discovery APIs and cached markets are not pinned.
      const pin = pinnedBlock(this.chainId);
      const block = Number(pin ?? (await getClient(this.chainId).getBlockNumber()));
      const data = await fn();
      const result = ok(data, markets ? Math.min(Date.now(), markets.fetchedAt) : Date.now(), markets?.stale ?? false, block);
      if (result.ok) result.provenance = {
        kind: pin === undefined ? "observed-head" : "pinned-contract-reads", block,
        ...(markets ? { markets: { block: markets.block, fetchedAt: markets.fetchedAt, stale: markets.stale, provenance: markets.provenance } } : {}),
      };
      return result;
    } catch (e) {
      return { ok: false, error: e instanceof InvalidData ? { code: "INVALID_DATA", message: e.message, retryable: true } : toProtocolError(e) };
    }
  }
}

/**
 * Fail-closed contract. A read that succeeds but yields a number no risk figure
 * may rest on is never passed through as 0, 1 or NaN:
 *  - a market whose prices or thresholds are unusable is returned with
 *    `status: "unpriced"` — listed, never quoted, never "best";
 *  - a position with any leg that cannot be priced is not returned at all: the
 *    protocol's Result is an INVALID_DATA error naming the leg;
 *  - a balance read that fails throws (lib/balances.ts) rather than reading as 0;
 *  - a stale cache value is served with `stale: true` and its `fetchedAt`; how old is
 *    too old is the consumer's rule, not the adapter's.
 */
class InvalidData extends Error {}
const usable = (n: number) => Number.isFinite(n) && n > 0;

function admitMarket(m: Market): Market {
  if (m.status !== "active") return m;
  const bad = !usable(m.collateralPriceUsd) || !usable(m.debtPriceUsd) || !usable(m.liquidationThreshold) || m.liquidationThreshold > 1 || m.ltv > m.liquidationThreshold;
  return bad ? { ...m, status: "unpriced" } : m;
}

function admitPosition(p: Position): Position {
  for (const l of [...p.collateral, ...p.debt]) {
    if (!Number.isFinite(l.usd) || (l.amount > 0n && l.usd <= 0)) throw new InvalidData(`${l.token.symbol} on ${p.protocol} has no usable price; position withheld`);
  }
  if (p.healthFactor !== null && !Number.isFinite(p.healthFactor)) throw new InvalidData(`health factor on ${p.protocol} is not finite; position withheld`);
  return p;
}
