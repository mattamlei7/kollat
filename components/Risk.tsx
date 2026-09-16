import { riskBand, type RiskBand } from "@/lib/math/health";
import { hf as fmtHf } from "@/lib/format";
import { Chip, tone } from "./ui";

export function bandLabel(band: RiskBand): string {
  switch (band) {
    case "none":
      return "No debt";
    case "comfortable":
      return "Comfortable";
    case "watch":
      return "Watch";
    case "danger":
      return "Liquidation range";
    case "liquidatable":
      return "Liquidatable now";
  }
}

export function hueClass(band: RiskBand): string {
  const t = tone(band);
  return t === "none" ? "" : `hue-${t}`;
}

/** The health-factor figure. One of three places saturated hue is allowed. */
export function HealthFactor({ value, size = "base" }: { value: number | null; size?: "base" | "lg" | "hero" }) {
  const band = value === null ? "none" : riskBand(value);
  const cls = size === "hero" ? "text-[36px] leading-none font-medium" : size === "lg" ? "text-[20px] leading-none font-medium" : "font-medium";
  return <span className={`num ${cls} ${hueClass(band)}`}>{fmtHf(value)}</span>;
}

export function BandChip({ band }: { band: RiskBand }) {
  return <Chip tone={tone(band)}>{bandLabel(band)}</Chip>;
}
