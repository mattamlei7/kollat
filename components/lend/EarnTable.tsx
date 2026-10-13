"use client";

import { useState } from "react";
import { CHAIN_LABEL } from "@/lib/client-types";
import { capacityLeft, withdrawalState, yearlyEarnings, type Row } from "@/lib/earn/rank";
import { PRODUCT_LABEL, type Opportunity } from "@/lib/earn/types";
import { Badge } from "../ui";
import { fmtAgo, fmtApy, fmtToken } from "./format";

export const EARNINGS_NOTE = "Estimate assumes today’s APY stays unchanged for one year. Excludes network fees and token rewards.";

interface Props {
  rows: Row[];
  amount: bigint | null;
  selected: string | null;
  onSelect: (id: string) => void;
}

/** One asset on one network: a row per destination, highest net base APY first among those accepting the deposit. */
export function EarnTable({ rows, amount, selected, onSelect }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const eligible = rows.filter((r) => r.eligible).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-t2" role="status">
        {eligible === 0 ? "No destination is accepting this deposit right now." : `${eligible} destination${eligible === 1 ? "" : "s"} accepting ${amount ? "this deposit" : "deposits"}.`}
      </p>
      <div className="earn-list" role="radiogroup" aria-label="Earning options">
        <div className="earn-head" aria-hidden="true">
          <span>Destination</span>
          <span className="num-col">Net base APY</span>
          <span className="num-col">Est. earnings / year</span>
          <span>Withdrawal</span>
          <span />
        </div>
        {rows.map((r) => (
          <EarnRow key={r.opp.id} row={r} amount={amount} selected={selected === r.opp.id} expanded={open === r.opp.id}
            onSelect={() => onSelect(r.opp.id)} onToggle={() => setOpen((o) => (o === r.opp.id ? null : r.opp.id))} />
        ))}
      </div>
      <p className="text-sm text-t2">{EARNINGS_NOTE} Net base APY is after the destination’s ongoing fees; token rewards are listed separately under the rate when a destination reports them.</p>
    </div>
  );
}

export function rewardsText(o: Opportunity) {
  if (o.rewards === null) return "Not tracked";
  if (o.rewards.length === 0) return "None";
  return o.rewards.map((r) => `${(r.apr * 100).toFixed(2)}% APR in ${r.token}`).join(", ");
}

export function withdrawalText(o: Opportunity, amount: bigint | null) {
  const w = withdrawalState(o, amount);
  return { ...w, detail: w.liquidity === null ? "Liquidity could not be read" : `${fmtToken(w.liquidity, o.asset, 0)} withdrawable now` };
}

