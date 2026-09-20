"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

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
        <Link href="/" className="brand" aria-label="Kollat home">
          <Image src="/kollat-wordmark-white.png" alt="Kollat" width={781} height={134} className="wordmark" priority />
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
