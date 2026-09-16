"use client";

import { useState } from "react";
import { CHAIN_LABEL } from "@/lib/client-types";
import { amount, pct, usd } from "@/lib/format";
import type { ChainTable } from "@/lib/join";
import { rowKeyOf, type Selection } from "./Rail";
import { EmptyState, ErrorLine, StaleBadge } from "./States";
import { Badge, type Tone } from "./ui";

interface Props {
  table: ChainTable;
  showChain: boolean;
  selection: Selection | null;
  /** Risk tone of the current simulation — washes the selected row. */
  tone: Tone;
  onSelect: (s: Selection) => void;
  onRetry: () => void;
}

const DUST_USD = 1;

/**
 * Holdings × protocols. Each cell is a max USDC borrow with its liquidation
 * price directly beneath — the two never appear apart.
 */
export function CapacityTable({ table, showChain, selection, tone, onSelect, onRetry }: Props) {
  const { columns, rows, totals } = table;
  const chainName = CHAIN_LABEL[table.chainId] ?? String(table.chainId);
  const [showDust, setShowDust] = useState(false);
  const dust = rows.filter((r) => r.holding.usd < DUST_USD);
  const visible = showDust ? rows : rows.filter((r) => r.holding.usd >= DUST_USD);
  const failed = columns.filter((c) => c.error);

  if (rows.length === 0) {
    return (
      <section aria-label={`${chainName} capacity`} className="hair-b">
        <EmptyState
          title={`Nothing to borrow against on ${chainName}`}
          body={`This address holds no asset that ${columns.map((c) => c.name).join(" or ")} accept as collateral here.`}
          action={failed.length ? { label: "Read again", onClick: onRetry } : undefined}
        />
        {failed.length > 0 && (
          <div className="px-[var(--gutter)] pb-5 flex flex-col gap-1">
            {failed.map((c) => <ErrorLine key={c.key} name={c.label} message={c.error!} />)}
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-label={`${chainName} capacity`}>
      {showChain && (
        <div className="px-[var(--gutter)] pt-4 pb-1">
          <Badge>{chainName}</Badge>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="blotter">
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Balance</th>
              <th scope="col">Value</th>
              {columns.map((c) => (
                <th scope="col" key={c.key}>
                  <span className="text-t1">{c.name}</span>
                  <span className="sub">{c.error ? "unavailable" : "max USDC · liq. price"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const rowKey = rowKeyOf(r);
              const rowSelected = selection?.chainId === table.chainId && selection.rowKey === rowKey;
              return (
                <tr key={rowKey} data-wash={rowSelected && tone !== "none" ? tone : undefined}>
                  <th scope="row" className="font-medium">
                    {r.holding.token.symbol}
                    {r.holding.nativeIncluded && r.holding.nativeIncluded !== "0" && (
                      <span className="sub">incl. ETH — wrap to use</span>
                    )}
                  </th>
                  <td className="num">{amount(r.holding.units)}</td>
                  <td className="num">
                    {usd(r.holding.usd)}
                    <span className="sub">@ {usd(r.holding.priceUsd, { cents: true })}</span>
                  </td>
                  {columns.map((c) => {
                    const cell = r.cells[c.key];
                    if (!cell || cell.kind === "unavailable") {
                      return (
                        <td key={c.key} className="text-t3">
                          —<span className="sub">{cell?.reason}</span>
                        </td>
                      );
                    }
                    const selected = rowSelected && selection?.colKey === c.key;
                    const { capacity, rate } = cell;
                    return (
                      <td key={c.key} className="num">
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`Simulate borrowing against ${r.holding.token.symbol} on ${c.name}`}
                          onClick={() => onSelect({ chainId: table.chainId, rowKey, colKey: c.key })}
                          className={`w-full text-right ${selected ? "font-semibold" : ""}`}
                        >
                          {usd(capacity.maxBorrowUsd)}
                          {r.best === c.key && <> <Badge>best</Badge></>}
                          <span className="sub">
                            liq. {usd(capacity.liquidationPriceAtMaxUsd, { cents: true })}
                            {rate ? ` · ${pct(rate.borrowApyVariable)}` : ""}
                            {capacity.cappedByLiquidity ? " · capped" : ""}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {dust.length > 0 && (
              <tr>
                <td colSpan={3 + columns.length} className="text-left" style={{ paddingLeft: "var(--gutter)" }}>
                  <button type="button" className="btn btn-text" onClick={() => setShowDust((s) => !s)}>
                    {showDust ? "Hide" : "Show"} {dust.length} balance{dust.length === 1 ? "" : "s"} under $1
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="num">{usd(rows.reduce((s, r) => s + r.holding.usd, 0))}</td>
              {columns.map((c) => (
                <td key={c.key} className="num">
                  {c.error ? <span className="text-t3 font-normal">—</span> : usd(totals[c.key])}
                  {c.stale && <> <StaleBadge /></>}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {failed.length > 0 && (
        <div className="px-[var(--gutter)] py-3 hair-b flex flex-col gap-1">
          {failed.map((c) => <ErrorLine key={c.key} name={c.label} message={c.error!} retryable />)}
        </div>
      )}
    </section>
  );
}
