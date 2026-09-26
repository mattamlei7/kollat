import { AaveV3Arbitrum, AaveV3Avalanche, AaveV3Base, AaveV3Ethereum, AaveV3Optimism, AaveV3Polygon } from "@bgd-labs/aave-address-book";
import { COMET_USDC, MORPHO_BLUE, SPARK_ETHEREUM } from "../protocols/addresses";
import { aaveExecutor } from "./aave";
import type { Executor } from "./common";
import { compoundExecutor } from "./compound";
import { morphoExecutor } from "./morpho";

export type { Executor, PlanStep } from "./common";

const AAVE: Record<number, { POOL: `0x${string}`; AAVE_PROTOCOL_DATA_PROVIDER: `0x${string}` }> = {
  1: AaveV3Ethereum, 8453: AaveV3Base, 42161: AaveV3Arbitrum, 10: AaveV3Optimism, 137: AaveV3Polygon, 43114: AaveV3Avalanche,
};

/** The wallet flow for a protocol on a chain, or null where Kollat can only link out. */
export function executorFor(protocolId: string, chainId: number): Executor | null {
  if (protocolId === "morpho-blue") {
    const morpho = MORPHO_BLUE[chainId as keyof typeof MORPHO_BLUE];
    return morpho ? morphoExecutor(morpho) : null;
  }
  if (protocolId === "aave-v3" && AAVE[chainId]) return aaveExecutor(AAVE[chainId].POOL, AAVE[chainId].AAVE_PROTOCOL_DATA_PROVIDER, "Aave");
  if (protocolId === "compound-v3") {
    const comet = COMET_USDC[chainId as keyof typeof COMET_USDC];
    return comet ? compoundExecutor(comet) : null;
  }
  if (protocolId === "spark" && chainId === 1) return aaveExecutor(SPARK_ETHEREUM.POOL, SPARK_ETHEREUM.PROTOCOL_DATA_PROVIDER, "Spark");
  return null;
}
