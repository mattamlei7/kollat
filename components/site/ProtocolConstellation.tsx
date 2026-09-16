"use client";

import { useEffect, useRef } from "react";

/* Positions are % of the section box, kept outside the centre copy rectangle
   (roughly 25–75% x, 30–70% y). k = parallax factor, dur = drift period. */
const CHIPS: { s: string; c: string; x: number; y: number; k: number; dur: number }[] = [
  { s: "AAVE", c: "#7c5bd6", x: 8, y: 18, k: 0.6, dur: 9 },
  { s: "SPK", c: "#f0b429", x: 20, y: 8, k: 1.1, dur: 11 },
  { s: "COMP", c: "#00d395", x: 36, y: 12, k: 0.8, dur: 8 },
  { s: "MRPH", c: "#2f6bed", x: 58, y: 6, k: 1.3, dur: 10 },
  { s: "ETH", c: "#627eea", x: 76, y: 14, k: 0.7, dur: 12 },
  { s: "BASE", c: "#0052ff", x: 90, y: 24, k: 1.0, dur: 9 },
  { s: "USDC", c: "#2775ca", x: 94, y: 48, k: 0.5, dur: 13 },
  { s: "WETH", c: "#4c5ea8", x: 86, y: 70, k: 1.2, dur: 8 },
  { s: "wstETH", c: "#00a3ff", x: 72, y: 86, k: 0.9, dur: 10 },
  { s: "cbBTC", c: "#f7931a", x: 54, y: 92, k: 0.6, dur: 11 },
  { s: "weETH", c: "#7f56d9", x: 36, y: 88, k: 1.1, dur: 9 },
  { s: "rETH", c: "#f2a900", x: 18, y: 80, k: 0.8, dur: 12 },
  { s: "cbETH", c: "#0052ff", x: 6, y: 62, k: 1.3, dur: 8 },
  { s: "DAI", c: "#f4b731", x: 4, y: 40, k: 0.7, dur: 10 },
  { s: "USDS", c: "#1aab9b", x: 14, y: 30, k: 1.0, dur: 11 },
  { s: "WBTC", c: "#e07d18", x: 82, y: 36, k: 0.9, dur: 9 },
  { s: "ezETH", c: "#5cc86d", x: 26, y: 70, k: 1.2, dur: 13 },
  { s: "LINK", c: "#2a5ada", x: 64, y: 78, k: 0.6, dur: 8 },
  { s: "sDAI", c: "#54b29b", x: 46, y: 4, k: 0.8, dur: 10 },
  { s: "tBTC", c: "#3e3e3e", x: 92, y: 84, k: 1.1, dur: 12 },
  { s: "FLUID", c: "#3b82f6", x: 6, y: 92, k: 0.9, dur: 10 },
  { s: "EUL", c: "#ff3b6b", x: 86, y: 4, k: 1.2, dur: 9 },
  { s: "WELL", c: "#00c48c", x: 2, y: 84, k: 0.7, dur: 11 },
  { s: "ARB", c: "#12aaff", x: 78, y: 56, k: 1.0, dur: 12 },
  { s: "OP", c: "#ff0420", x: 12, y: 50, k: 1.1, dur: 8 },
  { s: "AVAX", c: "#e84142", x: 44, y: 98, k: 0.8, dur: 10 },
];

/** "Powered by" — floats over the starfield reached after the fly-through. */
export function ProtocolConstellation() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const centre = r.top + r.height / 2 - window.innerHeight / 2;
      el.style.setProperty("--par", `${(-centre * 0.08).toFixed(1)}px`);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="section" id="protocols" aria-labelledby="powered">
      <div className="wrap">
        <div className="constellation" ref={ref}>
          {CHIPS.map((c) => (
            <span
              key={c.s}
              className="chip"
              aria-hidden="true"
              style={{ left: `${c.x}%`, top: `${c.y}%`, background: c.c, "--k": c.k, "--dur": `${c.dur}s` } as React.CSSProperties}
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