function EarnRow({ row, amount, selected, expanded, onSelect, onToggle }: { row: Row; amount: bigint | null; selected: boolean; expanded: boolean; onSelect: () => void; onToggle: () => void }) {
  const o = row.opp;
  const earn = amount ? yearlyEarnings(o, amount) : null;
  const w = withdrawalText(o, amount);
  const detailsId = `earn-details-${o.id.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className="earn-item" data-selected={selected || undefined} data-muted={!row.eligible || undefined}>
      <label className="earn-row">
        <input type="radio" name="earn" className="sr-only" checked={selected} disabled={!row.eligible} onChange={onSelect} />
        <span className="earn-dest">
          <span className="body-strong">{PRODUCT_LABEL[o.product]}</span>
          <span className="text-sm text-t2">{o.name}{o.operator && o.product === "morpho-vault" ? ` · curated by ${o.operator}` : ""}</span>
        </span>
        <span className="num num-col">
          <span className="earn-cell-label" aria-hidden="true">Net base APY</span>
          <span className="body-strong">{fmtApy(o.baseApy)}</span>
          <span className="text-sm text-t2">{o.baseApy === null ? "" : o.rateKind === "governance-set" ? "Governance-set" : "Variable"}</span>
          {o.rewards && o.rewards.length > 0 && <span className="text-sm text-t2">+ {rewardsText(o)} rewards</span>}
          {row.highest && <Badge>Highest base APY</Badge>}
        </span>
        <span className="num num-col">
          <span className="earn-cell-label" aria-hidden="true">Est. earnings / year</span>
          {amount === null ? <span className="text-t2">Enter an amount</span> : earn === null ? "Unavailable" : `≈ ${earn.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${o.asset.symbol}`}
        </span>
        <span className="earn-wd">
          <span className="earn-cell-label" aria-hidden="true">Withdrawal</span>
          <span className={w.state === "Available now" ? "" : "hue-caution"}>{w.state}</span>
          {w.state !== "Available now" && <span className="text-sm text-t2">{w.liquidity === null ? "Liquidity could not be read" : `Only ${fmtToken(w.liquidity, o.asset, 0)} free now`}</span>}
        </span>
        <span className="earn-action">
          {row.eligible ? <span className="pick-action" aria-hidden="true">{selected ? "Selected" : "Select"}</span> : <span className="text-sm text-t3">{row.reason}</span>}
        </span>
      </label>
      <button type="button" className="btn btn-text earn-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}>
        {expanded ? "Hide details" : "Details"}<span className="sr-only"> for {o.name} on {CHAIN_LABEL[o.chainId]}</span>
      </button>
      {expanded && <Details id={detailsId} o={o} amount={amount} />}
    </div>
  );
}

function Details({ id, o, amount }: { id: string; o: Opportunity; amount: bigint | null }) {
  const left = capacityLeft(o);
  const lines: [string, React.ReactNode][] = [
    ["Product", `${o.protocol} · ${PRODUCT_LABEL[o.product]} · ${o.name}`],
    ["Contract", <a key="c" className="btn-text num break-all" href={o.explorerUrl} target="_blank" rel="noreferrer">{o.target}</a>],
    ["Network", CHAIN_LABEL[o.chainId]],
    ["Curator / operator", o.operator ?? "None"],
    ["Funds are used for", o.usedFor],
    ["What you are exposed to", o.exposure],
    ...(o.conversion ? [["Conversion", o.conversion] as [string, React.ReactNode]] : []),
    ["Base yield", `${fmtApy(o.baseApy)} APY (${o.rateKind === "governance-set" ? "governance-set, can change by vote" : "variable, changes with supply and demand"})`],
    ["Incentive yield", rewardsText(o)],
    ...((o.fees ?? [{ label: "Fees", value: "Unavailable" }]).map((f) => [f.label, f.value] as [string, React.ReactNode])),
    ["Deposit capacity", o.capacity === null ? "Unavailable" : o.capacity === "unlimited" ? "No cap" : `${fmtToken(left!, o.asset, 0)} more accepted${amount !== null && left! < amount ? " (less than your amount)" : ""}`],
    ["Withdrawals", `${o.withdrawal} ${withdrawalText(o, amount).detail}.`],
    ["Receipt", `${o.receipt.symbol} (${o.receipt.kind})`],
    ["Data as of", `${fmtAgo(o.fetchedAt)}${o.error ? ` · ${o.error}` : ""}`],
  ];
  return (
    <div id={id} className="earn-details">
      <dl>
        {lines.map(([k, v]) => <div key={k}><dt className="text-t2">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {o.allocations && (
        <div className="mt-3">
          <p className="label-strong">Current allocation, by borrower collateral</p>
          <ul className="earn-alloc">
            {o.allocations.slice(0, 6).map((a) => <li key={a.label}><span>{a.label}</span><span className="num">{(a.share * 100).toFixed(1)}%</span></li>)}
          </ul>
          {o.allocations.length > 6 && <p className="text-sm text-t2">and {o.allocations.length - 6} more.</p>}
        </div>
      )}
      <p className="text-sm mt-3"><a className="btn-text" href={o.docsUrl} target="_blank" rel="noreferrer">{o.protocol} documentation</a> · <a className="btn-text" href={o.explorerUrl} target="_blank" rel="noreferrer">View on block explorer</a></p>
    </div>
  );
}
