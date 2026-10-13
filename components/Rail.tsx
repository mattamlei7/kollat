"use client";

import { useEffect, useState } from "react";
import { CHAIN_LABEL } from "@/lib/client-types";
import { BorrowReview, reviewIssue } from "./BorrowReview";
import { amount as fmtAmount, pct, timeAgo, usd } from "@/lib/format";
import { marketsOf, type ChainTable, type Column, type PositionView, type Row } from "@/lib/join";
import { assessRoute, fmtUsdc, routesFor, type CapacityCell, type RouteCheck } from "@/lib/eligibility";
import { annualCostDelta, distanceToLiquidation, riskBand, type RiskBand } from "@/lib/math/health";
import { hueClass } from "./Risk";
import { Def, Icon } from "./ui";

/** Which (chain, holding, protocol, market) the summary describes. */
export interface Selection {
  chainId: number;
  rowKey: string;
  colKey: string;
  /** The market within the protocol; the protocol's largest market when omitted. */
  marketId?: string;
}
export type RailView = "sim" | "review";

export interface Sim {
  table: ChainTable;
  row: Row;
  col: Column;
  cell: CapacityCell;
  /** Columns that can lend against this holding. */
  cols: Column[];
  max: number;
  amount: number;
  /** Collateral pledged, in token units, and as a share of what this route accepts. */
  units: number;
  share: number;
  /** A capacity comparison only, not a policy approval or executable quote. */
  withinCapacity: boolean;
  hf: number;
  band: RiskBand;
  liq: number;
  /** Fractional move from today's price to the liquidation price (negative = drop). */
  dist: number;
  /** Debt this address already carries on the same protocol (same pool, or same isolated market). */
  existingDebt: number;
  apy: number | null;
  costPerYear: number | null;
  /** An eligible route that funds the same amount on the same collateral at a lower variable APY. */
  cheaper: { selection: Selection; label: string; apy: number; saving: number } | null;
  /** The shared eligibility check for this route: the same one the comparison and the review gate use. */
  check: RouteCheck;
}

export const rowKeyOf = (row: Row) => row.holding.token.address.toLowerCase();

const capacityCols = (table: ChainTable, row: Row) => table.columns.filter((c) => marketsOf(row, c.key).length > 0);

export { foldable } from "@/lib/eligibility";

/** Pure: everything the summary needs for one borrow. `units` is the collateral quantity; null means not entered yet. */
export function simulate(tables: ChainTable[], sel: Selection | null, amount: number, positions: PositionView[] | null = null, units: number | null = null): Sim | null {
  if (!sel || !Number.isFinite(amount) || amount < 0) return null;
  const table = tables.find((t) => t.chainId === sel.chainId);
  const row = table?.rows.find((r) => rowKeyOf(r) === sel.rowKey);
  if (!table || !row) return null;
  const cols = capacityCols(table, row);
  const col = cols.find((c) => c.key === sel.colKey);
  if (!col) return null;
  const markets = marketsOf(row, col.key);
  const cell = markets.find((m) => m.market.id === sel.marketId) ?? markets[0];
  const check = assessRoute(table, row, col, amount, units, positions, cell)!;
  const { max, hf, liq, existingDebt, apy } = check;
  const withinCapacity = amount <= max;

  // Only a route that funds the same amount on the same collateral, on fresh data with a known rate, is offered.
  let cheaper: Sim["cheaper"] = null;
  if (apy !== null && amount > 0) {
    const best = routesFor(table, row, amount, units, positions).eligible.find((r) => r.check.marketId !== cell.market.id || r.col.key !== col.key);
    if (best && best.check.apy !== null && best.check.apy < apy - 1e-9 && best.check.units === check.units) {
      cheaper = {
        selection: { chainId: table.chainId, rowKey: rowKeyOf(row), colKey: best.col.key, marketId: best.cell.market.id },
        label: best.label,
        apy: best.check.apy,
        saving: annualCostDelta(amount, apy, best.check.apy),
      };
    }
  }

  return {
    table, row, col, cell, cols, max, amount, units: check.units, withinCapacity, hf, existingDebt, check,
    share: check.acceptedUnits > 0 ? check.units / check.acceptedUnits : 0,
    band: riskBand(hf),
    liq,
    dist: distanceToLiquidation(cell.market.collateralPriceUsd, liq),
    apy,
    costPerYear: apy === null ? null : amount * apy,
    cheaper,
  };
}

