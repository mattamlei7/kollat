"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { FORK_OF, FORK_RPC, chainFor, provider, wallet } from "./WalletSteps";

/** Set when the user disconnects, so a reload does not silently reconnect; cleared on the next Connect. */
const DISCONNECTED_KEY = "kollat:wallet-disconnected";
const remember = (on: boolean) => { try { if (on) localStorage.setItem(DISCONNECTED_KEY, "1"); else localStorage.removeItem(DISCONNECTED_KEY); } catch { /* storage unavailable */ } };
const wasDisconnected = () => { try { return localStorage.getItem(DISCONNECTED_KEY) === "1"; } catch { return false; } };

type Eip1193 = ReturnType<typeof provider> & { isMetaMask?: boolean; on?: (e: string, f: (x: unknown) => void) => void; removeListener?: (e: string, f: (x: unknown) => void) => void };

/** The connected wallet's address and network. Connecting never switches network; that only happens as a deposit step. */
export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (request: boolean): Promise<Address | null> => {
    if (!request && wasDisconnected()) return null;
    try {
      const eth = provider() as Eip1193;
      if (request) remember(false);
      const accounts = (await eth.request({ method: request ? "eth_requestAccounts" : "eth_accounts" })) as Address[];
      setAddress(accounts[0] ?? null);
      setWalletChain(Number(await eth.request({ method: "eth_chainId" })));
      setError(null);
      return accounts[0] ?? null;
    } catch (e) {
      if (request) setError(rejected(e) ? "Connection was declined in your wallet." : (e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!eth) return;
    const first = setTimeout(() => void read(false), 0); // reconnect silently if this site is already authorised
    const onAccounts = (a: unknown) => { if (!wasDisconnected()) setAddress(((a as Address[])[0]) ?? null); };
    const onChain = (c: unknown) => setWalletChain(Number(c));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => { clearTimeout(first); eth.removeListener?.("accountsChanged", onAccounts); eth.removeListener?.("chainChanged", onChain); };
  }, [read]);

  /** The real network the wallet is on (a local fork's own chain id maps back to the chain it copies). */
  const chainId = walletChain !== null && FORK_RPC && walletChain === chainFor(FORK_OF).id ? FORK_OF : walletChain;
  /** Forget the connection here, and ask the wallet to revoke this site's access where it supports that. */
  const disconnect = useCallback(async () => {
    remember(true);
    setAddress(null);
    try { await (provider() as Eip1193).request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never); }
    catch { /* not every wallet supports revoking; the local disconnect still holds */ }
  }, []);

  const isMetaMask = !!(globalThis as { ethereum?: Eip1193 }).ethereum?.isMetaMask;
  return { address, chainId, error, isMetaMask, connect: () => read(true), disconnect };
}

export const rejected = (e: unknown) => {
  const err = e as { code?: number; name?: string; cause?: { code?: number }; message?: string };
  return err.code === 4001 || err.cause?.code === 4001 || err.name === "UserRejectedRequestError" || /user (rejected|denied)/i.test(err.message ?? "");
};

/** Ask the wallet to move to a network (the local fork stands in for its chain). Rejections propagate. */
export async function switchWallet(chainId: number) {
  const target = chainFor(chainId);
  const w = wallet(chainId);
  try { await w.switchChain({ id: target.id }); }
  catch (e) { if (rejected(e)) throw e; await w.addChain({ chain: target }); }
}
