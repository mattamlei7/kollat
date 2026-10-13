"use client";

import { useEffect, useRef, useState } from "react";
import { type Address, type Hash, type PublicClient } from "viem";
import { getClient } from "@/lib/chains";
import type { PlanStep } from "@/lib/execution";
import { withGasBuffer } from "@/lib/execution/common";
import type { ChainId } from "@/lib/protocols/types";
import { FORK_OF, FORK_RPC, MAINNET, chainFor, reader, wallet, provider } from "../WalletSteps";
import { assertEarnWallet } from "@/lib/earn/wallet-guard";
import { rejected } from "../useWallet";

export { useWallet } from "../useWallet";

/** Deposits are live only where borrowing is: on the configured local fork, or with mainnet execution switched on. */
export const lendLive = (chainId: number) => (FORK_RPC ? chainId === FORK_OF : MAINNET);

/** Reads for one chain: the local fork when it stands in for that chain, else the chain's public RPCs. */
export const earnReader = (chainId: number): PublicClient => (FORK_RPC && chainId === FORK_OF ? (reader(chainId) as PublicClient) : getClient(chainId as ChainId));

const reason = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "Unknown error").split("\n")[0];

export type TxStatus =
  | { phase: "idle" }
  | { phase: "switching" }
  | { phase: "signing"; step: number }
  | { phase: "pending"; step: number; hash: Hash }
  | { phase: "done"; hash: Hash }
  | { phase: "failed"; step: number; message: string };

/**
 * Runs a plan in the user's wallet: switch network if needed, then for each step simulate, sign, and wait for the
 * receipt. Rejections, failed approvals and failed main steps are reported differently; an approval alone is never
 * success. Callers rebuild the plan from chain state before each run, so a confirmed approval is not repeated.
 */
export function useTxRunner(chainId: number) {
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [status, setStatus] = useState<TxStatus>({ phase: "idle" });
  const [confirmed, setConfirmed] = useState(0);

  const run = async (user: Address, steps: PlanStep[], noun: string): Promise<Hash | null> => {
    if (running.current || !mounted.current || !lendLive(chainId)) return null;
    running.current = true;
    try {
    const r = earnReader(chainId);
    const target = chainFor(chainId);
    try {
      const w = wallet(chainId);
      if ((await w.getChainId()) !== target.id) {
        setStatus({ phase: "switching" });
        try { await w.switchChain({ id: target.id }); }
        catch (e) { if (rejected(e)) throw e; await w.addChain({ chain: target }); await w.switchChain({ id: target.id }); }
      }
    } catch (e) {
      setStatus({ phase: "failed", step: -1, message: rejected(e) ? `You declined the network switch. Nothing was sent.` : `Could not switch your wallet to ${target.name}: ${reason(e)}` });
      return null;
    }
    let last: Hash | null = null;
    setConfirmed(0);
    for (let i = 0; i < steps.length; i++) {
      if (!mounted.current) return null;
      const s = steps[i];
      const approval = s.label.startsWith("Approve");
      const failed = (msg: string) => { setStatus({ phase: "failed", step: i, message: msg }); return null; };
      setStatus({ phase: "signing", step: i });
      let gas: bigint;
      try {
        // Estimating simulates the step on current state; a revert here means nothing is sent.
        await assertEarnWallet(provider(), r, target, user, !!FORK_RPC, chainId);
        gas = withGasBuffer(await r.estimateGas({ account: user, to: s.to, data: s.data, value: s.value }));
      } catch (e) {
        return failed(approval ? `The approval would fail: ${reason(e)}. Nothing was sent.`
          : i > 0 ? `The approval went through, but the ${noun} would fail: ${reason(e)}. Nothing else was sent; your funds have not moved.`
          : `The ${noun} would fail: ${reason(e)}. Nothing was sent.`);
      }
      let hash: Hash;
      try {
        if (!mounted.current) return null;
        await assertEarnWallet(provider(), r, target, user, !!FORK_RPC, chainId);
        hash = await wallet(chainId).sendTransaction({ account: user, chain: target, to: s.to, data: s.data, value: s.value, gas });
      } catch (e) {
        return failed(rejected(e)
          ? approval ? "You declined the approval in your wallet. Nothing was sent." : i > 0 ? `You declined the ${noun}. The approval stays in place; nothing was ${noun === "deposit" ? "deposited" : "withdrawn"}.` : `You declined the ${noun} in your wallet. Nothing was sent.`
          : `Your wallet could not send the transaction: ${reason(e)}`);
      }
      setStatus({ phase: "pending", step: i, hash });
      let ok: boolean | undefined;
      // A timeout does not mean failure. Track the same hash instead of enabling a duplicate deposit.
      while (mounted.current && ok === undefined) {
        try { ok = (await r.waitForTransactionReceipt({ hash, timeout: 180_000 })).status === "success"; }
        catch { await new Promise((resolve) => setTimeout(resolve, 5_000)); }
      }
      if (!mounted.current) return null;
      if (!ok) return failed(approval ? "The approval transaction failed on-chain. Nothing was deposited." : `The ${noun} transaction failed on-chain${i > 0 ? " after the approval succeeded" : ""}. Your funds did not move.`);
      setConfirmed(i + 1);
      last = hash;
    }
    if (last) setStatus({ phase: "done", hash: last });
    return last;
    } finally { running.current = false; }
  };

  return { status, confirmed, run, reset: () => { setStatus({ phase: "idle" }); setConfirmed(0); } };
}
