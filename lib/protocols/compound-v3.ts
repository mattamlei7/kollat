import { erc20Abi, formatUnits, type Address } from "viem";
import { getClient } from "../chains";
import {
  aprToApy,
  healthFactor,
  liquidationPrice,
  liquidationPriceSingle,
  uniformDrawdown,
  type CollateralLeg,
} from "../math/health";
import { COMET_ABI } from "./abis/compound";
import { BaseLendingProtocol } from "./base";
import type { BorrowCapacity, ChainId, Market, MarketStatus, Position, PositionLeg, ProtocolId, Rate, Token } from "./types";

const SECONDS_PER_YEAR = 31_536_000;
/** Collateral factors and per-second rates are 1e18-scaled; Comet prices are 8-decimal USD. */
const WAD = 1e18;
const PRICE_SCALE = 1e8;

/**
 * Compound v3 ("Comet"). One Comet per (chain, base asset); the base asset is
 * the only thing you can borrow, every listed asset is collateral for it.
 *
 *   ltv                  = borrowCollateralFactor
 *   liquidationThreshold = liquidateCollateralFactor
 *   liquidationPenalty   = 1 − liquidationFactor   (the share the borrower keeps)
 *
 * Markets: ~5 multicalls. Positions: one multicall.
 */
export class CompoundV3Adapter extends BaseLendingProtocol {
  readonly id: ProtocolId = "compound-v3";
  readonly name = "Compound v3";
  readonly chainId: ChainId;

  /**
   * Supply-cap headroom per collateral (base units), refreshed with markets.
   * Comet refuses collateral above the cap, so wallet balance past it cannot borrow.
   */
  private headroom = new Map<string, bigint>();

  constructor(private readonly cfg: { chainId: ChainId; comet: Address }) {
    super();
    this.chainId = cfg.chainId;
  }

  private marketId(collateral: string, debt: string) {
    return `${this.id}:${this.chainId}:${collateral}>${debt}`;
  }

  protected async fetchMarkets(): Promise<Market[]> {
    const client = getClient(this.chainId);
    const comet = { address: this.cfg.comet, abi: COMET_ABI } as const;

    const [baseToken, baseFeed, numAssets, paused, totalSupply, totalBorrow] = await client.multicall({
      contracts: [
        { ...comet, functionName: "baseToken" },
        { ...comet, functionName: "baseTokenPriceFeed" },
        { ...comet, functionName: "numAssets" },
        { ...comet, functionName: "isWithdrawPaused" },
        { ...comet, functionName: "totalSupply" },
        { ...comet, functionName: "totalBorrow" },
      ],
      allowFailure: false,
    });

    const infos = await client.multicall({
      contracts: Array.from({ length: numAssets }, (_, i) => ({ ...comet, functionName: "getAssetInfo" as const, args: [i] as const })),
      allowFailure: false,
    });
    const assets = [baseToken, ...infos.map((a) => a.asset)];

    const [metas, prices, totals] = await Promise.all([
      client.multicall({
        contracts: assets.flatMap((address) => [
          { address, abi: erc20Abi, functionName: "symbol" as const },
          { address, abi: erc20Abi, functionName: "decimals" as const },
        ]),
        allowFailure: true,
      }),
      client.multicall({
        contracts: [baseFeed, ...infos.map((a) => a.priceFeed)].map((feed) => ({ ...comet, functionName: "getPrice" as const, args: [feed] as const })),
        allowFailure: false,
      }),
      client.multicall({
        contracts: infos.map((a) => ({ ...comet, functionName: "totalsCollateral" as const, args: [a.asset] as const })),
        allowFailure: false,
      }),
    ]);

    const token = (i: number): Token => ({
      chainId: this.chainId,
      address: assets[i],
      symbol: (metas[i * 2].result as string | undefined) ?? assets[i].slice(0, 8),
      decimals: Number(metas[i * 2 + 1].result ?? 18),
    });
    const debt = token(0);
    const debtPriceUsd = Number(prices[0]) / PRICE_SCALE;
    const now = Date.now();

    this.headroom.clear();
    return infos.map((a, i) => {
      const collateral = token(i + 1);
      const [supplied] = totals[i];
      this.headroom.set(collateral.address.toLowerCase(), a.supplyCap > supplied ? a.supplyCap - supplied : 0n);
      const ltv = Number(a.borrowCollateralFactor) / WAD;
      let status: MarketStatus = "active";
      if (paused) status = "paused";
      else if (ltv === 0 || a.supplyCap === 0n) status = "collateral-disabled";
      return {
        id: this.marketId(collateral.symbol, debt.symbol),
        protocol: this.id,
        chainId: this.chainId,
        collateral,
        debt,
        ltv,
        liquidationThreshold: Number(a.liquidateCollateralFactor) / WAD,
        liquidationPenalty: 1 - Number(a.liquidationFactor) / WAD,
        collateralPriceUsd: Number(prices[i + 1]) / PRICE_SCALE,
        debtPriceUsd,
        availableLiquidity: totalSupply > totalBorrow ? totalSupply - totalBorrow : 0n,
        status,
        fetchedAt: now,
      };
    });
  }

