import { AaveV3Arbitrum, AaveV3Base, AaveV3Ethereum } from "@bgd-labs/aave-address-book";
import { getAddress, type Address } from "viem";
import { COMET_USDC, SPARK_ETHEREUM, USDC } from "../protocols/addresses";

/**
 * The deposit destinations Kollat lists, configured explicitly and checked on-chain (2026-10-13, additions 2026-10-14):
 * asset() of every vault and baseToken() of every Comet is the chain's native USDC; Aave/SparkLend reserves are active
 * and not frozen; deposits are open (maxDeposit > 0, Comet supply not paused). Bridged USDC (USDC.e, USDbC) is never listed.
 * Adding a destination means adding it here, after the same checks and a fork lifecycle test.
 */

export const EARN_CHAINS = [1, 8453, 42161] as const;
export type EarnChain = (typeof EARN_CHAINS)[number];

export const EXPLORER: Record<EarnChain, string> = { 1: "https://etherscan.io", 8453: "https://basescan.org", 42161: "https://arbiscan.io" };

interface AaveBook { POOL: string; AAVE_PROTOCOL_DATA_PROVIDER: string; ASSETS: Record<string, { UNDERLYING: string; A_TOKEN: string }> }

/** The book entry whose underlying is native USDC (Arbitrum's "USDC" key is bridged USDC.e). */
function aaveUsdc(book: AaveBook, chainId: EarnChain) {
  const usdc = USDC[chainId].toLowerCase();
  const asset = Object.values(book.ASSETS).find((a) => a.UNDERLYING.toLowerCase() === usdc);
  if (!asset) throw new Error(`No native USDC reserve in the Aave book for chain ${chainId}`);
  return { pool: getAddress(book.POOL), dataProvider: getAddress(book.AAVE_PROTOCOL_DATA_PROVIDER), aToken: getAddress(asset.A_TOKEN) };
}

export type Destination =
  | { product: "aave-supply" | "sparklend-supply"; chainId: EarnChain; pool: Address; dataProvider: Address; aToken: Address | null }
  | { product: "compound-supply"; chainId: EarnChain; comet: Address }
  | { product: "morpho-vault"; chainId: EarnChain; vault: Address; name: string; curator: string }
  | { product: "euler-vault"; chainId: EarnChain; vault: Address; name: string; curator: string }
  | { product: "fluid-lending"; chainId: EarnChain; vault: Address }
  | { product: "spark-savings"; chainId: EarnChain; vault: Address };

const aave = (chainId: EarnChain, book: AaveBook): Destination => ({ product: "aave-supply", chainId, ...aaveUsdc(book, chainId) });

export const DESTINATIONS: Destination[] = [
  aave(1, AaveV3Ethereum as unknown as AaveBook),
  aave(8453, AaveV3Base as unknown as AaveBook),
  aave(42161, AaveV3Arbitrum as unknown as AaveBook),
  // SparkLend is an Aave v3 fork; its spUSDC address is read from the data provider.
  { product: "sparklend-supply", chainId: 1, pool: SPARK_ETHEREUM.POOL, dataProvider: SPARK_ETHEREUM.PROTOCOL_DATA_PROVIDER, aToken: null },
  // Spark Savings "Spark USDC Vault" (sUSDC): USDC is converted to USDS and held as sUSDS, earning the Sky Savings Rate.
  { product: "spark-savings", chainId: 1, vault: "0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE" },
  { product: "spark-savings", chainId: 8453, vault: "0x3128a0F7f0ea68E7B7c9B00AFa7E41045828e858" },
  { product: "spark-savings", chainId: 42161, vault: "0x940098b108fB7D0a7E374f6eDED7760787464609" },
  // Compound v3 cUSDCv3: USDC is the Comet's base asset, so a supply earns the base supply rate.
  ...([1, 8453, 42161] as const).map((chainId): Destination => ({ product: "compound-supply", chainId, comet: COMET_USDC[chainId]! })),
  // Moonwell is not listed: its only native-USDC market here (Base mUSDC) had no cash and a 1-wei borrow cap on
  // 2026-10-14, so a deposit could not be withdrawn. Moonwell has no Ethereum or Arbitrum deployment.
  // Fluid fUSDC lending tokens (fluid-contracts-public deployments.md): ERC-4626 over Fluid's shared liquidity layer.
  { product: "fluid-lending", chainId: 1, vault: "0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33" },
  { product: "fluid-lending", chainId: 8453, vault: "0xf42f5795D9ac7e9D757dB633D693cD548Cfd9169" },
  { product: "fluid-lending", chainId: 42161, vault: "0x1A996cb54bb95462040408C06122D45D6Cdb6096" },
  // Euler v2 (EVK, ERC-4626). Only Ethereum has a governed USDC lending vault of meaningful size (≥ $1M supplied, no
  // deposit hook); Base and Arbitrum USDC vaults were all under $0.5M on 2026-10-14. Name and curator: Euler labels.
  { product: "euler-vault", chainId: 1, vault: "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9", name: "K3 Capital Prime Market", curator: "K3 Capital" },
  // Curated Morpho vaults: the largest listed USDC vaults per chain by assets (Morpho API, 2026-10-13).
  { product: "morpho-vault", chainId: 1, vault: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB", name: "Steakhouse USDC", curator: "Steakhouse Financial" },
  { product: "morpho-vault", chainId: 1, vault: "0xdd0f28e19C1780eb6396170735D45153D261490d", name: "Gauntlet USDC Prime", curator: "Gauntlet" },
  { product: "morpho-vault", chainId: 8453, vault: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61", name: "Gauntlet USDC Prime", curator: "Gauntlet" },
  { product: "morpho-vault", chainId: 8453, vault: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183", name: "Steakhouse USDC", curator: "Steakhouse Financial" },
  { product: "morpho-vault", chainId: 8453, vault: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A", name: "Spark USDC Vault", curator: "SparkDAO" },
  // Added 2026-10-14, reviewed by hand rather than by rank: listed, identifiable curator, blue-chip collateral
  // (BTC / ETH wrappers), no deposit restriction. Passed over: PT- and RWA-heavy vaults, single unknown curators, a
  // vault 96% in a PT expiring 2026-10-15 (Arbitrum Steakhouse High Yield), and near-duplicates from one curator.
  { product: "morpho-vault", chainId: 1, vault: "0x68Aea7b82Df6CcdF76235D46445Ed83f85F845A3", name: "Yearn USDC", curator: "Yearn" },
  { product: "morpho-vault", chainId: 1, vault: "0x56A76b428244a50513ec81e225a293d128fd581D", name: "Spark Blue Chip USDC Vault", curator: "SparkDAO" },
  { product: "morpho-vault", chainId: 8453, vault: "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2", name: "Steakhouse Prime USDC", curator: "Steakhouse Financial" },
  { product: "morpho-vault", chainId: 8453, vault: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca", name: "Moonwell Flagship USDC", curator: "Anthias Labs" },
  { product: "morpho-vault", chainId: 42161, vault: "0x7c574174DA4b2be3f705c6244B4BfA0815a8B3Ed", name: "Gauntlet USDC Prime", curator: "Gauntlet" },
];

export const targetOf = (d: Destination): Address => ("pool" in d ? d.pool : "comet" in d ? d.comet : d.vault);
export const idOf = (d: Destination) => `${d.product}:${d.chainId}:${targetOf(d).toLowerCase()}`;
