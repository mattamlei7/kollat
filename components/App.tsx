"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AmountInput } from "@/components/AmountInput";
import { HealthSlider } from "@/components/HealthSlider";
import { HoldingsPicker, holdingKey, groupHoldings, type HoldingRef } from "@/components/HoldingsPicker";
import { Positions } from "@/components/Positions";
import { Rail, rowKeyOf, simulate, type RailView, type Selection } from "@/components/Rail";
import { RouteTable } from "@/components/RouteTable";
import { Sidebar } from "@/components/Sidebar";
import { useWallet } from "@/components/useWallet";
import { WalletControl } from "@/components/WalletControl";
import { EmptyState } from "@/components/States";
import { Avatar } from "@/components/ui";
import { useAccount, useMarkets, type ChainParam } from "@/hooks/useSnapshot";
import { CHAIN_LABEL, NATIVE_SYMBOL } from "@/lib/client-types";
import { fmtUnits, routeKeyOf, routesFor } from "@/lib/eligibility";
import { amount as fmtAmount, shortAddress, timeAgo, usd } from "@/lib/format";
import { buildChainTables, collectPositions } from "@/lib/join";

/**
 * The Borrow tab, one stage at a time: see your assets → choose collateral → specify the loan → compare eligible
 * rates → review → approve in your wallet. Each input lives in one place; the rail summarises the selected loan.
 */
/** "All" first, then every network Borrow reads. */
const BORROW_NETWORKS: (number | "all")[] = ["all", 1, 8453, 42161, 10, 137, 43114];

