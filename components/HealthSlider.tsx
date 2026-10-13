"use client";

import type { CSSProperties } from "react";
import { pct } from "@/lib/format";

interface Props {
  collateralUsd: number;
  borrow: number;
  onBorrow: (usdc: number) => void;
  /** Limits of the route the slider is drawn for: the selected one, or the most permissive when none is chosen. */
  maxLtv: number;
  liqThreshold: number;
  routeLabel: string;
  /** Health factor from the full simulation (includes existing debt) when a route is selected. */
  hf?: number | null;
}

/** Loan-to-value from 0 to liquidation, green to red. Dragging sets the borrow amount; it stops at the route's max LTV. */
export function HealthSlider({ collateralUsd, borrow, onBorrow, maxLtv, liqThreshold, routeLabel, hf }: Props) {
  const ltv = collateralUsd > 0 ? borrow / collateralUsd : 0;
  const health = hf ?? (ltv > 0 ? liqThreshold / ltv : Infinity);
  const tone = health >= 1.5 ? "safe" : health > 1.1 ? "caution" : "danger";

  return (
    <div className="health" data-tone={tone} style={{ "--max": Math.min(1, maxLtv / liqThreshold) } as CSSProperties}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="health-slider" className="label-strong text-t2">Loan to value</label>
        <span className="num">
          <span className="body-strong">{pct(ltv, 1)}</span>
          <span className={`hue-${tone} ml-3`}>Health factor {Number.isFinite(health) ? health.toFixed(2) : "—"}</span>
        </span>
      </div>
      <div className="health-track">
        <input
          id="health-slider"
          type="range"
          min={0}
          max={Math.round(liqThreshold * 1000)}
          step={1}
          value={Math.min(Math.round(ltv * 1000), Math.round(liqThreshold * 1000))}
          onChange={(e) => onBorrow(Math.floor((Math.min(Number(e.target.value) / 1000, maxLtv) * collateralUsd)))}
          aria-valuetext={`${pct(ltv, 1)} loan to value, health factor ${Number.isFinite(health) ? health.toFixed(2) : "not applicable"}`}
        />
        <span className="health-max" aria-hidden="true" />
      </div>
      <div className="flex justify-between text-sm text-t2 num">
        <span>0%</span>
        <span>Max {pct(maxLtv, 1)} · Liquidation {pct(liqThreshold, 1)} on {routeLabel}</span>
      </div>
    </div>
  );
}
