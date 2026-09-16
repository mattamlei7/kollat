import Link from "next/link";

const ROWS = [
  {
    id: "how-it-works",
    title: "See your borrowing power everywhere at once",
    body: "One address, four protocols, two networks. Max borrow, current rate, and utilization for each, ranked.",
    tiles: ["AAVE", "SPK", "COMP", "MRPH"],
  },
  {
    id: "liquidation",
    title: "Know the liquidation price before you borrow",
    body: "Every quote carries the collateral price at which the position gets liquidated, computed from the protocol's own LTV and oracle.",
    tiles: ["WETH", "wstETH", "cbBTC", "weETH"],
  },
  {
    id: "networks",
    title: "Read positions you already hold",
    body: "Open positions appear with each protocol's own health factor, unmodified — not a normalized score we invented.",
    tiles: ["ETH", "BASE"],
  },
];

/** Three alternating rows: periwinkle media panel + dark text panel, flush. */
export function FeatureRows() {
  return (
    <section className="section" id="how-it-works" aria-labelledby="features">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <span className="eyebrow">Built for comparison</span>
          <h2 id="features">Four lenders, one set of numbers, no wallet required.</h2>
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
