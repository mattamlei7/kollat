import { erc20Abi, formatUnits, type Address } from "viem";
import { WNATIVE } from "../balances";
import { getClient } from "../chains";
import { aprToApy, liquidationPriceSingle, uniformDrawdown } from "../math/health";
import { FLUID_VAULT_RESOLVER_ABI } from "./abis/fluid";
import { FLUID_VAULT_RESOLVER, USDC } from "./addresses";
import { BaseLendingProtocol } from "./base";
import type { ChainId, Market, Position, ProtocolId, Rate, Token } from "./types";

const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
/** Oracle prices are debt-per-collateral in 1e27, adjusted by the decimals difference. */
const ORACLE_PRECISION = 1e27;
/** Config percentages (CF, LT, penalty) and rates are in 1e4 = 100 %. */
const BPS = 1e4;
const CHUNK = 20;

type VaultData = Awaited<ReturnType<typeof readVaults>>[number];

async function readVaults(chainId: ChainId, vaults: readonly Address[]) {
  const client = getClient(chainId);
  const chunks: Address[][] = [];
  for (let i = 0; i < vaults.length; i += CHUNK) chunks.push(vaults.slice(i, i + CHUNK));
  const parts = await Promise.all(
    chunks.map((c) => client.readContract({ address: FLUID_VAULT_RESOLVER, abi: FLUID_VAULT_RESOLVER_ABI, functionName: "getVaultsEntireData", args: [c] })),
  );
  return parts.flat();
}

/**
 * Fluid (Instadapp) vaults. Each vault is one (collateral → debt) pair with
 * its own CF / LT / penalty and oracle, so it maps 1:1 onto a Market. Smart
 * (DEX-share) vaults are excluded: their amounts are shares, not tokens.
 * Per collateral the vault with the most borrowable USDC is kept.
 * Positions are NFTs; the resolver returns them per owner.
 */
export class FluidAdapter extends BaseLendingProtocol {
  readonly id: ProtocolId = "fluid";
  readonly name = "Fluid";

  /** Vault → market id, for rates and position matching. */
  private vaultOf = new Map<string, Address>();

  constructor(readonly chainId: ChainId) {
    super();
  }

  private async tokens(addresses: Address[]): Promise<Map<string, Token>> {
    const client = getClient(this.chainId);
    const unique = [...new Set(addresses.map((a) => a.toLowerCase() as Address))];
    const metas = await client.multicall({
      contracts: unique.flatMap((address) => [
        { address, abi: erc20Abi, functionName: "symbol" as const },
        { address, abi: erc20Abi, functionName: "decimals" as const },
      ]),
      allowFailure: true,
    });
    const out = new Map<string, Token>();
    unique.forEach((a, i) => {
      out.set(a, { chainId: this.chainId, address: a, symbol: (metas[i * 2].result as string | undefined) ?? a.slice(0, 8), decimals: Number(metas[i * 2 + 1].result ?? 18) });
    });
    return out;
  }

  /** Native ETH vaults are keyed to the wrapped token so wallet ETH + WETH both count (Fluid takes ETH directly). */
  private collateralAddress(d: VaultData): Address {
    const a = d.constantVariables.supplyToken.token0;
    return a.toLowerCase() === NATIVE ? WNATIVE[this.chainId] : a;
  }

  private priceInDebt(d: VaultData, collateralDecimals: number, debtDecimals: number) {
    return (Number(d.configs.oraclePriceOperate) / ORACLE_PRECISION) * 10 ** (collateralDecimals - debtDecimals);
  }

  protected async fetchMarkets(): Promise<Market[]> {
    const client = getClient(this.chainId);
    const all = await client.readContract({ address: FLUID_VAULT_RESOLVER, abi: FLUID_VAULT_RESOLVER_ABI, functionName: "getAllVaultsAddresses" });
    const usdc = USDC[this.chainId].toLowerCase();
    const data = (await readVaults(this.chainId, all)).filter(
      (d) => !d.isSmartCol && !d.isSmartDebt && d.constantVariables.borrowToken.token0.toLowerCase() === usdc,
    );
    const tokens = await this.tokens([...data.map((d) => this.collateralAddress(d)), USDC[this.chainId]]);
    const debt = tokens.get(usdc)!;

    // One market per collateral: the vault with the most USDC currently borrowable.
    const best = new Map<string, VaultData>();
    for (const d of data) {
      const key = this.collateralAddress(d).toLowerCase();
      const cur = best.get(key);
      if (!cur || d.limitsAndAvailability.borrowable > cur.limitsAndAvailability.borrowable) best.set(key, d);
    }

    const now = Date.now();
    this.vaultOf.clear();
    return [...best.values()].map((d) => {
      const collateral = tokens.get(this.collateralAddress(d).toLowerCase())!;
      const id = `${this.id}:${this.chainId}:${d.constantVariables.vaultId}`;
      this.vaultOf.set(id, d.vault);
      return {
        id,
        protocol: this.id,
        chainId: this.chainId,
        collateral,
        debt,
        ltv: d.configs.collateralFactor / BPS,
        liquidationThreshold: d.configs.liquidationThreshold / BPS,
        liquidationPenalty: d.configs.liquidationPenalty / BPS,
        collateralPriceUsd: this.priceInDebt(d, collateral.decimals, debt.decimals),
        debtPriceUsd: 1,
        availableLiquidity: d.limitsAndAvailability.borrowable,
        status: d.configs.collateralFactor === 0 ? "collateral-disabled" : "active",
        fetchedAt: now,
      };
    });
  }

