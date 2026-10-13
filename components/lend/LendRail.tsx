"use client";

import { useRef, useState } from "react";
import type { Address, Hash } from "viem";
import { CHAIN_LABEL } from "@/lib/client-types";
import { depositPlan, readFundingFor } from "@/lib/earn/execute";
import { reviewChange, reviewedTerms, yearlyEarnings, type Reviewed } from "@/lib/earn/rank";
import { PRODUCT_LABEL, type Opportunity } from "@/lib/earn/types";
import type { PlanStep } from "@/lib/execution";
import { Section, SummaryLine } from "../Rail";
import { CAP_USD, FORK_RPC, MAINNET } from "../WalletSteps";
import { EARNINGS_NOTE, rewardsText, withdrawalText } from "./EarnTable";
import { fmtApy, fmtToken } from "./format";
import { earnReader, lendLive, useTxRunner, type TxStatus } from "./useWalletTx";
import { EXPLORER, type EarnChain } from "@/lib/earn/registry";

interface Props {
  opp: Opportunity | null;
  amount: bigint | null;
  /** Why the amount cannot be deposited (precision, balance, capacity), if anything. */
  amountIssue: string | null;
  /** The amount itself is invalid (shown under the input); disables the button without repeating the message. */
  blocked?: boolean;
  address: Address | null;
  onConnect: () => void;
  /** Fetch fresh destination data just before executing; null if it could not be read. */
  refresh: (id: string) => Promise<Opportunity | null>;
  /** Re-read wallet and position balances after a confirmed deposit; throws if the refresh fails. */
  onDeposited: (o: Opportunity) => Promise<void>;
  onViewPosition: () => void;
}

export const txUrl = (chainId: number, hash: Hash) => `${EXPLORER[chainId as EarnChain]}/tx/${hash}`;

