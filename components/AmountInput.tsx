"use client";

import { useState } from "react";
import { parseAmount } from "@/lib/eligibility";

/** Grouped, at most `decimals` places (two for USDC), empty at zero (so the first digit typed replaces nothing). */
export const formatAmount = (value: number, decimals = 2) => (value > 0 ? value.toLocaleString("en-US", { maximumFractionDigits: decimals }) : "");
/** What the field holds while being edited: the plain number, so typing never fights the grouping. */
const editable = (value: number, decimals: number) => (value > 0 ? String(Math.round(value * 10 ** decimals) / 10 ** decimals) : "");

interface Props {
  id: string;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  /** Shown beside the field, e.g. the "USDC" unit. */
  suffix?: React.ReactNode;
  /** Decimal places shown: 2 for USDC, more for a token quantity. */
  decimals?: number;
}

/**
 * A USDC amount field. While focused it keeps exactly what was typed (no reformatting, so the cursor never jumps);
 * on blur it shows the grouped value. Malformed, negative or oversized text is reported and never reaches the amount.
 * Several of these can show the same value: each follows `value` whenever it is not the one being typed in.
 */
export function AmountInput({ id, value, onChange, className = "ctl num", invalid = false, describedBy, placeholder = "0", suffix, decimals = 2 }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;
  return (
    <span className="flex flex-col">
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className={className}
          placeholder={placeholder}
          value={draft ?? formatAmount(value, decimals)}
          aria-invalid={invalid || !!error}
          aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined}
          onFocus={() => setDraft(editable(value, decimals))}
          onBlur={() => {
            setDraft(null);
            setError(null);
          }}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            const parsed = parseAmount(text);
            setError(parsed.error);
            if (parsed.value !== null) onChange(parsed.value);
          }}
        />
        {suffix}
      </span>
      {error && (
        <span id={errorId} className="amount-error hue-caution text-sm">
          {error} Your amount is unchanged.
        </span>
      )}
    </span>
  );
}
