"use client";

import { useEffect, useRef, useState } from "react";
import { fmtUsdc, type Route, type RouteList } from "@/lib/eligibility";
import { pct, usd } from "@/lib/format";
import { Badge } from "./ui";

export const LOWEST_NOTE = "Lowest current variable APY among the supported eligible routes shown. Excludes transaction costs and future rate changes.";

interface Props {
  routes: RouteList;
  amount: number;
  symbol: string;
  /** Key of the selected route, if any. Nothing is chosen for the borrower. */
  selected: string | null;
  onSelect: (route: Route) => void;
  onEditCollateral: () => void;
  onEditAmount: () => void;
}

/** One row per route (protocol and market), rate first. Ineligible routes wait, with their reasons, under "Other routes". */
export function RouteTable({ routes, amount, symbol, selected, onSelect, onEditCollateral, onEditAmount }: Props) {
  const { eligible, other, unsupported, lowest, specified } = routes;
  const selectedOther = other.some((r) => r.key === selected);
  const [showOther, setShowOther] = useState(selectedOther);
  const list = useRef<HTMLDivElement>(null);
  const otherOpen = showOther || selectedOther;

  // Reveal the selected route (for example after "Compare route" in the summary) without jumping the page.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>("[data-selected]");
    if (!row) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, [selected]);

  const reasons = summarise(other);
  const otherCount = other.length + unsupported.length;

  return (
    <div ref={list} className="flex flex-col gap-3">
      <p className="text-t2" role="status">
        {specified
          ? eligible.length
            ? `${eligible.length} route${eligible.length === 1 ? "" : "s"} can fund ${fmtUsdc(amount)} USDC`
            : `No route can fund ${fmtUsdc(amount)} USDC with this collateral`
          : `Indicative variable rates for ${symbol}. Enter a collateral amount and a borrow amount to see which routes can fund your loan.`}
      </p>

      {specified && eligible.length === 0 ? (
        <div className="route-empty">
          <p className="body">
            {reasons || "No supported route has fresh data for this request."} Your amounts have not been changed.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn-soft" onClick={onEditCollateral}>Edit collateral</button>
            <button type="button" className="btn btn-soft" onClick={onEditAmount}>Edit borrow amount</button>
          </div>
        </div>
      ) : (
        <div className="route-list" role="radiogroup" aria-label="Routes">
          <div className="route-head" aria-hidden="true">
            <span>Protocol</span>
            <span className="num-col">Variable APY</span>
            <span className="num-col">Est. interest / month</span>
            <span className="num-col">Price drop to liquidation</span>
            <span />
          </div>
          {eligible.map((r) => (
            <RouteRow key={r.key} route={r} amount={amount} specified={specified} selected={selected === r.key} lowest={lowest.includes(r.key)} tied={lowest.length > 1} onSelect={onSelect} />
          ))}
        </div>
      )}

      {lowest.length > 0 && <p className="text-sm text-t2"><Badge>Lowest rate</Badge> {LOWEST_NOTE}</p>}

      {otherCount > 0 && (
        <div>
          <button type="button" className="btn btn-soft" aria-expanded={otherOpen} aria-controls="other-routes" onClick={() => setShowOther((s) => !s)}>
            {otherOpen ? "Hide" : "Show"} other routes ({otherCount})
          </button>
          {otherOpen && (
            <div id="other-routes" className="route-list route-list-other mt-3" role="radiogroup" aria-label="Other routes">
              {other.map((r) => (
                <RouteRow key={r.key} route={r} amount={amount} specified={specified} selected={selected === r.key} lowest={false} tied={false} onSelect={onSelect} other />
              ))}
              {unsupported.map(({ col, reason }) => (
                <div key={col.key} className="route-row route-row-static">
                  <span className="route-name">{col.name}</span>
                  <span className="route-reason text-t3">{reason === "Fresh data unavailable" ? reason : `Unsupported collateral${reason && reason !== "not listed" ? ` (${reason})` : ""}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Why nothing funds the request, by cause, without repeating every shortfall. */
function summarise(other: Route[]) {
  const count = (label: string) => other.filter((r) => r.check.label === label).length;
  const parts = [
    ["Insufficient collateral", count("Insufficient collateral")],
    ["limited market liquidity", count("Limited market liquidity")],
    ["a supply cap on collateral", count("Supply cap")],
    ["fresh data unavailable", other.filter((r) => r.check.status === "no-data").length],
    ["no current rate", other.filter((r) => r.check.status === "fundable" && r.check.apy === null).length],
    ["it would open at liquidation", count("Would open at liquidation")],
  ].filter(([, n]) => (n as number) > 0) as [string, number][];
  if (!parts.length) return "";
  return `Limiting factors: ${parts.map(([text, n]) => `${text} (${n} route${n === 1 ? "" : "s"})`).join(", ")}.`;
}

function RouteRow({ route, amount, specified, selected, lowest, tied, onSelect, other = false }: {
  route: Route; amount: number; specified: boolean; selected: boolean; lowest: boolean; tied: boolean; onSelect: (r: Route) => void; other?: boolean;
}) {
  const { check } = route;
  const rate = check.apy === null ? "Unavailable" : pct(check.apy);
  const monthly = specified && check.apy !== null ? usd((amount * check.apy) / 12, { cents: true }) : "—";
  const drop = !specified || check.status !== "fundable" ? "—" : check.existingDebt > 0 ? "See details" : check.liq > 0 ? pct(-check.drop, 1) : "—";
  const reason = other ? (check.apy === null && check.status === "fundable" ? "Rate unavailable" : check.label || "Fresh data unavailable") : null;
  return (
    <label className="route-row" data-selected={selected || undefined}>
      <input type="radio" name="route" className="sr-only" checked={selected} onChange={() => onSelect(route)} />
      <span className="route-name">
        <span className="body-strong">{route.label}</span>
        <span className="text-sm text-t2">{specified ? `Limit ${usd(check.max)} on this collateral` : `Up to ${usd(check.max)}`}</span>
      </span>
      <span className="route-rate num num-col">
        <span className="route-cell-label" aria-hidden="true">APY</span>
        <span className="body-strong">{rate}</span>
        {lowest && <Badge>{tied ? "Lowest rate (tied)" : "Lowest rate"}</Badge>}
      </span>
      <span className="num num-col"><span className="route-cell-label" aria-hidden="true">Interest / month</span>{monthly}</span>
      <span className="num num-col"><span className="route-cell-label" aria-hidden="true">Drop to liquidation</span>{drop}</span>
      <span className="route-action">
        {reason ? (
          <details className="route-why" onClick={(e) => e.stopPropagation()}>
            <summary className="text-t3 text-sm">{reason}</summary>
            <span className="text-sm text-t2">{check.detail}</span>
          </details>
        ) : (
          <span className="pick-action" aria-hidden="true">{selected ? "Selected" : "Select"}</span>
        )}
      </span>
      <span className="sr-only">{`${route.label}: ${check.apy === null ? "variable APY unavailable" : `${rate} variable APY`}${lowest ? ", lowest rate" : ""}. ${check.reason || ""} ${check.detail}`}</span>
    </label>
  );
}
