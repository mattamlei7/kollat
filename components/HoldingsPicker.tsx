"use client";

import { useState } from "react";
import { CHAIN_LABEL, NATIVE_SYMBOL } from "@/lib/client-types";
import { amount, usd } from "@/lib/format";
import { statusOf, type ChainTable, type Row } from "@/lib/join";
import { rowKeyOf } from "./Rail";
import { ErrorLine } from "./States";
import { Avatar } from "./ui";

export interface HoldingRef {
  chainId: number;
  rowKey: string;
}
export const holdingKey = (h: HoldingRef) => `${h.chainId}:${h.rowKey}`;

export interface HoldingEntry {
  table: ChainTable;
  row: Row;
  key: string;
}

const SMALL_USD = 1;

/**
 * Supported holdings first, by value; small supported balances, and holdings no protocol can take (or whose
 * eligibility could not be read), behind their own toggles. A failed read is never reported as unsupported.
 */
export function groupHoldings(tables: ChainTable[]) {
  const all: HoldingEntry[] = tables.flatMap((table) => table.rows.map((row) => ({ table, row, key: holdingKey({ chainId: table.chainId, rowKey: rowKeyOf(row) }) })));
  const supported = all.filter((h) => statusOf(h.row) === "supported").sort((a, b) => b.row.holding.usd - a.row.holding.usd);
  return {
    main: supported.filter((h) => h.row.holding.usd >= SMALL_USD),
    small: supported.filter((h) => h.row.holding.usd < SMALL_USD),
    unavailable: all.filter((h) => statusOf(h.row) === "data-unavailable"),
    unsupported: all.filter((h) => statusOf(h.row) === "unsupported"),
    failed: tables.flatMap((t) => t.columns.filter((c) => c.error).map((c) => ({ chain: CHAIN_LABEL[t.chainId] ?? String(t.chainId), name: c.name, error: c.error! }))),
  };
}

interface Props {
  tables: ChainTable[];
  selected: string | null;
  onPick: (h: HoldingRef) => void;
  onRetry: () => void;
}

export function HoldingsPicker({ tables, selected, onPick, onRetry }: Props) {
  const groups = groupHoldings(tables);
  const [showSmall, setShowSmall] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const other = [...groups.unavailable, ...groups.unsupported];

  return (
    <div className="flex flex-col gap-3">
      {groups.main.length + groups.small.length > 0 && (
        <div className="pick-list" role="radiogroup" aria-labelledby="choose-collateral">
          <div className="pick-head" aria-hidden="true">
            <span>Asset</span>
            <span>Network</span>
            <span className="num-col">Available</span>
            <span className="num-col">Value</span>
            <span />
          </div>
          {groups.main.map((h) => <HoldingRow key={h.key} entry={h} selected={selected === h.key} onPick={onPick} />)}
          {showSmall && groups.small.map((h) => <HoldingRow key={h.key} entry={h} selected={selected === h.key} onPick={onPick} />)}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {groups.small.length > 0 && (
          <button type="button" className="btn btn-soft" aria-expanded={showSmall} onClick={() => setShowSmall((s) => !s)}>
            {showSmall ? "Hide" : "Show"} {groups.small.length} small balance{groups.small.length === 1 ? "" : "s"}
          </button>
        )}
        {other.length > 0 && (
          <button type="button" className="btn btn-soft" aria-expanded={showOther} aria-controls="other-holdings" onClick={() => setShowOther((s) => !s)}>
            {showOther ? "Hide" : "Show"} {other.length} not available as collateral
          </button>
        )}
      </div>

      {showOther && other.length > 0 && (
        <ul id="other-holdings" className="pick-list" aria-label="Holdings not available as collateral">
          {other.map(({ table, row, key }) => (
            <li key={key} className="pick-row pick-row-static">
              <span className="pick-asset"><Avatar text={row.holding.token.symbol} token={row.holding.token} /><span className="body-strong">{row.holding.token.symbol}</span></span>
              <span className="text-t2">{CHAIN_LABEL[table.chainId]}</span>
              <span className="num num-col">{amount(row.holding.units)}</span>
              <span className="num num-col">{usd(row.holding.usd)}</span>
              <span className="text-t2 text-sm">{statusOf(row) === "data-unavailable" ? "Eligibility data unavailable" : "Unsupported collateral"}</span>
            </li>
          ))}
        </ul>
      )}

      {groups.failed.length > 0 && (
        <div className="flex flex-col gap-1">
          {groups.failed.map((f) => <ErrorLine key={`${f.chain}:${f.name}`} name={`${f.name} · ${f.chain}`} message={`${f.error} Holdings it accepts may be missing until it is read again.`} retryable />)}
          <button type="button" className="btn btn-soft self-start" onClick={onRetry}>Read again</button>
        </div>
      )}
    </div>
  );
}

function HoldingRow({ entry, selected, onPick }: { entry: HoldingEntry; selected: boolean; onPick: (h: HoldingRef) => void }) {
  const { table, row } = entry;
  const sym = row.holding.token.symbol;
  const native = row.holding.nativeIncluded && row.holding.nativeIncluded !== "0";
  return (
    <label className="pick-row" data-selected={selected || undefined}>
      <input
        type="radio"
        name="collateral"
        className="sr-only"
        checked={selected}
        onClick={() => { if (selected) onPick({ chainId: table.chainId, rowKey: rowKeyOf(row) }); }}
        onChange={() => onPick({ chainId: table.chainId, rowKey: rowKeyOf(row) })}
      />
      <span className="pick-asset">
        <Avatar text={sym} token={row.holding.token} />
        <span className="flex flex-col min-w-0">
          <span className="body-strong">{sym}</span>
          {native && <span className="text-sm text-t2">incl. native {NATIVE_SYMBOL[table.chainId] ?? "ETH"}</span>}
        </span>
      </span>
      <span className="text-t2">{CHAIN_LABEL[table.chainId]}</span>
      <span className="num num-col">{amount(row.holding.units)}</span>
      <span className="num num-col">{usd(row.holding.usd)}</span>
      <span className="pick-action" aria-hidden="true">{selected ? "Selected" : "Select"}</span>
    </label>
  );
}
