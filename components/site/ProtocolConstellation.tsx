/* Positions are % of the section box (bubble centre), kept outside the centre
   copy rectangle (roughly 25–75% x, 30–70% y). */
const CHIPS: { s: string; c: string; x: number; y: number }[] = [
  { s: "AAVE", c: "#7c5bd6", x: 8, y: 18 },
  { s: "SPK", c: "#f0b429", x: 20, y: 8 },
  { s: "COMP", c: "#00d395", x: 36, y: 12 },
  { s: "MRPH", c: "#2f6bed", x: 58, y: 6 },
  { s: "ETH", c: "#627eea", x: 76, y: 14 },
  { s: "BASE", c: "#0052ff", x: 90, y: 24 },
  { s: "USDC", c: "#2775ca", x: 94, y: 48 },
  { s: "WETH", c: "#4c5ea8", x: 86, y: 70 },
  { s: "wstETH", c: "#00a3ff", x: 72, y: 86 },
  { s: "cbBTC", c: "#f7931a", x: 54, y: 92 },
  { s: "weETH", c: "#7f56d9", x: 36, y: 88 },
  { s: "rETH", c: "#f2a900", x: 18, y: 80 },
  { s: "cbETH", c: "#0052ff", x: 6, y: 62 },
  { s: "DAI", c: "#f4b731", x: 4, y: 40 },
  { s: "USDS", c: "#1aab9b", x: 14, y: 30 },
  { s: "WBTC", c: "#e07d18", x: 82, y: 36 },
  { s: "ezETH", c: "#5cc86d", x: 26, y: 70 },
  { s: "LINK", c: "#2a5ada", x: 64, y: 78 },
  { s: "sDAI", c: "#54b29b", x: 46, y: 4 },
  { s: "tBTC", c: "#3e3e3e", x: 92, y: 84 },
  { s: "FLUID", c: "#3b82f6", x: 6, y: 92 },
  { s: "EUL", c: "#ff3b6b", x: 86, y: 4 },
  { s: "WELL", c: "#00c48c", x: 2, y: 84 },
  { s: "ARB", c: "#12aaff", x: 78, y: 56 },
  { s: "OP", c: "#ff0420", x: 12, y: 50 },
  { s: "AVAX", c: "#e84142", x: 44, y: 98 },
];

/** "Powered by" — sits over the starfield reached after the fly-through. */
export function ProtocolConstellation() {
  return (
    <section className="section" id="protocols" aria-labelledby="powered">
      <div className="wrap">
        <div className="constellation">
          {CHIPS.map((c) => (
            <span
              key={c.s}
              className="chip"
              aria-hidden="true"
              style={{ left: `${c.x}%`, top: `${c.y}%`, background: c.c }}
            >
              {c.s}
            </span>
          ))}
          <div className="section-head" data-reveal>
            <h2 id="powered">Reads from the protocols themselves</h2>
            <p>No aggregator middleman. Positions and rates come straight from each protocol&apos;s contracts.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
