import { erc20Abi, formatUnits, type Address } from "viem";
import { getClient } from "../chains";
import { aprToApy, healthFactor, liquidationPrice, liquidationPriceSingle, uniformDrawdown, type CollateralLeg } from "../math/health";
import { COMPTROLLER_ABI, MTOKEN_ABI, ORACLE_ABI } from "./abis/moonwell";
import { USDC } from "./addresses";
import { BaseLendingProtocol } from "./base";
import type { BorrowCapacity, ChainId, Market, MarketStatus, Position, PositionLeg, ProtocolId, Rate, Token } from "./types";

const SECONDS_PER_YEAR = 31_536_000;
const WAD = 1e18;

interface MarketInfo {
  mToken: Address;
  token: Token;
  priceUsd: number;
  /** Collateral factor — in Compound v2 this is both the LTV and the liquidation threshold. */
  cf: number;
}

/**
 * Moonwell (Compound v2 fork on Base + Optimism). Cross-collateral: every
 * listed market with a non-zero collateral factor backs a USDC borrow from the
 * USDC mToken.
 *
 *   ltv = liquidationThreshold = collateralFactor
 *   liquidationPenalty         = liquidationIncentive − 1
 *
 * Prices come from the comptroller's oracle, scaled 1e(36 − decimals).
 * Rates are per second ("per timestamp") in 1e18.
 */
export class MoonwellAdapter extends BaseLendingProtocol {
  readonly id: ProtocolId = "moonwell";
  readonly name = "Moonwell";
  readonly chainId: ChainId;

  /** mToken (lower-cased) → token, price, cf. Refreshed with markets; positions read it. */
  private info = new Map<string, MarketInfo>();
  /** Supply-cap headroom per collateral underlying (base units). */
  private headroom = new Map<string, bigint>();
  private debtMToken: Address | null = null;

  constructor(private readonly cfg: { chainId: ChainId; comptroller: Address }) {
    super();
    this.chainId = cfg.chainId;
  }

