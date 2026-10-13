import { CodeWindow } from "@/components/site/CodeWindow";
import { FeatureRows } from "@/components/site/FeatureRow";
import { FinalCta } from "@/components/site/FinalCta";
import { Hero } from "@/components/site/Hero";
import { ProtocolConstellation } from "@/components/site/ProtocolConstellation";
import { TrustRow } from "@/components/site/TrustRow";
import { CHAIN_IDS } from "@/lib/chains";
import { liquidityByProtocol } from "@/lib/liquidity";
import { marketsSnapshot } from "@/lib/snapshot";

// Stats come from the same adapters the app uses; refreshed hourly, never per visit.
export const revalidate = 3600;

async function stats() {
  try {
    const snap = await marketsSnapshot(CHAIN_IDS);
    const markets = snap.protocols.reduce((n, p) => n + (p.markets.ok ? p.markets.data.length : 0), 0);
    return { markets, ...liquidityByProtocol(snap.protocols) };
  } catch {
    return { markets: 0, liquidityUsd: 0, byProtocol: [], updatedAt: 0 };
  }
}

export default async function Home() {
  return (
    <>
      <Hero stats={await stats()} />
      <ProtocolConstellation />
      <FeatureRows />
      <CodeWindow />
      <TrustRow />
      <FinalCta />
    </>
  );
}
