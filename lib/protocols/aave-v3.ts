import { formatUnits, type Address } from "viem";
import { IUiPoolDataProvider_ABI } from "@bgd-labs/aave-address-book/abis";
import { getClient } from "../chains";
import { aprToApy, healthFactor, liquidationPrice, uniformDrawdown, type CollateralLeg } from "../math/health";
import { POOL_ABI, PROTOCOL_DATA_PROVIDER_ABI, UI_POOL_DATA_PROVIDER_V33_ABI } from "./abis/aave";
import { BaseLendingProtocol } from "./base";
import type { ChainId, Market, MarketStatus, Position, PositionLeg, ProtocolId, Rate, Token } from "./types";

const RAY = 1e27;
/** Aave's max uint256 healthFactor sentinel for "no debt". */
const NO_DEBT_HF = 2n ** 255n;

export interface AaveV3Config {
  id: ProtocolId;
  name: string;
  chainId: ChainId;
  pool: Address;
  addressesProvider: Address;
  uiPoolDataProvider: Address;
  protocolDataProvider: Address;
  /** v3.3 = current Aave deployments; v3.0 = Spark (stable-rate fields still in the struct). */
  uiProviderVariant: "v3.3" | "v3.0";
  /** Symbols accepted as the debt asset. */
  debtSymbols: string[];
}

interface ReserveRow {
  underlyingAsset: Address;
  symbol: string;
  decimals: number;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  isPaused: boolean;
  variableBorrowRate: bigint;
  liquidityRate: bigint;
  availableLiquidity: bigint;
  totalScaledVariableDebt: bigint;
  variableBorrowIndex: bigint;
  priceUsd: number;
  debtCeiling: bigint;
  eModeCategoryId: number;
}

/**
 * Aave v3 (and forks). Two RPC calls for markets+rates, ~3 for positions.
 * Everything comes from UiPoolDataProviderV3 + Pool + ProtocolDataProvider.
 */
export class AaveV3Adapter extends BaseLendingProtocol {
  readonly id: ProtocolId;
  readonly name: string;
  readonly chainId: ChainId;

  constructor(private readonly cfg: AaveV3Config) {
    super();
    this.id = cfg.id;
    this.name = cfg.name;
    this.chainId = cfg.chainId;
  }

  // ---- raw reads -----------------------------------------------------------

  private async readReserves(): Promise<ReserveRow[]> {
    const client = getClient(this.chainId);
    const addr = this.cfg.uiPoolDataProvider;
    const args = [this.cfg.addressesProvider] as const;

    if (this.cfg.uiProviderVariant === "v3.3") {
      const [rows, base] = await client.readContract({
        address: addr,
        abi: UI_POOL_DATA_PROVIDER_V33_ABI,
        functionName: "getReservesData",
        args,
      });
      const toUsd = usdConverter(base.marketReferenceCurrencyUnit, base.marketReferenceCurrencyPriceInUsd);
      return rows.map((r) => ({
        underlyingAsset: r.underlyingAsset,
        symbol: r.symbol,
        decimals: Number(r.decimals),
        ltv: Number(r.baseLTVasCollateral) / 10_000,
        liquidationThreshold: Number(r.reserveLiquidationThreshold) / 10_000,
        liquidationBonus: Number(r.reserveLiquidationBonus) / 10_000 - 1,
        usageAsCollateralEnabled: r.usageAsCollateralEnabled,
        borrowingEnabled: r.borrowingEnabled,
        isActive: r.isActive,
        isFrozen: r.isFrozen,
        isPaused: r.isPaused,
        variableBorrowRate: r.variableBorrowRate,
        liquidityRate: r.liquidityRate,
        availableLiquidity: r.availableLiquidity,
        totalScaledVariableDebt: r.totalScaledVariableDebt,
        variableBorrowIndex: r.variableBorrowIndex,
        priceUsd: toUsd(r.priceInMarketReferenceCurrency),
        debtCeiling: r.debtCeiling,
        eModeCategoryId: 0,
      }));
    }

    const [rows, base] = await client.readContract({
      address: addr,
      abi: IUiPoolDataProvider_ABI,
      functionName: "getReservesData",
      args,
    });
    const toUsd = usdConverter(base.marketReferenceCurrencyUnit, base.marketReferenceCurrencyPriceInUsd);
    return rows.map((r) => ({
      underlyingAsset: r.underlyingAsset,
      symbol: r.symbol,
      decimals: Number(r.decimals),
      ltv: Number(r.baseLTVasCollateral) / 10_000,
      liquidationThreshold: Number(r.reserveLiquidationThreshold) / 10_000,
      liquidationBonus: Number(r.reserveLiquidationBonus) / 10_000 - 1,
      usageAsCollateralEnabled: r.usageAsCollateralEnabled,
      borrowingEnabled: r.borrowingEnabled,
      isActive: r.isActive,
      isFrozen: r.isFrozen,
      isPaused: r.isPaused,
      variableBorrowRate: r.variableBorrowRate,
      liquidityRate: r.liquidityRate,
      availableLiquidity: r.availableLiquidity,
      totalScaledVariableDebt: r.totalScaledVariableDebt,
      variableBorrowIndex: r.variableBorrowIndex,
      priceUsd: toUsd(r.priceInMarketReferenceCurrency),
      debtCeiling: r.debtCeiling,
      eModeCategoryId: Number(r.eModeCategoryId),
    }));
  }

