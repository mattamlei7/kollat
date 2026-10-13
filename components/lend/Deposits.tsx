"use client";

import { useState } from "react";
import type { Address, Hash } from "viem";
import { CHAIN_LABEL } from "@/lib/client-types";
import { readHolding, withdrawPlan, type Holding } from "@/lib/earn/execute";
import { parseAmountInput } from "@/lib/earn/rank";
import { PRODUCT_LABEL, type Opportunity } from "@/lib/earn/types";
import { FORK_RPC } from "../WalletSteps";
import { fmtApy, fmtToken } from "./format";
import { txUrl } from "./LendRail";
import { earnReader, lendLive, useTxRunner } from "./useWalletTx";

export type HoldingRead = { holding: Holding } | { error: string };

interface Props {
  opps: Opportunity[];
  address: Address | null;
  holdings: Map<string, HoldingRead> | null;
  loading: boolean;
  onConnect: () => void;
  onAddFunds: (o: Opportunity) => void;
  onChanged: (o: Opportunity) => Promise<void>;
}

/** The connected wallet's deposits at every listed destination, with withdrawals. */
export function Deposits({ opps, address, holdings, loading, onConnect, onAddFunds, onChanged }: Props) {
  // Lives here, not in the position, so it survives a full exit removing the position from the list.
  const [notice, setNotice] = useState<{ text: string; chainId: number; hash: Hash; refreshError: string | null } | null>(null);
  const changed = (o: Opportunity, text: string, hash: Hash) => {
    setNotice({ text, chainId: o.chainId, hash, refreshError: null });
    onChanged(o).catch((e: Error & { shortMessage?: string }) => setNotice((n) => n && { ...n, refreshError: e.shortMessage ?? e.message.split("\n")[0] }));
  };
  const held = opps.filter((o) => { const h = holdings?.get(o.id); return h && "holding" in h && h.holding.assets > 0n; });
  const failed = opps.filter((o) => { const h = holdings?.get(o.id); return h && "error" in h; });
  return (
    <section className="section" aria-labelledby="deposits-heading" id="your-deposits">
      <div className="row flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="deposits-heading" className="heading">Your deposits</h2>
        {!address ? <button type="button" className="btn-text" onClick={onConnect}>Connect a wallet to see your deposits</button>
          : loading && !holdings ? <span className="text-t2">Reading your deposits…</span>
          : held.length === 0 && failed.length === 0 ? <span className="text-t2">No deposits at the listed destinations</span> : null}
      </div>
      {notice && <div className="row mt-3 flex flex-col gap-1" role="status">
        <p className="body-strong">{notice.text}</p>
        <a className="btn-text" href={txUrl(notice.chainId, notice.hash)} target="_blank" rel="noreferrer">{FORK_RPC ? `Transaction ${notice.hash.slice(0, 10)}… (local fork)` : "View transaction"}</a>
        {notice.refreshError && <p className="hue-caution">The withdrawal is confirmed, but balances could not be refreshed: {notice.refreshError}. Reload to see them.</p>}
        <button type="button" className="btn btn-quiet self-start" onClick={() => setNotice(null)}>Dismiss</button>
      </div>}
      {failed.length > 0 && <p className="row hue-caution mt-2" role="alert">Could not read your position at {failed.map((o) => `${o.name} (${CHAIN_LABEL[o.chainId]})`).join(", ")}. Shown positions may be incomplete.</p>}
      {held.length > 0 && <div className="row flex flex-col gap-3 mt-4">
        {held.map((o) => <Position key={o.id} o={o} holding={(holdings!.get(o.id) as { holding: Holding }).holding} address={address!} onAddFunds={() => onAddFunds(o)} onDone={changed} />)}
      </div>}
    </section>
  );
}

type Done = (o: Opportunity, text: string, hash: Hash) => void;

function Position({ o, holding, address, onAddFunds, onDone }: { o: Opportunity; holding: Holding; address: Address; onAddFunds: () => void; onDone: Done }) {
  const [open, setOpen] = useState(false);
  const partial = holding.withdrawable < holding.assets;
  return (
    <div className="deposit-item">
      <div className="deposit-row">
        <span className="flex flex-col">
          <span className="body-strong">{fmtToken(holding.assets, o.asset)}</span>
          <span className="text-sm text-t2">Redeemable value</span>
        </span>
        <span className="flex flex-col">
          <span>{PRODUCT_LABEL[o.product]}</span>
          <span className="text-sm text-t2">{o.name} · {CHAIN_LABEL[o.chainId]}</span>
        </span>
        <span className="flex flex-col num">
          <span>{fmtApy(o.baseApy)}</span>
          <span className="text-sm text-t2">Current base APY</span>
        </span>
        <span className="flex flex-col num">
          <span className={partial ? "hue-caution" : ""}>{fmtToken(holding.withdrawable, o.asset)}</span>
          <span className="text-sm text-t2">Withdrawable now</span>
        </span>
        <span className="flex flex-col">
          <span className="text-t2">Not tracked</span>
          <span className="text-sm text-t2" title="Kollat does not record your deposit history, so it cannot separate earnings from deposits and transfers.">Earnings</span>
        </span>
        <span className="flex gap-2 justify-end">
          <button type="button" className="btn btn-soft" onClick={onAddFunds}>Add funds</button>
          <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen((x) => !x)}>Withdraw</button>
        </span>
      </div>
      {holding.withdrawalNote ? <p className="text-sm hue-caution mt-2">{holding.withdrawalNote}</p> : partial && <p className="text-sm hue-caution mt-2">Only {fmtToken(holding.withdrawable, o.asset)} of {fmtToken(holding.assets, o.asset)} can be withdrawn right now; the rest is lent out. More becomes available as borrowers repay or others deposit.</p>}
      {open && <Withdraw o={o} holding={holding} address={address} onDone={(text, hash) => { setOpen(false); onDone(o, text, hash); }} />}
    </div>
  );
}

