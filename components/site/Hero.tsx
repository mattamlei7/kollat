"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SCROLL_SPAN_VH } from "@/components/scene/useScrollProgress";

/** The one input on the site: hands the address to the /borrow app. */
export function AddressInput({ id, note }: { id: string; note: string }) {
  const router = useRouter();
  const [v, setV] = useState("");
  function go(e: FormEvent) {
    e.preventDefault();
    const a = v.trim();
    router.push(a ? `/borrow?a=${encodeURIComponent(a)}&chain=all` : "/borrow");
  }
  return (
    <form className="addr" onSubmit={go}>
      <label htmlFor={id} className="sr-only">Address or ENS name</label>
      <input id={id} value={v} onChange={(e) => setV(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
      <button type="submit" aria-label="Check this address">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </button>
      <div className="addr-note">{note}</div>
    </form>
  );
}

export function CountUp({ value, prefix = "", digits = 0 }: { value: number; prefix?: string; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = prefix + fmt.format(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1200);
      el.textContent = prefix + fmt.format(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, prefix, digits]);
  return <span ref={ref}>{prefix}{new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value)}</span>;
}

interface Stats { markets: number; liquidityUsd: number }

export function Hero({ stats }: { stats: Stats }) {
  const copy = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const p = Math.min(1, window.scrollY / (SCROLL_SPAN_VH * window.innerHeight));
      const k = Math.min(1, p / 0.35);
      if (copy.current) {
        // At rest, no transform: the headline then renders as normal text, not a cached layer.
        copy.current.style.opacity = k ? String(1 - k) : "";
        copy.current.style.transform = k ? `translateY(${-40 * k}px)` : "";
      }
      if (bottom.current) bottom.current.style.opacity = String(1 - Math.min(1, Math.max(0, (p - 0.35) / 0.25)));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const liq = stats.liquidityUsd >= 1e9 ? { v: stats.liquidityUsd / 1e9, s: "B" } : { v: stats.liquidityUsd / 1e6, s: "M" };

  return (
    <section className="hero-track" aria-label="Introduction">
      <div className="hero">
        <div className="hero-copy" ref={copy}>
          <h1>Borrow against crypto without selling it.</h1>
          <p className="sub">
            Paste an address to compare what Aave, Spark, Compound, Morpho, Fluid, Euler and Moonwell would lend against it: rate, limit and liquidation price.
          </p>
          <AddressInput id="hero-address" note="Estimates only. No wallet or signature needed." />
        </div>
        <div className="hero-bottom" ref={bottom}>
          <div className="stats" aria-label="Coverage">
            <div className="stat"><span className="label">Protocols</span><span className="value"><CountUp value={7} /></span></div>
            <div className="stat"><span className="label">Networks</span><span className="value"><CountUp value={6} /></span></div>
            <div className="stat"><span className="label">Markets indexed</span><span className="value"><CountUp value={stats.markets} /></span></div>
            <div className="stat">
              <span className="label">Liquidity compared</span>
              <span className="value"><CountUp value={Math.round(liq.v * 10) / 10} prefix="$" digits={1} />{liq.s}</span>
            </div>
          </div>
          <div className="scroll-hint">Scroll to explore</div>
        </div>
      </div>
    </section>
  );
}
