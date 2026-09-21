"use client";

import { CHAIN_LABEL, PROTOCOL_URL } from "@/lib/client-types";
import { amount as fmtAmount, pct, signedPct, timeAgo, usd } from "@/lib/format";
import type { Cell, ChainTable, Column, PositionView, Row } from "@/lib/join";
import { sharesHealthFactor } from "@/lib/protocols/types";
import {
  annualCostDelta,
  distanceToLiquidation,
  healthFactor,
  liquidationPrice,
  riskBand,
  type RiskBand,
} from "@/lib/math/health";
import { BandChip, HealthFactor, bandLabel, hueClass } from "./Risk";
import { Def, Icon, tone } from "./ui";

/** Which (chain, holding, protocol) the rail is simulating. */
export interface Selection {
  chainId: number;
  rowKey: string;
  colKey: string;
}
export type RailView = "sim" | "params";

type CapacityCell = Extract<Cell, { kind: "capacity" }>;

export interface Sim {
  table: ChainTable;
  row: Row;
  col: Column;
  cell: CapacityCell;
  /** Columns that can lend against this holding. */
  cols: Column[];
  max: number;
  amount: number;
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
  cheaper: { col: Column; bps: number; saving: number } | null;
}

export const rowKeyOf = (row: Row) => row.holding.token.address.toLowerCase();

const capacityCols = (table: ChainTable, row: Row) =>
  table.columns.filter((c) => row.cells[c.key]?.kind === "capacity");

/** First holding with any capacity, on its best protocol. */
export function defaultSelection(tables: ChainTable[]): Selection | null {
  for (const table of tables) {
    for (const row of table.rows) {
      const cols = capacityCols(table, row);
      if (cols.length) return { chainId: table.chainId, rowKey: rowKeyOf(row), colKey: row.best ?? cols[0].key };
    }
  }
  return null;
}

/** Pure: everything the rail and the table wash need for one borrow. */
/** Positions the new borrow would share a health factor with: account-level ones, or the same isolated market. */
export function foldable(positions: PositionView[] | null, chainId: number, protocolId: string, marketId: string) {
  return (positions ?? []).filter(
    (p) => p.chainId === chainId && p.protocolId === protocolId && sharesHealthFactor(p.position.marketId, marketId),
  );
}

export function simulate(tables: ChainTable[], sel: Selection | null, amount: number, positions: PositionView[] | null = null): Sim | null {
  if (!sel || !Number.isFinite(amount) || amount < 0) return null;
  const table = tables.find((t) => t.chainId === sel.chainId);
  const row = table?.rows.find((r) => rowKeyOf(r) === sel.rowKey);
  if (!table || !row) return null;
  const cols = capacityCols(table, row);
  const col = cols.find((c) => c.key === sel.colKey) ?? cols[0];
  if (!col) return null;
  const cell = row.cells[col.key] as CapacityCell;
  const { market, capacity, rate } = cell;
  const max = capacity.maxBorrowUsd;
  const withinCapacity = amount <= max;
  // Collateral the protocol would accept (a supply cap can take less than the wallet holds).
  const units = Math.min(row.holding.units, capacity.collateralUsd / market.collateralPriceUsd);
  const existing = foldable(positions, table.chainId, col.id, market.id);
  const existingDebt = existing.reduce((s, p) => s + p.position.debt.reduce((d, l) => d + l.usd, 0), 0);
  // Existing collateral legs only matter by USD value, so price them at $1 per USD.
  const legs = [
    { units, priceUsd: market.collateralPriceUsd, liquidationThreshold: market.liquidationThreshold, ltv: market.ltv },
    ...existing.flatMap((p) => p.position.collateral.map((l) => ({ units: l.usd, priceUsd: 1, liquidationThreshold: l.liquidationThreshold ?? 0, ltv: 0 }))),
  ];
  const debt = existingDebt + amount;
  const hf = healthFactor(legs, debt);
  const liq = liquidationPrice(legs, debt, 0);
  const apy = rate?.borrowApyVariable ?? null;

  let cheaper: Sim["cheaper"] = null;
  if (apy !== null) {
    for (const c of cols) {
      if (c.key === col.key) continue;
      const candidate = row.cells[c.key] as CapacityCell;
      if (candidate.capacity.maxBorrowUsd < amount || c.error || c.stale) continue;
      const r = candidate.rate;
      if (!r || r.borrowApyVariable >= apy) continue;
      if (!cheaper || r.borrowApyVariable < apy - cheaper.bps / 10_000) {
        cheaper = { col: c, bps: Math.round((apy - r.borrowApyVariable) * 10_000), saving: annualCostDelta(amount, apy, r.borrowApyVariable) };
      }
    }
  }

  return {
    table, row, col, cell, cols, max, amount, withinCapacity, hf, existingDebt,
    band: riskBand(hf),
    liq,
    dist: distanceToLiquidation(market.collateralPriceUsd, liq),
    apy,
    costPerYear: apy === null ? null : amount * apy,
    cheaper,
  };
}

