/**
 * USDC a borrower could draw today, counted once per lending pool: markets on a pooled protocol (Aave, Spark,
 * Compound, Moonwell, Fluid's liquidity layer) share one pool per chain, Euler shares one per debt vault, and each
 * Morpho market is its own pool. Within a pool the largest market reading is used.
 */
export function liquidityByProtocol(protocols: { id: string; name: string; chainId: number; markets: { ok: boolean; data?: { id: string; availableLiquidity: bigint; debtPriceUsd: number; debt: { decimals: number }; fetchedAt: number }[] } }[]) {
  const pools = new Map<string, { name: string; usd: number }>();
  let updatedAt = 0;
  for (const p of protocols) {
    if (!p.markets.ok || !p.markets.data) continue;
    for (const m of p.markets.data) {
      const key = p.id === "morpho-blue" ? m.id : p.id === "euler-v2" ? m.id.split(":").slice(0, 3).join(":") : `${p.id}:${p.chainId}`;
      const usd = (Number(m.availableLiquidity) / 10 ** m.debt.decimals) * m.debtPriceUsd;
      const cur = pools.get(key);
      if (!cur || usd > cur.usd) pools.set(key, { name: p.name, usd });
      updatedAt = Math.max(updatedAt, m.fetchedAt);
    }
  }
  const totals = new Map<string, number>();
  for (const { name, usd } of pools.values()) totals.set(name, (totals.get(name) ?? 0) + usd);
  const byProtocol = [...totals].map(([name, usd]) => ({ name, usd })).sort((a, b) => b.usd - a.usd);
  return { byProtocol, liquidityUsd: byProtocol.reduce((a, b) => a + b.usd, 0), updatedAt };
}
