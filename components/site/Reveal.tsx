"use client";

import { useEffect } from "react";

/** Fades every [data-reveal] element in once at 20% visibility, siblings staggered 60ms. */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          const sibs = Array.from(el.parentElement?.children ?? []).filter((s) => s.hasAttribute("data-reveal"));
          el.style.transitionDelay = `${sibs.indexOf(el) * 60}ms`;
          el.dataset.in = "true";
          io.unobserve(el);
        }
      },
      { threshold: 0.2 },
    );
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
