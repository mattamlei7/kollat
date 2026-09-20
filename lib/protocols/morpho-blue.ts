import { formatUnits, type Address, type Hex } from "viem";
import { getClient } from "../chains";
import { healthFactor, liquidationPriceSingle, uniformDrawdown } from "../math/health";
import { MORPHO_ABI, MORPHO_ORACLE_ABI } from "./abis/morpho";
import { MORPHO_BLUE, USDC } from "./addresses";
import { BaseLendingProtocol } from "./base";
import type { ChainId, Market, Position, ProtocolId, Rate, Token } from "./types";

const API = "https://blue-api.morpho.org/graphql";
const WAD = 1e18;
/** Oracle price = loan base units per collateral base unit, scaled by 1e36. */
const ORACLE_SCALE = 1e36;
/** Markets with less than this supplied are not offered. */
const MIN_SUPPLY_USD = 250_000;
/** Morpho's share accounting adds virtual shares/assets; toAssetsUp needs the same constants. */
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

interface ApiAsset {
  address: Address;
  symbol: string;
  decimals: number;
  priceUsd: number | null;
}
interface ApiMarket {
  marketId: Hex;
  loanAsset: ApiAsset;
  collateralAsset: ApiAsset | null;
  state: { borrowApy: number; supplyApy: number; utilization: number; liquidityAssetsUsd: number } | null;
}

const MARKETS_QUERY = `query($chain: Int!, $loan: String!, $minSupply: Float!) {
  markets(first: 200, orderBy: SupplyAssetsUsd, orderDirection: Desc,
          where: { chainId_in: [$chain], loanAssetAddress_in: [$loan], listed: true, supplyAssetsUsd_gte: $minSupply }) {
    items {
      marketId
      loanAsset { address symbol decimals priceUsd }
      collateralAsset { address symbol decimals priceUsd }
      state { borrowApy supplyApy utilization liquidityAssetsUsd }
    }
  }
}`;

/**
 * Morpho Blue. Isolated (collateral, loan, oracle, LLTV) markets on one
 * singleton contract. There is no LTV / liquidation-threshold split:
 * the max borrow *is* the liquidation point, so ltv == liquidationThreshold.
 *
 * Discovery and rates come from Morpho's public API (no key). LLTV, oracle
 * price and liquidity are read from the contract, which wins on disagreement.
 * Positions are read entirely on-chain.
 */
export class MorphoBlueAdapter extends BaseLendingProtocol {
  readonly id: ProtocolId = "morpho-blue";
  readonly name = "Morpho";

  constructor(readonly chainId: ChainId) {
    super();
  }

