import { App } from "@/components/App";
import type { ChainParam } from "@/hooks/useSnapshot";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const a = typeof sp.a === "string" ? sp.a : null;
  const c = typeof sp.chain === "string" ? sp.chain : "all";
  const chain: ChainParam = c === "1" || c === "8453" ? c : "all";
  return <App initialInput={a} initialChain={chain} />;
}
