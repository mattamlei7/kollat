"use client";

/**
 * The borrow question, asked beside the address rather than after the tables.
 * Capacity for this amount is described by the rail's #sim-capacity note.
 */
export function AmountField({ value, invalid, onChange }: { value: number; invalid: boolean; onChange: (amount: number) => void }) {
  return (
    <div className="amount-pill">
      <label className="sr-only" htmlFor="sim-amount">Amount to borrow in USDC</label>
      <input
        id="sim-amount"
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        className="num"
        value={Number(value.toFixed(2))}
        aria-invalid={invalid}
        aria-describedby="sim-capacity"
        onChange={(e) => {
          const amount = Number(e.target.value);
          if (Number.isFinite(amount) && amount >= 0) onChange(amount);
        }}
      />
      <span className="unit">USDC</span>
    </div>
  );
}
