import { erc20Abi, type Address } from "viem";
import { getClient } from "./chains";
import type { ChainId } from "./protocols/types";

export const WETH: Record<ChainId, Address> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  8453: "0x4200000000000000000000000000000000000006",
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
    erc20.set(unique[i], r.status === "success" ? (r.result as bigint) : 0n);
  });
  return { erc20, native };
}
