import { App } from "@/components/App";
import { CHAIN_PARAMS, type ChainParam } from "@/lib/client-types";

export default async function Borrow({ searchParams }: PageProps<"/borrow">) {
  const sp = await searchParams;
  const a = typeof sp.a === "string" ? sp.a : null;
  const c = typeof sp.chain === "string" ? sp.chain : "all";
  const chain: ChainParam = CHAIN_PARAMS.includes(c as ChainParam) ? (c as ChainParam) : "all";
  return <App initialInput={a} initialChain={chain} />;
}
