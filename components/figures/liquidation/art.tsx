import * as React from "react";
import { Dots, FaceText, Line, Solid, Wire } from "@/components/iso/draw";
import * as k from "@/components/iso/iso-kit";
import * as G from "@/components/iso/lathe";
import { LIQ_PRICE, PRICE_MAX, PRICE_MIN, PRICE_START, WEIGHTS, dropAt, hfAt } from "./model";
import { LiquidationLive } from "./live";
import {
  BARS, BAR_H, BEAM, BEAM_H, BEAM_Z, CABLE_Y, CENTRE, COLLAR_R, COLLAR_TOP, COLUMN, DIAL, DIAL_FROM, DIAL_H, DIAL_R, DIAL_SPAN, DIAL_TOP, DISC_H,
  EYE_R, FOOT_H, HANGER, HF_HI, HF_LO, HOOK_X, HOUSING, HOUSING_H, LOW_Z, MAT, P, PEDESTAL, PEDESTAL_H, PLATE, PLATE_H, PLATFORM, PLATFORM_H,
  PRICE_X0, PRICE_X1, PULLEY_A, PULLEY_B, PULLEY_R, PULLEY_Z, RAIL, RAIL_H, RULER, STEM_R, STROKE, TOP_Z, WEIGHT_R, WEIGHT_TOP_LOW, WEIGHT_X,
  at, cableOf, dialAngle, liftAt, needleOf, xOfPrice,
} from "./view";

const LABEL_PLATE = { x: PLATE.x + PLATE.w - 36, y: PLATE.y + 8, w: 26, d: 16, r: 1.2 };
const byDepth = (points: k.Plane[]) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const face = (points: k.Point3[]) => k.pathOf(points.map(at), true);

const BASE = (
  <g key="base">
    <path className="lq-halo" d={k.haloOf(k.insetPlan(PLATE, -14), -PLATE_H - FOOT_H, PLATE_H, P)} />
    {byDepth(k.corners(PLATE, 20)).map(([x, y], index) => (
      <g key={index}>
        <Solid paths={k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 48)} tone="lo" />
        <Solid paths={k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 48)} tone="mid" />
      </g>
    ))}
    <Solid paths={k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 20, 1.6)} tone="mid" />
    <Line d={k.planOutline(k.insetPlan(PLATE, 5), 0, P, 20)} tone="lo" />
    <Line d={k.corners(PLATE, 10).map(([x, y]) => k.ring(x, y, 2.2, 0, P, 32)).join("")} tone="lo" />
    <Dots points={k.corners(PLATE, 10).map(([x, y]) => at([x, y, 0]))} size={0.5} />
    <Solid paths={k.slabOf(LABEL_PLATE, 0, 0.8, P, 4)} tone="lo" crease="none" />
    <Line d={k.planOutline(k.insetPlan(LABEL_PLATE, 1.6), 0.8, P, 3)} tone="faint" />
    <Line d={[[6, 16], [9, 12], [12, 18]].map(([y, w]) => k.lineOnTop([LABEL_PLATE.x + 4, LABEL_PLATE.y + y], [LABEL_PLATE.x + 4 + w, LABEL_PLATE.y + y], 0.8, P)).join("")} tone="lo" free />
    <Dots points={[at([LABEL_PLATE.x + 2.4, LABEL_PLATE.y + 2.4, 0.8]), at([LABEL_PLATE.x + LABEL_PLATE.w - 2.4, LABEL_PLATE.y + LABEL_PLATE.d - 2.4, 0.8])]} size={0.4} />
  </g>
);

/** Column, bracket and beam with the two pulleys the cable runs over. */
function pulley(cx: number, index: number) {
  const back = { x: cx - 3, y: CABLE_Y - 3.6, w: 6, d: 1, r: 0.4 };
  const F = G.frameAlong([cx, CABLE_Y - 2, PULLEY_Z], [0, 1, 0]);
  const forkH = BEAM_Z - (PULLEY_Z - 3);
  return (
    <g key={`pulley-${index}`}>
      <Solid paths={k.slabOf(back, PULLEY_Z - 3, forkH, P, 2)} tone="mid" />
      <Solid paths={G.solidOf([[0, PULLEY_R + 1.6], [0.9, PULLEY_R + 1.6], [1.7, PULLEY_R], [2.3, PULLEY_R], [3.1, PULLEY_R + 1.6], [4, PULLEY_R + 1.6]], F, P, { steps: 96 })} tone="hi" crease="lo" />
      <Line d={G.circleOf(F, 4, PULLEY_R - 1.4, P, 96)} tone="faint" />
    </g>
  );
}

