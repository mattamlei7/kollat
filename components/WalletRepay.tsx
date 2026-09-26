"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { executorFor } from "@/lib/execution";
import { USDC } from "@/lib/protocols/addresses";
import type { ChainId } from "@/lib/protocols/types";
import type { PositionView } from "@/lib/join";
import { amount as fmtAmount } from "@/lib/format";
import { StepList, modeNote, reader, useSteps } from "./WalletSteps";

/** Repay part of a position, or repay all of it and take the collateral back. Kollat's loans are in USDC. */
export function WalletRepay({ view, owner, onChanged }: { view: PositionView; owner: string; onChanged?: () => void }) {
  const s = useSteps(view.chainId);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const p = view.position;
  const loanToken = USDC[view.chainId as ChainId];
  const debtToken = p.debt.find((l) => l.token.address.toLowerCase() === loanToken.toLowerCase())?.token ?? { symbol: "USDC", decimals: 6 };
  const collToken = p.collateral[0]?.token;
  const ref = { marketId: p.marketId ?? "", loanToken, collateralToken: (collToken?.address ?? loanToken) as Address };

  const prepare = (repayAll: boolean) => s.prepare(async (user) => {
    if (user.toLowerCase() !== owner.toLowerCase()) throw new Error("Connect the wallet that owns this position.");
    return executorFor(view.protocolId, view.chainId)!.prepareRepay(reader(view.chainId), {
      ...ref, user, assets: repayAll ? undefined : parseUnits(input || "0", debtToken.decimals),
      collateralTokens: p.collateral.map((l) => l.token.address as Address), debtTokens: p.debt.map((l) => l.token.address as Address),
    });
  });

  const execute = () => s.execute(async (user: Address) => {
    const { collateral, debt } = await executorFor(view.protocolId, view.chainId)!.position(reader(view.chainId), { ...ref, user });
    setResult(debt === 0n && collateral === 0n ? "Loan closed. Your collateral is back in your wallet."
      : `Repaid. ${collToken ? `${fmtAmount(Number(formatUnits(collateral, collToken.decimals)))} ${collToken.symbol} still backs the remaining debt.` : ""}`);
    onChanged?.();
  });

  if (result) return <p className="body-strong" role="status">{result}</p>;
  if (!open) return <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>Repay or close</button>;
  return <div className="flex flex-col gap-3 max-w-md">
    <p className="text-t2"><strong>{modeNote(view.chainId)}</strong> Repayment comes from your wallet{debtToken ? `'s ${debtToken.symbol}` : ""}. Collateral returns to the same wallet.</p>
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