interface RailProps {
  sim: Sim | null;
  /** The one instruction shown when there is no loan to summarise yet. */
  hint: string;
  positions: PositionView[] | null;
  /** Select a route, e.g. the lower-rate one the summary points to. */
  onSelect: (s: Selection) => void;
  view: RailView;
  onView: (v: RailView) => void;
  /** Required account/market reads, supplied by the public explorer. */
  reviewUnavailable?: string | null;
  oldestReadAt?: number;
}

export function Rail(props: RailProps) {
  const { sim, view } = props;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  const expired = props.oldestReadAt !== undefined && (!now || !Number.isFinite(props.oldestReadAt) || now - props.oldestReadAt > 15 * 60_000 || props.oldestReadAt > now + 30_000);
  const unavailable = props.reviewUnavailable || (expired ? "Refresh the account to review an up-to-date estimate." : null);
  if (sim && view === "review") return <BorrowReview sim={sim} unavailable={unavailable} onBack={() => props.onView("sim")} />;
  return <Summary key="sim" {...props} reviewUnavailable={unavailable} />;
}

/** Announce the summary only once typing pauses, so a screen reader is not interrupted on every keystroke. */
function useSettled(text: string, ms = 900) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}

/**
 * The selected loan in a few lines: route, what you receive, what you pledge, the rate, the interest estimate and
 * where it would be liquidated, then the way to review it. Details and assumptions fold away beneath.
 * Inputs live in the main column; nothing here edits them.
 */