  private token(r: ReserveRow): Token {
    return { chainId: this.chainId, address: r.underlyingAsset, symbol: r.symbol, decimals: r.decimals };
  }

  private marketId(collateral: string, debt: string) {
    return `${this.id}:${this.chainId}:${collateral}>${debt}`;
  }

  // ---- LendingProtocol -----------------------------------------------------

  protected async fetchMarkets(): Promise<Market[]> {
    const reserves = await this.readReserves();
    const now = Date.now();
    const debts = reserves.filter((r) => this.cfg.debtSymbols.includes(r.symbol) && r.isActive);
    const collaterals = reserves.filter((r) => r.isActive && !this.cfg.debtSymbols.includes(r.symbol));

    const markets: Market[] = [];
    for (const d of debts) {
      for (const c of collaterals) {
        let status: MarketStatus = "active";
        if (c.isPaused || d.isPaused) status = "paused";
        else if (c.isFrozen || d.isFrozen || !d.borrowingEnabled) status = "frozen";
        // LTV < 1 % means "collateral only inside an E-mode" — not usable for a plain USDC borrow.
        else if (!c.usageAsCollateralEnabled || c.ltv < 0.01) status = "collateral-disabled";
        markets.push({
          id: this.marketId(c.symbol, d.symbol),
          protocol: this.id,
          chainId: this.chainId,
          collateral: this.token(c),
          debt: this.token(d),
          ltv: c.ltv,
          liquidationThreshold: c.liquidationThreshold,
          liquidationPenalty: c.liquidationBonus,
          collateralPriceUsd: c.priceUsd,
          debtPriceUsd: d.priceUsd,
          availableLiquidity: d.availableLiquidity,
          status,
          fetchedAt: now,
        });
      }
    }
    return markets;
  }

  protected async fetchRates(markets: Market[]): Promise<Rate[]> {
    const reserves = await this.readReserves();
    const bySymbol = new Map(reserves.map((r) => [r.symbol, r]));
    const now = Date.now();
    return markets.map((m) => {
      const d = bySymbol.get(m.debt.symbol);
      const apr = d ? Number(d.variableBorrowRate) / RAY : 0;
      const totalDebt = d ? (Number(d.totalScaledVariableDebt) * Number(d.variableBorrowIndex)) / RAY : 0;
      const liquidity = d ? Number(d.availableLiquidity) : 0;
      const utilization = totalDebt + liquidity > 0 ? totalDebt / (totalDebt + liquidity) : null;
      return {
        marketId: m.id,
        borrowAprVariable: apr,
        borrowApyVariable: aprToApy(apr),
        supplyApr: d ? Number(d.liquidityRate) / RAY : null,
        utilization,
        fetchedAt: now,
      };
    });
  }

