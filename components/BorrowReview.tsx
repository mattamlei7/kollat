"use client";

import { useEffect, useRef, useState } from "react";
import { CHAIN_LABEL, PROTOCOL_URL } from "@/lib/client-types";
import { amount, pct, usd } from "@/lib/format";
import type { Sim } from "./Rail";
import { WalletBorrow } from "./WalletBorrow";
import { FORK_RPC, executable } from "./WalletSteps";
import { Icon } from "./ui";
import styles from "./BorrowReview.module.css";

export function reviewIssue(sim: Sim, unavailable?: string | null): string | null {
  if (unavailable) return unavailable;
  if (sim.col.error || sim.col.stale) return "This option needs fresh data before you can review it.";
  if (!sim.withinCapacity || sim.amount <= 0) return "Choose a positive amount within this option’s limit.";
  if (sim.apy === null || !Number.isFinite(sim.apy) || sim.apy < 0) return "The borrowing rate is unavailable. Refresh before reviewing.";
  if (!Number.isFinite(sim.hf) || sim.hf <= 1) return "This estimate reaches liquidation immediately. Lower the borrowing amount.";
  if (!PROTOCOL_URL[sim.col.id]) return "This protocol has no supported handoff.";
  return null;
}

/** Compare terms, not refresh timestamps. Full precision stays in the calculation. */
export function reviewTerms(sim: Sim): string {
  return JSON.stringify([
    sim.table.chainId, sim.col.id, sim.cell.market.id, sim.row.holding.token.address,
    sim.amount, sim.max, sim.apy, sim.costPerYear, sim.hf, sim.liq, sim.existingDebt,
    sim.cell.market.collateralPriceUsd, sim.cell.market.liquidationThreshold,
    sim.cell.market.liquidationPenalty, sim.cell.capacity.collateralUsd, sim.row.holding.units, sim.units,
  ]);
}

