import Link from "next/link";

const ROWS = [
  {
    id: "how-it-works",
    title: "Compare what each lender would give you",
    body: "One address, seven protocols, six networks: each one's limit and rate, ranked. Coverage varies by asset.",
    tiles: ["AAVE", "SPK", "COMP", "MRPH", "FLUID", "EUL", "WELL"],
  },
  {
    id: "liquidation",
    title: "Know the liquidation price before you borrow",
    body: "Each option shows its yearly cost and the collateral price at which it would be liquidated, from the protocol's own limits and oracle.",
    tiles: ["WETH", "wstETH", "cbBTC", "weETH"],
  },
  {
    id: "networks",
    title: "Next: borrow and repay yourself",
    body: "Open positions show each protocol's own health factor. Borrowing and repaying from your wallet is in testing.",
    tiles: ["ETH", "BASE", "ARB", "OP", "POL", "AVAX"],
  },
];

/** Three alternating rows: periwinkle media panel + dark text panel, flush. */
export function FeatureRows() {
  return (
    <section className="section" id="how-it-works" aria-labelledby="features">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <span className="eyebrow">From comparison to loan</span>
          <h2 id="features">Seven lenders, one set of numbers, your choice of route.</h2>
        </div>
        <div className="features">
          {ROWS.map((r, i) => (
            <article className="feature" id={r.id} data-flip={i % 2 === 1} key={r.id} data-reveal>
              <div className="media" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- static asset, no optimisation needed */}
                <img src="/screens/borrow.png" alt="" loading="lazy" width={1534} height={889} />
              </div>
              <div className="text">
                <h3>{r.title}</h3>
                <p>{r.body}</p>
                <div className="tiles" aria-hidden="true">
                  {r.tiles.map((t) => <span className="tile" key={t}>{t}</span>)}
                </div>
                <div>
                  <Link href="/borrow" className="pill pill-quiet">Read more ↗</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