interface RailProps {
  sim: Sim | null;
  /** Shown when there is nothing to simulate. */
  hint: string;
  positions: PositionView[] | null;
  onAmount: (amount: number) => void;
  onSelect: (s: Selection) => void;
  view: RailView;
  onView: (v: RailView) => void;
}

export function Rail(props: RailProps) {
  const { sim, view } = props;
  if (sim && view === "params") return <Params key="params" sim={sim} onBack={() => props.onView("sim")} />;
  return <Simulator key="sim" {...props} />;
}

function Simulator({ sim, hint, positions, onAmount, onSelect, onView }: RailProps) {
  const band = sim?.band ?? "none";
  const t = tone(band);
  const sym = sim?.row.holding.token.symbol;

  if (!sim) {
    return (
      <div className="rail-view flex flex-col gap-4">
        <h2 className="display-sm text-balance">Simulate a borrow</h2>
        <p className="body text-t2">{hint}</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="text-t2">Health factor</span>
          <HealthFactor value={null} size="lg" />
        </div>
      </div>
    );
  }

  const drop = pct(Math.max(0, -sim.dist), 1);

  return (
    <div className="rail-view flex flex-col gap-6">
      {/* Health factor: the price block. */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-t2">{!sim.withinCapacity && "Hypothetical "}<Def term="hf">Health factor</Def></span>
          {sim.withinCapacity && <BandChip band={band} />}
        </div>
        <div className="mt-1">
          <HealthFactor value={sim.hf} size="hero" />
        </div>
        <p className={`mt-1 body ${sim.liq > 0 ? hueClass(band) : "text-t2"}`}>
          {sim.liq > 0 ? `↘ ${drop} in ${sym} to liquidation` : "No debt at this amount"}
        </p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {!sim.withinCapacity && "Hypothetical "}Health factor {sim.hf === Infinity ? "no debt" : sim.hf.toFixed(2)}, {bandLabel(band)}
        </p>
      </div>

      {/* Protocol + asset dropdowns (seven protocols no longer fit a segmented control in the rail). */}
      <div className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="sim-protocol">Protocol</label>
        <select
          id="sim-protocol"
          className="ctl w-full"
          value={sim.col.key}
          onChange={(e) => onSelect({ chainId: sim.table.chainId, rowKey: rowKeyOf(sim.row), colKey: e.target.value })}
        >
          {sim.cols.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}{(sim.row.cells[c.key] as CapacityCell).capacity.maxBorrowUsd < sim.amount ? " — below requested amount" : ""}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="sim-asset">Collateral</label>
        <select
          id="sim-asset"
          className="ctl w-full"
          value={`${sim.table.chainId}:${rowKeyOf(sim.row)}`}
          onChange={(e) => {
            const [chainId, rowKey] = e.target.value.split(":");
            onSelect({ chainId: Number(chainId), rowKey, colKey: sim.col.key });
          }}
        >
          {sim.table.rows
            .filter((r) => capacityCols(sim.table, r).length)
            .map((r) => (
              <option key={rowKeyOf(r)} value={`${sim.table.chainId}:${rowKeyOf(r)}`}>
                {fmtAmount(r.holding.units)} {r.holding.token.symbol} · {usd(r.holding.usd)}
              </option>
            ))}
        </select>
      </div>

      {/* Amount entry. */}
      <div>
        <label className="label-strong text-t2" htmlFor="sim-amount">I want to borrow (USDC)</label>
        <div className="flex items-end justify-between gap-3">
          <div className="amount">
            <input
              id="sim-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="num"
              value={Number(sim.amount.toFixed(2))}
              aria-invalid={!sim.withinCapacity}
              aria-describedby="sim-capacity"
              onChange={(e) => {
                const amount = Number(e.target.value);
                if (Number.isFinite(amount) && amount >= 0) onAmount(amount);
              }}
            />
            <span className="unit">USDC</span>
          </div>
          <button type="button" className="btn btn-soft" onClick={() => onAmount(sim.max)}>
            Max
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={sim.max}
          step="any"
          value={Math.min(sim.amount, sim.max)}
          disabled={sim.max <= 0}
          aria-label="Adjust amount within this option’s limit"
          aria-valuetext={usd(Math.min(sim.amount, sim.max), { cents: true })}
          aria-describedby="sim-capacity"
          onChange={(e) => onAmount(Number(e.target.value))}
        />
        <p className="label-strong hue-primary">
          ⇅ {usd(sim.max)} max at <Def term="ltv" right>{pct(sim.cell.market.ltv, 0)} LTV</Def>
          {sim.cell.capacity.cappedByLiquidity ? " · capped by the market" : ""}
        </p>
        <p id="sim-capacity" className={`mt-2 text-sm ${sim.withinCapacity ? "text-t2" : "hue-danger"}`} aria-live="polite">
          {sim.withinCapacity
            ? "Your amount stays the same when you compare options. Capacity is an estimate, not loan approval."
            : `${sim.col.name} cannot support your requested ${usd(sim.amount, { cents: true })} with this collateral. Estimated maximum: ${usd(sim.max, { cents: true })}. Choose another option or lower the amount; your request has not been changed.`}
        </p>
      </div>

      {/* Summary rows. */}
      <div>
        <button type="button" className="summary" onClick={() => onView("params")}>
          <span className="disc" data-tone={t}><Icon name="shield" /></span>
          <span className="text">
            <span className={`title num ${hueClass(band)}`}>
              <Def term="liq">Liquidation</Def> {sim.liq > 0 ? usd(sim.liq, { cents: true }) : "—"}
            </span>
            <span className="subtitle num">
              {sym} now {usd(sim.cell.market.collateralPriceUsd, { cents: true })}
              {sim.liq > 0 ? ` · ${signedPct(sim.dist, 1)}` : ""} · LT {pct(sim.cell.market.liquidationThreshold, 1)}
            </span>
          </span>
          <span className="chev"><Icon name="chevron" /></span>
        </button>
        <button type="button" className="summary" onClick={() => onView("params")}>
          <span className="disc"><Icon name="percent" /></span>
          <span className="text">
            <span className="title num">
              {sim.apy === null ? "—" : pct(sim.apy)} <Def term="apy">APY</Def>
              <span className="text-t2 font-normal"> · {sim.costPerYear === null ? "—" : `${usd(sim.costPerYear)} a year`}</span>
            </span>
            <span className="subtitle num">
              {sim.cheaper ? (
                <span className="hue-safe">↗ {sim.cheaper.col.name} is {sim.cheaper.bps} bps cheaper · saves {usd(sim.cheaper.saving)} a year</span>
              ) : (
                "Indicative borrowing cost; excludes transaction fees"
              )}
            </span>
          </span>
          <span className="chev"><Icon name="chevron" /></span>
        </button>
      </div>

      {sim.withinCapacity && sim.amount > 0 ? (
        <a
          className="btn btn-primary btn-cta"
          href={PROTOCOL_URL[sim.col.id] ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open {sim.col.name}
          <Icon name="external" className="w-5 h-5" />
        </a>
      ) : (
        <button type="button" className="btn btn-primary btn-cta" disabled>
          {sim.amount === 0 ? "Enter a borrow amount" : "Amount exceeds this option’s limit"}
        </button>
      )}

      <Narrative sim={sim} positions={positions} />
    </div>
  );
}

function Narrative({ sim }: { sim: Sim; positions: PositionView[] | null }) {
  if (!sim.withinCapacity) {
    return <p className="hair-t pt-5 text-t2">The figures above illustrate your requested amount, not an available loan. This simulator does not sign or move funds.</p>;
  }
  const sym = sim.row.holding.token.symbol;
  const drop = pct(Math.max(0, -sim.dist), 1);
  const penalty = pct(sim.cell.market.liquidationPenalty, 1);
  return (
    <div className="hair-t pt-5 flex flex-col gap-3 text-t2">
      {sim.band === "liquidatable" && (
        <p className="hue-danger">
          This loan is liquidatable the moment it opens. {sim.col.name} lets you borrow to {pct(sim.cell.market.ltv, 0)} of collateral, and {usd(sim.amount)} is past that.
        </p>
      )}
      {sim.band === "danger" && (
        <p className="hue-danger">
          A {drop} drop in {sym} makes this liquidatable. A liquidator then repays part of the USDC and takes {sym} worth that amount plus a {penalty} bonus.
        </p>
      )}
      {sim.band === "watch" && (
        <p>
          {sym} can fall {drop} before this loan is liquidated. Below a health factor of 1.2 most people top up collateral or repay.
        </p>
      )}
      {sim.band === "comfortable" && <p>{sym} can fall {drop} before this loan is liquidated.</p>}
      {sim.cell.market.ltv === sim.cell.market.liquidationThreshold && (
        <p>On {sim.col.name} the maximum borrow is the liquidation point: there is no buffer between the two.</p>
      )}
      {sim.existingDebt > 0 && (
        <p>Includes the {usd(sim.existingDebt)} this address already owes on {sim.col.name}, and the collateral behind it.</p>
      )}
      <p className="text-t3">
        Assumes the whole {sym} balance is supplied as collateral. Read-only: nothing here signs or moves funds. Opening a protocol leaves this site.
      </p>
    </div>
  );
}

function Params({ sim, onBack }: { sim: Sim; onBack: () => void }) {
  const { market, rate } = sim.cell;
  const chain = CHAIN_LABEL[sim.table.chainId] ?? sim.table.chainId;
  return (
    <div className="rail-view">
      <div className="h-10 flex items-center relative">
        <button type="button" className="btn btn-icon btn-ghost" onClick={onBack} aria-label="Back to simulator">
          <Icon name="back" />
        </button>
        <h2 className="absolute inset-x-0 text-center heading pointer-events-none">
          {sim.col.name} · {market.collateral.symbol}
        </h2>
      </div>
      <dl className="mt-4">
        <Line label="Chain">{chain}</Line>
        <Line label="Market">{market.collateral.symbol} → {market.debt.symbol}</Line>
        <Line label="Status">{market.status}</Line>
        <Line label={<Def term="ltv">Loan-to-value</Def>}>{pct(market.ltv)}</Line>
        <Line label={<Def term="lt">Liquidation threshold</Def>}>{pct(market.liquidationThreshold)}</Line>
        <Line label={<Def term="penalty">Liquidation penalty</Def>}>{pct(market.liquidationPenalty)}</Line>
        <Line label="Oracle price">{usd(market.collateralPriceUsd, { cents: true })}</Line>
        <Line label={<Def term="apr">Borrow APR</Def>}>{rate ? pct(rate.borrowAprVariable) : "—"}</Line>
        <Line label={<Def term="apy">Borrow APY</Def>}>{rate ? pct(rate.borrowApyVariable) : "—"}</Line>
        <Line label="Supply APR">{rate?.supplyApr != null ? pct(rate.supplyApr) : "—"}</Line>
        <Line label={<Def term="utilization">Utilization</Def>}>{rate?.utilization != null ? pct(rate.utilization, 1) : "—"}</Line>
        <Line label="USDC available">{usd(Number(market.availableLiquidity) / 10 ** market.debt.decimals, { compact: true })}</Line>
        <Line label="Last read">{timeAgo(market.fetchedAt)}</Line>
      </dl>
      <p className="mt-4 text-t2">
        Read from {sim.col.name}&apos;s own contracts on {chain}. The oracle price is the one its liquidators see.
      </p>
    </div>
  );
}

function Line({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-[44px] py-2 hair-b">
      <dt className="text-t2 shrink-0">{label}</dt>
      <dd className="num text-right body-strong">{children}</dd>
    </div>
  );
}
