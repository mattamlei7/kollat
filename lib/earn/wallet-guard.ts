import { createPublicClient, custom, type Address, type Chain, type EIP1193Provider, type PublicClient } from "viem";

/** Verify the account and actual fork, not just a chain ID shared with production. */
export async function assertEarnWallet(provider: EIP1193Provider, reader: PublicClient, chain: Chain, user: Address, fork: boolean, originChainId?: number) {
  if (fork && chain.id === originChainId) throw new Error("Configure a distinct local fork chain ID before executing. The fork must not share the production chain ID.");
  const accounts = await provider.request({ method: "eth_accounts" }) as Address[];
  if (accounts[0]?.toLowerCase() !== user.toLowerCase()) throw new Error("The connected wallet changed. Review again with the current account.");
  const chainId = await provider.request({ method: "eth_chainId" });
  if (Number(chainId) !== chain.id) throw new Error("The wallet network changed. Switch back and review again.");
  if (fork) {
    const block = await reader.getBlock();
    const walletReader = createPublicClient({ chain, transport: custom(provider) });
    const theirs = await walletReader.getBlock({ blockNumber: block.number });
    if (!block.hash || block.hash !== theirs.hash) throw new Error("Your wallet is not connected to the configured local fork. No transaction was sent.");
  }
}
