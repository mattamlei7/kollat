import { erc20Abi, formatUnits, getAddress, type Address } from "viem";
import { getClient } from "../chains";
import { healthFactor, liquidationPrice, uniformDrawdown, type CollateralLeg } from "../math/health";
import { EULER_ROUTER_ABI, EVAULT_ABI, EVC_ABI } from "./abis/euler";
import { USDC } from "./addresses";
import { BaseLendingProtocol } from "./base";
import type { ChainId, Market, MarketStatus, Position, PositionLeg, ProtocolId, Rate, Token } from "./types";

const SECONDS_PER_YEAR = 31_536_000;
const RAY = 1e27;
const BPS = 1e4;
/** EVK's unit-of-account sentinel for USD (18 decimals). */
const USD = "0x0000000000000000000000000000000000000348";
const SUB_ACCOUNTS = 256;
const META_URL = "https://app.euler.finance/api/public/metadata";
// ponytail: top-N USDC vaults by size; add a curator allow-list if a partner wants a specific vault surfaced.
const TOP_VAULTS = 4;

interface VaultMeta { address: string; type: string; deprecated: boolean; productId: string | null; asset?: { address: string; symbol: string } }

/** EVK AmountCap: 0 = unlimited, else mantissa × 10^exponent / 100 (exponent = low 6 bits). */
export function decodeCap(cap: number): bigint | null {
  if (cap === 0) return null;
  return (BigInt(cap >> 6) * 10n ** BigInt(cap & 63)) / 100n;
}

/** EVC sub-account i of an owner: the address with its low byte XOR-ed. */
export function subAccount(owner: Address, i: number): Address {
  return getAddress(("0x" + (BigInt(owner) ^ BigInt(i)).toString(16).padStart(40, "0")) as Address);
}

interface DebtVault {
  vault: Address;
  oracle: Address;
  uoa: Address;
  uoaDecimals: number;
  cash: bigint;
  borrows: bigint;
  borrowCap: bigint | null;
  maxDiscount: number;
}

/**
 * Euler v2 (EVK). A debt vault lists collateral vaults with borrow / liquidation
 * LTVs; the wallet holds the collateral vault's underlying asset. Vaults are
 * discovered through Euler's public metadata endpoint (no key), then everything
 * else is read from the vault, its oracle router and the EVC.
 *
 *   liquidationPenalty = maxLiquidationDiscount (the discount is dynamic; this is the worst case)
 */
export class EulerV2Adapter extends BaseLendingProtocol {
  readonly id: ProtocolId = "euler-v2";
  readonly name = "Euler";
  readonly chainId: ChainId;

  /** Market id → debt vault (for rates). */
  private vaultOf = new Map<string, Address>();

  constructor(private readonly cfg: { chainId: ChainId; evc: Address }) {
    super();
    this.chainId = cfg.chainId;
  }