/** The near fork plates and axle nuts sit in front of the cable, so they are drawn after it. */
function fork(cx: number, index: number) {
  const F = G.frameAlong([cx, CABLE_Y - 2, PULLEY_Z], [0, 1, 0]);
  return (
    <g key={`fork-${index}`}>
      <Solid paths={G.disc(3.1, 4, PULLEY_R + 1.6, F, P, { steps: 96 })} tone="hi" crease="lo" />
      <Line d={G.circleOf(F, 4, PULLEY_R - 1.4, P, 96)} tone="faint" />
      <Solid paths={k.slabOf({ x: cx - 3, y: CABLE_Y + 2.6, w: 6, d: 1, r: 0.4 }, PULLEY_Z - 3, BEAM_Z - (PULLEY_Z - 3), P, 2)} tone="mid" />
      <Solid paths={G.disc(5.6, 6.6, 1.7, F, P, { steps: 40 })} tone="mid" />
      <Dots points={[at([cx, CABLE_Y + 4.6, PULLEY_Z])]} size={0.45} />
    </g>
  );
}

const FORKS = (
  <g key="forks">
    {fork(PULLEY_A, 0)}
    {fork(PULLEY_B, 1)}
  </g>
);

const STAND = (
  <g key="stand">
    <Solid paths={k.slabOf({ x: -64, y: -88, w: 18, d: 18, r: 2 }, 0, 2, P, 3, 0.4)} tone="lo" />
    <Dots points={k.corners({ x: -64, y: -88, w: 18, d: 18, r: 2 }, 3).map(([x, y]) => at([x, y, 2]))} size={0.45} />
    <Solid paths={k.slabOf(COLUMN, 2, BEAM_Z - 2, P, 3, 0.5)} tone="mid" />
    <Line d={[40, 80].map((z) => k.sideSeam(COLUMN, z, P, 3)).join("")} tone="faint" />
    <Solid paths={k.slabOf({ x: COLUMN.x, y: COLUMN.y, w: COLUMN.w, d: BEAM.y - COLUMN.y, r: 1.5 }, BEAM_Z, BEAM_H, P, 3, 0.5)} tone="mid" />
    <Solid paths={k.slabOf(BEAM, BEAM_Z, BEAM_H, P, 3, 0.6)} tone="mid" />
    <Dots points={[at([COLUMN.x + 5, COLUMN.y + 5, BEAM_Z + BEAM_H]), at([PULLEY_A, CABLE_Y, BEAM_Z + BEAM_H]), at([PULLEY_B, CABLE_Y, BEAM_Z + BEAM_H])]} size={0.5} />
    {pulley(PULLEY_A, 0)}
    {pulley(PULLEY_B, 1)}
  </g>
);

const HOUSING_ART = (
  <g key="housing">
    <Solid paths={k.slabOf(HOUSING, 0, HOUSING_H, P, 14, 1.2)} tone="mid" inner={<Line d={k.sideSeam(HOUSING, 6, P, 14)} tone="faint" />} />
    <Line d={k.planOutline(k.insetPlan(HOUSING, 4), HOUSING_H, P, 4)} tone="faint" />
    <Dots points={k.corners(HOUSING, 7).map(([x, y]) => at([x, y, HOUSING_H]))} size={0.45} />
    <Line d={[-98, -92, -86, -80, -74].map((x) => face([[x, HOUSING.y + HOUSING.d, 9], [x + 2.4, HOUSING.y + HOUSING.d, 9], [x + 2.4, HOUSING.y + HOUSING.d, 16], [x, HOUSING.y + HOUSING.d, 16]])).join("")} tone="lo" />
    <Line d={k.sideRing([HOUSING.x + HOUSING.w, 22, 10], 2.2, "x", P, 36)} tone="lo" />
    <Solid paths={k.cylinder(CENTRE[0], CENTRE[1], COLLAR_R, HOUSING_H, COLLAR_TOP - HOUSING_H, P, 72, 0.6)} tone="mid" />
    <Line d={k.ring(CENTRE[0], CENTRE[1], STEM_R + 0.7, COLLAR_TOP, P, 56)} tone="faint" />
  </g>
);