export function BorrowReview({ sim, unavailable, onBack }: { sim: Sim; unavailable?: string | null; onBack: () => void }) {
  const [terms] = useState(() => reviewTerms(sim));
  const [continued, setContinued] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const changed = terms !== reviewTerms(sim);
  const issue = changed ? "The borrowing details changed. Go back and review the updated estimate." : reviewIssue(sim, unavailable);
  useEffect(() => { heading.current?.focus(); }, [continued]);
  const units = sim.units;
  const symbol = sim.row.holding.token.symbol;
  const live = executable(sim.col.id, sim.table.chainId);

  return <div className="rail-view flex flex-col gap-5">
    <div className="flex items-center gap-3">
      <button type="button" className="btn btn-icon btn-ghost" onClick={onBack} aria-label="Back to simulator"><Icon name="back" /></button>
      <h2 className="heading" ref={heading} tabIndex={-1}>{continued ? (live ? "Borrow with your wallet" : "Continue on the protocol") : "Review borrow"}</h2>
    </div>
    <p className="text-t2">{continued && live ? "Connect your wallet to open this loan. Check each step in your wallet before confirming." : continued ? "Preview complete. Your loan has not been opened. Confirm the latest terms and finish on the protocol’s website." : "Know before you borrow. Check the amount, costs, and liquidation exposure for this estimate."}</p>
    <dl>
      <ReviewLine label="Borrow amount">{usd(sim.amount, { cents: true })} USDC</ReviewLine>
      <ReviewLine label="Collateral used">{amount(units)} {symbol}</ReviewLine>
      <ReviewLine label="Variable annual rate">{sim.apy === null ? "Unavailable" : `${pct(sim.apy)} APY`}</ReviewLine>
      <ReviewLine label="Est. interest / year">{sim.costPerYear === null ? "Unavailable" : usd(sim.costPerYear, { cents: true })}</ReviewLine>
      <ReviewLine label="Protocol">{sim.col.name}</ReviewLine>
      <ReviewLine label="Network">{CHAIN_LABEL[sim.table.chainId]}</ReviewLine>
      <ReviewLine label="Network & other fees">Not included</ReviewLine>
      {sim.existingDebt > 0 && <ReviewLine label="Existing debt in risk">{usd(sim.existingDebt)}</ReviewLine>}
    </dl>
    <div className="wash flex flex-col gap-2" data-tone={sim.hf < 1.2 ? "danger" : "none"}>
      <p className="body-strong">{sim.liq > 0 ? `Liquidation could begin at ${usd(sim.liq, { cents: true })} per ${symbol}.` : "Existing collateral covers the modeled debt at this asset price."}</p>
      <p className="text-t2">Some collateral could be sold to repay debt, plus a {pct(sim.cell.market.liquidationPenalty, 1)} liquidation penalty. Other collateral prices are held constant. Rates and risk can change.</p>
    </div>
    <p className="text-t2">{sim.share < 1 ? `Uses ${pct(sim.share, 0)} of the balance the protocol can accept; the rest stays in your wallet.` : "Uses the whole balance the protocol can accept."} Capacity is an estimate, not loan approval.</p>
    {continued && live ? <>
      {issue && <p className="hue-caution" role="alert">{issue}</p>}
      <WalletBorrow sim={sim} issue={issue} />
    </> : issue ? <p className="hue-caution" role="alert">{issue}</p> : continued ? (
      <a className="btn btn-primary btn-cta" href={PROTOCOL_URL[sim.col.id]} target="_blank" rel="noopener noreferrer">Open {sim.col.name}<Icon name="external" className="w-5 h-5" /></a>
    ) : <>
      <p id="slide-borrow-note" className="text-t2">{live ? <><strong>{FORK_RPC ? "Local fork." : "Real loan."}</strong> Sliding starts the wallet steps; nothing is signed until your wallet asks.</> : <><strong>Read-only preview.</strong> Sliding previews the handoff; it does not sign, deposit collateral, or open a loan.</>}</p>
      <SlideToBorrow onComplete={() => setContinued(true)} />
    </>}
    {!live && <p className="text-t3">Opening a protocol leaves Kollat. Your amounts are not prefilled or transferred. Check fees and terms there before proceeding.</p>}
    <button type="button" className="btn btn-quiet w-full" onClick={onBack}>Edit borrow amount</button>
  </div>;
}

function ReviewLine({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 min-h-[44px] py-2 hair-b"><dt className="text-t2">{label}</dt><dd className="num text-right body-strong">{children}</dd></div>;
}

function SlideToBorrow({ onComplete }: { onComplete: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; distance: number } | null>(null);
  const moved = useRef(false);
  const [progress, setProgress] = useState(0);
  const [confirm, setConfirm] = useState(false);
  function cancel() { drag.current = null; setProgress(0); }
  return <div className="flex flex-col gap-3">
    <div ref={track} className={styles.track}>
      <span className={styles.label}>Slide to borrow</span>
      <button type="button" className={styles.thumb} aria-label="Slide to borrow preview" aria-describedby="slide-borrow-note"
        style={{ left: `calc(4px + (100% - 56px) * ${progress})` }}
        onClick={() => { if (!moved.current) setConfirm(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setConfirm(true); }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          moved.current = false;
          drag.current = { start: e.clientX, distance: Math.max(1, (track.current?.clientWidth ?? 56) - 56) };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          if (Math.abs(e.clientX - drag.current.start) > 4) moved.current = true;
          setProgress(Math.max(0, Math.min(1, (e.clientX - drag.current.start) / drag.current.distance)));
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const complete = (e.clientX - drag.current.start) / drag.current.distance >= 0.95;
          cancel();
          if (complete) onComplete();
        }}
        onPointerCancel={cancel} onLostPointerCapture={cancel}
      ><Icon name="chevron" className="w-6 h-6" /></button>
    </div>
    {confirm ? <button type="button" className="btn btn-primary btn-cta" onClick={onComplete}>Confirm preview · no funds move</button>
      : <button type="button" className="btn btn-quiet w-full" onClick={() => setConfirm(true)}>Use a button instead</button>}
  </div>;
}
