"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { CHAIN_LABEL } from "@/lib/client-types";
import { rejected, switchWallet } from "./useWallet";
import { Icon } from "./ui";

const EXPLORER: Record<number, string> = {
  1: "https://etherscan.io", 8453: "https://basescan.org", 42161: "https://arbiscan.io", 10: "https://optimistic.etherscan.io", 137: "https://polygonscan.com", 43114: "https://snowtrace.io",
};

const ICON: Record<number, string> = {
  1: "ethereum", 8453: "base", 42161: "arbitrum", 10: "optimism", 137: "polygon", 43114: "avalanche",
};

export function NetworkIcon({ chainId, size = 24 }: { chainId: number | "all"; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (chainId === "all" || !ICON[chainId] || failed) {
    return <span className="net-icon net-icon-text" style={{ width: size, height: size }} aria-hidden>{chainId === "all" ? "All" : (CHAIN_LABEL[chainId] ?? "?").slice(0, 1)}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- tiny remote icon; nothing for next/image to optimise
  return <img className="net-icon" src={`https://icons.llamao.fi/icons/chains/rsz_${ICON[chainId]}.jpg`} width={size} height={size} alt="" onError={() => setFailed(true)} />;
}

interface Props {
  /** Networks the page can show; "all" means every supported network at once. */
  networks: (number | "all")[];
  network: number | "all";
  onNetwork: (n: number | "all") => void;
  /** Borrow only: look up any address or ENS name from the wallet menu. */
  lookup?: { viewing: string | null; onLookup: (input: string) => void };
  wallet: { address: Address | null; chainId: number | null; error: string | null; isMetaMask?: boolean; connect: () => Promise<unknown>; disconnect: () => Promise<void> };
}

/**
 * Top-right network picker and wallet button, shared by Borrow and Lend. Picking a network changes what the page
 * shows and, when a wallet is connected, asks the wallet to switch too. Nothing switches without that click.
 */
export function WalletControl({ networks, network, onNetwork, wallet, lookup }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(n: number | "all") {
    setError(null);
    onNetwork(n);
    if (n !== "all" && wallet.address && wallet.chainId !== n) {
      try { await switchWallet(n); }
      catch (e) {
        setError(rejected(e) ? `Your wallet stayed on ${CHAIN_LABEL[wallet.chainId ?? 0] ?? "its current network"}.` : `Could not switch your wallet: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
        return;
      }
    }
    dialog.current?.close();
  }

  const label = network === "all" ? "All networks" : CHAIN_LABEL[network];
  return (
    <div className="wallet-control">
      <button type="button" className="btn btn-quiet btn-net" aria-haspopup="dialog" aria-label={`Network: ${label}. Change network`} onClick={() => { setError(null); dialog.current?.showModal(); }}>
        <NetworkIcon chainId={network} />
        <Icon name="chevron" className="net-chev" />
      </button>
      {wallet.address
        ? <WalletMenu address={wallet.address} chainId={wallet.chainId ?? (network === "all" ? 1 : network)} isMetaMask={!!wallet.isMetaMask} onDisconnect={wallet.disconnect} lookup={lookup} />
        : <button type="button" className="btn btn-primary" onClick={() => void wallet.connect()}>Connect wallet</button>}
      {wallet.error && <p className="wallet-error hue-caution text-sm" role="alert">{wallet.error}</p>}

      <dialog ref={dialog} className="net-dialog" aria-labelledby="net-dialog-title" onClick={(e) => { if (e.target === dialog.current) dialog.current.close(); }}>
        <div className="flex items-center justify-between mb-4">
          <h2 id="net-dialog-title" className="heading">Select network</h2>
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Close" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <div className="net-grid">
          {networks.map((n) => (
            <button key={n} type="button" className="net-option" aria-pressed={network === n} onClick={() => void pick(n)}>
              <NetworkIcon chainId={n} size={32} />
              <span className="body-strong">{n === "all" ? "All networks" : CHAIN_LABEL[n]}</span>
              {n !== "all" && wallet.address && wallet.chainId === n && <span className="net-connected">Connected</span>}
            </button>
          ))}
        </div>
        {error && <p className="hue-caution mt-3" role="alert">{error}</p>}
        <p className="text-sm text-t2 mt-4">{wallet.address ? "Choosing a network also asks your wallet to switch." : "Connect a wallet to use your own balances. You can browse any network without one."}</p>
      </dialog>
    </div>
  );
}

/** The connected address as a menu: copy it, open it on the network's explorer, or disconnect. */
function WalletMenu({ address, chainId, isMetaMask, onDisconnect, lookup }: { address: Address; chainId: number; isMetaMask: boolean; onDisconnect: () => Promise<void>; lookup?: Props["lookup"] }) {
  const [other, setOther] = useState("");
  const viewingOther = !!lookup?.viewing && lookup.viewing.toLowerCase() !== address.toLowerCase();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function copy() {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked; the full address is still shown in the title */ }
  }

  return (
    <div className="wallet-menu" ref={root}>
      <button type="button" className="btn btn-quiet num" aria-haspopup="menu" aria-expanded={open} title={address} onClick={() => setOpen((o) => !o)}>
        <span className="wallet-glyph" aria-hidden>{isMetaMask ? "🦊" : <Icon name="wallet" />}</span>{short}
      </button>
      {open && (
        <div className="wallet-pop" role="menu" aria-label="Wallet">
          <div className="wallet-pop-head">
            <span className="wallet-glyph wallet-glyph-lg" aria-hidden>{isMetaMask ? "🦊" : <Icon name="wallet" />}</span>
            <span className="flex items-center gap-2">
              <span className="body-strong num">{short}</span>
              <button type="button" className="btn btn-icon btn-ghost wallet-copy" aria-label={copied ? "Address copied" : "Copy address"} onClick={copy}>{copied ? "✓" : "⧉"}</button>
            </span>
            <span className="sr-only" role="status">{copied ? "Address copied" : ""}</span>
          </div>
          {lookup && (
            <form className="wallet-lookup" onSubmit={(e) => { e.preventDefault(); const v = other.trim(); if (v) { lookup.onLookup(v); setOther(""); setOpen(false); } }}>
              <label htmlFor="lookup-address" className="text-sm text-t2">View another address</label>
              <span className="flex gap-2">
                <input id="lookup-address" className="ctl num w-full" placeholder="0x… or name.eth" value={other} onChange={(e) => setOther(e.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="off" />
                <button type="submit" className="btn btn-primary" disabled={!other.trim()}>View</button>
              </span>
              {viewingOther && <button type="button" className="btn-text text-sm self-start" onClick={() => { lookup.onLookup(address); setOpen(false); }}>Back to my wallet</button>}
            </form>
          )}
          <button type="button" role="menuitem" className="wallet-pop-item" onClick={() => { setOpen(false); void onDisconnect(); }}><Icon name="logout" />Disconnect</button>
          <a role="menuitem" className="wallet-pop-item" href={`${EXPLORER[chainId] ?? EXPLORER[1]}/address/${address}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}><Icon name="external" />View on Explorer</a>
        </div>
      )}
    </div>
  );
}