  protected async fetchMarkets(): Promise<Market[]> {
    const client = getClient(this.chainId);
    const comp = { address: this.cfg.comptroller, abi: COMPTROLLER_ABI } as const;
    const [mTokens, oracle, incentive] = await client.multicall({
      contracts: [
        { ...comp, functionName: "getAllMarkets" },
        { ...comp, functionName: "oracle" },
        { ...comp, functionName: "liquidationIncentiveMantissa" },
      ],
      allowFailure: false,
    });

    const per = await client.multicall({
      contracts: mTokens.flatMap((m) => {
        const mt = { address: m, abi: MTOKEN_ABI } as const;
        return [
          { ...mt, functionName: "underlying" as const },
          { ...comp, functionName: "markets" as const, args: [m] as const },
          { ...comp, functionName: "borrowCaps" as const, args: [m] as const },
          { ...comp, functionName: "supplyCaps" as const, args: [m] as const },
          { ...comp, functionName: "borrowGuardianPaused" as const, args: [m] as const },
          { ...comp, functionName: "mintGuardianPaused" as const, args: [m] as const },
          { ...mt, functionName: "getCash" as const },
          { ...mt, functionName: "totalBorrows" as const },
          { ...mt, functionName: "totalSupply" as const },
          { ...mt, functionName: "exchangeRateStored" as const },
          { address: oracle, abi: ORACLE_ABI, functionName: "getUnderlyingPrice" as const, args: [m] as const },
        ];
      }),
      allowFailure: true,
    });
    const N = 11;
    const row = (i: number) => per.slice(i * N, i * N + N);

    const underlyings = mTokens.map((_, i) => row(i)[0].result as Address | undefined);
    const metas = await client.multicall({
      contracts: underlyings.flatMap((u) => [
        { address: u ?? mTokens[0], abi: erc20Abi, functionName: "symbol" as const },
        { address: u ?? mTokens[0], abi: erc20Abi, functionName: "decimals" as const },
      ]),
      allowFailure: true,
    });

    const usdc = USDC[this.chainId].toLowerCase();
    const now = Date.now();
    this.info.clear();
    this.headroom.clear();
    this.debtMToken = null;

    type Row = { mToken: Address; token: Token; cf: number; borrowCap: bigint; supplyCap: bigint; borrowPaused: boolean; mintPaused: boolean; cash: bigint; borrows: bigint; supplied: bigint; priceUsd: number };
    const rows: Row[] = [];
    mTokens.forEach((m, i) => {
      const r = row(i);
      const u = underlyings[i];
      if (!u || r.some((x) => x.status !== "success")) return;
      const decimals = Number(metas[i * 2 + 1].result ?? 18);
      const token: Token = { chainId: this.chainId, address: u, symbol: (metas[i * 2].result as string | undefined) ?? u.slice(0, 8), decimals };
      const [, cfMantissa] = r[1].result as readonly [boolean, bigint];
      const exchangeRate = r[9].result as bigint;
      const priceUsd = Number(r[10].result as bigint) / 10 ** (36 - decimals);
      const info: MarketInfo = { mToken: m, token, priceUsd, cf: Number(cfMantissa) / WAD };
      this.info.set(m.toLowerCase(), info);
      rows.push({
        mToken: m,
        token,
        cf: info.cf,
        borrowCap: r[2].result as bigint,
        supplyCap: r[3].result as bigint,
        borrowPaused: r[4].result as boolean,
        mintPaused: r[5].result as boolean,
        cash: r[6].result as bigint,
        borrows: r[7].result as bigint,
        supplied: ((r[8].result as bigint) * exchangeRate) / 10n ** 18n,
        priceUsd,
      });
    });

    const debt = rows.find((r) => r.token.address.toLowerCase() === usdc);
    if (!debt) return [];
    this.debtMToken = debt.mToken;

    let debtStatus: MarketStatus = "active";
    if (debt.borrowPaused) debtStatus = "paused";
    else if (debt.borrowCap > 0n && debt.borrows >= debt.borrowCap) debtStatus = "frozen";
    const capRoom = debt.borrowCap > 0n ? (debt.borrowCap > debt.borrows ? debt.borrowCap - debt.borrows : 0n) : debt.cash;
    const availableLiquidity = debt.cash < capRoom ? debt.cash : capRoom;
    const penalty = Number(incentive) / WAD - 1;

    return rows
      .filter((r) => r.mToken !== debt.mToken)
      .map((r) => {
        if (r.supplyCap > 0n) this.headroom.set(r.token.address.toLowerCase(), r.supplyCap > r.supplied ? r.supplyCap - r.supplied : 0n);
        let status: MarketStatus = debtStatus;
        if (status === "active" && (r.mintPaused || r.cf === 0)) status = "collateral-disabled";
        return {
          id: `${this.id}:${this.chainId}:${r.token.symbol}>${debt.token.symbol}`,
          protocol: this.id,
          chainId: this.chainId,
          collateral: r.token,
          debt: debt.token,
          ltv: r.cf,
          liquidationThreshold: r.cf,
          liquidationPenalty: penalty,
          collateralPriceUsd: r.priceUsd,
          debtPriceUsd: debt.priceUsd,
          availableLiquidity,
          status,
          fetchedAt: now,
        };
      });
  }

