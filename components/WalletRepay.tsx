"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { ERC20_ABI, MORPHO_WRITE_ABI, morphoRepayPlan, toAssetsUp } from "@/lib/execution/morpho";
import type { PositionView } from "@/lib/join";
import { amount as fmtAmount } from "@/lib/format";
import { MORPHO, StepList, modeNote, reader, useSteps } from "./WalletSteps";

/** Repay part of a Morpho position, or repay all of it and take the collateral back. */
export function WalletRepay({ view, owner, onChanged }: { view: PositionView; owner: string; onChanged?: () => void }) {
  const s = useSteps();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const p = view.position;
  const marketId = (p.marketId ?? "").slice((p.marketId ?? "").lastIndexOf(":") + 1) as Hex;
  const debtToken = p.debt[0]?.token;
  const collToken = p.collateral[0]?.token;

  const prepare = (repayAll: boolean) => s.prepare(async (user) => {
    const r = reader();
    const [loanToken, collateralToken, oracle, irm, lltv] = await r.readContract({ address: MORPHO, abi: MORPHO_WRITE_ABI, functionName: "idToMarketParams", args: [marketId] });
    const [[, borrowShares, collateral], [, , totalBorrowAssets, totalBorrowShares], loanBalance, allowance] = await Promise.all([
      r.readContract({ address: MORPHO, abi: MORPHO_WRITE_ABI, functionName: "position", args: [marketId, user] }),
      r.readContract({ address: MORPHO, abi: MORPHO_WRITE_ABI, functionName: "market", args: [marketId] }),
      r.readContract({ address: loanToken, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
      r.readContract({ address: loanToken, abi: ERC20_ABI, functionName: "allowance", args: [user, MORPHO] }),
    ]);
    if (user.toLowerCase() !== owner.toLowerCase()) throw new Error("Connect the wallet that owns this position.");
    const assets = repayAll ? undefined : parseUnits(input || "0", debtToken?.decimals ?? 6);
    return morphoRepayPlan({
      morpho: MORPHO, market: { loanToken, collateralToken, oracle, irm, lltv }, user, assets,
      borrowShares, debt: toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares), collateral, loanBalance, allowance,
    });
  });

  const execute = () => s.execute(async (user: Address) => {
    const [, borrowShares, collateral] = await reader().readContract({ address: MORPHO, abi: MORPHO_WRITE_ABI, functionName: "position", args: [marketId, user] });
    setResult(borrowShares === 0n && collateral === 0n ? "Loan closed. Your collateral is back in your wallet."
      : `Repaid. ${collToken ? `${fmtAmount(Number(formatUnits(collateral, collToken.decimals)))} ${collToken.symbol} still backs the remaining debt.` : ""}`);
    onChanged?.();
  });

  if (result) return <p className="body-strong" role="status">{result}</p>;
  if (!open) return <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>Repay or close</button>;
  return <div className="flex flex-col gap-3 max-w-md">
    <p className="text-t2"><strong>{modeNote}</strong> Repayment comes from your wallet{debtToken ? `'s ${debtToken.symbol}` : ""}. Collateral returns to the same wallet.</p>
    {!s.plan && <label className="flex flex-col gap-1">
      <span className="text-t2">Repay part{debtToken ? ` (${debtToken.symbol})` : ""}</span>
      <input className="ctl num w-full" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" />
    </label>}
    {s.plan && <StepList steps={s.plan.steps} done={s.done} busy={s.busy} />}
    {s.error && <p className="hue-caution" role="alert">{s.error}</p>}
    {!s.plan ? <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-quiet" disabled={s.busy || !Number(input)} onClick={() => prepare(false)}>Repay amount</button>
      <button type="button" className="btn btn-primary" disabled={s.busy} onClick={() => prepare(true)}>Repay all and withdraw</button>
    </div> : <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" disabled={s.busy} onClick={execute}>{s.busy ? "Confirm in your wallet…" : s.done > 0 ? "Resume" : "Confirm"}</button>
      {!s.busy && s.done === 0 && <button type="button" className="btn btn-quiet" onClick={s.reset}>Back</button>}
    </div>}
  </div>;
}
