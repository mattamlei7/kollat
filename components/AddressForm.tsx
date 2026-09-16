"use client";

import { useState, type FormEvent } from "react";
import type { ChainParam } from "@/hooks/useSnapshot";
import { Segmented } from "./ui";

interface Props {
  initial: string;
  chain: ChainParam;
  onSubmit: (input: string) => void;
  onChain: (chain: ChainParam) => void;
  error: string | null;
  busy: boolean;
}

const CHAINS: { value: ChainParam; label: string }[] = [
  { value: "all", label: "Both" },
  { value: "1", label: "Ethereum" },
  { value: "8453", label: "Base" },
];

/** Address or ENS input. Submits on Enter only — never per keystroke. */
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

  return (
    <form onSubmit={submit} className="flex-1 min-w-0 max-md:basis-full flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="address">
          Ethereum address or ENS name
        </label>
        <input
          id="address"
          name="address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x… or name.eth"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className="ctl num flex-1 min-w-[18rem]"
        />
        <Segmented options={CHAINS} value={chain} onChange={onChain} label="Chain" />
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Reading…" : "Read address"}
        </button>
        <button type="button" onClick={useWallet} className="btn btn-quiet">
          Use my wallet
        </button>
      </div>
      {(error || walletError) && (
        <p role="alert" className="text-t2">
          {error ?? walletError}
        </p>
      )}
    </form>
  );
}
