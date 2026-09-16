"use client";

import { CHAIN_LABEL } from "@/lib/client-types";
import { amount as fmtAmount, pct, signedPct, timeAgo, usd } from "@/lib/format";
import type { Cell, ChainTable, Column, PositionView, Row } from "@/lib/join";
import {
  annualCostDelta,
  distanceToLiquidation,
  healthFactor,
  liquidationPriceSingle,
  riskBand,
  type RiskBand,
} from "@/lib/math/health";
import { BandChip, HealthFactor, bandLabel, hueClass } from "./Risk";
import { Def, Segmented, tone } from "./ui";

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
  hf: number;
  band: RiskBand;
  liq: number;
  /** Fractional move from today's price to the liquidation price (negative = drop). */
  dist: number;
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
export function simulate(tables: ChainTable[], sel: Selection | null, frac: number): Sim | null {
  if (!sel) return null;
  const table = tables.find((t) => t.chainId === sel.chainId);
  const row = table?.rows.find((r) => rowKeyOf(r) === sel.rowKey);
  if (!table || !row) return null;
  const cols = capacityCols(table, row);
  const col = cols.find((c) => c.key === sel.colKey) ?? cols[0];
  if (!col) return null;
  const cell = row.cells[col.key] as CapacityCell;
  const { market, capacity, rate } = cell;
  const max = capacity.maxBorrowUsd;
  const amount = max * frac;
  const units = row.holding.units;
  const hf = healthFactor([{ units, priceUsd: market.collateralPriceUsd, liquidationThreshold: market.liquidationThreshold, ltv: market.ltv }], amount);
  const liq = liquidationPriceSingle(units, market.liquidationThreshold, amount);
  const apy = rate?.borrowApyVariable ?? null;

  let cheaper: Sim["cheaper"] = null;
  if (apy !== null) {
    for (const c of cols) {
      if (c.key === col.key) continue;
      const r = (row.cells[c.key] as CapacityCell).rate;
      if (!r || r.borrowApyVariable >= apy) continue;
      if (!cheaper || r.borrowApyVariable < apy - cheaper.bps / 10_000) {
        cheaper = { col: c, bps: Math.round((apy - r.borrowApyVariable) * 10_000), saving: annualCostDelta(amount, apy, r.borrowApyVariable) };
      }
    }
  }

  return {
    table, row, col, cell, cols, max, amount, hf,
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
  frac: number;
  onFrac: (f: number) => void;
  onSelect: (s: Selection) => void;
  view: RailView;
  onView: (v: RailView) => void;
}

export function Rail(props: RailProps) {
  const { sim, view } = props;
  if (sim && view === "params") return <Params key="params" sim={sim} onBack={() => props.onView("sim")} />;
  return <Simulator key="sim" {...props} />;
}

function Simulator({ sim, hint, positions, frac, onFrac, onSelect, onView }: RailProps) {
  const band = sim?.band ?? "none";
  const t = tone(band);
  const sym = sim?.row.holding.token.symbol;

  return (
    <div className="rail-view">
      <div className="px-8 pt-6 pb-5 hair-b">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium text-t2">
            <Def term="hf">Health factor</Def>
          </h2>
          {sim && (
            <button type="button" className="btn btn-text" onClick={() => onView("params")}>
              {sim.col.name} parameters ›
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <HealthFactor value={sim ? sim.hf : null} size="hero" />
          <BandChip band={band} />
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {sim ? `Health factor ${sim.hf === Infinity ? "no debt" : sim.hf.toFixed(2)}, ${bandLabel(band)}` : ""}
        </p>
        {!sim && <p className="mt-3 text-t2 max-w-[38ch]">{hint}</p>}
      </div>

      {sim && (
        <>
          <div className="px-8 py-5 hair-b">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-t2" htmlFor="sim-asset">Against</label>
              <select
                id="sim-asset"
                className="ctl"
                value={`${sim.table.chainId}:${rowKeyOf(sim.row)}`}
                onChange={(e) => {
                  const [chainId, rowKey] = e.target.value.split(":");
                  onSelect({ chainId: Number(chainId), rowKey, colKey: sim.col.key });
                }}
              >
                {[sim.table].map((table) =>
                  table.rows
                    .filter((r) => capacityCols(table, r).length)
                    .map((r) => (
                      <option key={rowKeyOf(r)} value={`${table.chainId}:${rowKeyOf(r)}`}>
                        {fmtAmount(r.holding.units)} {r.holding.token.symbol} · {usd(r.holding.usd)}
                      </option>
                    )),
                )}
              </select>
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <span className="text-t2">On</span>
              <Segmented
                label="Protocol"
                tone={t}
                options={sim.cols.map((c) => ({ value: c.key, label: c.name }))}
                value={sim.col.key}
                onChange={(colKey) => onSelect({ chainId: sim.table.chainId, rowKey: rowKeyOf(sim.row), colKey })}
              />
            </div>
          </div>

          <div className="px-8 py-5 hair-b">
            <div className="flex items-center justify-between gap-3">
              <label className="text-t2" htmlFor="sim-amount">Borrow USDC</label>
              <input
                id="sim-amount"
                type="number"
                min={0}
                max={Math.round(sim.max)}
                step={100}
                className="ctl num text-right w-[9.5rem]"
                value={Math.round(sim.amount)}
                onChange={(e) => onFrac(clamp(Number(e.target.value) / sim.max))}
              />
            </div>
            <input
              type="range"
              min={0}
              max={1000}
              step={5}
              value={Math.round(frac * 1000)}
              aria-label="Borrow amount"
              aria-valuetext={usd(sim.amount)}
              onChange={(e) => onFrac(Number(e.target.value) / 1000)}
            />
            <div className="flex justify-between text-t3">
              <span>0</span>
              <span>
                {usd(sim.max)} max · <Def term="ltv" right>{pct(sim.cell.market.ltv, 0)} LTV</Def>
                {sim.cell.capacity.cappedByLiquidity ? " · capped by the market" : ""}
              </span>
            </div>
          </div>

          <dl className="px-8 py-2 hair-b">
            <Line label={<Def term="liq">Liquidation price</Def>}>
              <span className={`font-medium ${hueClass(band)}`}>{sim.liq > 0 ? usd(sim.liq, { cents: true }) : "—"}</span>
              <span className="sub"> per {sym}</span>
            </Line>
            <Line label="Now">
              {usd(sim.cell.market.collateralPriceUsd, { cents: true })}
              <span className="sub"> {sim.liq > 0 ? `${signedPct(sim.dist, 1)} to liquidation` : "no debt"}</span>
            </Line>
            <Line label={<Def term="lt">Liquidation threshold</Def>}>{pct(sim.cell.market.liquidationThreshold, 1)}</Line>
          </dl>

          <dl className="px-8 py-2 hair-b">
            <Line label={<Def term="apy">Borrow APY</Def>}>{sim.apy === null ? "—" : pct(sim.apy)}</Line>
            <Line label="Cost per year">{sim.costPerYear === null ? "—" : usd(sim.costPerYear)}</Line>
            {sim.cheaper && (
              <Line label={`${sim.cheaper.col.name} instead`}>
                <span className="font-semibold">−{sim.cheaper.bps} bps</span>
                <span className="sub"> saves {usd(sim.cheaper.saving)} a year</span>
              </Line>
            )}
          </dl>

          <Narrative sim={sim} positions={positions} />
        </>
      )}
    </div>
  );
}

function Narrative({ sim, positions }: { sim: Sim; positions: PositionView[] | null }) {
  const existing = positions?.find(
    (p) => p.protocolId === sim.col.id && p.chainId === sim.table.chainId && p.position.debt.length > 0,
  );
  const sym = sim.row.holding.token.symbol;
  const drop = pct(Math.max(0, -sim.dist), 1);
  const penalty = pct(sim.cell.market.liquidationPenalty, 1);
  return (
    <div className="px-8 py-5 flex flex-col gap-3">
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
        <p className="text-t2">
          {sym} can fall {drop} before this loan is liquidated. Below a health factor of 1.2 most people top up collateral or repay.
        </p>
      )}
      {sim.band === "comfortable" && (
        <p className="text-t2">
          {sym} can fall {drop} before this loan is liquidated.
        </p>
      )}
      {sim.cell.market.ltv === sim.cell.market.liquidationThreshold && (
        <p className="text-t2">
          On {sim.col.name} the maximum borrow is the liquidation point: there is no buffer between the two.
        </p>
      )}
      {existing && (
        <p className="text-t3">
          This address already has debt on {sim.col.name}. The figures above treat the loan as a fresh position and do not include it.
        </p>
      )}
      <p className="text-t3">
        Assumes the whole {sym} balance is supplied as collateral. Read-only: nothing here signs or moves funds.
      </p>
    </div>
  );
}

function Params({ sim, onBack }: { sim: Sim; onBack: () => void }) {
  const { market, rate } = sim.cell;
  const chain = CHAIN_LABEL[sim.table.chainId] ?? sim.table.chainId;
  return (
    <div className="rail-view">
      <div className="px-8 h-[52px] flex items-center hair-b relative">
        <button type="button" className="btn btn-text" onClick={onBack}>
          ‹ Simulate
        </button>
        <h2 className="absolute inset-x-0 text-center font-medium pointer-events-none">
          {sim.col.name} · {market.collateral.symbol}
        </h2>
      </div>
      <dl className="px-8 py-2">
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
      <p className="px-8 py-4 text-t3">
        Read from {sim.col.name}&apos;s own contracts on {chain}. The oracle price is the one its liquidators see.
      </p>
    </div>
  );
}

function Line({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-[36px] py-2">
      <dt className="text-t2 shrink-0">{label}</dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