  protected async fetchRates(markets: Market[]): Promise<Rate[]> {
    const client = getClient(this.chainId);
    const comet = { address: this.cfg.comet, abi: COMET_ABI } as const;
    const utilization = await client.readContract({ ...comet, functionName: "getUtilization" });
    const [borrowRate, supplyRate] = await client.multicall({
      contracts: [
        { ...comet, functionName: "getBorrowRate", args: [utilization] },
        { ...comet, functionName: "getSupplyRate", args: [utilization] },
      ],
      allowFailure: false,
    });
    const apr = (Number(borrowRate) / WAD) * SECONDS_PER_YEAR;
    const now = Date.now();
    // One base asset → one rate shared by every collateral market.
    return markets.map((m) => ({
      marketId: m.id,
      borrowAprVariable: apr,
      borrowApyVariable: aprToApy(apr),
      supplyApr: (Number(supplyRate) / WAD) * SECONDS_PER_YEAR,
      utilization: Number(utilization) / WAD,
      fetchedAt: now,
    }));
  }

  /** Default capacity, then clamped to what the supply cap will still accept. */
  protected async computeCapacity(address: Address, markets: Market[]): Promise<BorrowCapacity[]> {
    const caps = await super.computeCapacity(address, markets);
    return caps.map((c) => {
      const m = markets.find((x) => x.id === c.marketId)!;
      const room = this.headroom.get(m.collateral.address.toLowerCase());
      if (room === undefined || c.collateralBalance <= room) return c;
      const units = Number(formatUnits(room, m.collateral.decimals));
      const maxBorrowUsd = Math.min(c.maxBorrowUsd, units * m.collateralPriceUsd * m.ltv);
      return {
        ...c,
        maxBorrowUsd,
        liquidationPriceAtMaxUsd: liquidationPriceSingle(units, m.liquidationThreshold, maxBorrowUsd),
        cappedByLiquidity: true,
      };
    });
  }

  protected async fetchPositions(address: Address, markets: Market[]): Promise<Position[]> {
    if (markets.length === 0) return [];
    const client = getClient(this.chainId);
    const comet = { address: this.cfg.comet, abi: COMET_ABI } as const;
    // Two multicalls so viem keeps per-call result types; the http transport batches them into one request.
    const [[borrowed, liquidatable], balances] = await Promise.all([
      client.multicall({
        contracts: [
          { ...comet, functionName: "borrowBalanceOf", args: [address] },
          { ...comet, functionName: "isLiquidatable", args: [address] },
        ],
        allowFailure: false,
      }),
      client.multicall({
        contracts: markets.map((m) => ({ ...comet, functionName: "collateralBalanceOf" as const, args: [address, m.collateral.address] as const })),
        allowFailure: false,
      }),
    ]);

    const collateral: PositionLeg[] = [];
    const legs: CollateralLeg[] = [];
    markets.forEach((m, i) => {
      const amount = balances[i];
      if (amount === 0n) return;
      const units = Number(formatUnits(amount, m.collateral.decimals));
      collateral.push({ token: m.collateral, amount, usd: units * m.collateralPriceUsd, liquidationThreshold: m.liquidationThreshold });
      legs.push({ units, priceUsd: m.collateralPriceUsd, liquidationThreshold: m.liquidationThreshold, ltv: m.ltv });
    });
    const debtToken = markets[0].debt;
    const debtUsd = Number(formatUnits(borrowed, debtToken.decimals)) * markets[0].debtPriceUsd;
    const debt: PositionLeg[] = borrowed > 0n ? [{ token: debtToken, amount: borrowed, usd: debtUsd }] : [];
    if (collateral.length === 0 && debt.length === 0) return [];

    const hf = debtUsd > 0 ? healthFactor(legs, debtUsd) : null;
    const notes: string[] = [];
    if (hf !== null && liquidatable !== hf < 1) {
      notes.push(`Compound reports this account as ${liquidatable ? "" : "not "}liquidatable, which disagrees with the computed health factor — trust the protocol.`);
    }
    return [
      {
        protocol: this.id,
        chainId: this.chainId,
        marketId: null,
        collateral,
        debt,
        healthFactor: hf,
        healthFactorReported: null,
        liquidationPrices: collateral.map((l, i) => ({ token: l.token, priceUsd: debtUsd > 0 ? liquidationPrice(legs, debtUsd, i) : 0 })),
        uniformDrawdownToLiquidation: hf !== null && Number.isFinite(hf) ? uniformDrawdown(hf) : null,
        notes,
        fetchedAt: Date.now(),
      },
    ];
  }
}
