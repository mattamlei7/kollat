"use client";

import { useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, http, type Address, type EIP1193Provider } from "viem";
import { base } from "viem/chains";
import type { PlanStep } from "@/lib/execution/morpho";
import { MORPHO_BLUE } from "@/lib/protocols/addresses";

/**
 * Wallet execution for Morpho on Base, signed by the borrower's own browser wallet.
 * The server never signs and funds never pass through Kollat.
 * - NEXT_PUBLIC_FORK_RPC_URL: local fork (dev). Refuses a wallet that is on real Base.
 *   NEXT_PUBLIC_FORK_CHAIN_ID gives the fork its own chain id (e.g. 31337), so wallets treat it as
 *   a separate network and read its balances instead of real Base's.
 * - NEXT_PUBLIC_EXECUTION=mainnet: real Base, real funds, borrows capped at NEXT_PUBLIC_EXECUTION_CAP_USD (default $100).
 * Neither set: the borrow screen stays a read-only preview.
 */
export const FORK_RPC = process.env.NEXT_PUBLIC_FORK_RPC_URL || undefined;
export const MAINNET = !FORK_RPC && process.env.NEXT_PUBLIC_EXECUTION === "mainnet";
export const CAP_USD = Number(process.env.NEXT_PUBLIC_EXECUTION_CAP_USD) || 100;
export const MORPHO = MORPHO_BLUE[8453]!;
/** Base, or the fork under its own id. Contracts are Base's either way. */
const CHAIN = FORK_RPC && Number(process.env.NEXT_PUBLIC_FORK_CHAIN_ID)
  ? defineChain({ ...base, id: Number(process.env.NEXT_PUBLIC_FORK_CHAIN_ID), name: "Base (local fork)", rpcUrls: { default: { http: [FORK_RPC] } } })
  : base;
export const executable = (protocolId: string, chainId: number) => (!!FORK_RPC || MAINNET) && protocolId === "morpho-blue" && chainId === 8453;
export const modeNote = FORK_RPC ? "Local fork. No real funds move." : "Real funds on Base. Your wallet signs every step.";

function provider() {
  const eth = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No browser wallet found. Install or unlock one, then try again.");
  return eth;
}
const wallet = () => createWalletClient({ chain: CHAIN, transport: custom(provider()) });
/** Independent reads: the fork, or a public Base RPC. Never the wallet's own view. */
export const reader = () => createPublicClient({ chain: CHAIN, transport: http(FORK_RPC ?? "https://mainnet.base.org") });

export async function connect(): Promise<Address> {
  const w = wallet();
  const [user] = await w.requestAddresses();
  if ((await w.getChainId()) !== CHAIN.id) {
    try { await w.switchChain({ id: CHAIN.id }); }
    catch { await w.addChain({ chain: CHAIN }); } // unknown to the wallet yet: offer to add it
  }
  if (FORK_RPC) {
    // A wallet on real Base sees a different latest block than the fork; refuse rather than move real funds.
    const [ours, theirs] = await Promise.all([reader().getBlock(), createPublicClient({ chain: CHAIN, transport: custom(provider()) }).getBlock()]);
    if (ours.hash !== theirs.hash) throw new Error(`Your wallet is not connected to the local fork. Point it at ${FORK_RPC} (chain 8453).`);
  }
  return user;
}

type Plan = { user: Address; steps: PlanStep[] };

/** Prepare a plan, then run it step by step: simulate, sign in the wallet, wait for the receipt. */
export function useSteps() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { setError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message); }
    finally { setBusy(false); }
  }

  return {
    plan, done, busy, error,
    prepare: (build: (user: Address) => Promise<PlanStep[]>) => guard(async () => {
      const user = await connect();
      setPlan({ user, steps: await build(user) }); setDone(0);
    }),
    // Resumes from the first unfinished step, so a retry never repeats a confirmed deposit, borrow or repay.
    execute: (after: (user: Address) => Promise<void>) => plan && guard(async () => {
      const w = wallet();
      const r = reader();
      for (let i = done; i < plan.steps.length; i++) {
        const s = plan.steps[i];
        await r.call({ account: plan.user, to: s.to, data: s.data, value: s.value }); // simulate; throws on revert
        const hash = await w.sendTransaction({ account: plan.user, chain: CHAIN, to: s.to, data: s.data, value: s.value });
        if ((await r.waitForTransactionReceipt({ hash })).status !== "success") throw new Error(`${s.label} reverted. Nothing after it was sent.`);
        setDone(i + 1);
      }
      await after(plan.user);
    }),
    reset: () => { setPlan(null); setDone(0); setError(null); },
  };
}

export function StepList({ steps, done, busy }: { steps: PlanStep[]; done: number; busy: boolean }) {
  return <ol className="flex flex-col gap-1">
    {steps.map((s, i) => <li key={i} className="flex justify-between gap-3 text-t2">
      <span>{i + 1}. {s.label}</span><span>{i < done ? "Confirmed" : busy && i === done ? "Waiting…" : ""}</span>
    </li>)}
  </ol>;
}
