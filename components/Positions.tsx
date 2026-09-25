import { amount, pct, signedPct, usd } from "@/lib/format";
import type { PositionView } from "@/lib/join";
import { riskBand } from "@/lib/math/health";
import { BandChip, HealthFactor, hueClass } from "./Risk";
import { ErrorLine } from "./States";
import { Avatar, Def, tone } from "./ui";
import { WalletRepay } from "./WalletRepay";
import { executable } from "./WalletSteps";

interface Props {
  positions: PositionView[];
  /** Address the positions belong to; repay needs the same wallet. */
  owner: string;
  onChanged?: () => void;
  errors: { name: string; message: string; retryable: boolean }[];
}

/** Open positions with health factor, per-leg liquidation price and a plain-language read. */
export function Positions({ positions, errors, owner, onChanged }: Props) {
  return (
    <section aria-labelledby="positions" id="positions" className="section">
      <div className="row flex items-baseline gap-3">
        <h2 id="positions" className="heading">Positions</h2>
        {positions.length === 0 && errors.length === 0 && <span className="text-t2">None on the supported protocols</span>}
      </div>
      <div className="flex flex-col gap-2 mt-4">
        {positions.map((v) => (
          <PositionBlock key={v.key} view={v} owner={owner} onChanged={onChanged} />
        ))}
      </div>
      {errors.length > 0 && (
        <div className="row pt-4 flex flex-col gap-1">
          {errors.map((e) => <ErrorLine key={e.name} {...e} />)}
        </div>
      )}
    </section>
  );
}

function PositionBlock({ view, owner, onChanged }: { view: PositionView; owner: string; onChanged?: () => void }) {
  const p = view.position;
  // The protocol's own number is authoritative (Aave E-mode, Euler unit of account); ours is the cross-check.
  const hf = p.healthFactorReported ?? p.healthFactor;
  const band = hf === null ? "none" : riskBand(hf);
  const t = tone(band);
  const debtUsd = p.debt.reduce((s, l) => s + l.usd, 0);
  const collUsd = p.collateral.reduce((s, l) => s + l.usd, 0);
  const liqByToken = new Map(p.liquidationPrices.map((l) => [l.token.address.toLowerCase(), l.priceUsd]));
  const drawdown = p.uniformDrawdownToLiquidation;

  return (
    <article aria-label={`${view.label} position`}>
      <div className="px-[var(--gutter)] py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="name-cell">
          <Avatar text={view.label} />
          <div className="lines">
            <span className="body-strong">{view.label}</span>
            <span className="sub num">
              {usd(collUsd - debtUsd)} net{collUsd > 0 && debtUsd > 0 ? ` · debt is ${pct(debtUsd / collUsd, 1)} of collateral` : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-t2"><Def term="hf">HF</Def></span>
          <HealthFactor value={hf} size="lg" />
          <BandChip band={band} />
        </div>
        {p.healthFactorReported !== null && p.healthFactor !== null && Math.abs(p.healthFactorReported - p.healthFactor) > 0.005 && (
          <span className="text-t2">
            we compute <span className="num">{p.healthFactor.toFixed(2)}</span>
          </span>
        )}
        {drawdown !== null && (
          <span className="text-t2">
            all collateral <span className="num">{signedPct(-drawdown, 1)}</span> → liquidation
          </span>
        )}
        {view.stale && <span className="badge">stale</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="blotter">
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col">Amount</th>
              <th scope="col">Value</th>
              <th scope="col"><Def term="lt">Liq. threshold</Def></th>
              <th scope="col"><Def term="liq">Liq. price</Def></th>
            </tr>
          </thead>
          <tbody>
            {p.collateral.map((l) => {
              const liq = liqByToken.get(l.token.address.toLowerCase());
              return (
                <tr key={"c" + l.token.address}>
                  <th scope="row">
                    <span className="name-cell">
                      <Avatar text={l.token.symbol} />
                      <span className="lines">
                        <span>{l.token.symbol}</span>
                        <span className="sub">Collateral</span>
                      </span>
                    </span>
                  </th>
                  <td className="num">{amount(Number(l.amount) / 10 ** l.token.decimals)}</td>
                  <td className="num">{usd(l.usd)}</td>
                  <td className="num">{l.liquidationThreshold ? pct(l.liquidationThreshold, 1) : <span className="text-t2">not collateral</span>}</td>
                  <td className={`num ${hueClass(band)}`}>
                    {liq === undefined ? "—" : liq === 0 ? <span className="text-t2">covered by other collateral</span> : usd(liq, { cents: true })}
                  </td>
                </tr>
              );
            })}
            {p.debt.map((l) => (
              <tr key={"d" + l.token.address}>
                <th scope="row">
                  <span className="name-cell">
                    <Avatar text={l.token.symbol} />
                    <span className="lines">
                      <span>{l.token.symbol}</span>
                      <span className="sub">Debt</span>
                    </span>
                  </span>
                </th>
                <td className="num">{amount(Number(l.amount) / 10 ** l.token.decimals)}</td>
                <td className="num">{usd(l.usd)}</td>
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {executable(view.protocolId, view.chainId) && p.marketId && p.debt.length + p.collateral.length > 0 && (
        <div className="px-[var(--gutter)] pt-3"><WalletRepay view={view} owner={owner} onChanged={onChanged} /></div>
      )}

      {(t !== "none" && t !== "safe") || p.notes.length > 0 ? (
        <div className="px-[var(--gutter)] pt-3">
          <div className="wash flex flex-col gap-2" data-tone={t === "safe" ? "none" : t}>
            {band === "watch" && (
              <p>
                A further {pct(drawdown ?? 0, 1)} drop across the collateral makes this position liquidatable. Repay or add collateral before it gets there.
              </p>
            )}
            {band === "danger" && (
              <p className="hue-danger">
                Within {pct(drawdown ?? 0, 1)} of liquidation. A liquidator can then repay part of the debt and take collateral plus the protocol&apos;s bonus.
              </p>
            )}
            {band === "liquidatable" && (
              <p className="hue-danger">Liquidatable now. Any liquidator can repay debt and seize collateral at a discount.</p>
            )}
            {p.notes.map((n) => (
              <p key={n} className="text-t2">{n}</p>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
