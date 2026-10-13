import { describe, expect, it } from "vitest";
import { mainnet } from "viem/chains";
import type { EIP1193Provider, PublicClient } from "viem";
import { assertEarnWallet } from "../lib/earn/wallet-guard";

const user = "0x0000000000000000000000000000000000000001";
function setup(account = user, chain = "0x1", hash = "0xabc") {
  const provider = { request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return [account];
    if (method === "eth_chainId") return chain;
    if (method === "eth_getBlockByNumber") return { number: "0x1", hash, transactions: [] };
    throw new Error(`Unexpected method ${method}`);
  } } as EIP1193Provider;
  const reader = { getBlock: async () => ({ number: 1n, hash: "0xabc" }) } as unknown as PublicClient;
  return { provider, reader };
}
describe("earn wallet execution guard", () => {
  it("requires a distinct fork chain ID even before the fork has mined a different block", async () => {
    const { provider, reader } = setup();
    await expect(assertEarnWallet(provider, reader, mainnet, user, true, 1)).rejects.toThrow(/distinct local fork chain ID/);
  });
  it("accepts the reviewed account on the matching fork", async () => {
    const { provider, reader } = setup();
    await expect(assertEarnWallet(provider, reader, mainnet, user, true)).resolves.toBeUndefined();
  });
  it("rejects an account change before another signing request", async () => {
    const { provider, reader } = setup("0x0000000000000000000000000000000000000002");
    await expect(assertEarnWallet(provider, reader, mainnet, user, false)).rejects.toThrow(/wallet changed/);
  });
  it("rejects a network change", async () => {
    const { provider, reader } = setup(user, "0x2105");
    await expect(assertEarnWallet(provider, reader, mainnet, user, false)).rejects.toThrow(/network changed/);
  });
  it("rejects the production chain even when its chain ID equals the fork's", async () => {
    const { provider, reader } = setup(user, "0x1", "0xdef");
    await expect(assertEarnWallet(provider, reader, mainnet, user, true)).rejects.toThrow(/local fork/);
  });
});
