"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { executorFor } from "@/lib/execution";
import { ERC20_ABI } from "@/lib/execution/common";
import { amount as fmtAmount, usd } from "@/lib/format";
import type { Sim } from "./Rail";
import { NATIVE_SYMBOL } from "@/lib/client-types";
import { WNATIVE } from "@/lib/protocols/addresses";
import type { ChainId } from "@/lib/protocols/types";
import { CAP_USD, MAINNET, StepList, modeNote, reader, useSteps } from "./WalletSteps";

/** Native coin kept back for network fees when wrapping. Ethereum fees run higher; POL is cheap per unit. */
const GAS_RESERVE: Record<number, bigint> = { 1: parseUnits("0.02", 18), 137: parseUnits("1", 18) };
const DEFAULT_GAS_RESERVE = parseUnits("0.005", 18);

export function WalletBorrow({ sim, issue }: { sim: Sim; issue: string | null }) {
  const chainId = sim.table.chainId;
  const gasReserve = GAS_RESERVE[chainId] ?? DEFAULT_GAS_RESERVE;
  const s = useSteps(chainId);
  const [collateral, setCollateral] = useState(0n);
  const [before, setBefore] = useState(0n);
  const [result, setResult] = useState<{ received: string; collateral: string } | null>(null);
  const market = sim.cell.market;
  const ref = { marketId: market.id, collateralToken: market.collateral.address as Address, loanToken: market.debt.address as Address };
  const capped = MAINNET && sim.amount > CAP_USD;

  const prepare = () => s.prepare(async (user) => {
    const r = reader(chainId);
    const [collateralBalance, native, loanBalance] = await Promise.all([
      r.readContract({ address: ref.collateralToken, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
      r.getBalance({ address: user }),
      r.readContract({ address: ref.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    ]);
    setBefore(loanBalance);
    const wanted = parseUnits(sim.units.toFixed(market.collateral.decimals), market.collateral.decimals);
    const spendable = collateralBalance + (native > gasReserve ? native - gasReserve : 0n);
    const amount = wanted < spendable ? wanted : spendable;
    setCollateral(amount);
    return executorFor(sim.col.id, chainId)!.prepareBorrow(r, {
      ...ref, user, collateral: amount, borrow: parseUnits(sim.amount.toFixed(market.debt.decimals), market.debt.decimals),
      gasReserve, wrappedNative: WNATIVE[chainId as ChainId], nativeSymbol: NATIVE_SYMBOL[chainId],
    });
  });

  const execute = () => s.execute(async (user) => {
    const r = reader(chainId);
    const [held, after] = await Promise.all([
      executorFor(sim.col.id, chainId)!.position(r, { ...ref, user }),
      r.readContract({ address: ref.loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    ]);
    setResult({ received: formatUnits(after - before, market.debt.decimals), collateral: formatUnits(held.collateral, market.collateral.decimals) });
  });

  if (result) return <div className="wash flex flex-col gap-2" role="status">
    <p className="body-strong">Loan opened.</p>
    <p className="text-t2">{usd(Number(result.received), { cents: true })} {market.debt.symbol} arrived in your wallet. {sim.col.name} holds {fmtAmount(Number(result.collateral))} {market.collateral.symbol} as collateral. Repay from Positions.</p>
    <p className="text-t3">{modeNote(chainId)} Read back from the chain after confirmation.</p>
  </div>;

  return <div className="flex flex-col gap-3">
    <p className="text-t2"><strong>{modeNote(chainId)}</strong> Kollat never holds keys or funds; the {market.debt.symbol} goes to your wallet.</p>
    {s.plan && <StepList steps={s.plan.steps} done={s.done} busy={s.busy} />}
    {s.plan && <p className="text-t2">Deposit {fmtAmount(Number(formatUnits(collateral, market.collateral.decimals)))} {market.collateral.symbol}, borrow {usd(sim.amount, { cents: true })} {market.debt.symbol}. Network fees are shown in your wallet.</p>}
    {capped && <p className="hue-caution" role="alert">Borrowing is limited to {usd(CAP_USD)} for now. Lower the amount.</p>}
    {s.error && <p className="hue-caution" role="alert">{s.error}</p>}
    {(issue || capped) && !s.plan ? null : !s.plan
      ? <button type="button" className="btn btn-primary btn-cta" disabled={s.busy} onClick={prepare}>{s.busy ? "Connecting…" : "Connect wallet"}</button>
      : <button type="button" className="btn btn-primary btn-cta" disabled={s.busy} onClick={execute}>{s.busy ? "Confirm in your wallet…" : s.done > 0 ? "Resume" : "Borrow"}</button>}
  </div>;
}
