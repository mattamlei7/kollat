/**
 * Prints every adapter's output for an address so numbers can be checked
 * against the protocol front-ends.
 *
 *   npx tsx scripts/verify.ts 0xabc… [--chain 1|8453|42161|10|137|43114] [--protocol aave-v3]
 */
import { formatUnits, isAddress, type Address } from "viem";
import { PROTOCOLS } from "../lib/protocols/registry";
import type { ChainId, ProtocolId } from "../lib/protocols/types";

const args = process.argv.slice(2);
const address = args.find((a) => a.startsWith("0x")) as Address | undefined;
const chainArg = args.includes("--chain") ? Number(args[args.indexOf("--chain") + 1]) : undefined;
const protoArg = args.includes("--protocol") ? (args[args.indexOf("--protocol") + 1] as ProtocolId) : undefined;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = (n: number) => (n * 100).toFixed(2) + "%";

async function main() {
  const targets = PROTOCOLS.filter(
    (p) => (chainArg ? p.chainId === (chainArg as ChainId) : true) && (protoArg ? p.id === protoArg : true),
  );
  for (const p of targets) {
    console.log(`\n=== ${p.name} · chain ${p.chainId} ===`);
    const markets = await p.getMarkets();
    if (!markets.ok) { console.log("markets ERROR", markets.error); continue; }
    const rates = await p.getRates();
    const rateBy = new Map(rates.ok ? rates.data.map((r) => [r.marketId, r]) : []);
    console.table(
      markets.data
        .filter((m) => m.status === "active")
        .map((m) => {
          const r = rateBy.get(m.id);
          return {
            collateral: m.collateral.symbol,
            debt: m.debt.symbol,
            ltv: pct(m.ltv),
            liqThreshold: pct(m.liquidationThreshold),
            penalty: pct(m.liquidationPenalty),
            price: usd(m.collateralPriceUsd),
            borrowAPR: r ? pct(r.borrowAprVariable) : "-",
            borrowAPY: r ? pct(r.borrowApyVariable) : "-",
            liquidity: usd(Number(formatUnits(m.availableLiquidity, m.debt.decimals)) * m.debtPriceUsd),
          };
        }),
    );
    const inactive = markets.data.filter((m) => m.status !== "active");
    if (inactive.length) console.log("inactive:", inactive.map((m) => `${m.collateral.symbol} (${m.status})`).join(", "));

    if (!address || !isAddress(address)) continue;
    const cap = await p.getBorrowCapacity(address);
    if (!cap.ok) console.log("capacity ERROR", cap.error);
    else {
      const rows = cap.data.filter((c) => c.collateralBalance > 0n).map((c) => {
        const m = markets.data.find((x) => x.id === c.marketId)!;
        return {
          collateral: m.collateral.symbol,
          balance: formatUnits(c.collateralBalance, m.collateral.decimals),
          usd: usd(c.collateralUsd),
          maxBorrow: usd(c.maxBorrowUsd),
          liqPriceAtMax: usd(c.liquidationPriceAtMaxUsd),
          cappedByLiquidity: c.cappedByLiquidity,
          nativeIncluded: c.nativeBalanceIncluded ? formatUnits(c.nativeBalanceIncluded, 18) : "",
        };
      });
      console.log("wallet capacity:");
      if (rows.length) console.table(rows); else console.log("  (no supported collateral in wallet)");
    }
    const pos = await p.getPositions(address);
    if (!pos.ok) console.log("positions ERROR", pos.error);
    else if (pos.data.length === 0) console.log("positions: none");
    else for (const P of pos.data) {
      console.log("position:", {
        healthFactorComputed: P.healthFactor?.toFixed(4),
        healthFactorReported: P.healthFactorReported?.toFixed(4),
        notes: P.notes,
      });
      console.table(P.collateral.map((l) => ({ leg: "collateral", token: l.token.symbol, amount: formatUnits(l.amount, l.token.decimals), usd: usd(l.usd), LT: l.liquidationThreshold !== undefined ? pct(l.liquidationThreshold) : "" })).concat(
        P.debt.map((l) => ({ leg: "debt", token: l.token.symbol, amount: formatUnits(l.amount, l.token.decimals), usd: usd(l.usd), LT: "" })),
      ));
      console.table(P.liquidationPrices.map((l) => ({ token: l.token.symbol, liquidationPrice: usd(l.priceUsd) })));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
