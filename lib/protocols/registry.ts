import * as AB from "@bgd-labs/aave-address-book";
import type { Address } from "viem";
import { AaveV3Adapter } from "./aave-v3";
import { COMET_USDC, EULER_EVC, FLUID_CHAINS, MOONWELL_COMPTROLLER, MORPHO_BLUE, SPARK_ETHEREUM, USDC } from "./addresses";
import { CompoundV3Adapter } from "./compound-v3";
import { EulerV2Adapter } from "./euler-v2";
import { FluidAdapter } from "./fluid";
import { MoonwellAdapter } from "./moonwell";
import { MorphoBlueAdapter } from "./morpho-blue";
import type { ChainId, LendingProtocol, ProtocolId } from "./types";

type AaveBook = Record<"POOL" | "POOL_ADDRESSES_PROVIDER" | "UI_POOL_DATA_PROVIDER" | "AAVE_PROTOCOL_DATA_PROVIDER", Address>;

/** Aave v3 deployments from the address book, keyed by chain. All run the v3.3+ UiPoolDataProvider. */
const AAVE: Partial<Record<ChainId, AaveBook>> = {
  1: AB.AaveV3Ethereum,
  8453: AB.AaveV3Base,
  42161: AB.AaveV3Arbitrum,
  10: AB.AaveV3Optimism,
  137: AB.AaveV3Polygon,
  43114: AB.AaveV3Avalanche,
};

function aave(chainId: ChainId, book: AaveBook) {
  return new AaveV3Adapter({
    id: "aave-v3",
    name: "Aave v3",
    chainId,
    pool: book.POOL,
    addressesProvider: book.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: book.UI_POOL_DATA_PROVIDER,
    protocolDataProvider: book.AAVE_PROTOCOL_DATA_PROVIDER,
    uiProviderVariant: "v3.3",
    debtTokens: [USDC[chainId]],
  });
}

const entries = <T>(rec: Partial<Record<ChainId, T>>) =>
  Object.entries(rec).map(([k, v]) => [Number(k) as ChainId, v as T] as const);

/**
 * The only place that knows which adapters exist.
 * Adding a protocol = one adapter file + one entry here.
 */
export const PROTOCOLS: LendingProtocol[] = [
  ...entries(AAVE).map(([chainId, book]) => aave(chainId, book)),
  new AaveV3Adapter({
    id: "spark",
    name: "Spark",
    chainId: 1,
    pool: SPARK_ETHEREUM.POOL,
    addressesProvider: SPARK_ETHEREUM.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: SPARK_ETHEREUM.UI_POOL_DATA_PROVIDER,
    protocolDataProvider: SPARK_ETHEREUM.PROTOCOL_DATA_PROVIDER,
    uiProviderVariant: "v3.0",
    debtTokens: [USDC[1]],
  }),
  ...entries(COMET_USDC).map(([chainId, comet]) => new CompoundV3Adapter({ chainId, comet })),
  ...entries(MORPHO_BLUE).map(([chainId]) => new MorphoBlueAdapter(chainId)),
  ...FLUID_CHAINS.map((chainId) => new FluidAdapter(chainId)),
  ...entries(EULER_EVC).map(([chainId, evc]) => new EulerV2Adapter({ chainId, evc })),
  ...entries(MOONWELL_COMPTROLLER).map(([chainId, comptroller]) => new MoonwellAdapter({ chainId, comptroller })),
];

export const PROTOCOL_META: Record<ProtocolId, { name: string; closeFactor: number; url: string }> = {
  "aave-v3": { name: "Aave v3", closeFactor: 0.5, url: "https://app.aave.com" },
  spark: { name: "Spark", closeFactor: 0.5, url: "https://app.spark.fi" },
  "compound-v3": { name: "Compound v3", closeFactor: 1, url: "https://app.compound.finance" },
  "morpho-blue": { name: "Morpho", closeFactor: 1, url: "https://app.morpho.org" },
  fluid: { name: "Fluid", closeFactor: 1, url: "https://fluid.io" },
  "euler-v2": { name: "Euler", closeFactor: 1, url: "https://app.euler.finance" },
  moonwell: { name: "Moonwell", closeFactor: 0.5, url: "https://moonwell.fi" },
};

export function protocolsFor(chainId: ChainId): LendingProtocol[] {
  return PROTOCOLS.filter((p) => p.chainId === chainId);
}
