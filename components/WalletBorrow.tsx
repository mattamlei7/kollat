"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { ERC20_ABI, MORPHO_WRITE_ABI, morphoBorrowPlan } from "@/lib/execution/morpho";
import { amount as fmtAmount, usd } from "@/lib/format";
import type { Sim } from "./Rail";
import { CAP_USD, MAINNET, MORPHO, StepList, modeNote, reader, useSteps } from "./WalletSteps";

const GAS_RESERVE = parseUnits("0.01", 18);

export function WalletBorrow({ sim, issue }: { sim: Sim; issue: string | null }) {
  const s = useSteps();
  const [collateral, setCollateral] = useState(0n);
  const [before, setBefore] = useState(0n);
  const [result, setResult] = useState<{ received: string; collateral: string } | null>(null);
  const market = sim.cell.market;
  const marketId = market.id.slice(market.id.lastIndexOf(":") + 1) as Hex;
  const loan = market.debt.address as Address;
  const capped = MAINNET && sim.amount > CAP_USD;

  const prepare = () => s.prepare(async (user) => {
    const r = reader();
    const [loanToken, collateralToken, oracle, irm, lltv] = await r.readContract({ address: MORPHO, abi: MORPHO_WRITE_ABI, functionName: "idToMarketParams", args: [marketId] });
    const [collateralBalance, allowance, native, loanBalance] = await Promise.all([
      r.readContract({ address: collateralToken, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
      r.readContract({ address: collateralToken, abi: ERC20_ABI, functionName: "allowance", args: [user, MORPHO] }),
      r.getBalance({ address: user }),
      r.readContract({ address: loan, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    ]);
    setBefore(loanBalance);
    const units = Math.min(sim.row.holding.units, sim.cell.capacity.collateralUsd / market.collateralPriceUsd);
    const wanted = parseUnits(units.toFixed(market.collateral.decimals), market.collateral.decimals);
    const spendable = collateralBalance + (native > GAS_RESERVE ? native - GAS_RESERVE : 0n);
    const amount = wanted < spendable ? wanted : spendable;
    setCollateral(amount);
    return morphoBorrowPlan({
      morpho: MORPHO, market: { loanToken, collateralToken, oracle, irm, lltv }, user, collateral: amount,
      borrow: parseUnits(sim.amount.toFixed(market.debt.decimals), market.debt.decimals),
      collateralBalance, allowance, native, gasReserve: GAS_RESERVE,
    });
  });

  const execute = () => s.execute(async (user) => {
      const r = reader();
      const [[, , held], after] = await Promise.all([
        r.readContract({ address: MORPHO, abi: MORPHO_WRITE_ABI, functionName: "position", args: [marketId, user] }),
        r.readContract({ address: loan, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
      ]);
      setResult({ received: formatUnits(after - before, market.debt.decimals), collateral: formatUnits(held, market.collateral.decimals) });
  });

  if (result) return <div className="wash flex flex-col gap-2" role="status">
    <p className="body-strong">Loan opened.</p>
    <p className="text-t2">{usd(Number(result.received), { cents: true })} {market.debt.symbol} arrived in your wallet. Morpho holds {fmtAmount(Number(result.collateral))} {market.collateral.symbol} as collateral for this market. Repay from Positions.</p>
    <p className="text-t3">{modeNote} Read back from the chain after confirmation.</p>
  </div>;

  return <div className="flex flex-col gap-3">
    <p className="text-t2"><strong>{modeNote}</strong> Kollat never holds keys or funds; the {market.debt.symbol} goes to your wallet.</p>
    {s.plan && <StepList steps={s.plan.steps} done={s.done} busy={s.busy} />}
    {s.plan && <p className="text-t2">Deposit {fmtAmount(Number(formatUnits(collateral, market.collateral.decimals)))} {market.collateral.symbol}, borrow {usd(sim.amount, { cents: true })} {market.debt.symbol}. Network fees are shown in your wallet.</p>}
    {capped && <p className="hue-caution" role="alert">Borrowing is limited to {usd(CAP_USD)} for now. Lower the amount.</p>}
    {s.error && <p className="hue-caution" role="alert">{s.error}</p>}
    {(issue || capped) && !s.plan ? null : !s.plan
      ? <button type="button" className="btn btn-primary btn-cta" disabled={s.busy} onClick={prepare}>{s.busy ? "Connecting…" : "Connect wallet"}</button>
      : <button type="button" className="btn btn-primary btn-cta" disabled={s.busy} onClick={execute}>{s.busy ? "Confirm in your wallet…" : s.done > 0 ? "Resume" : "Borrow"}</button>}
  </div>;
}
