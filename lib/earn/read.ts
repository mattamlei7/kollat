import { erc20Abi, getAddress, parseAbi, type Address } from "viem";
import { getClient } from "../chains";
import { USDC } from "../protocols/addresses";
import { DESTINATIONS, EXPLORER, idOf, type Destination, type EarnChain } from "./registry";
import type { EarnSnapshot, EarnToken, Opportunity } from "./types";

/** Server-side reads of every configured destination. A failed read leaves fields null and records why. */

const SECONDS_PER_YEAR = 31_536_000;
const RAY = 10n ** 27n;
const MORPHO_API = "https://blue-api.morpho.org/graphql";
/** Any address works for maxDeposit; none of these vaults gate deposits by depositor. */
const PROBE = "0x0000000000000000000000000000000000000001";
/** Vault caps this large (sums of uint184 market caps) are no practical limit. */
const capOf = (max: bigint) => (max > 10n ** 30n ? "unlimited" : max.toString());

const DATA_PROVIDER_ABI = parseAbi([
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
  "function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
  "function getReserveCaps(address asset) view returns (uint256 borrowCap, uint256 supplyCap)",
  "function getPaused(address asset) view returns (bool)",
  "function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
]);
const VAULT_ABI = parseAbi([
  "function maxDeposit(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function asset() view returns (address)",
  "function psm() view returns (address)",
  "function susds() view returns (address)",
]);
const SAVINGS_ABI = parseAbi([
  "function ssr() view returns (uint256)",
  "function pocket() view returns (address)",
  "function tin() view returns (uint256)",
  "function tout() view returns (uint256)",
  "function rateProvider() view returns (address)",
  "function getSSR() view returns (uint256)",
]);

/** Per-second compounding of a ray-denominated APR (Aave liquidity rate). */
const aprToApy = (apr: number) => Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
/** A per-second ray growth factor (Sky Savings Rate) as an APY. */
const perSecondToApy = (ssr: bigint) => Math.pow(Number(ssr) / 1e27, SECONDS_PER_YEAR) - 1;
const usdcOf = (chainId: EarnChain): EarnToken => ({ address: USDC[chainId], symbol: "USDC", decimals: 6 });
const message = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e)).slice(0, 200);

function blank(d: Destination): Opportunity {
  const base = { id: idOf(d), chainId: d.chainId, asset: usdcOf(d.chainId), baseApy: null, rewards: null, fees: null, capacity: null, liquidity: null,
    status: "unknown" as const, allocations: null, fetchedAt: null, error: null };
  const explorer = (a: Address) => `${EXPLORER[d.chainId]}/address/${a}`;
  switch (d.product) {
    case "aave-supply":
    case "sparklend-supply": {
      const spark = d.product === "sparklend-supply";
      return { ...base, product: d.product, protocol: spark ? "Spark" : "Aave", name: spark ? "SparkLend USDC market" : "Aave v3 USDC market", operator: spark ? "SparkDAO governance" : "Aave governance",
        receipt: { address: d.aToken ?? d.pool, symbol: spark ? "spUSDC" : "aUSDC", decimals: 6, kind: "interest-bearing token" }, target: d.pool, rateKind: "variable",
        withdrawal: "Withdraw any time, up to the USDC not currently lent out by the pool.",
        usedFor: `Lent to ${spark ? "SparkLend" : "Aave"} borrowers, who post other crypto as collateral.`,
        exposure: `Your USDC is pooled and lent to borrowers. If a borrower's collateral falls faster than liquidations can cover, the pool can take a loss.`,
        conversion: null, docsUrl: spark ? "https://docs.spark.fi" : "https://aave.com/docs", explorerUrl: explorer(d.pool) };
    }
    case "spark-savings":
      return { ...base, product: d.product, protocol: "Spark", name: "Spark USDC Vault (sUSDC)", operator: "Spark / Sky governance",
        receipt: { address: d.vault, symbol: "sUSDC", decimals: 18, kind: "vault shares" }, target: d.vault, rateKind: "governance-set",
        withdrawal: "Withdraw any time, up to the USDC held by Spark's conversion module (PSM).",
        usedFor: "Converted to USDS and deposited in sUSDS, which earns the Sky Savings Rate set by Sky governance.",
        exposure: "While deposited you hold USDS (Sky's stablecoin), not USDC. Getting USDC back depends on the PSM holding enough USDC and on USDS holding its peg.",
        conversion: "USDC → USDS → sUSDS on deposit, and back to USDC on withdrawal, through Spark's PSM.",
        docsUrl: "https://docs.spark.fi", explorerUrl: explorer(d.vault) };
    case "morpho-vault":
      return { ...base, product: d.product, protocol: "Morpho", name: d.name, operator: d.curator,
        receipt: { address: d.vault, symbol: "shares", decimals: 18, kind: "vault shares" }, target: d.vault, rateKind: "variable",
        withdrawal: "Withdraw any time, up to the USDC not currently borrowed from the vault's markets.",
        usedFor: `Allocated by ${d.curator} across Morpho lending markets, where borrowers post other crypto as collateral.`,
        exposure: `This vault allocates USDC across lending markets selected by its curator. Your USDC is lent against the collateral listed below, and the curator can change the allocation within the vault's configured limits.`,
        conversion: null, docsUrl: "https://docs.morpho.org", explorerUrl: explorer(d.vault) };
  }
}

