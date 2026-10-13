import Image from "next/image";
import Link from "next/link";
import { Icon } from "./ui";

/** App navigation shared by Borrow and Lend. */
export function Sidebar({ current }: { current: "borrow" | "lend" }) {
  const fork = !!process.env.NEXT_PUBLIC_FORK_RPC_URL;
  const live = process.env.NEXT_PUBLIC_EXECUTION === "mainnet";
  const mode = fork ? "Local fork" : live ? "Wallet execution" : "Read-only";
  return (
    <nav className="sidebar" aria-label="Primary">
      <Link href="/" className="logo" aria-label="Kollat home">
        <Image src="/kollat-wordmark.svg" alt="Kollat" width={140} height={20} unoptimized className="wordmark" priority />
      </Link>
      <div className="nav">
        <Link className="nav-item" href="/borrow" aria-current={current === "borrow" ? "page" : undefined}>
          <Icon name="borrow" />
          Borrow
        </Link>
        <Link className="nav-item" href="/lend" aria-current={current === "lend" ? "page" : undefined}>
          <Icon name="lend" />
          Lend
        </Link>
      </div>
      <div className="pinned nav-item" title={fork ? "Transactions use a local fork; no real funds move." : live ? "Your wallet signs transactions using real funds." : "Transaction execution is disabled in this environment."}>
        <Icon name="lock" />
        <span className="flex-1">{mode}</span>
        <span className="toggle" data-on="true" aria-hidden />
      </div>
    </nav>
  );
}