  protected async fetchRates(markets: Market[]): Promise<Rate[]> {
    if (!this.debtMToken) return [];
    const client = getClient(this.chainId);
    const mt = { address: this.debtMToken, abi: MTOKEN_ABI } as const;
    const [borrowRate, supplyRate, cash, borrows, reserves] = await client.multicall({
      contracts: [
        { ...mt, functionName: "borrowRatePerTimestamp" },
        { ...mt, functionName: "supplyRatePerTimestamp" },
        { ...mt, functionName: "getCash" },
        { ...mt, functionName: "totalBorrows" },
        { ...mt, functionName: "totalReserves" },
      ],
      allowFailure: false,
    });
    const apr = (Number(borrowRate) / WAD) * SECONDS_PER_YEAR;
    const denom = Number(cash + borrows - reserves);
    const now = Date.now();
    return markets.map((m) => ({
      marketId: m.id,
      borrowAprVariable: apr,
      borrowApyVariable: aprToApy(apr),
      supplyApr: (Number(supplyRate) / WAD) * SECONDS_PER_YEAR,
      utilization: denom > 0 ? Number(borrows) / denom : null,
      fetchedAt: now,
    }));
  }

  /** Default capacity, clamped to what the supply cap will still accept. */
  protected async computeCapacity(address: Address, markets: Market[]): Promise<BorrowCapacity[]> {
    const caps = await super.computeCapacity(address, markets);
    return caps.map((c) => {
      const m = markets.find((x) => x.id === c.marketId)!;
      const room = this.headroom.get(m.collateral.address.toLowerCase());
      if (room === undefined || c.collateralBalance <= room) return c;
      const units = Number(formatUnits(room, m.collateral.decimals));
      const maxBorrowUsd = Math.min(c.maxBorrowUsd, units * m.collateralPriceUsd * m.ltv);
      return { ...c, collateralUsd: units * m.collateralPriceUsd, maxBorrowUsd, liquidationPriceAtMaxUsd: liquidationPriceSingle(units, m.liquidationThreshold, maxBorrowUsd), cappedByLiquidity: true };
    });
  }

  protected async fetchPositions(address: Address): Promise<Position[]> {
    const client = getClient(this.chainId);
    const comp = { address: this.cfg.comptroller, abi: COMPTROLLER_ABI } as const;
    const entered = await client.readContract({ ...comp, functionName: "getAssetsIn", args: [address] });
    if (entered.length === 0) return [];
    const [snapshots, [, , shortfall]] = await Promise.all([
      client.multicall({
        contracts: entered.map((m) => ({ address: m, abi: MTOKEN_ABI, functionName: "getAccountSnapshot" as const, args: [address] as const })),
        allowFailure: false,
      }),
      client.readContract({ ...comp, functionName: "getAccountLiquidity", args: [address] }),
    ]);

    const collateral: PositionLeg[] = [];
    const legs: CollateralLeg[] = [];
    const debt: PositionLeg[] = [];
    let debtUsd = 0;
    const notes: string[] = [];
    entered.forEach((m, i) => {
      const info = this.info.get(m.toLowerCase());
      const [, mBal, borrowed, exchangeRate] = snapshots[i];
      if (!info) {
        if (mBal > 0n || borrowed > 0n) notes.push(`A position in an unlisted Moonwell market (${m.slice(0, 8)}…) is not shown.`);
        return;
      }
      const amount = (mBal * exchangeRate) / 10n ** 18n;
      if (amount > 0n) {
        const units = Number(formatUnits(amount, info.token.decimals));
        collateral.push({ token: info.token, amount, usd: units * info.priceUsd, liquidationThreshold: info.cf });
        legs.push({ units, priceUsd: info.priceUsd, liquidationThreshold: info.cf, ltv: info.cf });
      }
      if (borrowed > 0n) {
        const usd = Number(formatUnits(borrowed, info.token.decimals)) * info.priceUsd;
        debt.push({ token: info.token, amount: borrowed, usd });
        debtUsd += usd;
      }
    });
    if (collateral.length === 0 && debt.length === 0) return [];

    const hf = debtUsd > 0 ? healthFactor(legs, debtUsd) : null;
    if (hf !== null && shortfall > 0n !== hf < 1) {
      notes.push(`Moonwell reports this account as ${shortfall > 0n ? "" : "not "}liquidatable, which disagrees with the computed health factor — trust the protocol.`);
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
