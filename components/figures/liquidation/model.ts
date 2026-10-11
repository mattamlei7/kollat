import { healthFactor, liquidationPriceSingle, uniformDrawdown } from "@/lib/math/health";

/** The example loan: 2 ETH supplied, $3,000 USDC borrowed, an 83% liquidation threshold. */
export const UNITS = 2;
export const LT = 0.83;
export const DEBT = 3000;
/** One slotted weight per $1,000 of debt. */
export const WEIGHTS = DEBT / 1000;

export const PRICE_MIN = 1000;
export const PRICE_MAX = 4500;
export const PRICE_START = 3000;

/** Same functions the borrow screen uses, so the figure can't disagree with it. */
export const LIQ_PRICE = liquidationPriceSingle(UNITS, LT, DEBT);
export const hfAt = (price: number) => healthFactor([{ units: UNITS, priceUsd: price, liquidationThreshold: LT, ltv: LT }], DEBT);
/** Share the price can still fall before liquidation: 1 − 1/HF, 0 once liquidatable. */
export const dropAt = (price: number) => uniformDrawdown(hfAt(price));

const dollars = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

export function readoutOf(price: number) {
  const head = `ETH ${dollars(price)}`;
  return hfAt(price) < 1 ? `${head} · your ETH can be sold` : `${head} · can fall ${Math.round(dropAt(price) * 100)}% before ${dollars(LIQ_PRICE)}`;
}

export const CAPTION = `Move your pointer across the picture to change the ETH price. Here, 2 ETH back a ${dollars(DEBT)} loan. ` +
  `As the price falls, the needle moves toward red. If ETH drops below ${dollars(LIQ_PRICE)}, part of your ETH can be sold to repay the loan. Example loan.`;