async function readPool(d: Extract<Destination, { product: "aave-supply" | "sparklend-supply" }>, o: Opportunity): Promise<Opportunity> {
  const c = getClient(d.chainId);
  const asset = USDC[d.chainId];
  const dp = { address: d.dataProvider, abi: DATA_PROVIDER_ABI } as const;
  const [data, cfg, caps, paused, tokens] = await c.multicall({
    contracts: [
      { ...dp, functionName: "getReserveData", args: [asset] },
      { ...dp, functionName: "getReserveConfigurationData", args: [asset] },
      { ...dp, functionName: "getReserveCaps", args: [asset] },
      { ...dp, functionName: "getPaused", args: [asset] },
      { ...dp, functionName: "getReserveTokensAddresses", args: [asset] },
    ],
    allowFailure: false,
  });
  const aToken = tokens[0];
  const liquidity = await c.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [aToken] });
  const [, accruedScaled, totalAToken, , , liquidityRate, , , , liquidityIndex] = data;
  const supplyCap = caps[1];
  // Aave checks (scaled supply + treasury accrual) × index against the cap, in whole tokens.
  const supplied = totalAToken + (accruedScaled * liquidityIndex) / RAY;
  const capUnits = supplyCap * 10n ** BigInt(o.asset.decimals);
  const reserveFactor = Number(cfg[4]) / 100;
  return {
    ...o,
    receipt: { ...o.receipt, address: aToken },
    baseApy: aprToApy(Number(liquidityRate) / 1e27),
    // Aave Merit / Spark rewards are separate programs Kollat does not read yet.
    rewards: null,
    fees: [{ label: "Reserve factor", value: `${reserveFactor}% of borrower interest goes to the ${o.protocol === "Spark" ? "SparkLend" : "Aave"} treasury. The rate shown is already after it.` }],
    capacity: supplyCap === 0n ? "unlimited" : (capUnits > supplied ? capUnits - supplied : 0n).toString(),
    liquidity: liquidity.toString(),
    status: !cfg[8] ? "paused" : paused ? "paused" : cfg[9] ? "frozen" : "active",
    fetchedAt: Date.now(), // a live read; the rate updates whenever the reserve is touched
  };
}

async function readSavings(d: Extract<Destination, { product: "spark-savings" }>, o: Opportunity): Promise<Opportunity> {
  const c = getClient(d.chainId);
  const [psm, maxDeposit] = await Promise.all([
    c.readContract({ address: d.vault, abi: VAULT_ABI, functionName: "psm" }),
    c.readContract({ address: d.vault, abi: VAULT_ABI, functionName: "maxDeposit", args: [PROBE] }),
  ]);
  const p = { address: psm, abi: SAVINGS_ABI } as const;
  let ssr: bigint, pocket: Address, fees: Opportunity["fees"];
  if (d.chainId === 1) {
    // Mainnet: a LitePSM wrapper (USDC ↔ USDS, fees tin/tout in WAD) feeding sUSDS, whose ssr() is the rate.
    const susds = await c.readContract({ address: d.vault, abi: VAULT_ABI, functionName: "susds" });
    const [rate, pk, tin, tout] = await c.multicall({ contracts: [
      { address: susds, abi: SAVINGS_ABI, functionName: "ssr" }, { ...p, functionName: "pocket" }, { ...p, functionName: "tin" }, { ...p, functionName: "tout" },
    ], allowFailure: false });
    ssr = rate; pocket = pk;
    const pct = (w: bigint) => `${Number(w) / 1e16}%`;
    fees = [{ label: "Conversion fee in", value: pct(tin) }, { label: "Conversion fee out", value: pct(tout) }, { label: "Vault fee", value: "None; the rate shown is the Sky Savings Rate." }];
  } else {
    // L2: PSM3 swaps USDC for sUSDS at the rate its oracle reports; the oracle relays mainnet's ssr.
    const [rateProvider, pk] = await c.multicall({ contracts: [{ ...p, functionName: "rateProvider" }, { ...p, functionName: "pocket" }], allowFailure: false });
    ssr = await c.readContract({ address: rateProvider, abi: SAVINGS_ABI, functionName: "getSSR" });
    pocket = pk;
    fees = [{ label: "Vault fee", value: "None; the rate shown is the Sky Savings Rate relayed to this network." }, { label: "Conversion fee", value: "Not exposed by PSM3; not shown." }];
  }
  const liquidity = await c.readContract({ address: USDC[d.chainId], abi: erc20Abi, functionName: "balanceOf", args: [pocket] });
  return { ...o, baseApy: perSecondToApy(ssr), rewards: [], fees, capacity: capOf(maxDeposit), liquidity: liquidity.toString(), status: maxDeposit === 0n ? "paused" : "active", fetchedAt: Date.now() };
}

