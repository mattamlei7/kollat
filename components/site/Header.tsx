"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke="#fff" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="6" stroke="#fff" strokeWidth="1.5" />
      <path d="M16 3v10M16 19v10" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export function Header() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const read = () => setSolid(window.scrollY > 80);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return (
    <header className="site-header" data-solid={solid}>
      <div className="wrap">
        <Link href="/" className="brand">
          <Mark />
          Borrow Router
        </Link>
        <nav aria-label="Site">
          <Link href="/#protocols">Protocols</Link>
          <Link href="/#networks">Networks</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <div className="right">
          <Link href="/borrow" className="pill">Check an address</Link>
        </div>
      </div>
    </header>
  );
}