export function LendRail(p: Props) {
  const confirming = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [review, setReview] = useState<{ terms: Reviewed; steps: PlanStep[]; allowance: bigint; error: string | null } | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: bigint; opp: Opportunity; hash: Hash; refreshError: string | null } | null>(null);
  const tx = useTxRunner(p.opp?.chainId ?? 1);
  const o = p.opp;

  if (success) return <Success s={success} onDone={() => { setSuccess(null); setReview(null); tx.reset(); }} onView={p.onViewPosition} />;

  if (!o || p.amount === null) {
    return <div className="rail-view flex flex-col gap-3">
      <p className="text-t2">{!o ? "Choose an earning option to review your deposit." : "Enter an amount to deposit."}</p>
    </div>;
  }

  const amount = p.amount;
  const live = lendLive(o.chainId);
  const overCap = MAINNET && Number(amount) / 10 ** o.asset.decimals > CAP_USD;
  const stale = review ? reviewChange(review.terms, o, amount) : null;
  const earn = yearlyEarnings(o, amount);
  const w = withdrawalText(o, amount);

  async function openReview() {
    setChanged(null);
    if (!p.address) { p.onConnect(); return; }
    try {
      const f = await readFundingFor(earnReader(o!.chainId), o!, p.address);
      const steps = depositPlan({ dest: o!, user: p.address, amount, balance: f.balance, allowance: f.allowance, capacity: f.capacity });
      setReview({ terms: reviewedTerms(o!, amount), steps, allowance: f.allowance, error: null });
    } catch (e) {
      setReview({ terms: reviewedTerms(o!, amount), steps: [], allowance: 0n, error: (e as Error).message });
    }
  }

  async function confirm() {
    if (!p.address || !review || confirming.current || !live || overCap || p.amountIssue) return;
    confirming.current = true;
    setPreparing(true);
    try {
    // Revalidate destination data, balance, allowance and capacity right before signing.
    const fresh = await p.refresh(o!.id);
    if (!fresh) { setChanged("Could not refresh the destination’s rate and capacity. Nothing was sent; try again."); return; }
    const change = reviewChange(review.terms, fresh, amount);
    if (change) { setChanged(`${change} Check the new terms and review again. Nothing was sent.`); setReview(null); return; }
    let steps: PlanStep[];
    try {
      const f = await readFundingFor(earnReader(o!.chainId), fresh, p.address);
      // Rebuilt from chain state: an approval confirmed in an earlier attempt shows up in the allowance and is dropped.
      steps = depositPlan({ dest: fresh, user: p.address, amount, balance: f.balance, allowance: f.allowance, capacity: f.capacity });
    } catch (e) { setChanged(`${(e as Error).message} Nothing was sent.`); return; }
    setReview({ ...review, steps });
    const hash = await tx.run(p.address, steps, "deposit");
    if (!hash) return;
    // The receipt is the success signal; balances refresh afterwards and a failed refresh is reported, not hidden.
    setSuccess({ amount, opp: fresh, hash, refreshError: null });
    p.onDeposited(fresh).catch((e: Error & { shortMessage?: string }) => setSuccess((s) => s && { ...s, refreshError: e.shortMessage ?? e.message.split("\n")[0] }));
    } finally { confirming.current = false; setPreparing(false); }
  }

  if (review) {
    const approve = review.steps.find((s) => s.label.startsWith("Approve"));
    return <div className="rail-view flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-icon btn-ghost" aria-label="Back to summary" disabled={tx.status.phase === "signing" || tx.status.phase === "pending"} onClick={() => { setReview(null); tx.reset(); }}>‹</button>
        <h2 className="heading">Review deposit</h2>
      </div>
      <dl>
        <SummaryLine label="Deposit">{fmtToken(amount, o.asset)}</SummaryLine>
        <SummaryLine label="Network">{CHAIN_LABEL[o.chainId]}</SummaryLine>
        <SummaryLine label="Destination">{PRODUCT_LABEL[o.product]}<br /><span className="text-t2 font-normal">{o.name}</span></SummaryLine>
        <SummaryLine label="Current yield">{fmtApy(o.baseApy)} <span className="text-t2 font-normal">{o.rateKind === "governance-set" ? "governance-set" : "variable"}</span></SummaryLine>
        <SummaryLine label="You receive">{o.receipt.symbol} <span className="text-t2 font-normal">({o.receipt.kind})</span></SummaryLine>
        <SummaryLine label="Approval">{approve ? <>Exactly {fmtToken(amount, o.asset)}<br /><span className="text-t2 font-normal num break-all">to {o.target}</span></> : "Not needed"}</SummaryLine>
        <SummaryLine label="Network fees">Shown in your wallet</SummaryLine>
      </dl>
      <div className="text-sm text-t2 flex flex-col gap-2">
        {(o.fees ?? []).map((f) => <p key={f.label}><strong>{f.label}:</strong> {f.value}</p>)}
        {o.conversion && <p><strong>Conversion:</strong> {o.conversion}</p>}
        <p><strong>Withdrawals:</strong> {o.withdrawal} {w.detail}.</p>
        <p>The rate can change at any time after you deposit.</p>
      </div>
      {review.error && <p className="hue-caution" role="alert">{review.error}</p>}
      {stale && <p className="hue-caution" role="alert">{stale} <button type="button" className="btn-text" onClick={openReview}>Review again</button></p>}
      {changed && <p className="hue-caution" role="alert">{changed}</p>}
      {review.steps.length > 0 && <Steps steps={review.steps} status={tx.status} confirmed={tx.confirmed} chainSwitch={CHAIN_LABEL[o.chainId]} />}
      {!live ? <p className="text-t2"><strong>Read-only preview.</strong> Deposits are not enabled in this environment; nothing can be signed here.</p>
        : overCap ? <p className="hue-caution" role="alert">Deposits are limited to {CAP_USD} {o.asset.symbol} for now. Lower the amount.</p>
        : !review.error && !stale && <>
          <p className="text-t2"><strong>{FORK_RPC ? "Local fork." : "Real funds."}</strong> Your wallet asks you to confirm each step.</p>
          <button type="button" className="btn btn-primary btn-cta" disabled={preparing || !!p.amountIssue || tx.status.phase === "signing" || tx.status.phase === "pending" || tx.status.phase === "switching"} onClick={confirm}>
            {tx.status.phase === "signing" || tx.status.phase === "switching" ? "Confirm in your wallet…" : tx.status.phase === "pending" ? "Waiting for confirmation…" : tx.status.phase === "failed" ? "Try again" : "Deposit"}
          </button>
        </>}
    </div>;
  }

  return <div className="rail-view flex flex-col gap-4">
    <h2 className="heading">{o.protocol} · {o.name}</h2>
    <dl>
      <SummaryLine label="You deposit">{fmtToken(amount, o.asset)}</SummaryLine>
      <SummaryLine label="Destination">{PRODUCT_LABEL[o.product]}</SummaryLine>
      <SummaryLine label="Network">{CHAIN_LABEL[o.chainId]}</SummaryLine>
      <SummaryLine label="Net base APY">{fmtApy(o.baseApy)} <span className="text-t2 font-normal">{o.rateKind === "governance-set" ? "governance-set" : "variable"}</span></SummaryLine>
      <SummaryLine label="Est. earnings / year">{earn === null ? "Unavailable" : `≈ ${earn.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${o.asset.symbol}`}</SummaryLine>
      <SummaryLine label="Rewards">{rewardsText(o)}</SummaryLine>
      <SummaryLine label="Withdrawal"><span className={w.state === "Available now" ? "" : "hue-caution"}>{w.state}</span><br /><span className="text-t2 font-normal text-sm">{w.detail}</span></SummaryLine>
      <SummaryLine label="Network fees">Shown in your wallet</SummaryLine>
    </dl>
    <p className="text-sm text-t2 -mt-2">{EARNINGS_NOTE}</p>
    {p.amountIssue && <p className="hue-caution" role="alert">{p.amountIssue}</p>}
    {changed && <p className="hue-caution" role="alert">{changed}</p>}
    <button type="button" className="btn btn-primary btn-cta" disabled={!!p.amountIssue || !!p.blocked} onClick={openReview}>{p.address ? "Review deposit" : "Connect wallet to review"}</button>
    <div>
      <Section title="Know before you deposit"><KnowBeforeYouDeposit o={o} /></Section>
    </div>
  </div>;
}

