import { codeToHtml } from "shiki";

/* Mirrors lib/protocols/aave-v3.ts: server-side reads, no signer anywhere. */
const SNIPPET = `import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { POOL_ABI, UI_POOL_DATA_PROVIDER_ABI } from "./abis";

// A public client can only read. There is no wallet, no signer, no sendTransaction.
const client = createPublicClient({ chain: mainnet, transport: http(process.env.RPC_URL_MAINNET) });

export async function quote(address: \`0x\${string}\`) {
  // 1. Account-level limits, straight from the Aave v3 Pool contract.
  const [totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor] =
    await client.readContract({ address: AAVE_POOL, abi: POOL_ABI, functionName: "getUserAccountData", args: [address] });

  // 2. Per-reserve balances and params in one multicall.
  const [reserves] = await client.readContract({
    address: UI_POOL_DATA_PROVIDER,
    abi: UI_POOL_DATA_PROVIDER_ABI,
    functionName: "getUserReservesData",
    args: [POOL_ADDRESSES_PROVIDER, address],
  });

  return {
    maxBorrowUsd: Number(availableBorrowsBase) / 1e8,
    healthFactor: Number(healthFactor) / 1e18,
    liquidationThreshold: Number(currentLiquidationThreshold) / 1e4,
    reserves,
  };
}`;

/** "Read-only by construction": the actual shape of a read, syntax-highlighted at build time. */
export async function CodeWindow() {
  const html = await codeToHtml(SNIPPET, { lang: "ts", theme: "github-dark-default" });
  return (
    <section className="section" id="read-only" aria-labelledby="transparency">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <h2 id="transparency">Read-only by construction</h2>
          <p>There is no write path. See for yourself.</p>
        </div>
        <div className="code-window" data-reveal>
          <div className="tabs"><span className="tab">quote.ts</span></div>
          <div className="body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <div className="code-actions" data-reveal>
          <a className="pill pill-ghost" href="https://github.com/mattamlei7/borrow-router" target="_blank" rel="noopener noreferrer">
            GitHub ↗
          </a>
        </div>
      </div>
    </section>
  );
}
