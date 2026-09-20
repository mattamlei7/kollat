"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AddressForm } from "@/components/AddressForm";
import { CapacityTable } from "@/components/CapacityTable";
import { Positions } from "@/components/Positions";
import { Rail, defaultSelection, simulate, type RailView, type Selection } from "@/components/Rail";
import { EmptyState, SkeletonRows } from "@/components/States";
import { Icon, tone } from "@/components/ui";
import { useAccount, useMarkets, type ChainParam } from "@/hooks/useSnapshot";
import { pct, shortAddress, timeAgo, usd } from "@/lib/format";
import { buildChainTables, collectPositions, type ChainTable } from "@/lib/join";

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
  const stats = useMemo(() => summarize(tables), [tables]);

  // The picked cell may not exist for a new address; fall back to the first borrowable holding.
  const sim = useMemo(() => simulate(tables, picked, frac, positions?.positions) ?? simulate(tables, defaultSelection(tables), frac, positions?.positions), [tables, picked, frac, positions]);
  const selection: Selection | null = sim ? { chainId: sim.table.chainId, rowKey: sim.row.holding.token.address.toLowerCase(), colKey: sim.col.key } : null;
  const simTone = tone(sim?.band ?? "none");

  function select(s: Selection) {
    setPicked(s);
    setView("sim");
  }

  const emptyEverywhere = tables.length > 0 && tables.every((t) => t.rows.length === 0);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <Link href="/" className="logo">
          <span className="logo-mark">BR</span>
          <span className="body-strong">Kollat</span>
        </Link>
        <div className="nav">
          <Link className="nav-item" href="/borrow" aria-current="page">
            <Icon name="borrow" />
            Borrow
          </Link>
          <a className="nav-item" href="#positions">
            <Icon name="positions" />
            Positions
          </a>
          <a className="nav-item" href="#protocols">
            <Icon name="home" />
            Protocols
          </a>
        </div>
        <div className="pinned nav-item" title="This app never requests a signature and has no write path.">
          <Icon name="lock" />
          <span className="flex-1">Read-only</span>
          <span className="toggle" data-on="true" aria-hidden />
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <h1 className="display-sm">Borrow</h1>
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
                  <th scope="col">Fluid</th>
                  <th scope="col">Euler</th>
                  <th scope="col">Moonwell</th>
                </tr>
              </thead>
              <SkeletonRows cols={10} />
            </table>
          </div>
        )}

        {account.data && (
          <>
            <section className="section" id="protocols">
              <div className="row flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h2 className="heading">
                  Holdings
                  <span className="text-t2 font-normal">
                    {" "}
                    <span className="num">{account.data.ens ?? shortAddress(account.data.address)}</span>
                  </span>
                </h2>
                <span className="text-t2">
                  {account.loading ? "Refreshing…" : account.fetchedAt ? `Read ${timeAgo(account.fetchedAt)}` : ""}
                </span>
              </div>

              {!emptyEverywhere && (
                <div className="row mt-4 tiles">
                  <div className="tile">
                    <div className="label">Collateral value</div>
                    <div className="value num">{usd(stats.value)}</div>
                  </div>
                  <div className="tile">
                    <div className="label">Max USDC, best protocol per asset</div>
                    <div className="value num">{usd(stats.maxBorrow)}</div>
                  </div>
                  <div className="tile">
                    <div className="label">Lowest borrow APY</div>
                    <div className="value num">
                      {stats.lowestApy ? (
                        <>
                          {pct(stats.lowestApy.apy)} <span className="label-strong text-t2">{stats.lowestApy.name}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6">
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
              </div>

              {!emptyEverywhere && (
                <p className="row mt-4 text-t2 max-w-[80ch]">
                  Max USDC assumes the whole balance is supplied as collateral and borrowed to the protocol&apos;s maximum loan-to-value. The liquidation price is where that max loan would be liquidated. Aave E-mode and isolation-mode caps are not modelled.
                </p>
              )}
            </section>

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

function summarize(tables: ChainTable[]) {
  let value = 0;
  let maxBorrow = 0;
  let lowestApy: { apy: number; name: string } | null = null;
  for (const t of tables) {
    for (const r of t.rows) {
      value += r.holding.usd;
      const best = r.best ? r.cells[r.best] : null;
      if (best?.kind === "capacity") maxBorrow += best.capacity.maxBorrowUsd;
      for (const c of t.columns) {
        const cell = r.cells[c.key];
        if (cell?.kind !== "capacity" || !cell.rate) continue;
        if (!lowestApy || cell.rate.borrowApyVariable < lowestApy.apy) lowestApy = { apy: cell.rate.borrowApyVariable, name: c.name };
      }
    }
  }
  return { value, maxBorrow, lowestApy };
}
