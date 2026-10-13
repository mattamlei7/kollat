import { AaveV3Arbitrum, AaveV3Base, AaveV3Ethereum } from "@bgd-labs/aave-address-book";
import { getAddress, type Address } from "viem";
import { SPARK_ETHEREUM, USDC } from "../protocols/addresses";

/**
 * The deposit destinations Kollat lists, configured explicitly and checked on-chain (2026-10-13):
 * asset() of every vault is the chain's native USDC; Aave/SparkLend reserves are active and not frozen.
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
  | { product: "morpho-vault"; chainId: EarnChain; vault: Address; name: string; curator: string }
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
  // Curated Morpho vaults: the largest listed USDC vaults per chain by assets (Morpho API, 2026-10-13).
  { product: "morpho-vault", chainId: 1, vault: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB", name: "Steakhouse USDC", curator: "Steakhouse Financial" },
  { product: "morpho-vault", chainId: 1, vault: "0xdd0f28e19C1780eb6396170735D45153D261490d", name: "Gauntlet USDC Prime", curator: "Gauntlet" },
  { product: "morpho-vault", chainId: 8453, vault: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61", name: "Gauntlet USDC Prime", curator: "Gauntlet" },
  { product: "morpho-vault", chainId: 8453, vault: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183", name: "Steakhouse USDC", curator: "Steakhouse Financial" },
  { product: "morpho-vault", chainId: 8453, vault: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A", name: "Spark USDC Vault", curator: "SparkDAO" },
];

export const targetOf = (d: Destination): Address => ("pool" in d ? d.pool : d.vault);
export const idOf = (d: Destination) => `${d.product}:${d.chainId}:${targetOf(d).toLowerCase()}`;