/** Moving parts, built at the highest price (lift 0). */
const platTop = LOW_Z + PLATFORM_H;
const STEM = G.rodOut(G.frameAlong([CENTRE[0], CENTRE[1], COLLAR_TOP], [0, 0, 1]), 0, LOW_Z - COLLAR_TOP, STEM_R, P, { stroke: STROKE });

const PLATFORM_ART = (
  <React.Fragment key="platform">
    <clipPath id="lq-stem">
      <path data-hold="" d={STEM.clip} />
    </clipPath>
    <g clipPath="url(#lq-stem)">
      <Solid paths={STEM.paths} tone="mid" crease="none" />
    </g>
    <path className="lq-halo" d={k.haloOf(k.insetPlan(PLATFORM, -4), LOW_Z - 0.5, 0.1, P)} />
    <Solid paths={k.slabOf(PLATFORM, LOW_Z, PLATFORM_H, P, 12, 1)} tone="mid" />
    <Line d={k.planOutline(k.insetPlan(PLATFORM, 4), platTop, P, 4)} tone="faint" />
    <Dots points={k.corners(PLATFORM, 7).map(([x, y]) => at([x, y, platTop]))} size={0.45} />
    <Solid paths={k.slabOf(MAT, platTop, 1, P, 3)} tone="lo" crease="none" />
    <Solid paths={k.slabOf({ x: HOOK_X - 2, y: CABLE_Y - 2, w: 4, d: 4, r: 0.8 }, platTop, 2.4, P, 2)} tone="mid" />
    <Line d={k.sideRing([HOOK_X, CABLE_Y, platTop + 2.4 + EYE_R], EYE_R, "y", P, 36)} tone="mid" />
  </React.Fragment>
);

const LATCH = (
  <g key="latch">
    <Solid paths={k.slabOf({ x: COLUMN.x + 1, y: COLUMN.y + COLUMN.d, w: 8, d: 34, r: 1 }, TOP_Z + PLATFORM_H + 1, 4, P, 3, 0.4)} tone="mid" />
    <Solid paths={k.slabOf({ x: COLUMN.x + 2, y: PLATFORM.y + 0.5, w: 6, d: 5, r: 1 }, TOP_Z + PLATFORM_H, 1, P, 2)} tone="lo" crease="none" />
    <Dots points={[at([COLUMN.x + 5, COLUMN.y + COLUMN.d + 4, TOP_Z + PLATFORM_H + 5])]} size={0.45} />
  </g>
);

const BARS_ART = (
  <g key="bars">
    {BARS.map((plan, index) => (
      <g key={index}>
        <Solid paths={k.slabOf(plan, platTop + 1, BAR_H, P, 4, 1.2)} tone="hi" crease="lo" />
        <Line d={k.planOutline(k.insetPlan(plan, 3), platTop + 1 + BAR_H, P, 3)} tone="faint" />
      </g>
    ))}
    <FaceText transform={k.topMatrix([BARS[1].x + BARS[1].w / 2, BARS[1].y + BARS[1].d / 2 + 2], platTop + 1 + BAR_H, P, "y")} size={6} tone="lo" anchor="middle">
      ETH
    </FaceText>
  </g>
);

/** Slotted weights, one per $1,000 of debt, on a hanger. Built with the hanger top at its highest. */
const WT = WEIGHT_TOP_LOW + STROKE;
const HANGER_BASE = WT - HANGER;
const discTop = (index: number) => HANGER_BASE + 2 + (index + 1) * (DISC_H + 0.3);
const toward = k.towardViewer(P);

