import { AaveV3Base, AaveV3Ethereum } from "@bgd-labs/aave-address-book";
import { AaveV3Adapter } from "./aave-v3";
import { COMET_USDC, SPARK_ETHEREUM } from "./addresses";
import { CompoundV3Adapter } from "./compound-v3";
import { MorphoBlueAdapter } from "./morpho-blue";
import type { ChainId, LendingProtocol, ProtocolId } from "./types";

/**
 * The only place that knows which adapters exist.
 * Adding a protocol = one adapter file + one entry here.
 */
export const PROTOCOLS: LendingProtocol[] = [
  new AaveV3Adapter({
    id: "aave-v3",
    name: "Aave v3",
    chainId: 1,
    pool: AaveV3Ethereum.POOL,
    addressesProvider: AaveV3Ethereum.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: AaveV3Ethereum.UI_POOL_DATA_PROVIDER,
    protocolDataProvider: AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER,
    uiProviderVariant: "v3.3",
    debtSymbols: ["USDC"],
  }),
  new AaveV3Adapter({
    id: "aave-v3",
    name: "Aave v3",
    chainId: 8453,
    pool: AaveV3Base.POOL,
    addressesProvider: AaveV3Base.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: AaveV3Base.UI_POOL_DATA_PROVIDER,
    protocolDataProvider: AaveV3Base.AAVE_PROTOCOL_DATA_PROVIDER,
    uiProviderVariant: "v3.3",
    debtSymbols: ["USDC"],
  }),
  new AaveV3Adapter({
    id: "spark",
    name: "Spark",
    chainId: 1,
    pool: SPARK_ETHEREUM.POOL,
    addressesProvider: SPARK_ETHEREUM.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: SPARK_ETHEREUM.UI_POOL_DATA_PROVIDER,
    protocolDataProvider: SPARK_ETHEREUM.PROTOCOL_DATA_PROVIDER,
    uiProviderVariant: "v3.0",
    debtSymbols: ["USDC"],
  }),
  new CompoundV3Adapter({ chainId: 1, comet: COMET_USDC[1] }),
  new CompoundV3Adapter({ chainId: 8453, comet: COMET_USDC[8453] }),
  new MorphoBlueAdapter(1),
  new MorphoBlueAdapter(8453),
];

export const PROTOCOL_META: Record<ProtocolId, { name: string; closeFactor: number; url: string }> = {
  "aave-v3": { name: "Aave v3", closeFactor: 0.5, url: "https://app.aave.com" },
  spark: { name: "Spark", closeFactor: 0.5, url: "https://app.spark.fi" },
  "compound-v3": { name: "Compound v3", closeFactor: 1, url: "https://app.compound.finance" },
  "morpho-blue": { name: "Morpho", closeFactor: 1, url: "https://app.morpho.org" },
};

export function protocolsFor(chainId: ChainId): LendingProtocol[] {
  return PROTOCOLS.filter((p) => p.chainId === chainId);
}
