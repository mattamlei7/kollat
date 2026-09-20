import { erc20Abi, type Address } from "viem";
import { getClient } from "./chains";
import type { ChainId } from "./protocols/types";

/** Wrapped native token per chain (WETH, WPOL, WAVAX). A wallet's native balance counts toward this market. */
export const WNATIVE: Record<ChainId, Address> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  8453: "0x4200000000000000000000000000000000000006",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  10: "0x4200000000000000000000000000000000000006",
  137: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
};

/**
 * ERC-20 balances for a list of tokens plus the native balance, in one
 * multicall. Returns base units keyed by lower-cased token address.
 */
export async function getTokenBalances(
  chainId: ChainId,
  owner: Address,
  tokens: Address[],
): Promise<{ erc20: Map<string, bigint>; native: bigint }> {
  const client = getClient(chainId);
  const unique = [...new Set(tokens.map((t) => t.toLowerCase() as Address))];
  const [results, native] = await Promise.all([
    unique.length
      ? client.multicall({
          contracts: unique.map((address) => ({
            address,
            abi: erc20Abi,
            functionName: "balanceOf" as const,
            args: [owner] as const,
          })),
          allowFailure: true,
        })
      : Promise.resolve([]),
    client.getBalance({ address: owner }),
  ]);
  const erc20 = new Map<string, bigint>();
  results.forEach((r, i) => {
    // A failed read is not an empty wallet.
    if (r.status !== "success") throw new Error(`balanceOf(${unique[i]}) failed: ${r.error.message}`);
    erc20.set(unique[i], r.result as bigint);
  });
  return { erc20, native };
}
