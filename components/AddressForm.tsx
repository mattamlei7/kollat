"use client";

import { useState, type FormEvent } from "react";
import type { ChainParam } from "@/hooks/useSnapshot";
import { Icon, Segmented } from "./ui";

interface Props {
  initial: string;
  chain: ChainParam;
  onSubmit: (input: string) => void;
  onChain: (chain: ChainParam) => void;
  error: string | null;
  busy: boolean;
}

const CHAINS: { value: ChainParam; label: string }[] = [
  { value: "all", label: "All" },
  { value: "1", label: "Ethereum" },
  { value: "8453", label: "Base" },
];

/** Address or ENS input styled as the top-bar search pill. Submits on Enter only. */
export function AddressForm({ initial, chain, onSubmit, onChain, error, busy }: Props) {
  const [value, setValue] = useState(initial);
  const [walletError, setWalletError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v) onSubmit(v);
  }

  async function useWallet() {
    setWalletError(null);
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<string[]> } }).ethereum;
    if (!eth) {
      setWalletError("No wallet detected in this browser.");
      return;
    }
    try {
      // Read the account list only. This app never requests a signature.
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (accounts[0]) {
        setValue(accounts[0]);
        onSubmit(accounts[0]);
      }
    } catch {
      setWalletError("Wallet declined to share an address.");
    }
  }

  const msg = error ?? walletError;

  return (
    <form onSubmit={submit} className="contents">
      <div className="search">
        <Icon name="search" />
        <label className="sr-only" htmlFor="address">
          Ethereum address or ENS name
        </label>
        <input
          id="address"
          name="address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search an address or name.eth"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className="num"
        />
      </div>
      <Segmented options={CHAINS} value={chain} onChange={onChain} label="Chain" small />
      <button type="submit" disabled={busy} className="btn btn-primary">
        {busy ? "Reading…" : "Read"}
      </button>
      <button type="button" onClick={useWallet} className="btn btn-quiet" title="Reads your wallet address only. Nothing is signed.">
        Use wallet
      </button>
      {msg && (
        <p role="alert" className="basis-full text-t2 label-strong hue-danger">
          {msg}
        </p>
      )}
    </form>
  );
}
