import { CodeWindow } from "@/components/site/CodeWindow";
import { FeatureRows } from "@/components/site/FeatureRow";
import { FinalCta } from "@/components/site/FinalCta";
import { Hero } from "@/components/site/Hero";
import { ProtocolConstellation } from "@/components/site/ProtocolConstellation";
import { TrustRow } from "@/components/site/TrustRow";
import { CHAIN_IDS } from "@/lib/chains";
import { marketsSnapshot } from "@/lib/snapshot";

// Stats come from the same adapters the app uses; refreshed hourly, never per visit.
export const revalidate = 3600;

async function stats() {
  try {
    const snap = await marketsSnapshot(CHAIN_IDS);
    let markets = 0;
    let liquidityUsd = 0;
    for (const p of snap.protocols) {
      if (!p.markets.ok) continue;
      for (const m of p.markets.data) {
        markets++;
        liquidityUsd += (Number(m.availableLiquidity) / 10 ** m.debt.decimals) * m.debtPriceUsd;
      }
    }
    return { markets, liquidityUsd };
  } catch {
    return { markets: 0, liquidityUsd: 0 };
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
