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

/** Track with one indicator that slides between options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tone: t = "none",
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  tone?: Tone;
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
    <div ref={ref} role="radiogroup" aria-label={label} className="seg" onKeyDown={onKey}>
      {ind && <span className="seg-ind" data-tone={t} style={{ left: ind.left, width: ind.width }} aria-hidden />}
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

const GLYPH: Record<Tone, string> = { none: "–", safe: "●", caution: "▲", danger: "■" };

export function Chip({ tone: t, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="chip" data-tone={t}>
      <span aria-hidden>{GLYPH[t]}</span>
      {children}
    </span>
  );
}