interface MorphoVault {
  address: string;
  symbol: string;
  chain: { id: number };
  state: { netApyExcludingRewards: number | null; fee: number | null; timestamp: number; curators: { name: string }[]; allRewards: { asset: { symbol: string }; supplyApr: number | null }[] | null;
    allocation: { supplyAssetsUsd: number | null; market: { collateralAsset: { symbol: string } | null } }[] };
  liquidity: { underlying: string | number } | null;
}

async function readMorpho(ds: Extract<Destination, { product: "morpho-vault" }>[]): Promise<Map<string, MorphoVault>> {
  const query = `{ vaults(first: 50, where: { address_in: ${JSON.stringify(ds.map((d) => d.vault))}, chainId_in: ${JSON.stringify([...new Set(ds.map((d) => d.chainId))])} }) { items {
    address symbol chain { id } state { netApyExcludingRewards fee timestamp curators { name } allRewards { asset { symbol } supplyApr } allocation { supplyAssetsUsd market { collateralAsset { symbol } } } } liquidity { underlying } } } }`;
  const res = await fetch(MORPHO_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Morpho API ${res.status}`);
  const json = (await res.json()) as { data?: { vaults: { items: MorphoVault[] } }; errors?: { message: string }[] };
  if (!json.data) throw new Error(json.errors?.[0]?.message ?? "Morpho API returned no data");
  return new Map(json.data.vaults.items.map((v) => [`${v.chain.id}:${v.address.toLowerCase()}`, v]));
}

function fromMorpho(o: Opportunity, v: MorphoVault | undefined, maxDeposit: bigint | null): Opportunity {
  if (!v) return { ...o, error: "Morpho's API did not return this vault." };
  const s = v.state;
  const total = s.allocation.reduce((a, x) => a + (x.supplyAssetsUsd ?? 0), 0);
  const byCollateral = new Map<string, number>();
  for (const a of s.allocation) {
    if (!a.supplyAssetsUsd) continue;
    const label = a.market.collateralAsset?.symbol ?? "Idle (not lent)";
    byCollateral.set(label, (byCollateral.get(label) ?? 0) + a.supplyAssetsUsd);
  }
  return {
    ...o,
    receipt: { ...o.receipt, symbol: v.symbol },
    operator: s.curators[0]?.name ?? o.operator,
    // Morpho reports the vault's yield net of its performance fee; it is not reduced again here.
    baseApy: s.netApyExcludingRewards,
    rewards: (s.allRewards ?? []).filter((r) => (r.supplyApr ?? 0) > 0).map((r) => ({ token: r.asset.symbol, apr: r.supplyApr! })),
    fees: [{ label: "Performance fee", value: s.fee === null ? "Unavailable" : `${Math.round(s.fee * 1000) / 10}% of interest earned, taken by the vault. The rate shown is already after it.` }],
    capacity: maxDeposit === null ? null : capOf(maxDeposit),
    liquidity: v.liquidity ? BigInt(Math.floor(Number(v.liquidity.underlying))).toString() : null,
    status: maxDeposit === 0n ? "paused" : "active",
    allocations: total > 0 ? [...byCollateral].map(([label, usd]) => ({ label, share: usd / total })).sort((a, b) => b.share - a.share) : null,
    fetchedAt: s.timestamp * 1000,
  };
}

export async function readEarn(chains: readonly number[]): Promise<EarnSnapshot> {
  const ds = DESTINATIONS.filter((d) => chains.includes(d.chainId));
  const failures: EarnSnapshot["failures"] = [];
  const fail = (source: string, chainId: number, e: unknown) => { failures.push({ source, chainId, message: message(e) }); return message(e); };

  const morphos = ds.filter((d): d is Extract<Destination, { product: "morpho-vault" }> => d.product === "morpho-vault");
  const [api, maxDeposits] = await Promise.all([
    morphos.length ? readMorpho(morphos).catch((e) => e as Error) : Promise.resolve(new Map<string, MorphoVault>()),
    Promise.all(morphos.map((d) => getClient(d.chainId).readContract({ address: d.vault, abi: VAULT_ABI, functionName: "maxDeposit", args: [PROBE] }).catch(() => null))),
  ]);
  if (api instanceof Error) for (const chainId of new Set(morphos.map((d) => d.chainId))) fail("Morpho API", chainId, api);

  const opportunities = await Promise.all(ds.map(async (d) => {
    const o = blank(d);
    try {
      if (d.product === "morpho-vault") {
        if (api instanceof Error) return { ...o, error: `Rates unavailable: ${message(api)}` };
        return fromMorpho(o, api.get(`${d.chainId}:${getAddress(d.vault).toLowerCase()}`), maxDeposits[morphos.indexOf(d)]);
      }
      return d.product === "spark-savings" ? await readSavings(d, o) : await readPool(d, o);
    } catch (e) {
      return { ...o, error: fail(o.protocol === "Aave" ? "Aave" : o.product === "spark-savings" ? "Spark Savings" : "SparkLend", d.chainId, e) };
    }
  }));
  return { opportunities, failures, fetchedAt: Date.now() };
}
