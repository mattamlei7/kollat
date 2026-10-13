/** Token logo by chain and address, from CoinGecko's per-chain token lists; ?s=SYMBOL falls back to that symbol's logo elsewhere. */
const LISTS: Record<string, string> = {
  "1": "ethereum",
  "8453": "base",
  "42161": "arbitrum-one",
  "10": "optimistic-ethereum",
  "137": "polygon-pos",
  "43114": "avalanche",
};
const DAY_MS = 86_400_000;

interface Lists { byAddress: Map<string, string>; bySymbol: Map<string, string> }
let cache: { at: number; lists: Promise<Lists> } | null = null;

async function load(): Promise<Lists> {
  const byAddress = new Map<string, string>();
  const bySymbol = new Map<string, string>();
  // Ethereum first, so a symbol shared across chains resolves to its mainnet logo.
  for (const [chain, slug] of Object.entries(LISTS).sort(([a], [b]) => (a === "1" ? -1 : b === "1" ? 1 : 0))) {
    const res = await fetch(`https://tokens.coingecko.com/${slug}/all.json`).catch(() => null);
    if (!res?.ok) continue;
    const { tokens } = (await res.json()) as { tokens: { address: string; symbol: string; logoURI?: string }[] };
    for (const t of tokens) {
      if (!t.logoURI) continue;
      const url = t.logoURI.replace("/thumb/", "/small/");
      byAddress.set(`${chain}:${t.address.toLowerCase()}`, url);
      if (!bySymbol.has(t.symbol.toLowerCase())) bySymbol.set(t.symbol.toLowerCase(), url);
    }
  }
  return { byAddress, bySymbol };
}

function lists() {
  if (!cache || Date.now() - cache.at > DAY_MS) {
    const lists = load();
    cache = { at: Date.now(), lists };
    lists.then((l) => { if (!l.byAddress.size) cache = null; }); // retry soon if every list failed
  }
  return cache.lists;
}

export async function GET(request: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  const symbol = new URL(request.url).searchParams.get("s")?.toLowerCase();
  const { byAddress, bySymbol } = await lists();
  const url = byAddress.get(`${chain}:${address.toLowerCase()}`) ?? (symbol ? bySymbol.get(symbol) : undefined);
  if (!url) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=86400" } });
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "public, max-age=86400" } });
}