const WEIGHTS_ART = (
  <g key="weights">
    <Solid paths={k.cylinder(WEIGHT_X, CABLE_Y, 6.5, HANGER_BASE, 2, P, 56, 0.4)} tone="mid" />
    {Array.from({ length: WEIGHTS }, (_, index) => (
      <Solid key={index} paths={k.cylinder(WEIGHT_X, CABLE_Y, WEIGHT_R, discTop(index) - DISC_H, DISC_H, P, 80, 0.6)} tone="mid" />
    ))}
    <Line
      d={k.onTop(
        [
          [WEIGHT_X + toward[0] * 1.4 - toward[1] * 1.1, CABLE_Y + toward[1] * 1.4 + toward[0] * 1.1],
          [WEIGHT_X + toward[0] * (WEIGHT_R - 0.6) - toward[1] * 1.1, CABLE_Y + toward[1] * (WEIGHT_R - 0.6) + toward[0] * 1.1],
          [WEIGHT_X + toward[0] * (WEIGHT_R - 0.6) + toward[1] * 1.1, CABLE_Y + toward[1] * (WEIGHT_R - 0.6) - toward[0] * 1.1],
          [WEIGHT_X + toward[0] * 1.4 + toward[1] * 1.1, CABLE_Y + toward[1] * 1.4 - toward[0] * 1.1],
        ],
        discTop(WEIGHTS - 1),
        P,
        true,
      )}
      tone="lo"
    />
    <Solid paths={k.cylinder(WEIGHT_X, CABLE_Y, 0.9, discTop(WEIGHTS - 1), WT - EYE_R - discTop(WEIGHTS - 1), P, 24)} tone="mid" crease="none" />
    <Line d={k.sideRing([WEIGHT_X, CABLE_Y, WT], EYE_R, "y", P, 36)} tone="mid" />
  </g>
);

/** The dial head. Its red arc is health factor 0.5 to 1.0: liquidatable. */
const redArc = (() => {
  const points: k.Plane[] = [];
  for (let i = 0; i <= 40; i++) {
    const angle = dialAngle(HF_LO + ((1 - HF_LO) * i) / 40);
    points.push([DIAL[0] + Math.sin(angle) * (DIAL_R - 3), DIAL[1] - Math.cos(angle) * (DIAL_R - 3)]);
  }
  return k.onTop(points, DIAL_TOP, P);
})();
const ticks = k.radialTicks(DIAL[0], DIAL[1], DIAL_R - 3, (HF_HI - HF_LO) * 10, 5, DIAL_TOP, [1.3, 2.8], P, DIAL_FROM, DIAL_SPAN);

const DIAL_ART = (
  <g key="dial">
    <path className="lq-halo" d={k.haloOf({ x: WEIGHT_X - 14, y: CABLE_Y - 14, w: 28, d: 28, r: 14 }, 0, 0.1, P)} />
    <Wire from={at([HOUSING.x + HOUSING.w, 22, 10])} to={at([PEDESTAL.x, PEDESTAL.y + 14, 12])} tone="lo" size={0.9} />
    <Solid paths={k.slabOf(PEDESTAL, 0, PEDESTAL_H, P, 12, 1)} tone="mid" inner={<Line d={k.sideSeam(PEDESTAL, 8, P, 12)} tone="faint" />} />
    <Dots points={k.corners(PEDESTAL, 4.5).map(([x, y]) => at([x, y, PEDESTAL_H]))} size={0.45} />
    <Solid paths={k.cylinder(DIAL[0], DIAL[1], DIAL_R, PEDESTAL_H, DIAL_H, P, 120, 0.8)} tone="hi" crease="lo" />
    <Line d={k.knurl(DIAL[0], DIAL[1], DIAL_R, DIAL_TOP - 3.4, DIAL_TOP, 84, P, 0.3)} tone="lo" />
    <Line d={k.sideArc(DIAL[0], DIAL[1], DIAL_R, DIAL_TOP - 3.4, P, 80)} tone="faint" />
    <Line d={k.ring(DIAL[0], DIAL[1], DIAL_R - 2.2, DIAL_TOP, P, 120)} tone="lo" />
    <Line d={ticks.minor} tone="lo" />
    <Line d={ticks.major} tone="mid" />
    <Line d={redArc} tone="red" className="lq-red" />
    <Line d={k.ring(DIAL[0], DIAL[1], 1.6, DIAL_TOP, P, 32)} tone="mid" />
  </g>
);