  protected async fetchRates(markets: Market[]): Promise<Rate[]> {
    const vaults = markets.map((m) => this.vaultOf.get(m.id)).filter((v): v is Address => !!v);
    const data = await readVaults(this.chainId, vaults);
    const byVault = new Map(data.map((d) => [d.vault.toLowerCase(), d]));
    const now = Date.now();
    return markets.flatMap((m) => {
      const d = byVault.get(this.vaultOf.get(m.id)?.toLowerCase() ?? "");
      if (!d) return [];
      const apr = Number(d.exchangePricesAndRates.borrowRateVault) / BPS;
      const supplied = Number(d.totalSupplyAndBorrow.totalSupplyLiquidityOrDex);
      const borrowed = Number(d.totalSupplyAndBorrow.totalBorrowLiquidityOrDex);
      return [{
        marketId: m.id,
        borrowAprVariable: apr,
        borrowApyVariable: aprToApy(apr),
        supplyApr: Number(d.exchangePricesAndRates.supplyRateVault) / BPS,
        utilization: supplied > 0 ? borrowed / supplied : null,
        fetchedAt: now,
      }];
    });
  }

  protected async fetchPositions(address: Address): Promise<Position[]> {
    const client = getClient(this.chainId);
    const [positions, vaults] = await client.readContract({ address: FLUID_VAULT_RESOLVER, abi: FLUID_VAULT_RESOLVER_ABI, functionName: "positionsByUser", args: [address] });
    const live = positions.map((p, i) => ({ p, d: vaults[i] })).filter(({ p }) => p.supply > 0n || p.borrow > 0n);
    if (live.length === 0) return [];
    const smart = live.filter(({ d }) => d.isSmartCol || d.isSmartDebt).length;
    const plain = live.filter(({ d }) => !d.isSmartCol && !d.isSmartDebt);
    const tokens = await this.tokens(plain.flatMap(({ d }) => [this.collateralAddress(d), d.constantVariables.borrowToken.token0]));
    const now = Date.now();

    const out: Position[] = plain.map(({ p, d }) => {
      const colAddr = this.collateralAddress(d);
      const collateral = tokens.get(colAddr.toLowerCase())!;
      const debtToken = tokens.get(d.constantVariables.borrowToken.token0.toLowerCase())!;
      const isNative = d.constantVariables.supplyToken.token0.toLowerCase() === NATIVE;
      const colToken: Token = isNative ? { ...collateral, symbol: "ETH" } : collateral;
      const price = this.priceInDebt(d, collateral.decimals, debtToken.decimals); // in debt token; ≈ USD for USDC debt
      const debtUsd = Number(formatUnits(p.borrow, debtToken.decimals));
      const units = Number(formatUnits(p.supply, collateral.decimals));
      const lt = d.configs.liquidationThreshold / BPS;
      const hf = debtUsd > 0 ? (units * price * lt) / debtUsd : null;
      const id = `${this.id}:${this.chainId}:${d.constantVariables.vaultId}`;
      const notes: string[] = [`Fluid position #${p.nftId}`];
      if (debtToken.address.toLowerCase() !== USDC[this.chainId].toLowerCase()) notes.push(`Debt is in ${debtToken.symbol}; values are quoted in ${debtToken.symbol}, not USD.`);
      return {
        protocol: this.id,
        chainId: this.chainId,
        marketId: this.vaultOf.has(id) ? id : null,
        collateral: [{ token: colToken, amount: p.supply, usd: units * price, liquidationThreshold: lt }],
        debt: p.borrow > 0n ? [{ token: debtToken, amount: p.borrow, usd: debtUsd }] : [],
        healthFactor: hf,
        healthFactorReported: null,
        liquidationPrices: [{ token: colToken, priceUsd: debtUsd > 0 ? liquidationPriceSingle(units, lt, debtUsd) : 0 }],
        uniformDrawdownToLiquidation: hf !== null && Number.isFinite(hf) ? uniformDrawdown(hf) : null,
        notes,
        fetchedAt: now,
      };
    });
    if (smart > 0 && out.length > 0) out[0].notes.push(`${smart} Fluid smart-collateral/smart-debt position${smart > 1 ? "s are" : " is"} not shown.`);
    return out;
  }
}
