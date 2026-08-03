import type { Candle, Direction } from "../types/feature";

export interface RawFvg {
  direction: Direction;
  top: number;
  bottom: number;
  formationIndex: number;
  formationTs: Date;
}

/** Detect raw three-candle FVG geometry. No lifecycle or filtering. */
export function detectRawFvgs(candles: Candle[]): RawFvg[] {
  const fvgs: RawFvg[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (c1.h < c3.l) {
      fvgs.push({ direction: "bullish", top: c3.l, bottom: c1.h, formationIndex: i, formationTs: c3.ts });
    }
    if (c1.l > c3.h) {
      fvgs.push({ direction: "bearish", top: c1.l, bottom: c3.h, formationIndex: i, formationTs: c3.ts });
    }
  }
  return fvgs;
}
