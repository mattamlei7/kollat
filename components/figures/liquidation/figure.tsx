import { Plate } from "@/components/iso/draw";
import "@/components/iso/iso.css";
import { LiquidationArt } from "./art";
import { CAPTION, PRICE_START, readoutOf } from "./model";
import "./liquidation.css";

export function LiquidationFigure({ theme = "dark" }: { theme?: "light" | "dark" }) {
  return (
    <div className="iso lq" data-theme={theme}>
      <Plate
        readout={readoutOf(PRICE_START)}
        keys={[
          { mark: "lit", label: "Needle: how safe your loan is" },
          { mark: "red", label: "Red: your ETH can be sold" },
        ]}
        caption={CAPTION}
      >
        <LiquidationArt />
      </Plate>
    </div>
  );
}
