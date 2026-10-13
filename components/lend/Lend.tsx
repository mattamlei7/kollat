"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { CHAIN_LABEL } from "@/lib/client-types";
import { readHolding } from "@/lib/earn/execute";
import { capacityLeft, parseAmountInput, rankOpportunities } from "@/lib/earn/rank";
import { EARN_CHAINS } from "@/lib/earn/registry";
import type { EarnSnapshot, Opportunity } from "@/lib/earn/types";
import { USDC } from "@/lib/protocols/addresses";
import { Sidebar } from "../Sidebar";
import { WalletControl } from "../WalletControl";
import { Avatar } from "../ui";
import { FORK_RPC } from "../WalletSteps";
import { Deposits, type HoldingRead } from "./Deposits";
import { EarnTable } from "./EarnTable";
import { fmtAgo, fmtToken } from "./format";
import { LendRail } from "./LendRail";
import { earnReader, lendLive, useWallet } from "./useWalletTx";

const USDC_TOKEN = { symbol: "USDC", decimals: 6 };
const POLL_MS = 60_000;

/**
 * Lend: choose an asset and network, enter an amount, compare destinations, review and deposit from your own wallet.
 * USDC only for now; each network is a separate choice and nothing is bridged or swapped.
 */
export function Lend() {
  const wallet = useWallet();
  return <LendSession key={wallet.address?.toLowerCase() ?? "disconnected"} wallet={wallet} />;
}