  private async tokenMeta(addresses: Address[]): Promise<Map<string, Token>> {
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

  private async debtVaults(): Promise<DebtVault[]> {
    const res = await fetch(`${META_URL}?chainId=${this.chainId}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Euler metadata API ${res.status}`);
    const meta = (await res.json()) as Record<string, VaultMeta>;
    const usdc = USDC[this.chainId].toLowerCase();
    const candidates = Object.values(meta)
      .filter((v) => v.type === "evk" && !v.deprecated && v.productId && v.asset?.address.toLowerCase() === usdc)
      .map((v) => getAddress(v.address));
    if (candidates.length === 0) return [];

    const client = getClient(this.chainId);
    const per = await client.multicall({
      contracts: candidates.flatMap((address) => {
        const v = { address, abi: EVAULT_ABI } as const;
        return [
          { ...v, functionName: "cash" as const },
          { ...v, functionName: "totalBorrows" as const },
          { ...v, functionName: "caps" as const },
          { ...v, functionName: "oracle" as const },
          { ...v, functionName: "unitOfAccount" as const },
          { ...v, functionName: "maxLiquidationDiscount" as const },
        ];
      }),
      allowFailure: true,
    });
    const vaults: DebtVault[] = [];
    candidates.forEach((vault, i) => {
      const r = per.slice(i * 6, i * 6 + 6);
      if (r.some((x) => x.status !== "success")) return;
      const [, borrowCap] = r[2].result as readonly [number, number];
      vaults.push({
        vault,
        cash: r[0].result as bigint,
        borrows: r[1].result as bigint,
        borrowCap: decodeCap(borrowCap),
        oracle: r[3].result as Address,
        uoa: r[4].result as Address,
        uoaDecimals: 18,
        maxDiscount: (r[5].result as number) / BPS,
      });
    });
    vaults.sort((a, b) => Number(b.cash + b.borrows - (a.cash + a.borrows)));
    const top = vaults.slice(0, TOP_VAULTS);

    const nonUsd = top.filter((v) => v.uoa.toLowerCase() !== USD);
    if (nonUsd.length) {
      const decs = await client.multicall({
        contracts: nonUsd.map((v) => ({ address: v.uoa, abi: erc20Abi, functionName: "decimals" as const })),
        allowFailure: true,
      });
      nonUsd.forEach((v, i) => (v.uoaDecimals = Number(decs[i].result ?? 18)));
    }
    return top;
  }

  protected async fetchMarkets(): Promise<Market[]> {
    const client = getClient(this.chainId);
    const vaults = await this.debtVaults();
    if (vaults.length === 0) return [];

    const lists = await client.multicall({
      contracts: vaults.map((v) => ({ address: v.vault, abi: EVAULT_ABI, functionName: "LTVList" as const })),
      allowFailure: false,
    });
    const pairs = vaults.flatMap((v, i) => lists[i].map((collateralVault) => ({ v, collateralVault })));
    const cfg = await client.multicall({
      contracts: pairs.flatMap(({ v, collateralVault }) => [
        { address: v.vault, abi: EVAULT_ABI, functionName: "LTVBorrow" as const, args: [collateralVault] as const },
        { address: v.vault, abi: EVAULT_ABI, functionName: "LTVLiquidation" as const, args: [collateralVault] as const },
        { address: collateralVault, abi: EVAULT_ABI, functionName: "asset" as const },
      ]),
      allowFailure: true,
    });
    const rows = pairs
      .map((p, i) => ({ ...p, ltv: cfg[i * 3].result as number | undefined, lt: cfg[i * 3 + 1].result as number | undefined, asset: cfg[i * 3 + 2].result as Address | undefined }))
      .filter((r): r is typeof r & { ltv: number; lt: number; asset: Address } => r.ltv !== undefined && r.lt !== undefined && !!r.asset && r.ltv > 0);

    const tokens = await this.tokenMeta([...rows.map((r) => r.asset), USDC[this.chainId]]);
    const debt = tokens.get(USDC[this.chainId].toLowerCase())!;
    const quotes = await client.multicall({
      contracts: [
        ...rows.map((r) => {
          const t = tokens.get(r.asset.toLowerCase())!;
          return { address: r.v.oracle, abi: EULER_ROUTER_ABI, functionName: "getQuote" as const, args: [10n ** BigInt(t.decimals), r.asset, r.v.uoa] as const };
        }),
        ...vaults.map((v) => ({ address: v.oracle, abi: EULER_ROUTER_ABI, functionName: "getQuote" as const, args: [10n ** BigInt(debt.decimals), USDC[this.chainId], v.uoa] as const })),
      ],
      allowFailure: true,
    });
    const debtPrice = new Map(vaults.map((v, i) => [v.vault, Number((quotes[rows.length + i].result as bigint | undefined) ?? 0n) / 10 ** v.uoaDecimals]));

    const now = Date.now();
    const best = new Map<string, Market>();
    this.vaultOf.clear();
    rows.forEach((r, i) => {
      const q = quotes[i].result as bigint | undefined;
      const debtPriceUsd = debtPrice.get(r.v.vault) ?? 0;
      if (q === undefined || debtPriceUsd === 0) return;
      const collateral = tokens.get(r.asset.toLowerCase())!;
      const room = r.v.borrowCap === null ? r.v.cash : r.v.borrowCap > r.v.borrows ? (r.v.borrowCap - r.v.borrows < r.v.cash ? r.v.borrowCap - r.v.borrows : r.v.cash) : 0n;
      let status: MarketStatus = "active";
      if (r.v.borrowCap !== null && r.v.borrows >= r.v.borrowCap) status = "frozen";
      const m: Market = {
        id: `${this.id}:${this.chainId}:${r.v.vault}:${r.collateralVault}`,
        protocol: this.id,
        chainId: this.chainId,
        collateral,
        debt,
        ltv: r.ltv / BPS,
        liquidationThreshold: r.lt / BPS,
        liquidationPenalty: r.v.maxDiscount,
        collateralPriceUsd: Number(q) / 10 ** r.v.uoaDecimals,
        debtPriceUsd,
        availableLiquidity: room,
        status,
        fetchedAt: now,
      };
      const key = collateral.address.toLowerCase();
      const cur = best.get(key);
      if (!cur || m.availableLiquidity > cur.availableLiquidity || (m.availableLiquidity === cur.availableLiquidity && m.ltv > cur.ltv)) {
        best.set(key, m);
      }
    });
    for (const m of best.values()) this.vaultOf.set(m.id, m.id.split(":")[2] as Address);
    return [...best.values()];
  }

  protected async fetchRates(markets: Market[]): Promise<Rate[]> {
    const client = getClient(this.chainId);
    const vaults = [...new Set(markets.map((m) => this.vaultOf.get(m.id)).filter((v): v is Address => !!v))];
    const reads = await client.multicall({
      contracts: vaults.flatMap((address) => [
        { address, abi: EVAULT_ABI, functionName: "interestRate" as const },
        { address, abi: EVAULT_ABI, functionName: "interestFee" as const },
        { address, abi: EVAULT_ABI, functionName: "cash" as const },
        { address, abi: EVAULT_ABI, functionName: "totalBorrows" as const },
      ]),
      allowFailure: false,
    });
    const now = Date.now();
    const rate = new Map<Address, Rate>();
    vaults.forEach((v, i) => {
      const perSecond = Number(reads[i * 4] as bigint) / RAY;
      const fee = Number(reads[i * 4 + 1] as number) / BPS;
      const cash = Number(reads[i * 4 + 2] as bigint);
      const borrows = Number(reads[i * 4 + 3] as bigint);
      const apr = perSecond * SECONDS_PER_YEAR;
      const utilization = cash + borrows > 0 ? borrows / (cash + borrows) : null;
      rate.set(v, {
        marketId: "",
        borrowAprVariable: apr,
        borrowApyVariable: Math.exp(apr) - 1, // interest accrues every second
        supplyApr: utilization === null ? null : apr * utilization * (1 - fee),
        utilization,
        fetchedAt: now,
      });
    });
    return markets.flatMap((m) => {
      const r = rate.get(this.vaultOf.get(m.id)!);
      return r ? [{ ...r, marketId: m.id }] : [];
    });
  }

  protected async fetchPositions(address: Address): Promise<Position[]> {
    const client = getClient(this.chainId);
    const evc = { address: this.cfg.evc, abi: EVC_ABI } as const;
    const subs = Array.from({ length: SUB_ACCOUNTS }, (_, i) => subAccount(address, i));
    const controllers = await client.multicall({
      contracts: subs.map((account) => ({ ...evc, functionName: "getControllers" as const, args: [account] as const })),
      allowFailure: true,
    });
    const active = subs.map((account, i) => ({ account, i, controller: (controllers[i].result as readonly Address[] | undefined)?.[0] })).filter((a): a is typeof a & { controller: Address } => !!a.controller);
    if (active.length === 0) return [];

    const out: Position[] = [];
    for (const { account, i, controller } of active) {
      const v = { address: controller, abi: EVAULT_ABI } as const;
      const [debt, debtAsset, oracle, uoa, collaterals, [collateralValue, liabilityValue]] = await client.multicall({
        contracts: [
          { ...v, functionName: "debtOf", args: [account] },
          { ...v, functionName: "asset" },
          { ...v, functionName: "oracle" },
          { ...v, functionName: "unitOfAccount" },
          { ...evc, functionName: "getCollaterals", args: [account] },
          { ...v, functionName: "accountLiquidity", args: [account, true] },
        ],
        allowFailure: false,
      });
      const shares = await client.multicall({
        contracts: collaterals.flatMap((c) => [
          { address: c, abi: EVAULT_ABI, functionName: "balanceOf" as const, args: [account] as const },
          { address: c, abi: EVAULT_ABI, functionName: "asset" as const },
          { ...v, functionName: "LTVLiquidation" as const, args: [c] as const },
        ]),
        allowFailure: true,
      });
      const held = collaterals
        .map((c, k) => ({ vault: c, shares: shares[k * 3].result as bigint | undefined, asset: shares[k * 3 + 1].result as Address | undefined, lt: shares[k * 3 + 2].result as number | undefined }))
        .filter((h): h is typeof h & { shares: bigint; asset: Address; lt: number } => !!h.shares && h.shares > 0n && !!h.asset && h.lt !== undefined);
      if (debt === 0n && held.length === 0) continue;

      const tokens = await this.tokenMeta([debtAsset, ...held.map((h) => h.asset)]);
      const uoaDecimals = uoa.toLowerCase() === USD ? 18 : Number((await client.readContract({ address: uoa, abi: erc20Abi, functionName: "decimals" }).catch(() => 18)));
      const debtToken = tokens.get(debtAsset.toLowerCase())!;
      const amounts = await client.multicall({
        contracts: [
          ...held.map((h) => ({ address: h.vault, abi: EVAULT_ABI, functionName: "convertToAssets" as const, args: [h.shares] as const })),
          ...held.map((h) => ({ address: oracle, abi: EULER_ROUTER_ABI, functionName: "getQuote" as const, args: [10n ** BigInt(tokens.get(h.asset.toLowerCase())!.decimals), h.asset, uoa] as const })),
          { address: oracle, abi: EULER_ROUTER_ABI, functionName: "getQuote" as const, args: [10n ** BigInt(debtToken.decimals), debtAsset, uoa] as const },
        ],
        allowFailure: true,
      });
      const debtPrice = Number((amounts[held.length * 2].result as bigint | undefined) ?? 0n) / 10 ** uoaDecimals;
      const debtUsd = Number(formatUnits(debt, debtToken.decimals)) * debtPrice;

      const collateral: PositionLeg[] = [];
      const legs: CollateralLeg[] = [];
      held.forEach((h, k) => {
        const token = tokens.get(h.asset.toLowerCase())!;
        const amount = (amounts[k].result as bigint | undefined) ?? 0n;
        const priceUsd = Number((amounts[held.length + k].result as bigint | undefined) ?? 0n) / 10 ** uoaDecimals;
        const units = Number(formatUnits(amount, token.decimals));
        const lt = h.lt / BPS;
        collateral.push({ token, amount, usd: units * priceUsd, liquidationThreshold: lt });
        legs.push({ units, priceUsd, liquidationThreshold: lt, ltv: lt });
      });
      const hf = debtUsd > 0 ? healthFactor(legs, debtUsd) : null;
      const reported = liabilityValue > 0n ? Number(collateralValue) / Number(liabilityValue) : null;
      const notes = [`Euler sub-account ${i}${uoa.toLowerCase() !== USD ? ` · values quoted in the vault's unit of account, not USD` : ""}`];
      out.push({
        protocol: this.id,
        chainId: this.chainId,
        marketId: `${this.id}:${this.chainId}:${controller}`,
        collateral,
        debt: debt > 0n ? [{ token: debtToken, amount: debt, usd: debtUsd }] : [],
        healthFactor: hf,
        healthFactorReported: reported,
        liquidationPrices: collateral.map((l, k) => ({ token: l.token, priceUsd: debtUsd > 0 ? liquidationPrice(legs, debtUsd, k) : 0 })),
        uniformDrawdownToLiquidation: hf !== null && Number.isFinite(hf) ? uniformDrawdown(hf) : null,
        notes,
        fetchedAt: Date.now(),
      });
    }
    return out;
  }
}