  protected async fetchPositions(address: Address, markets: Market[]): Promise<Position[]> {
    const client = getClient(this.chainId);
    const reserves = await this.readReserves();
    const byAsset = new Map(reserves.map((r) => [r.underlyingAsset.toLowerCase(), r]));

    // 1. account-level data + which reserves the user touches (2 calls)
    const [account, userReserves] = await Promise.all([
      client.readContract({ address: this.cfg.pool, abi: POOL_ABI, functionName: "getUserAccountData", args: [address] }),
      this.cfg.uiProviderVariant === "v3.3"
        ? client.readContract({
            address: this.cfg.uiPoolDataProvider,
            abi: UI_POOL_DATA_PROVIDER_V33_ABI,
            functionName: "getUserReservesData",
            args: [this.cfg.addressesProvider, address],
          })
        : client.readContract({
            address: this.cfg.uiPoolDataProvider,
            abi: IUiPoolDataProvider_ABI,
            functionName: "getUserReservesData",
            args: [this.cfg.addressesProvider, address],
          }),
    ]);
    const [rows, eMode] = userReserves;
    const touched = rows.filter((r) => {
      const stable = "principalStableDebt" in r ? (r.principalStableDebt as bigint) : 0n;
      return r.scaledATokenBalance > 0n || r.scaledVariableDebt > 0n || stable > 0n;
    });
    if (touched.length === 0) return [];

    // 2. live (index-adjusted) balances for just those reserves (1 multicall)
    const live = await client.multicall({
      contracts: touched.map((r) => ({
        address: this.cfg.protocolDataProvider,
        abi: PROTOCOL_DATA_PROVIDER_ABI,
        functionName: "getUserReserveData" as const,
        args: [r.underlyingAsset, address] as const,
      })),
      allowFailure: false,
    });

    const collateral: PositionLeg[] = [];
    const debt: PositionLeg[] = [];
    touched.forEach((r, i) => {
      const res = byAsset.get(r.underlyingAsset.toLowerCase());
      if (!res) return;
      const [aBal, stableDebt, varDebt, , , , , , collateralEnabled] = live[i];
      const token = this.token(res);
      if (aBal > 0n) {
        collateral.push({
          token,
          amount: aBal,
          usd: Number(formatUnits(aBal, res.decimals)) * res.priceUsd,
          liquidationThreshold: collateralEnabled ? res.liquidationThreshold : 0,
        });
      }
      const totalDebt = stableDebt + varDebt;
      if (totalDebt > 0n) {
        debt.push({ token, amount: totalDebt, usd: Number(formatUnits(totalDebt, res.decimals)) * res.priceUsd });
      }
    });

    const debtUsd = debt.reduce((s, l) => s + l.usd, 0);
    const legs: CollateralLeg[] = collateral.map((l) => ({
      units: Number(formatUnits(l.amount, l.token.decimals)),
      priceUsd: byAsset.get(l.token.address.toLowerCase())!.priceUsd,
      liquidationThreshold: l.liquidationThreshold ?? 0,
      ltv: byAsset.get(l.token.address.toLowerCase())!.ltv,
    }));
    const hf = debtUsd > 0 ? healthFactor(legs, debtUsd) : null;
    const reportedRaw = account[5];
    const healthFactorReported = debtUsd > 0 && reportedRaw < NO_DEBT_HF ? Number(reportedRaw) / 1e18 : null;

    const notes: string[] = [];
    if (Number(eMode) !== 0) {
      notes.push(
        `E-mode category ${eMode} is active on this account — the protocol applies higher thresholds than shown here; trust the protocol-reported health factor.`,
      );
    }
    if (collateral.some((l) => l.liquidationThreshold === 0 && l.usd > 0)) {
      notes.push("Some supplied assets are not enabled as collateral and do not protect the debt.");
    }
    void markets; // markets are not needed for account-level positions

    return [
      {
        protocol: this.id,
        chainId: this.chainId,
        marketId: null,
        collateral,
        debt,
        healthFactor: hf,
        healthFactorReported,
        liquidationPrices: collateral
          .map((l, i) => ({ token: l.token, priceUsd: debtUsd > 0 ? liquidationPrice(legs, debtUsd, i) : 0 }))
          .filter((_, i) => legs[i].liquidationThreshold > 0),
        uniformDrawdownToLiquidation: hf !== null && Number.isFinite(hf) ? uniformDrawdown(hf) : null,
        notes,
        fetchedAt: Date.now(),
      },
    ];
  }
}

function usdConverter(unit: bigint, priceInUsd: bigint) {
  // marketReferenceCurrencyPriceInUsd is 8-decimal USD per reference unit (1e8 for USD-based markets)
  const unitN = Number(unit);
  const refUsd = Number(priceInUsd) / 1e8;
  return (p: bigint) => (Number(p) / unitN) * refUsd;
}
