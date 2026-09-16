"use client";

import { useEffect } from "react";

/** Hero scroll distance that maps to a full fly-through. */
export const SCROLL_SPAN_VH = 1.6;

/* Module singletons: the canvas mounts once, and the frame loop reads these
   without React state, so nothing re-renders per frame. */
export const scroll = {
  /** Raw 0..1 from the scrollbar. */
  target: 0,
  /** Damped 0..1, lags the scrollbar by ~150ms. Advanced by `damp(dt)`. */
  value: 0,
};
export const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

export function useScrollProgress() {
  useEffect(() => {
    const read = () => {
      scroll.target = Math.min(1, Math.max(0, window.scrollY / (SCROLL_SPAN_VH * window.innerHeight)));
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);
}

export function damp(dt: number) {
  scroll.value += (scroll.target - scroll.value) * (1 - Math.pow(0.0015, dt));
  const k = 1 - Math.pow(0.001, dt);
  mouse.x += (mouse.tx - mouse.x) * k;
  mouse.y += (mouse.ty - mouse.y) * k;
  return scroll.value;
}
