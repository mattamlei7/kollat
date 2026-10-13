"use client";

import { useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, http, type Address, type Chain, type EIP1193Provider, type PublicClient } from "viem";
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from "viem/chains";
import { executorFor, type PlanStep } from "@/lib/execution";
import { assertNoErrorCode, withGasBuffer } from "@/lib/execution/common";
import { CHAIN_LABEL } from "@/lib/client-types";

/**
 * Wallet execution (Morpho, Aave, Spark, Compound, Moonwell), signed by the borrower's own browser wallet.
 * The server never signs and funds never pass through Kollat.
 * - NEXT_PUBLIC_FORK_RPC_URL: local fork (dev) of the chain in NEXT_PUBLIC_FORK_OF (default 8453, Base).
 *   Refuses a wallet that is on the real chain. NEXT_PUBLIC_FORK_CHAIN_ID gives the fork its own
 *   chain id (e.g. 31337), so wallets read its balances instead of the real chain's.
 * - NEXT_PUBLIC_EXECUTION=mainnet: every supported protocol and chain, real funds, borrows capped at
 *   NEXT_PUBLIC_EXECUTION_CAP_USD (default $100).
 * Neither set: the borrow screen stays a read-only preview.
 */
export const FORK_RPC = process.env.NEXT_PUBLIC_FORK_RPC_URL || undefined;
export const FORK_OF = Number(process.env.NEXT_PUBLIC_FORK_OF) || 8453;
const FORK_CHAIN_ID = Number(process.env.NEXT_PUBLIC_FORK_CHAIN_ID) || FORK_OF;
export const MAINNET = !FORK_RPC && process.env.NEXT_PUBLIC_EXECUTION === "mainnet";
export const CAP_USD = Number(process.env.NEXT_PUBLIC_EXECUTION_CAP_USD) || 100;

const CHAINS: Record<number, Chain> = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism, 137: polygon, 43114: avalanche };

export const executable = (protocolId: string, chainId: number) =>
  !!CHAINS[chainId] && !!executorFor(protocolId, chainId) && (FORK_RPC ? chainId === FORK_OF : MAINNET);
export const modeNote = (chainId: number) => FORK_RPC ? "Local fork. No real funds move." : `Real funds on ${CHAIN_LABEL[chainId]}. Your wallet signs every step.`;

/** The chain the wallet signs on: the real one, or the fork under its own id. Contracts are the real chain's either way. */
export function chainFor(chainId: number): Chain {
  const real = CHAINS[chainId];
  return FORK_RPC ? defineChain({ ...real, id: FORK_CHAIN_ID, name: `${real.name} (local fork)`, rpcUrls: { default: { http: [FORK_RPC] } } }) : real;
}

export function provider() {
  const eth = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No browser wallet found. Install or unlock one, then try again.");
  return eth;
}
export const wallet = (chainId: number) => createWalletClient({ chain: chainFor(chainId), transport: custom(provider()) });
/** Independent reads: the fork, or the chain's public RPC. Never the wallet's own view. */
export const reader = (chainId: number) => createPublicClient({ chain: chainFor(chainId), transport: http(FORK_RPC ?? CHAINS[chainId].rpcUrls.default.http[0]) });

export async function connect(chainId: number): Promise<Address> {
  const chain = chainFor(chainId);
  const w = wallet(chainId);
  const [user] = await w.requestAddresses();
  if ((await w.getChainId()) !== chain.id) {
    try { await w.switchChain({ id: chain.id }); }
    catch { await w.addChain({ chain }); } // unknown to the wallet yet: offer to add it
  }
  if (FORK_RPC) {
    // A wallet on the real chain sees a different latest block than the fork; refuse rather than move real funds.
    const [ours, theirs] = await Promise.all([reader(chainId).getBlock(), createPublicClient({ chain, transport: custom(provider()) }).getBlock()]);
    if (ours.hash !== theirs.hash) throw new Error(`Your wallet is not connected to the local fork. Point it at ${FORK_RPC} (chain ${chain.id}).`);
  }
  return user;
}

type Plan = { user: Address; steps: PlanStep[] };

/** Prepare a plan, then run it step by step: simulate, sign in the wallet, wait for the receipt. */
export function useSteps(chainId: number) {
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
      const user = await connect(chainId);
      setPlan({ user, steps: await build(user) }); setDone(0);
    }),
    // Resumes from the first unfinished step, so a retry never repeats a confirmed deposit, borrow or repay.
    execute: (after: (user: Address) => Promise<void>) => plan && guard(async () => {
      const w = wallet(chainId);
      const r = reader(chainId);
      for (let i = done; i < plan.steps.length; i++) {
        const s = plan.steps[i];
        await assertNoErrorCode(r as PublicClient, plan.user, s);
        // Estimating simulates the step (throws on revert) and sizes its gas.
        const gas = withGasBuffer(await r.estimateGas({ account: plan.user, to: s.to, data: s.data, value: s.value }));
        const hash = await w.sendTransaction({ account: plan.user, chain: chainFor(chainId), to: s.to, data: s.data, value: s.value, gas });
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
