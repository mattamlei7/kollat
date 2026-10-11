import { boxCorners, fitProjection, iso, lineOnTop, pathOf, type Flat, type Plan, type Point3 } from "@/components/iso/iso-kit";
import { PRICE_MAX, PRICE_MIN, dropAt } from "./model";

export const WIDTH = 600;
export const HEIGHT = 400;

export const PLATE: Plan = { x: -125, y: -90, w: 200, d: 172, r: 9 };
export const PLATE_H = 10;
export const FOOT_H = 5;

/** The scale: a housing with a stem rising through a collar into the platform. */
export const HOUSING: Plan = { x: -112, y: -52, w: 108, d: 100, r: 5 };
export const HOUSING_H = 20;
export const CENTRE: [number, number] = [-58, -2];
export const COLLAR_R = 9;
export const COLLAR_TOP = HOUSING_H + 3;
export const STEM_R = 5;
export const PLATFORM: Plan = { x: -106, y: -46, w: 96, d: 88, r: 4 };
export const PLATFORM_H = 4;
/** Platform underside when the price can fall no further: it is held by the stop. */
export const TOP_Z = 46;
/** Platform travel per 100% of price drop left. */
export const SINK = 34;
export const STROKE = SINK * dropAt(PRICE_MAX);
/** Everything that moves is built at the highest price (platform lowest, weights highest) and lifted from there. */
export const LOW_Z = TOP_Z - STROKE;
export const liftAt = (drop: number) => STROKE - SINK * drop;

export const MAT: Plan = { x: -100, y: -30, w: 76, d: 60, r: 2 };
export const BARS: Plan[] = [
  { x: -96, y: -26, w: 30, d: 52, r: 2.4 },
  { x: -60, y: -26, w: 30, d: 52, r: 2.4 },
];
export const BAR_H = 11;

/** Cable plane, hook on the platform and the two pulleys on the beam. */
export const CABLE_Y = -38;
export const PULLEY_R = 6;
export const PULLEY_A = -33;
export const PULLEY_B = 22;
export const PULLEY_Z = 116;
export const HOOK_X = PULLEY_A - PULLEY_R;
export const WEIGHT_X = PULLEY_B + PULLEY_R;
export const EYE_R = 1.6;
export const BEAM: Plan = { x: -60, y: CABLE_Y - 6, w: PULLEY_B + 10 + 60, d: 12, r: 1.5 };
export const BEAM_Z = 126;
export const BEAM_H = 6;
export const COLUMN: Plan = { x: -60, y: -84, w: 10, d: 10, r: 1.5 };

/** Debt weights: hanger top when the platform sits on its stop, and the stack below it. */
export const WEIGHT_TOP_LOW = 40;
export const HANGER = 30;
export const WEIGHT_R = 9;
export const DISC_H = 4.5;

/** Dial head reading the health factor. */
export const PEDESTAL: Plan = { x: 8, y: 6, w: 52, d: 52, r: 4 };
export const PEDESTAL_H = 24;
export const DIAL: [number, number] = [34, 32];
export const DIAL_R = 22;
export const DIAL_H = 8;
export const DIAL_TOP = PEDESTAL_H + DIAL_H;
export const HF_LO = 0.5;
export const HF_HI = 3;
/** The arc opens toward the viewer: 0.5 on the left, 3.0 on the right, clockwise seen from above. */
export const DIAL_FROM = Math.PI;
export const DIAL_SPAN = Math.PI * 1.5;

/** Price rail along the front edge. */
export const RAIL: Plan = { x: -114, y: 62, w: 176, d: 6, r: 1 };
export const RAIL_H = 3;
export const RULER: Plan = { x: -114, y: 70, w: 176, d: 8, r: 1 };
export const PRICE_X0 = -106;
export const PRICE_X1 = 54;
export const xOfPrice = (price: number) => PRICE_X0 + ((price - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * (PRICE_X1 - PRICE_X0);
export const priceOfShare = (share: number) => PRICE_MIN + share * (PRICE_MAX - PRICE_MIN);

export const P = fitProjection(
  [...boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [COLUMN.x, COLUMN.y, BEAM_Z + BEAM_H], [BEAM.x + BEAM.w, BEAM.y + BEAM.d, BEAM_Z + BEAM_H]],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 40 },
);

export const at = (point: Point3): Flat => iso(point, P);

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
export const dialAngle = (hf: number) => DIAL_FROM + ((clamp(hf, HF_LO, HF_HI) - HF_LO) / (HF_HI - HF_LO)) * DIAL_SPAN;

export function needleOf(hf: number) {
  const angle = dialAngle(hf);
  const [x, y] = DIAL;
  const sx = Math.sin(angle);
  const sy = -Math.cos(angle);
  return lineOnTop([x - sx * 3.4, y - sy * 3.4], [x + sx * (DIAL_R - 4.5), y + sy * (DIAL_R - 4.5)], DIAL_TOP + 0.2, P);
}

/** Points round a pulley's top half, in the cable plane, from one side to the other. */
function over(cx: number, from: number, to: number) {
  const out: Point3[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = from + ((to - from) * i) / 32;
    out.push([cx + Math.cos(t) * PULLEY_R, CABLE_Y, PULLEY_Z + Math.sin(t) * PULLEY_R]);
  }
  return out;
}

/** The cable from the platform's eye, over both pulleys, down to the weights' eye. */
export function cableOf(lift: number) {
  const eye = LOW_Z + PLATFORM_H + 4 + EYE_R + lift;
  const weightEye = WEIGHT_TOP_LOW + STROKE - lift + EYE_R;
  const points: Point3[] = [[HOOK_X, CABLE_Y, eye], ...over(PULLEY_A, Math.PI, Math.PI / 2), ...over(PULLEY_B, Math.PI / 2, 0), [WEIGHT_X, CABLE_Y, weightEye]];
  return pathOf(points.map(at));
}