  private async apiMarkets(): Promise<ApiMarket[]> {
    let res: Response;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: MARKETS_QUERY, variables: { chain: this.chainId, loan: USDC[this.chainId], minSupply: MIN_SUPPLY_USD } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new Error(`Morpho API fetch failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`Morpho API http ${res.status}`);
    const body = (await res.json()) as { data?: { markets: { items: ApiMarket[] } }; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`Morpho API: ${body.errors[0].message}`);
    return body.data?.markets.items ?? [];
  }

  /** One market per collateral token: the deepest, which is where a router would send you. */
  private pickPerCollateral(all: ApiMarket[]): ApiMarket[] {
    const best = new Map<string, ApiMarket>();
    for (const m of all) {
      if (!m.collateralAsset || !m.state) continue;
      const key = m.collateralAsset.address.toLowerCase();
      const cur = best.get(key);
      if (!cur || m.state.liquidityAssetsUsd > cur.state!.liquidityAssetsUsd) best.set(key, m);
    }
    return [...best.values()];
  }

  private idOf(m: Market): Hex {
    return m.id.slice(m.id.lastIndexOf(":") + 1) as Hex;
  }

  protected async fetchMarkets(): Promise<Market[]> {
    const chosen = this.pickPerCollateral(await this.apiMarkets());
    if (chosen.length === 0) return [];
    const client = getClient(this.chainId);
    const morpho = { address: MORPHO_BLUE[this.chainId]!, abi: MORPHO_ABI } as const;

    const [params, states] = await Promise.all([
      client.multicall({
        contracts: chosen.map((m) => ({ ...morpho, functionName: "idToMarketParams" as const, args: [m.marketId] as const })),
        allowFailure: false,
      }),
      client.multicall({
        contracts: chosen.map((m) => ({ ...morpho, functionName: "market" as const, args: [m.marketId] as const })),
        allowFailure: false,
      }),
    ]);
    const prices = await client.multicall({
      contracts: params.map(([, , oracle]) => ({ address: oracle, abi: MORPHO_ORACLE_ABI, functionName: "price" as const })),
      allowFailure: true,
    });

    const now = Date.now();
    const markets: Market[] = [];
    chosen.forEach((m, i) => {
      const [loanToken, collateralToken, , , lltvRaw] = params[i];
      const c = m.collateralAsset!;
      // The contract is the source of truth; an API row that disagrees is dropped.
      if (loanToken.toLowerCase() !== m.loanAsset.address.toLowerCase() || collateralToken.toLowerCase() !== c.address.toLowerCase()) return;
      const [totalSupplyAssets, , totalBorrowAssets] = states[i];
      const price = prices[i];
      const lltv = Number(lltvRaw) / WAD;
      const debtPriceUsd = m.loanAsset.priceUsd ?? 0; // 0 → admitMarket marks it unpriced
      const priceInLoan = price.status === "success" ? (Number(price.result) / ORACLE_SCALE) * 10 ** (c.decimals - m.loanAsset.decimals) : 0;
      const collateral: Token = { chainId: this.chainId, address: collateralToken, symbol: c.symbol, decimals: c.decimals };
      const debt: Token = { chainId: this.chainId, address: loanToken, symbol: m.loanAsset.symbol, decimals: m.loanAsset.decimals };
      markets.push({
        id: `${this.id}:${this.chainId}:${m.marketId}`,
        protocol: this.id,
        chainId: this.chainId,
        collateral,
        debt,
        ltv: lltv,
        liquidationThreshold: lltv,
        // Morpho's liquidation incentive: min(1.15, 1 / (1 − 0.3 × (1 − LLTV))) − 1
        liquidationPenalty: Math.min(1.15, 1 / (1 - 0.3 * (1 - lltv))) - 1,
        collateralPriceUsd: priceInLoan * debtPriceUsd,
        debtPriceUsd,
        availableLiquidity: totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : 0n,
        status: price.status === "success" ? "active" : "unpriced",
        fetchedAt: now,
      });
    });
    return markets;
  }

  protected async fetchRates(markets: Market[]): Promise<Rate[]> {
    const byId = new Map((await this.apiMarkets()).map((m) => [m.marketId.toLowerCase(), m.state]));
    const now = Date.now();
    return markets.map((m) => {
      const s = byId.get(this.idOf(m).toLowerCase());
      const apy = s?.borrowApy ?? 0;
      return {
        marketId: m.id,
        // Morpho compounds continuously, so the simple rate is ln(1 + APY).
        borrowAprVariable: Math.log1p(apy),
        borrowApyVariable: apy,
        supplyApr: s ? Math.log1p(s.supplyApy) : null,
        utilization: s?.utilization ?? null,
        fetchedAt: now,
      };
    });
  }

  protected async fetchPositions(address: Address, markets: Market[]): Promise<Position[]> {
    if (markets.length === 0) return [];
    const client = getClient(this.chainId);
    const morpho = { address: MORPHO_BLUE[this.chainId]!, abi: MORPHO_ABI } as const;
    const ids = markets.map((m) => this.idOf(m));
    const [positions, states] = await Promise.all([
      client.multicall({
        contracts: ids.map((id) => ({ ...morpho, functionName: "position" as const, args: [id, address] as const })),
        allowFailure: false,
      }),
      client.multicall({
        contracts: ids.map((id) => ({ ...morpho, functionName: "market" as const, args: [id] as const })),
        allowFailure: false,
      }),
    ]);

    const now = Date.now();
    return markets.flatMap((m, i): Position[] => {
      const [, borrowShares, collateralRaw] = positions[i];
      if (borrowShares === 0n && collateralRaw === 0n) return [];
      const [, , totalBorrowAssets, totalBorrowShares] = states[i];
      const borrowAssets = toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares);
      const units = Number(formatUnits(collateralRaw, m.collateral.decimals));
      const debtUsd = Number(formatUnits(borrowAssets, m.debt.decimals)) * m.debtPriceUsd;
      const leg = { units, priceUsd: m.collateralPriceUsd, liquidationThreshold: m.liquidationThreshold, ltv: m.ltv };
      const hf = debtUsd > 0 ? healthFactor([leg], debtUsd) : null;
      return [
        {
          protocol: this.id,
          chainId: this.chainId,
          marketId: m.id,
          collateral: collateralRaw > 0n ? [{ token: m.collateral, amount: collateralRaw, usd: units * m.collateralPriceUsd, liquidationThreshold: m.liquidationThreshold }] : [],
          debt: borrowAssets > 0n ? [{ token: m.debt, amount: borrowAssets, usd: debtUsd }] : [],
          healthFactor: hf,
          healthFactorReported: null,
          liquidationPrices: collateralRaw > 0n ? [{ token: m.collateral, priceUsd: liquidationPriceSingle(units, m.liquidationThreshold, debtUsd) }] : [],
          uniformDrawdownToLiquidation: hf !== null && Number.isFinite(hf) ? uniformDrawdown(hf) : null,
          notes: [`Isolated market at ${(m.ltv * 100).toFixed(1)}% LLTV: only this collateral backs this debt, and the max borrow is the liquidation point.`],
          fetchedAt: now,
        },
      ];
    });
  }
}

/** Morpho's SharesMathLib.toAssetsUp — borrow shares → assets owed, rounded against the borrower. */
function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (shares === 0n) return 0n;
  const num = shares * (totalAssets + VIRTUAL_ASSETS);
  const den = totalShares + VIRTUAL_SHARES;
  return (num + den - 1n) / den;
}