export function App({ initialInput, initialChain }: { initialInput: string | null; initialChain: ChainParam }) {
  const [input, setInput] = useState<string | null>(initialInput);
  const [chain, setChain] = useState<ChainParam>(initialChain);
  // Borrower intent: the collateral chosen, how much of it, how much USDC, and the route. Nothing is preselected.
  const [holding, setHolding] = useState<HoldingRef | null>(null);
  const [changingAsset, setChangingAsset] = useState(false);
  const [collateralByHolding, setCollateralByHolding] = useState<Record<string, number>>({});
  const [borrowAmount, setBorrowAmount] = useState(0);
  const [picked, setPicked] = useState<Selection | null>(null);
  const [view, setView] = useState<RailView>("sim");
  const wallet = useWallet();
  // Follow the connected wallet: show its borrowing options on load and after an account switch, unless the
  // user is looking at a different address they typed (or one from a shared link).
  const followed = useRef<string | null>(null);
  useEffect(() => {
    const a = wallet.address;
    if (!a) return;
    const prev = followed.current;
    followed.current = a;
    const showingWallet = !input || (prev !== null && input.toLowerCase() === prev.toLowerCase());
    if (!showingWallet || input?.toLowerCase() === a.toLowerCase()) return;
    const t = setTimeout(() => { setInput(a); setView("sim"); }, 0);
    return () => clearTimeout(t);
  }, [wallet.address, input]);

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

  const tables = useMemo(() => (account.data ? buildChainTables(markets.data, account.data) : []), [markets.data, account.data]);
  const positions = useMemo(() => (account.data ? collectPositions(account.data) : null), [account.data]);

  const table = holding ? tables.find((t) => t.chainId === holding.chainId) : undefined;
  const row = table?.rows.find((r) => rowKeyOf(r) === holding?.rowKey);
  const key = holding ? holdingKey(holding) : null;
  const units = key ? collateralByHolding[key] ?? 0 : 0;
  const unitsOrNull = units > 0 ? units : null;
  const routes = useMemo(
    () => (table && row ? routesFor(table, row, borrowAmount, unitsOrNull, positions?.positions ?? null) : null),
    [table, row, borrowAmount, unitsOrNull, positions],
  );

  const routeSelected = picked && holding && picked.chainId === holding.chainId && picked.rowKey === holding.rowKey ? picked : null;
  const sim = useMemo(() => simulate(tables, routeSelected, borrowAmount, positions?.positions ?? null, unitsOrNull), [tables, routeSelected, borrowAmount, positions, unitsOrNull]);
  const selectedRouteKey = sim ? routeKeyOf(sim.col.key, sim.cell.market.id) : null;

  const selectedAccount = account.data?.protocols.find((p) => p.chainId === sim?.table.chainId && p.id === sim?.col.id);
  const selectedMarket = markets.data?.protocols.find((p) => p.chainId === sim?.table.chainId && p.id === sim?.col.id);
  const reviewReads = [selectedAccount?.capacity, selectedAccount?.positions, selectedMarket?.markets, selectedMarket?.rates];
  const oldestReadAt = Math.min(...reviewReads.map((r) => r?.ok ? r.fetchedAt : 0));
  const reviewUnavailable = account.loading || markets.loading
    ? "Refreshing the estimate…"
    : account.error || markets.error || account.data?.input.toLowerCase() !== input?.toLowerCase() || reviewReads.some((r) => !r?.ok || r.stale)
      ? "Fresh account, position, and rate data are needed before reviewing. Read the account again."
      : null;

  const groups = useMemo(() => groupHoldings(tables), [tables]);
  const noSupported = !!account.data && groups.main.length === 0 && groups.small.length === 0;

  function pickHolding(h: HoldingRef) {
    // A route belongs to one collateral, so choosing another asset clears it; the borrow amount stays.
    if (!holding || holdingKey(h) !== holdingKey(holding)) setPicked(null);
    setHolding(h);
    setChangingAsset(false);
    setView("sim");
  }
  function selectRoute(s: Selection) {
    setPicked(s);
    setView("sim");
  }
  const setUnits = (value: number) => key && setCollateralByHolding((m) => ({ ...m, [key]: value }));
  const focus = (id: string) => document.getElementById(id)?.focus();

  const sym = row?.holding.token.symbol ?? "";
  // The slider is drawn against the selected route's limits, or the most permissive route until one is chosen.
  const sliderRoute = sim
    ? { market: sim.cell.market, label: sim.col.name }
    : [...(routes?.eligible ?? []), ...(routes?.other ?? [])].map((r) => ({ market: r.cell.market, label: r.label })).sort((a, b) => b.market.ltv - a.market.ltv)[0];
  const collateralUsd = units * (sliderRoute?.market.collateralPriceUsd ?? 0);
  const nativeUnits = row?.holding.nativeIncluded && row.holding.nativeIncluded !== "0" ? Number(row.holding.nativeIncluded) / 1e18 : 0;
  const overBalance = !!row && units > row.holding.units * (1 + 1e-9);
  const showPicker = !holding || !row || changingAsset;

  const hint = !account.data
    ? "Enter an address to see what it can borrow against."
    : noSupported
      ? "No supported collateral to build a loan with."
      : !row
        ? "Choose an asset to build your loan."
        : "Enter a collateral amount and a borrow amount, then select a route.";

  return (
    <div className="shell borrow">
      <Sidebar current="borrow" />

      <div className="main">
        <header className="topbar">
          <div className="flex flex-col">
            <h1 className="display-sm">Borrow against your crypto</h1>
            <p className="text-t2">Compare USDC loans across Aave, Compound, Euler, Fluid, Moonwell, Morpho and Spark.</p>
          </div>
          <WalletControl
            networks={BORROW_NETWORKS}
            network={chain === "all" ? "all" : Number(chain)}
            onNetwork={(n) => { setChain(String(n) as ChainParam); setView("sim"); }}
            wallet={{ ...wallet, connect: async () => { const a = await wallet.connect(); if (a) { setInput(a); setView("sim"); } } }}
            lookup={{ viewing: input, onLookup: (value) => { setInput(value); setView("sim"); } }}
          />
          {input && wallet.address && input.toLowerCase() !== wallet.address.toLowerCase() && (
            <p className="viewing-note text-sm text-t2">Viewing {input.startsWith("0x") && input.length === 42 ? shortAddress(input) : input}, not your connected wallet. Switch back from the wallet menu.</p>
          )}
          {account.error && <p role="alert" className="viewing-note label-strong hue-danger">{account.error}</p>}
        </header>

        {!input && (
          <EmptyState
            title="What can your wallet borrow?"
            body="Connect a wallet to see what it can borrow against. You’ll choose collateral, set your loan, and compare variable rates across supported protocols. Connecting signs nothing and moves nothing. Once connected, you can also look up any other address from the wallet menu."
          />
        )}

        {input && account.loading && !account.data && !account.error && (
          <section className="stage" aria-busy="true">
            <h2 className="heading">Reading holdings…</h2>
            <div className="pick-list mt-4" aria-hidden="true">
              {[0, 1, 2].map((i) => <div key={i} className="pick-row pick-row-static"><span className="skel" style={{ width: 160 }} /></div>)}
            </div>
          </section>
        )}

        {account.data && (
          <>
            {/* 1. Choose collateral (collapses to a one-line summary once chosen) */}
            <section className="stage" aria-labelledby="choose-collateral">
              {showPicker ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h2 id="choose-collateral" className="heading">Choose your collateral</h2>
                    <span className="text-t2 text-sm">
                      {account.data.ens ?? shortAddress(account.data.address)} · {account.loading ? "Refreshing…" : account.fetchedAt ? `Read ${timeAgo(account.fetchedAt)}` : ""}
                    </span>
                  </div>
                  <p className="text-t2 mt-1">Select an asset to compare borrowing options.</p>
                  <div className="mt-4">
                    {noSupported && (
                      <p className="mb-3 body">
                        {groups.failed.length || groups.unavailable.length
                          ? "Collateral eligibility could not be confirmed for all protocols. Read again before ruling out these holdings."
                          : "This address holds nothing the supported protocols accept as collateral on the selected networks. Try another network or address."}
                      </p>
                    )}
                    <HoldingsPicker tables={tables} selected={key} onPick={pickHolding} onRetry={account.refresh} />
                  </div>
                  {changingAsset && row && (
                    <button type="button" className="btn btn-ghost mt-3" onClick={() => setChangingAsset(false)}>Keep {sym}</button>
                  )}
                </>
              ) : (
                <div className="collateral-summary">
                  <Avatar text={sym} token={row!.holding.token} />
                  <div className="flex flex-col min-w-0">
                    <h2 id="choose-collateral" className="body-strong">Collateral: {sym} · {CHAIN_LABEL[table!.chainId]}</h2>
                    <span className="text-t2 num">Available: {fmtAmount(row!.holding.units)} {sym} · {usd(row!.holding.usd)}</span>
                  </div>
                  <button type="button" className="btn btn-soft ml-auto" onClick={() => setChangingAsset(true)}>Change asset</button>
                </div>
              )}
            </section>

            {/* 2. Specify the loan */}
            {row && !changingAsset && (
              <section className="stage" aria-labelledby="loan-heading">
                <h2 id="loan-heading" className="heading">Your loan</h2>
                <div className="loan-inputs mt-4">
                  <div className="flex flex-col gap-1">
                    <label className="label-strong text-t2" htmlFor="collateral-amount">Collateral amount</label>
                    <AmountInput
                      id="collateral-amount"
                      className="ctl num w-full"
                      value={units}
                      onChange={setUnits}
                      decimals={6}
                      invalid={overBalance}
                      describedBy="collateral-note"
                      suffix={<>
                        <span className="text-t2">{sym}</span>
                        <button type="button" className="btn btn-soft" onClick={() => setUnits(row.holding.units)}>Use all</button>
                      </>}
                    />
                    <span id="collateral-note" className={`text-sm ${overBalance ? "hue-caution" : "text-t2"}`}>
                      {overBalance
                        ? `More than your available ${fmtUnits(row.holding.units)} ${sym}. Routes are checked against what you hold.`
                        : `Available ${fmtUnits(row.holding.units)} ${sym}.`}
                      {nativeUnits > 0 && ` Includes ${fmtUnits(nativeUnits)} native ${NATIVE_SYMBOL[table!.chainId] ?? "ETH"}, which is wrapped to ${sym} as an extra wallet step before it is supplied.`}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="label-strong text-t2" htmlFor="borrow-amount">Borrow amount</label>
                    <AmountInput id="borrow-amount" className="ctl num w-full" value={borrowAmount} onChange={setBorrowAmount} suffix={<span className="text-t2">USDC</span>} />
                    <span className="text-sm text-t2">Every supported market lends USDC.</span>
                  </div>
                </div>
                {sliderRoute && collateralUsd > 0 && sliderRoute.market.liquidationThreshold > 0 && (
                  <HealthSlider
                    collateralUsd={collateralUsd}
                    borrow={borrowAmount}
                    onBorrow={setBorrowAmount}
                    maxLtv={sliderRoute.market.ltv}
                    liqThreshold={sliderRoute.market.liquidationThreshold}
                    routeLabel={sliderRoute.label}
                    hf={sim && sim.check.status === "fundable" && sim.check.existingDebt > 0 ? sim.check.hf : null}
                  />
                )}
                <p className="text-sm text-t2 mt-3">Nothing moves until you review and approve.</p>
              </section>
            )}

            {/* 3. Compare rates */}
            {row && !changingAsset && routes && (
              <section className="stage" aria-labelledby="rates-heading">
                <h2 id="rates-heading" className="heading">Compare rates</h2>
                <div className="mt-3">
                  <RouteTable
                    routes={routes}
                    amount={borrowAmount}
                    symbol={sym}
                    selected={selectedRouteKey}
                    onSelect={(r) => selectRoute({ chainId: table!.chainId, rowKey: rowKeyOf(row), colKey: r.col.key, marketId: r.cell.market.id })}
                    onEditCollateral={() => focus("collateral-amount")}
                    onEditAmount={() => focus("borrow-amount")}
                  />
                </div>
              </section>
            )}

          </>
        )}
      </div>

      <aside className="rail" aria-label="Loan summary">
        <Rail
          key={`${input}:${chain}`}
          sim={sim}
          hint={hint}
          positions={positions?.positions ?? null}
          onSelect={selectRoute}
          view={view}
          onView={setView}
          reviewUnavailable={reviewUnavailable}
          oldestReadAt={oldestReadAt}
        />
      </aside>

      {/* After the summary when the layout is one column; under the comparison on desktop. */}
      <div className="main borrow-loans">
        {account.data && positions && <Positions positions={positions.positions} errors={positions.errors} owner={account.data.address} onChanged={account.refreshFresh} />}
      </div>
    </div>
  );
}