function Summary({ sim, hint, onSelect, onView, reviewUnavailable }: RailProps) {
  const ready = !!sim && sim.amount > 0 && sim.units > 0 && sim.check.status !== "no-amount";
  const announcement = useSettled(!ready || !sim ? "" : `${sim.col.name}: ${sim.check.reason || sim.check.label}.`);

  if (!ready || !sim) {
    return (
      <div className="rail-view">
        <p className="body text-t2">{hint}</p>
      </div>
    );
  }

  const check = sim.check;
  const sym = sim.row.holding.token.symbol;
  const price = sim.cell.market.collateralPriceUsd;
  const drop = pct(Math.max(0, -sim.dist), 1);
  const issue = check.status === "fundable" ? reviewIssue(sim, reviewUnavailable) : null;

  return (
    <div className="rail-view flex flex-col gap-5">
      <h2 className="heading">{sim.col.name} · {sym} / USDC</h2>

      <dl className="loan-summary">
        <SummaryLine label="You receive">{fmtUsdc(sim.amount)} USDC</SummaryLine>
        <SummaryLine label="You pledge">
          {fmtAmount(sim.units)} {sym} <span className="text-t2 font-normal">· ≈ {usd(sim.units * price)}</span>
        </SummaryLine>
        <SummaryLine label="Variable borrowing rate">{sim.apy === null ? "Unavailable" : <>{pct(sim.apy)} <Def term="apy" right>APY</Def></>}</SummaryLine>
        <SummaryLine label="Estimated interest">
          {sim.costPerYear === null ? "Unavailable" : (
            <span className="flex flex-col items-end">
              <span>≈ {usd(sim.costPerYear / 12, { cents: true })} / month</span>
              <span className="text-t2 font-normal">≈ {usd(sim.costPerYear)} / year</span>
            </span>
          )}
        </SummaryLine>
        <SummaryLine label={<Def term="liq">Liquidation exposure</Def>}>
          {check.status !== "fundable"
            ? "Resolve eligibility first"
            : sim.existingDebt > 0
            ? <span className="flex flex-col items-end"><span className={hueClass(sim.band)}>≈ {usd(sim.liq, { cents: true })}</span><span className="text-t2 font-normal">Includes existing debt</span></span>
            : sim.liq > 0
              ? <span className="flex flex-col items-end"><span className={hueClass(sim.band)}>≈ {usd(sim.liq, { cents: true })}</span><span className="text-t2 font-normal whitespace-nowrap">{drop} below today</span></span>
              : "Existing collateral covers this debt"}
        </SummaryLine>
      </dl>
      <p className="text-sm text-t2 -mt-3">Interest is an estimate at today’s variable rate, not a required monthly payment.</p>

      {/* Blocking conditions and material risk stay in view. */}
      {check.status !== "fundable" && (
        <p className="hue-caution" role="status">
          {check.status === "short"
            ? `${sim.col.name} cannot fund ${fmtUsdc(sim.amount)} USDC with this collateral: ${check.detail} Your amounts have not been changed.`
            : check.status === "no-data" ? "This route needs fresh data before it can be compared or reviewed." : `${check.reason}.`}
        </p>
      )}
      {(sim.band === "danger" || sim.band === "liquidatable") && check.status === "fundable" && (
        <p className="hue-danger">
          {sim.band === "liquidatable"
            ? "This loan would be liquidatable the moment it opens."
            : `A ${drop} drop in ${sym} makes this liquidatable: a liquidator repays part of the USDC and takes ${sym} worth that amount plus a ${pct(sim.cell.market.liquidationPenalty, 1)} bonus.`}
        </p>
      )}

      {check.status === "fundable" ? (
        <button type="button" className="btn btn-primary btn-cta" disabled={!!issue} onClick={() => onView("review")}>
          Review borrow
          <Icon name="chevron" className="w-5 h-5" />
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-cta" disabled>
          {check.status === "short" ? "This route cannot fund your loan" : check.status === "no-data" ? "Fresh data needed" : "Lower the amount to review"}
        </button>
      )}
      {issue && <p className="text-t2" role="status">{issue}</p>}

      {sim.cheaper && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-t2">
            <span className="text-fg">{sim.cheaper.label}: {pct(sim.cheaper.apy)} APY</span> · approximately {usd(sim.cheaper.saving)} less interest per year on the same loan and collateral, at today’s rates.
          </p>
          <button type="button" className="btn btn-soft" onClick={() => onSelect(sim.cheaper!.selection)}>Compare route</button>
        </div>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

      <div className="hair-t">
        <Section title="Collateral and market details">
          <Details sim={sim} />
        </Section>
        <Section title="Know before you borrow">
          <KnowBeforeYouBorrow sim={sim} />
        </Section>
      </div>
    </div>
  );
}

/** A folded section. Its contents render only once opened, so a closed summary stays light. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rail-section hair-b" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex items-center justify-between gap-3 min-h-[44px] cursor-pointer">
        <span className="label-strong">{title}</span>
        <Icon name="chevron" className="rail-section-chev text-t2" />
      </summary>
      {open && <div className="pb-4">{children}</div>}
    </details>
  );
}

/** Every assumption behind the summary, in one place. */
function KnowBeforeYouBorrow({ sim }: { sim: Sim }) {
  const sym = sim.row.holding.token.symbol;
  const market = sim.cell.market;
  const drop = pct(Math.max(0, -sim.dist), 1);
  return (
    <ul className="flex flex-col gap-3 text-t2 text-sm list-none">
      <li>
        <strong className="text-fg">Liquidation.</strong>{" "}
        {sim.liq > 0 ? `If ${sym} falls about ${drop}, this loan can be liquidated. ` : ""}
        A liquidator can then repay part of the USDC and take {sym} worth that amount plus a {pct(market.liquidationPenalty, 1)} bonus. Pledged collateral is not protected from loss.
        {market.ltv === market.liquidationThreshold && ` On ${sim.col.name} the maximum borrow is the liquidation point: there is no buffer between the two.`}
      </li>
      <li>
        <strong className="text-fg">Health factor {sim.hf === Infinity ? "∞" : sim.hf.toFixed(2)}.</strong> Liquidation-weighted collateral divided by debt. Below 1.0 the loan can be liquidated; it measures distance from that point, not safety.
      </li>
      <li>
        <strong className="text-fg">Estimates.</strong> The liquidation price comes from {sim.col.name}&apos;s threshold and oracle price.
        {sim.existingDebt > 0
          ? ` It includes the ${usd(sim.existingDebt)} this address already owes on ${sim.col.name} and the collateral behind it, moves ${sym} only and holds the other collateral at today's prices: a guide to account-wide risk, not an exact trigger.`
          : " Other collateral and debt on the account are not included."}
      </li>
      <li>
        <strong className="text-fg">Interest.</strong> Estimated at today&apos;s variable rate; the rate changes with the market. Not a monthly payment. Network and other fees are not included.
      </li>
      <li>
        <strong className="text-fg">Availability.</strong> Based on this address&apos;s supported collateral and current market liquidity; final availability is checked before borrowing. {usd(sim.max)} is this route&apos;s limit on this collateral, not a recommendation. Amounts are in USDC, not guaranteed dollar proceeds.
      </li>
      <li>
        <strong className="text-fg">Nothing moves until you approve.</strong> Review the terms, then approve each step in your wallet: token access if needed, then supplying collateral and borrowing, which can be separate transactions.
      </li>
    </ul>
  );
}

function Details({ sim }: { sim: Sim }) {
  const { market, rate } = sim.cell;
  const chain = CHAIN_LABEL[sim.table.chainId] ?? sim.table.chainId;
  const sym = sim.row.holding.token.symbol;
  return (
    <>
      <dl>
        <Line label="Collateral">{fmtAmount(sim.units)} of {fmtAmount(sim.row.holding.units)} {sym}</Line>
        <Line label="Network">{chain}</Line>
        <Line label="Market">{market.collateral.symbol} → {market.debt.symbol}</Line>
        <Line label={<Def term="ltv">Loan-to-value</Def>}>{pct(market.ltv)}</Line>
        <Line label={<Def term="lt">Liquidation threshold</Def>}>{pct(market.liquidationThreshold)}</Line>
        <Line label={<Def term="penalty">Liquidation penalty</Def>}>{pct(market.liquidationPenalty)}</Line>
        <Line label="Oracle price">{usd(market.collateralPriceUsd, { cents: true })}</Line>
        <Line label={<Def term="apr">Borrow APR</Def>}>{rate ? pct(rate.borrowAprVariable) : "—"}</Line>
        <Line label={<Def term="utilization">Utilization</Def>}>{rate?.utilization != null ? pct(rate.utilization, 1) : "—"}</Line>
        <Line label="USDC available">{usd(Number(market.availableLiquidity) / 10 ** market.debt.decimals, { compact: true })}</Line>
        <Line label="Limit on this collateral">{usd(sim.max)}</Line>
        <Line label="Last read">{timeAgo(market.fetchedAt)}</Line>
      </dl>
      <p className="mt-3 text-sm text-t2">{sim.check.limitText} Read from {sim.col.name}&apos;s own contracts on {chain}.</p>
    </>
  );
}

export function SummaryLine({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 hair-b">
      <dt className="text-t2 shrink-0">{label}</dt>
      <dd className="num text-right body-strong min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Line({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-[40px] py-2 hair-b">
      <dt className="text-t2 shrink-0">{label}</dt>
      <dd className="num text-right body-strong">{children}</dd>
    </div>
  );
}