function Withdraw({ o, holding, address, onDone }: { o: Opportunity; holding: Holding; address: Address; onDone: (text: string, hash: Hash) => void }) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<{ all: boolean; amount: bigint; error: string | null } | null>(null);
  const tx = useTxRunner(o.chainId);
  const parsed = parseAmountInput(text, o.asset.decimals);
  const live = lendLive(o.chainId);
  const issue = parsed.error ?? (parsed.value !== null && parsed.value > holding.assets ? "More than this position holds."
    : parsed.value !== null && parsed.value > holding.withdrawable ? `Only ${fmtToken(holding.withdrawable, o.asset)} can be withdrawn right now.` : null);
  const fee = o.fees?.find((f) => /out|Conversion fee$/.test(f.label));

  async function run() {
    if (!plan) return;
    let steps;
    try {
      // Re-read the position right before signing; liquidity can move between review and confirmation.
      const fresh = await readHolding(earnReader(o.chainId), o, address);
      steps = withdrawPlan({ dest: o, user: address, amount: plan.all ? undefined : plan.amount, holding: fresh });
    } catch (e) { setPlan({ ...plan, error: (e as Error).message }); return; }
    const hash = await tx.run(address, steps, "withdrawal");
    if (!hash) return;
    onDone(`Withdrawal complete. About ${fmtToken(plan.all ? holding.assets : plan.amount, o.asset)} returned to your wallet from ${o.name} on ${CHAIN_LABEL[o.chainId]}.`, hash);
  }


  if (plan) return <div className="deposit-panel">
    <p className="label-strong">Review withdrawal</p>
    <dl className="text-t2 text-sm flex flex-col gap-1">
      <div><dt className="inline">You receive: </dt><dd className="inline">{plan.all ? `everything, about ${fmtToken(holding.assets, o.asset)}` : fmtToken(plan.amount, o.asset)} to {address.slice(0, 6)}…{address.slice(-4)} on {CHAIN_LABEL[o.chainId]}</dd></div>
      <div><dt className="inline">From: </dt><dd className="inline">{o.protocol} · {o.name}</dd></div>
      <div><dt className="inline">Fees: </dt><dd className="inline">{fee ? `${fee.label}: ${fee.value}` : "No withdrawal fee charged by the destination"}; network fee shown in your wallet</dd></div>
      <div><dt className="inline">Queue: </dt><dd className="inline">None. Paid out immediately from available liquidity.</dd></div>
    </dl>
    {plan.error && <p className="hue-caution" role="alert">{plan.error}</p>}
    <ol className="flex flex-col gap-1 text-t2 mt-2" aria-label="Transaction steps">
      <li className="flex justify-between gap-3"><span>Switch to {CHAIN_LABEL[o.chainId]}, if needed</span><span>{tx.status.phase === "switching" ? "Confirm in wallet" : ""}</span></li>
      <li className="flex justify-between gap-3"><span>{plan.all ? "Withdraw everything" : "Withdraw"}</span><span>{tx.status.phase === "signing" ? "Confirm in wallet" : tx.status.phase === "pending" ? "Waiting for confirmation" : tx.status.phase === "failed" ? "Failed" : ""}</span></li>
    </ol>
    <p className="sr-only" role="status" aria-live="polite">{tx.status.phase === "pending" ? "Withdrawal sent, waiting for confirmation." : ""}</p>
    {tx.status.phase === "failed" && <p className="hue-caution" role="alert">{tx.status.message}</p>}
    <div className="flex gap-2">
      {live ? <button type="button" className="btn btn-primary" disabled={tx.status.phase === "signing" || tx.status.phase === "pending" || tx.status.phase === "switching"} onClick={run}>
        {tx.status.phase === "signing" || tx.status.phase === "switching" ? "Confirm in your wallet…" : tx.status.phase === "pending" ? "Waiting for confirmation…" : tx.status.phase === "failed" ? "Try again" : "Withdraw"}
      </button> : <p className="text-t2"><strong>Read-only preview.</strong> Withdrawals are not enabled in this environment.</p>}
      {tx.status.phase !== "signing" && tx.status.phase !== "pending" && <button type="button" className="btn btn-quiet" onClick={() => { setPlan(null); tx.reset(); }}>Back</button>}
    </div>
  </div>;

  return <div className="deposit-panel">
    <label className="flex flex-col gap-1">
      <span className="label-strong text-t2">Amount to withdraw</span>
      <span className="flex gap-2 items-center">
        <input className="ctl num w-full" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="0.00" aria-invalid={!!issue} aria-describedby="withdraw-note" />
        <span className="text-t2">{o.asset.symbol}</span>
        <button type="button" className="btn btn-soft" onClick={() => setText(fmtToken(holding.withdrawable, o.asset, o.asset.decimals, false).replace(/,/g, ""))}>Max</button>
      </span>
    </label>
    <p id="withdraw-note" className={`text-sm ${issue ? "hue-caution" : "text-t2"}`}>{issue ?? `Position ${fmtToken(holding.assets, o.asset)} · withdrawable now ${fmtToken(holding.withdrawable, o.asset)}`}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-quiet" disabled={!!issue || !parsed.value} onClick={() => setPlan({ all: parsed.value === holding.assets, amount: parsed.value!, error: null })}>Review withdrawal</button>
      {holding.withdrawable >= holding.assets && <button type="button" className="btn btn-quiet" onClick={() => setPlan({ all: true, amount: holding.assets, error: null })}>Withdraw everything</button>}
    </div>
  </div>;
}
