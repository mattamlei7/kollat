"use client";

import * as React from "react";
import { axisVector, holdStill, translateAlong } from "@/components/iso/iso-kit";
import { follow, spring, useInView, useLoop, useReadout, type Spring } from "@/components/iso/live";
import { PRICE_MAX, PRICE_MIN, PRICE_START, dropAt, hfAt, readoutOf } from "./model";
import { HEIGHT, P, PRICE_X0, PRICE_X1, RAIL, RAIL_H, WIDTH, at, cableOf, liftAt, needleOf, priceOfShare, xOfPrice } from "./view";

const PRICE_EASE = 0.35;
/** A real gauge needle: slightly underdamped, so it settles with a small overshoot. */
const NEEDLE_STIFF = 220;
const NEEDLE_DAMP = 24;
const STIFF = 140;
const DAMP = 17;
const IDLE_MS = 3600;
const TOUR_PERIOD = 16;
const TOUR_MID = 2650;
const TOUR_SWING = 1150;
/** Start the tour where the page starts: at the opening price, heading down. */
const TOUR_START = (Math.acos((PRICE_START - TOUR_MID) / TOUR_SWING) / (Math.PI * 2)) * TOUR_PERIOD;
const tourAt = (t: number) => TOUR_MID + TOUR_SWING * Math.cos((t / TOUR_PERIOD) * Math.PI * 2);

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const snap = (price: number) => clamp(Math.round(price / 10) * 10, PRICE_MIN, PRICE_MAX);
const RAIL_SX = [at([PRICE_X0, RAIL.y + 3, RAIL_H])[0], at([PRICE_X1, RAIL.y + 3, RAIL_H])[0]];

interface Props {
  label: string;
  base: React.ReactNode;
  stand: React.ReactNode;
  housing: React.ReactNode;
  platform: React.ReactNode;
  latch: React.ReactNode;
  forks: React.ReactNode;
  bars: React.ReactNode;
  weights: React.ReactNode;
  dial: React.ReactNode;
  rail: React.ReactNode;
  slider: React.ReactNode;
  start: { needle: string; cable: string; lift: number; x: number };
}

export function LiquidationLive({ label, base, stand, housing, platform, latch, forks, bars, weights, dial, rail, slider, start }: Props) {
  const { anchor, say } = useReadout<HTMLDivElement>();
  const inView = useInView(anchor);
  const platformRef = React.useRef<SVGGElement>(null);
  const barsRef = React.useRef<SVGGElement>(null);
  const weightsRef = React.useRef<SVGGElement>(null);
  const sliderRef = React.useRef<SVGGElement>(null);
  const cableRef = React.useRef<SVGPathElement>(null);
  const needleRef = React.useRef<SVGPathElement>(null);
  const state = React.useRef({
    price: PRICE_START,
    target: PRICE_START,
    hf: { at: hfAt(PRICE_START), rate: 0 } as Spring,
    lift: { at: start.lift, rate: 0 } as Spring,
    touring: true,
    clock: TOUR_START,
    idle: 0 as ReturnType<typeof setTimeout> | 0,
  });

  const apply = React.useCallback(() => {
    const s = state.current;
    const up = translateAlong(P, [0, 0, s.lift.at]);
    platformRef.current?.setAttribute("transform", up);
    barsRef.current?.setAttribute("transform", up);
    if (platformRef.current) holdStill(platformRef.current, axisVector(P, [0, 0, s.lift.at]));
    weightsRef.current?.setAttribute("transform", translateAlong(P, [0, 0, -s.lift.at]));
    sliderRef.current?.setAttribute("transform", translateAlong(P, [xOfPrice(s.price), 0, 0]));
    cableRef.current?.setAttribute("d", cableOf(s.lift.at));
    needleRef.current?.setAttribute("d", needleOf(s.hf.at));
    const shown = snap(s.price);
    const text = readoutOf(shown);
    say(text);
    anchor.current?.setAttribute("aria-valuenow", String(shown));
    anchor.current?.setAttribute("aria-valuetext", text);
  }, [anchor, say]);

  const kick = useLoop((dt, calm) => {
    const s = state.current;
    if (s.touring && !calm) {
      s.clock += dt;
      s.target = tourAt(s.clock);
    }
    s.price = follow(s.price, s.target, dt, PRICE_EASE, calm);
    const needleSettled = spring(s.hf, hfAt(s.price), dt, NEEDLE_STIFF, NEEDLE_DAMP, calm);
    const settled = spring(s.lift, liftAt(dropAt(s.price)), dt, STIFF, DAMP, calm);
    apply();
    return (s.touring && !calm) || s.price !== s.target || !needleSettled || !settled;
  }, inView);

  React.useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) state.current.touring = false;
    apply();
  }, [apply]);

  React.useEffect(() => () => clearTimeout(state.current.idle || undefined), []);

  const steer = (price: number) => {
    const s = state.current;
    s.touring = false;
    s.target = snap(price);
    clearTimeout(s.idle || undefined);
    s.idle = setTimeout(() => {
      s.touring = true;
      s.clock = TOUR_START + ((Math.acos(clamp((s.price - TOUR_MID) / TOUR_SWING, -1, 1)) / (Math.PI * 2)) * TOUR_PERIOD);
      kick();
    }, IDLE_MS);
    kick();
  };

  const onPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const vx = ((event.clientX - box.left) / box.width) * WIDTH;
    steer(priceOfShare(clamp((vx - RAIL_SX[0]) / (RAIL_SX[1] - RAIL_SX[0]), 0, 1)));
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const from = state.current.target;
    const step = event.key === "PageUp" || event.key === "PageDown" ? 500 : 100;
    let to: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "PageUp") to = from + step;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "PageDown") to = from - step;
    if (event.key === "Home") to = PRICE_MIN;
    if (event.key === "End") to = PRICE_MAX;
    if (to === null) return;
    event.preventDefault();
    steer(to);
  };

  return (
    <div
      ref={anchor}
      className="iso-stage lq-stage"
      tabIndex={0}
      role="slider"
      aria-label="ETH price: arrow keys move it by $100, Page Up and Page Down by $500"
      aria-valuemin={PRICE_MIN}
      aria-valuemax={PRICE_MAX}
      aria-valuenow={PRICE_START}
      aria-valuetext={readoutOf(PRICE_START)}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onKeyDown={onKey}
    >
      <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} focusable="false">
        <defs>
          {/* Soft shadows as gradients, not CSS blur: a blur filter makes the browser draw the figure through a filter layer, which looks softer when still. */}
          <radialGradient id="lq-halo">
            <stop offset="0%" className="lq-halo-stop" stopOpacity={0.85} />
            <stop offset="55%" className="lq-halo-stop" stopOpacity={0.45} />
            <stop offset="100%" className="lq-halo-stop" stopOpacity={0} />
          </radialGradient>
        </defs>
        {base}
        {stand}
        {housing}
        <g ref={platformRef} transform={translateAlong(P, [0, 0, start.lift])}>{platform}</g>
        {latch}
        <path ref={cableRef} className="iso-line lq-cable" data-tone="mid" d={start.cable} />
        {forks}
        <g ref={barsRef} transform={translateAlong(P, [0, 0, start.lift])}>{bars}</g>
        <g ref={weightsRef} transform={translateAlong(P, [0, 0, -start.lift])}>{weights}</g>
        {dial}
        <path ref={needleRef} className="iso-line lq-needle" data-tone="lit" data-free="start" d={start.needle} />
        {rail}
        <g ref={sliderRef} transform={translateAlong(P, [start.x, 0, 0])}>{slider}</g>
      </svg>
    </div>
  );
}