/** Price rail: a slider on a ruler in dollars, with the liquidation price marked in red. */
const STEP = (PRICE_X1 - PRICE_X0) / ((PRICE_MAX - PRICE_MIN) / 100);
const rule = k.topTicks(PRICE_X0, PRICE_X1, STEP, 5, RULER.y + 0.8, 0.6, [2, 3.6], P);
const LIQ_X = xOfPrice(LIQ_PRICE);

const RAIL_ART = (
  <g key="rail">
    <Solid paths={k.slabOf(RAIL, 0, RAIL_H, P, 3, 0.4)} tone="mid" />
    {[RAIL.x - 2, RAIL.x + RAIL.w - 3].map((x) => (
      <Solid key={x} paths={k.slabOf({ x, y: RAIL.y - 3, w: 5, d: 12, r: 1.2 }, 0, 7, P, 3, 0.5)} tone="mid" />
    ))}
    <Dots points={[at([RAIL.x + 0.5, RAIL.y + 3, 7]), at([RAIL.x + RAIL.w - 0.5, RAIL.y + 3, 7])]} size={0.45} />
    <Solid paths={k.slabOf(RULER, 0, 0.6, P, 3)} tone="lo" crease="none" />
    <Line d={rule.minor} tone="lo" />
    <Line d={rule.major} tone="mid" />
    <Line d={k.lineOnTop([LIQ_X, RULER.y + 0.8], [LIQ_X, RULER.y + 5.6], 0.6, P)} tone="red" className="lq-red" />
  </g>
);

const SLIDER = (
  <g key="slider">
    <Solid paths={k.slabOf({ x: -7, y: RAIL.y - 3, w: 14, d: 12, r: 2 }, RAIL_H, 5, P, 3, 0.5)} tone="mid" />
    <Dots points={[at([-4.5, RAIL.y + 7.5, RAIL_H + 5]), at([4.5, RAIL.y + 7.5, RAIL_H + 5])]} size={0.4} />
    <Solid paths={k.slabOf({ x: -1.2, y: RAIL.y + 8.6, w: 2.4, d: 4.8, r: 0.6 }, RAIL_H, 1.2, P, 2)} tone="hi" />
    <Solid paths={k.cylinder(0, RAIL.y + 3, 3.8, RAIL_H + 5, 4, P, 56)} tone="mid" />
    <Line d={k.knurl(0, RAIL.y + 3, 3.8, RAIL_H + 5, RAIL_H + 9, 30, P)} tone="lo" />
    <Dots points={[at([0, RAIL.y + 3, RAIL_H + 9])]} size={0.5} tone="hi" />
  </g>
);

const LABEL =
  "A platform scale that weighs a loan. Two ETH bars sit on the platform; three slotted weights, one per thousand dollars borrowed, hang from a cable that runs from the platform over two pulleys on a beam. " +
  "A slider on a dollar ruler at the front sets the ETH price. As the price falls the platform rises toward a stop on the column and the dial needle swings toward a red arc: at the red mark on the ruler the health factor is 1.0 and the loan can be liquidated.";

export function LiquidationArt() {
  const lift = liftAt(dropAt(PRICE_START));
  return (
    <LiquidationLive
      label={LABEL}
      base={BASE}
      stand={STAND}
      housing={HOUSING_ART}
      platform={PLATFORM_ART}
      latch={LATCH}
      forks={FORKS}
      bars={BARS_ART}
      weights={WEIGHTS_ART}
      dial={DIAL_ART}
      rail={RAIL_ART}
      slider={SLIDER}
      start={{ needle: needleOf(hfAt(PRICE_START)), cable: cableOf(lift), lift, x: xOfPrice(PRICE_START) }}
    />
  );
}