function Steps({ steps, status, confirmed, chainSwitch }: { steps: PlanStep[]; status: TxStatus; confirmed: number; chainSwitch: string }) {
  const stateOf = (i: number) => i < confirmed ? "Confirmed"
    : status.phase === "signing" && status.step === i ? "Confirm in wallet"
    : status.phase === "pending" && status.step === i ? "Waiting for confirmation"
    : status.phase === "failed" && status.step === i ? "Failed" : "";
  return <div className="flex flex-col gap-2">
    <ol className="flex flex-col gap-1" aria-label="Transaction steps">
      <li className="flex justify-between gap-3 text-t2"><span>Switch to {chainSwitch}, if needed</span><span>{status.phase === "switching" ? "Confirm in wallet" : status.phase === "failed" && status.step === -1 ? "Failed" : ""}</span></li>
      {steps.map((s, i) => <li key={s.label} className="flex justify-between gap-3 text-t2"><span>{s.label === "Deposit" ? "Deposit" : s.label}</span><span>{stateOf(i)}</span></li>)}
      <li className="flex justify-between gap-3 text-t2"><span>Confirm on-chain</span><span>{status.phase === "done" ? "Confirmed" : ""}</span></li>
    </ol>
    <p className="sr-only" role="status" aria-live="polite">{status.phase === "pending" ? "Transaction sent, waiting for confirmation." : status.phase === "signing" ? "Confirm the transaction in your wallet." : status.phase === "done" ? "Deposit confirmed." : ""}</p>
    {status.phase === "pending" && <p className="text-t2 text-sm">Sent. Waiting for confirmation…</p>}
    {status.phase === "failed" && <p className="hue-caution" role="alert">{status.message}</p>}
  </div>;
}

function Success({ s, onDone, onView }: { s: { amount: bigint; opp: Opportunity; hash: Hash; refreshError: string | null }; onDone: () => void; onView: () => void }) {
  return <div className="rail-view flex flex-col gap-3" role="status">
    <h2 className="heading">Deposit complete.</h2>
    <p className="text-t2">{fmtToken(s.amount, s.opp.asset)} deposited to {s.opp.protocol} · {s.opp.name} on {CHAIN_LABEL[s.opp.chainId]}.</p>
    <a className="btn-text" href={txUrl(s.opp.chainId, s.hash)} target="_blank" rel="noreferrer">{FORK_RPC ? `Transaction ${s.hash.slice(0, 10)}… (local fork; not on the public explorer)` : "View transaction"}</a>
    {s.refreshError && <p className="hue-caution">The deposit is confirmed, but your balances could not be refreshed: {s.refreshError}. Reload to see the new position.</p>}
    <div className="flex gap-2">
      <button type="button" className="btn btn-primary" onClick={() => { onView(); onDone(); }}>View position</button>
      <button type="button" className="btn btn-quiet" onClick={onDone}>Done</button>
    </div>
  </div>;
}

/** The risks that apply to the selected destination, plainly. */
function KnowBeforeYouDeposit({ o }: { o: Opportunity }) {
  const items = [
    ...(o.product === "aave-supply" || o.product === "sparklend-supply" ? ["This deposit may also be used as collateral in the pool. If you borrow against it, withdrawals must preserve your loan's collateral requirements and the deposit can be liquidated."] : []),
    o.rateKind === "governance-set" ? "The rate is set by Sky governance and can be changed by vote at any time." : "The rate is variable. It moves with how much is borrowed and can fall after you deposit.",
    o.product === "morpho-vault" ? `Losses in the lending markets this vault uses, or a smart-contract failure in Morpho or the vault, can reduce what you get back.`
      : o.product === "spark-savings" ? "A smart-contract failure in Spark, Sky or the PSM can reduce what you get back."
      : `Bad debt in the ${o.protocol === "Spark" ? "SparkLend" : "Aave"} pool or a smart-contract failure can reduce what you get back.`,
    o.product === "spark-savings" ? "You hold USDS while deposited. If USDS or USDC loses its peg, you can get back less than you put in." : "USDC is a stablecoin; if it loses its peg, so does your deposit.",
    `Withdrawals depend on available liquidity: ${o.withdrawal.toLowerCase()} No queue applies; if liquidity is short you wait until borrowers repay or new deposits arrive.`,
    ...(o.product === "morpho-vault" ? [`${o.operator ?? "The curator"} can change which markets the vault lends to, within the vault’s configured limits and timelocks.`] : []),
    "Nothing here is insured or guaranteed.",
  ];
  return <ul className="flex flex-col gap-2 text-sm text-t2 list-disc pl-5">{items.map((t) => <li key={t}>{t}</li>)}</ul>;
}
