"use client";

import { useEffect, useMemo, useState } from "react";
import { AddressForm } from "@/components/AddressForm";
import { CapacityTable } from "@/components/CapacityTable";
import { Positions } from "@/components/Positions";
import { Rail, defaultSelection, simulate, type RailView, type Selection } from "@/components/Rail";
import { EmptyState, SkeletonRows } from "@/components/States";
import { tone } from "@/components/ui";
import { useAccount, useMarkets, type ChainParam } from "@/hooks/useSnapshot";
import { shortAddress, timeAgo } from "@/lib/format";
import { buildChainTables, collectPositions } from "@/lib/join";

export function App({ initialInput, initialChain }: { initialInput: string | null; initialChain: ChainParam }) {
  const [input, setInput] = useState<string | null>(initialInput);
  const [chain, setChain] = useState<ChainParam>(initialChain);
  const [picked, setPicked] = useState<Selection | null>(null);
  const [frac, setFrac] = useState(0.5);
  const [view, setView] = useState<RailView>("sim");

  // Keep the URL shareable: ?a=<address>&chain=<id>
  useEffect(() => {
    const u = new URL(window.location.href);
    if (input) u.searchParams.set("a", input);
    else u.searchParams.delete("a");
    u.searchParams.set("chain", chain);
    window.history.replaceState(null, "", u.toString());
  }, [input, chain]);

  const markets = useMarkets(chain);
  const account = useAccount(input, chain);

  const tables = useMemo(
    () => (account.data ? buildChainTables(markets.data, account.data) : []),
    [markets.data, account.data],
  );
  const positions = useMemo(() => (account.data ? collectPositions(account.data) : null), [account.data]);

  // The picked cell may not exist for a new address; fall back to the first borrowable holding.
  const sim = useMemo(() => simulate(tables, picked, frac) ?? simulate(tables, defaultSelection(tables), frac), [tables, picked, frac]);
  const selection: Selection | null = sim ? { chainId: sim.table.chainId, rowKey: sim.row.holding.token.address.toLowerCase(), colKey: sim.col.key } : null;
  const simTone = tone(sim?.band ?? "none");

  function select(s: Selection) {
    setPicked(s);
    setView("sim");
  }

  const emptyEverywhere = tables.length > 0 && tables.every((t) => t.rows.length === 0);

  return (
    <div className="shell">
      <div className="main">
        <header className="hair-b px-[var(--gutter)] py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <h1 className="font-medium text-[15px]">Borrow Router</h1>
          <AddressForm
            initial={input ?? ""}
            chain={chain}
            onSubmit={setInput}
            onChain={setChain}
            error={account.error}
            busy={account.loading}
          />
        </header>

        {!input && (
          <EmptyState
            title="What can this address borrow?"
            body="Enter an address or ENS name. You'll see the most USDC each protocol lends against what it holds, at what rate, and the price at which each loan is liquidated. Nothing is signed and nothing moves."
          />
        )}

        {input && account.loading && !account.data && !account.error && (
          <div className="overflow-x-auto">
            <table className="blotter" aria-label="Loading holdings">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Balance</th>
                  <th scope="col">Value</th>
                  <th scope="col">Aave v3</th>
                  <th scope="col">Spark</th>
                  <th scope="col">Compound v3</th>
                  <th scope="col">Morpho</th>
                </tr>
              </thead>
              <SkeletonRows cols={7} />
            </table>
          </div>
        )}

        {account.data && (
          <>
            <div className="px-[var(--gutter)] pt-5 pb-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 className="font-medium text-[15px]">
                Holdings and borrowing capacity
                <span className="text-t3 font-normal">
                  {" "}
                  <span className="num">{account.data.ens ?? shortAddress(account.data.address)}</span>
                </span>
              </h2>
              <span className="text-t3">
                {account.loading ? "refreshing…" : account.fetchedAt ? `read ${timeAgo(account.fetchedAt)}` : ""}
              </span>
            </div>

            {emptyEverywhere ? (
              <EmptyState
                title="Nothing here to borrow against"
                body="This address holds no asset the supported protocols accept as collateral on the selected chains. Try the other chain, or another address."
                action={{ label: "Read again", onClick: account.refresh }}
              />
            ) : (
              tables.map((t) => (
                <CapacityTable
                  key={t.chainId}
                  table={t}
                  showChain={tables.length > 1}
                  selection={selection}
                  tone={simTone}
                  onSelect={select}
                  onRetry={account.refresh}
                />
              ))
            )}

            {!emptyEverywhere && (
            <p className="px-[var(--gutter)] py-3 text-t3 max-w-[80ch]">
              Max USDC assumes the whole balance is supplied as collateral and borrowed to the protocol&apos;s maximum loan-to-value. The liquidation price is where that max loan would be liquidated. Aave E-mode and isolation-mode caps are not modelled.
            </p>
            )}

            {positions && <Positions positions={positions.positions} errors={positions.errors} />}
          </>
        )}
      </div>

      <aside className="rail" aria-label="Borrow simulator">
        <Rail
          sim={sim}
          hint={
            !account.data
              ? "Enter an address, then pick a holding. The health factor and liquidation price for any amount stay here while you compare protocols."
              : emptyEverywhere
                ? "Nothing to simulate: this address holds no collateral the supported protocols accept."
                : "Pick a holding in the table to simulate borrowing against it."
          }
          positions={positions?.positions ?? null}
          frac={frac}
          onFrac={setFrac}
          onSelect={select}
          view={view}
          onView={setView}
        />
      </aside>
    </div>
  );
}
