import { formatUnits, isAddress, type Address } from "viem";
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
    return `${this.id}:${this.chainId}:${scope}${extra ? ":" + extra : ""}`;
  }

  getMarkets(): Promise<Result<Market[]>> {
    return cachedResult(this.key("markets"), TTL.markets, () => this.guard(() => this.fetchMarkets()));
  }

  getRates(): Promise<Result<Rate[]>> {
    return cachedResult(this.key("rates"), TTL.rates, async () => {
      const markets = await this.getMarkets();
      if (!markets.ok) return markets as unknown as Result<Rate[]>;
      return this.guard(() => this.fetchRates(markets.data));
    });
  }

  getPositions(address: Address): Promise<Result<Position[]>> {
    if (!isAddress(address)) return Promise.resolve(fail("INVALID_ADDRESS", "Not a valid EVM address", false));
    return cachedResult(this.key("positions", address.toLowerCase()), TTL.account, async () => {
      const markets = await this.getMarkets();
      if (!markets.ok) return markets as unknown as Result<Position[]>;
      return this.guard(() => this.fetchPositions(address, markets.data));
    });
  }

  getBorrowCapacity(address: Address): Promise<Result<BorrowCapacity[]>> {
    if (!isAddress(address)) return Promise.resolve(fail("INVALID_ADDRESS", "Not a valid EVM address", false));
    return cachedResult(this.key("capacity", address.toLowerCase()), TTL.account, async () => {
      const markets = await this.getMarkets();
      if (!markets.ok) return markets as unknown as Result<BorrowCapacity[]>;
      return this.guard(() => this.computeCapacity(address, markets.data));
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

  private async guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return ok(await fn());
    } catch (e) {
      return { ok: false, error: toProtocolError(e) };
    }
  }
}