function LendSession({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const [snap, setSnap] = useState<EarnSnapshot | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number>(1);
  const pickedChain = useRef(false);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<number, bigint | null>>({});
  const [holdings, setHoldings] = useState<Map<string, HoldingRead> | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/earn", { cache: "no-store" });
      if (!res.ok) throw new Error(`Earn data request failed (${res.status})`);
      const s = (await res.json()) as EarnSnapshot;
      setSnap(s); setSnapError(null); setNow(Date.now());
      return s;
    } catch (e) { setSnapError((e as Error).message); setNow(Date.now()); return null; }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  // Default to the wallet's network when Lend supports it, until the user picks one.
  useEffect(() => {
    if (!pickedChain.current && wallet.chainId && (EARN_CHAINS as readonly number[]).includes(wallet.chainId)) {
      const t = setTimeout(() => setChainId(wallet.chainId!), 0);
      return () => clearTimeout(t);
    }
  }, [wallet.chainId]);

  const readBalances = useCallback(async () => {
    if (!wallet.address) return;
    const entries = await Promise.all(EARN_CHAINS.map(async (c) => {
      try { return [c, await earnReader(c).readContract({ address: USDC[c], abi: erc20Abi, functionName: "balanceOf", args: [wallet.address!] })] as const; }
      catch { return [c, null] as const; }
    }));
    setBalances(Object.fromEntries(entries));
  }, [wallet.address]);

  const readHoldings = useCallback(async (opps: Opportunity[]) => {
    if (!wallet.address) return;
    setHoldingsLoading(true);
    const reads = await Promise.all(opps.map(async (o): Promise<[string, HoldingRead]> => {
      // Public RPCs throttle bursts of reads; one retry before reporting the position as unreadable.
      const once = () => readHolding(earnReader(o.chainId), o, wallet.address!);
      try { return [o.id, { holding: await once().catch(() => new Promise<void>((r) => setTimeout(r, 800)).then(once)) }]; }
      catch (e) { return [o.id, { error: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0] }]; }
    }));
    setHoldings(new Map(reads));
    setHoldingsLoading(false);
  }, [wallet.address]);

  /** After a transaction: wallet balances, and the one position it touched. Throws if either read fails. */
  const refreshAfterTx = useCallback(async (o: Opportunity) => {
    if (!wallet.address) return;
    const [balance, holding] = await Promise.all([
      earnReader(o.chainId).readContract({ address: o.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
      readHolding(earnReader(o.chainId), o, wallet.address),
    ]);
    setBalances((previous) => ({ ...previous, [o.chainId]: balance }));
    setHoldings((m) => new Map(m ?? []).set(o.id, { holding }));
  }, [wallet.address]);

  const oppIds = snap?.opportunities.map((o) => o.id).join(",");
  useEffect(() => {
    if (!wallet.address) return;
    const t = setTimeout(() => { void readBalances(); if (snap) void readHoldings(snap.opportunities); }, 0);
    return () => clearTimeout(t);
    // Positions depend on which destinations exist, not on each rate refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, oppIds, readBalances, readHoldings]);

  const parsed = parseAmountInput(text, USDC_TOKEN.decimals);
  const amount = parsed.value !== null && parsed.value > 0n ? parsed.value : null;
  const balance = wallet.address ? balances[chainId] ?? null : null;
  const opps = useMemo(() => (snap?.opportunities ?? []).filter((o) => o.chainId === chainId), [snap, chainId]);
  const rows = useMemo(() => rankOpportunities(opps, amount, now), [opps, amount, now]);
  const selectedOpp = opps.find((o) => o.id === selected) ?? null;
  const selectedRow = rows.find((r) => r.opp.id === selected);

  // Shown once, under the amount field; the rail only disables its button for these.
  const inputIssue = parsed.error ?? (amount !== null && balance !== null && amount > balance ? `More than your available ${fmtToken(balance, USDC_TOKEN)}.` : null);
  // About the chosen destination; shown in the rail.
  const destIssue = (amount !== null && selectedOpp && capacityLeft(selectedOpp) !== null && amount > capacityLeft(selectedOpp)! ? `${selectedOpp.name} accepts at most ${fmtToken(capacityLeft(selectedOpp)!, USDC_TOKEN)} more right now.` : null)
    ?? (selectedRow && !selectedRow.eligible ? `${selectedRow.opp.name}: ${selectedRow.reason}.` : null);

  const failures = (snap?.failures ?? []).filter((f) => f.chainId === chainId);
  const unsupported = wallet.chainId !== null && !(EARN_CHAINS as readonly number[]).includes(wallet.chainId);
  const noUsdc = wallet.address && EARN_CHAINS.every((c) => balances[c] === 0n);
  // USDC the wallet holds on other networks, so a user on the wrong one can move over in one click.
  const elsewhere = EARN_CHAINS.filter((c) => c !== chainId && (balances[c] ?? 0n) > 0n && (balance ?? 0n) === 0n);

  function pickChain(c: number) {
    pickedChain.current = true;
    setChainId(c);
    setSelected(null); // a destination belongs to one network
  }

  return (
    <div className="shell borrow lend">
      <Sidebar current="lend" />

      <div className="main">
        <header className="topbar">
          <div className="flex flex-col">
            <h1 className="display-sm">Earn on your crypto</h1>
            <p className="text-t2">Compare earning options across Aave, Morpho and Spark.</p>
          </div>
          <WalletControl networks={[...EARN_CHAINS]} network={chainId} onNetwork={(n) => n !== "all" && pickChain(n)} wallet={wallet} />
        </header>

        {FORK_RPC && <p className="stage-note text-t2"><strong>Local fork.</strong> Deposits on {CHAIN_LABEL[Number(process.env.NEXT_PUBLIC_FORK_OF) || 8453]} go to a local copy of the chain; rates are read from the real networks.</p>}
        {unsupported && <p className="stage-note hue-caution" role="status">Your wallet is on {CHAIN_LABEL[wallet.chainId!] ?? `chain ${wallet.chainId}`}, which Lend does not support yet. Choose a network below; you’ll be asked to switch before depositing.</p>}

        <section className="stage" aria-labelledby="asset-heading">
          <h2 id="asset-heading" className="heading">Choose your asset</h2>
          <div className="asset-line mt-3">
            <Avatar text="USDC" token={{ chainId: 1, address: USDC[1] }} />
            <span className="body-strong">USDC</span>
            <span className="text-t2">on {CHAIN_LABEL[chainId]}</span>
            <button type="button" className="btn-text text-sm" onClick={() => document.querySelector<HTMLButtonElement>(".btn-net")?.click()}>Change network</button>
          </div>
          {elsewhere.length > 0 && <p className="text-t2 mt-2">You have {elsewhere.map((c, k) => <span key={c}>{k > 0 && ", "}<button type="button" className="btn-text" onClick={() => pickChain(c)}>{fmtToken(balances[c]!, USDC_TOKEN)} on {CHAIN_LABEL[c]}</button></span>)}.</p>}
          {noUsdc && <p className="text-t2 mt-2">This wallet has no USDC on the supported networks. You can still compare options.</p>}

          <div className="mt-4 flex flex-col gap-1 max-w-md">
            <label htmlFor="deposit-amount" className="label-strong text-t2">Amount to deposit</label>
            <span className="flex gap-2 items-center">
              <input id="deposit-amount" className="ctl num w-full" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text}
                onChange={(e) => setText(e.target.value)} aria-invalid={!!inputIssue} aria-describedby="deposit-note" />
              <span className="text-t2">USDC</span>
              <button type="button" className="btn btn-soft" disabled={balance === null} onClick={() => balance !== null && setText(formatUnits(balance, USDC_TOKEN.decimals))}>Max</button>
            </span>
            <span id="deposit-note" className={`text-sm ${inputIssue ? "hue-caution" : "text-t2"}`}>
              {inputIssue ?? (balance !== null ? `Available ${fmtToken(balance, USDC_TOKEN)} on ${CHAIN_LABEL[chainId]}.` : wallet.address ? balances[chainId] === null ? "Balance unavailable. Try refreshing before depositing." : "Reading your balance…" : "Connect a wallet to see your balance. You can compare options without one.")}
            </span>
          </div>
          <p className="text-sm text-t2 mt-3">Nothing moves until you review and confirm in your wallet. Kollat never bridges or swaps your funds.</p>
        </section>

        <section className="stage" aria-labelledby="options-heading" aria-busy={!snap && !snapError}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="options-heading" className="heading">Compare earning options</h2>
            {snap && <span className="text-sm text-t2">USDC on {CHAIN_LABEL[chainId]} · updated {fmtAgo(snap.fetchedAt, now)}</span>}
          </div>
          {failures.length > 0 && <p className="hue-caution mt-2" role="alert">Some data could not be read: {failures.map((f) => `${f.source} (${f.message})`).join("; ")}. Affected destinations are shown as unavailable and are not ranked.</p>}
          {snapError && <p className="hue-caution mt-2" role="alert">{snap ? `Refresh failed (${snapError}); showing data from ${fmtAgo(snap.fetchedAt, now)}.` : `Could not load earning options: ${snapError}.`} <button type="button" className="btn-text" onClick={load}>Try again</button></p>}
          <div className="mt-3">
            {!snap && !snapError && <div className="earn-list" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="earn-row"><span className="skel" style={{ width: 180 }} /></div>)}</div>}
            {snap && opps.length === 0 && <p className="text-t2">No destinations accept USDC on {CHAIN_LABEL[chainId]} yet.</p>}
            {snap && opps.length > 0 && <EarnTable rows={rows} amount={amount} selected={selected} onSelect={setSelected} />}
          </div>
        </section>
      </div>

      <aside className="rail" aria-label="Deposit summary">
        <LendRail
          key={`${selected ?? "none"}:${amount?.toString() ?? "empty"}`}
          opp={selectedOpp}
          amount={amount}
          amountIssue={destIssue}
          blocked={!!inputIssue}
          address={wallet.address}
          onConnect={wallet.connect}
          refresh={async (id) => (await load())?.opportunities.find((o) => o.id === id) ?? null}
          onDeposited={refreshAfterTx}
          onViewPosition={() => document.getElementById("your-deposits")?.scrollIntoView({ behavior: "smooth" })}
        />
      </aside>

      <div className="main borrow-loans">
        <Deposits
          opps={snap?.opportunities ?? []}
          address={wallet.address}
          holdings={holdings}
          loading={holdingsLoading}
          onConnect={wallet.connect}
          onAddFunds={(o) => { pickChain(o.chainId); setSelected(o.id); document.getElementById("deposit-amount")?.focus(); }}
          onChanged={refreshAfterTx}
        />
        {!lendLive(chainId) && !FORK_RPC && <p className="row text-sm text-t2 pb-6">Deposits are a read-only preview in this environment.</p>}
      </div>
    </div>
  );
}
