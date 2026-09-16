"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { RiskBand } from "@/lib/math/health";

/** Risk band → the one tone the whole UI keys off. */
export type Tone = "none" | "safe" | "caution" | "danger";
export function tone(band: RiskBand): Tone {
  if (band === "none") return "none";
  if (band === "comfortable") return "safe";
  if (band === "watch") return "caution";
  return "danger";
}

interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** Track with one white indicator that slides between options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  small,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);

  const measure = () => {
    const root = ref.current;
    const el = root?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
    if (!root || !el) return;
    setInd({ left: el.offsetLeft, width: el.offsetWidth });
  };
  useLayoutEffect(measure, [value, options.length]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  function onKey(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") onChange(options[(i + 1) % options.length].value);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") onChange(options[(i - 1 + options.length) % options.length].value);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={`seg${small ? " seg-sm" : ""}`} onKeyDown={onKey}>
      {ind && <span className="seg-ind" style={{ left: ind.left, width: ind.width }} aria-hidden />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-value={o.value}
          className="seg-opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const DEFS = {
  ltv: "Loan-to-value: the most you can borrow per dollar of this collateral.",
  lt: "Liquidation threshold: collateral value × this must stay above the debt. Below it the position can be liquidated.",
  hf: "Health factor: liquidation-weighted collateral ÷ debt. Below 1.0 the position is liquidatable.",
  liq: "Collateral price at which the health factor reaches 1.0, other holdings unchanged.",
  penalty: "Bonus a liquidator takes on top of the debt they repay.",
  utilization: "Share of the pool's supplied USDC currently borrowed. Drives the rate.",
  apy: "Compounded annual borrow rate — what a year of borrowing actually costs at today's rate.",
  apr: "Simple annual rate before compounding.",
} as const;

/** Jargon with a definition on hover and keyboard focus. */
export function Def({ term, children, right }: { term: keyof typeof DEFS; children: React.ReactNode; right?: boolean }) {
  const id = useId();
  return (
    <span className="def" tabIndex={0} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className={`def-tip${right ? " right" : ""}`}>
        {DEFS[term]}
      </span>
    </span>
  );
}

export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

/** Circular token/protocol mark from initials. No logos shipped. */
export function Avatar({ text, large }: { text: string; large?: boolean }) {
  return (
    <span className={`avatar${large ? " avatar-lg" : ""}`} aria-hidden>
      {text.replace(/^[a-z]+/, "").slice(0, 3).toUpperCase() || text.slice(0, 3).toUpperCase()}
    </span>
  );
}

const GLYPH: Record<Tone, string> = { none: "–", safe: "●", caution: "▲", danger: "■" };

export function Chip({ tone: t, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="chip" data-tone={t}>
      <span aria-hidden>{GLYPH[t]}</span>
      {children}
    </span>
  );
}

/** 24px stroke icons. */
const PATHS = {
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  borrow: "M3 7h18v10H3zM3 11h18M7 15h3",
  positions: "M4 19h16M6 15l4-5 4 3 5-7",
  lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  trend: "M4 17l6-6 4 4 6-7M14 8h6v6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  percent: "M19 5L5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  external: "M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5",
} as const;

export function Icon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
