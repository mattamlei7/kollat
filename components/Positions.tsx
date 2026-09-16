import { amount, pct, signedPct, usd } from "@/lib/format";
import type { PositionView } from "@/lib/join";
import { riskBand } from "@/lib/math/health";
import { BandChip, HealthFactor, hueClass } from "./Risk";
import { ErrorLine } from "./States";
import { Def, tone } from "./ui";

interface Props {
  positions: PositionView[];
  errors: { name: string; message: string; retryable: boolean }[];
}

/** Open positions with health factor, per-leg liquidation price and a plain-language read. */
export function Positions({ positions, errors }: Props) {
  return (
    <section aria-labelledby="positions">
      <div className="px-[var(--gutter)] pt-6 pb-2 flex items-baseline gap-3">
        <h2 id="positions" className="font-medium text-[15px]">Existing positions</h2>
        {positions.length === 0 && errors.length === 0 && <span className="text-t3">none on the supported protocols</span>}
      </div>
      {positions.map((v) => (
        <PositionBlock key={v.key} view={v} />
      ))}
      {errors.length > 0 && (
        <div className="px-[var(--gutter)] py-3 flex flex-col gap-1">
          {errors.map((e) => <ErrorLine key={e.name} {...e} />)}
        </div>
      )}
    </section>
  );
}

function PositionBlock({ view }: { view: PositionView }) {
  const p = view.position;
  const hf = p.healthFactor;
  const band = hf === null ? "none" : riskBand(hf);
  const t = tone(band);
  const debtUsd = p.debt.reduce((s, l) => s + l.usd, 0);
  const collUsd = p.collateral.reduce((s, l) => s + l.usd, 0);
  const liqByToken = new Map(p.liquidationPrices.map((l) => [l.token.address.toLowerCase(), l.priceUsd]));
  const drawdown = p.uniformDrawdownToLiquidation;

  return (
    <article className="hair-t" aria-label={`${view.label} position`}>
      <div className="px-[var(--gutter)] py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <h3 className="font-medium">{view.label}</h3>
        <div className="flex items-center gap-3">
          <span className="text-t2"><Def term="hf">HF</Def></span>
          <HealthFactor value={hf} size="lg" />
          <BandChip band={band} />
        </div>
        {p.healthFactorReported !== null && hf !== null && Math.abs(p.healthFactorReported - hf) > 0.005 && (
          <span className="text-t3">
            protocol reports <span className="num">{p.healthFactorReported.toFixed(2)}</span>
          </span>
        )}
        {drawdown !== null && (
          <span className="text-t3">
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
              <th scope="col"><Def term="lt" right>Liq. threshold</Def></th>
              <th scope="col"><Def term="liq" right>Liq. price</Def></th>
            </tr>
          </thead>
          <tbody>
            {p.collateral.map((l) => {
              const liq = liqByToken.get(l.token.address.toLowerCase());
              return (
                <tr key={"c" + l.token.address}>
                  <th scope="row" className="font-medium">
                    {l.token.symbol}
                    <span className="sub">collateral</span>
                  </th>
                  <td className="num">{amount(Number(l.amount) / 10 ** l.token.decimals)}</td>
                  <td className="num">{usd(l.usd)}</td>
                  <td className="num">{l.liquidationThreshold ? pct(l.liquidationThreshold, 1) : <span className="text-t3">not collateral</span>}</td>
                  <td className={`num ${hueClass(band)}`}>
                    {liq === undefined ? "—" : liq === 0 ? <span className="text-t3">covered by other collateral</span> : usd(liq, { cents: true })}
                  </td>
                </tr>
              );
            })}
            {p.debt.map((l) => (
              <tr key={"d" + l.token.address}>
                <th scope="row" className="font-medium">
                  {l.token.symbol}
                  <span className="sub">debt</span>
                </th>
                <td className="num">{amount(Number(l.amount) / 10 ** l.token.decimals)}</td>
                <td className="num">{usd(l.usd)}</td>
                <td />
                <td />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{collUsd > 0 && debtUsd > 0 ? `Debt is ${pct(debtUsd / collUsd, 1)} of collateral` : ""}</td>
              <td className="num">{usd(collUsd - debtUsd)} net</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {(t !== "none" && t !== "safe") || p.notes.length > 0 ? (
        <div className="px-[var(--gutter)] py-3">
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
