/**
 * Plain Fair Value Gaps (FVG) feature v1.0.0.
 *
 * Detects fresh bullish/bearish FVGs: a 3-candle pattern where candle 1 and
 * candle 3 do not overlap.  This is the un-mitigated counterpart to
 * `features_ifvg`; it simply publishes the gaps that exist at the right edge
 * of the candle window.
 */

import type { Candle, Direction, FeatureDefinition, FvgOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface FvgInput {
  candles: Candle[];
}

function detectFvgs(candles: Candle[]): FvgOutput["fvgs"] {
  if (candles.length < 3) return [];

  const fvgs: FvgOutput["fvgs"] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];

    let direction: Direction | null = null;
    let top = 0;
    let bottom = 0;

    if (c1.h < c3.l) {
      direction = "bullish";
      top = c3.l;
      bottom = c1.h;
    } else if (c1.l > c3.h) {
      direction = "bearish";
      top = c1.l;
      bottom = c3.h;
    }

    if (!direction) continue;

    // Fresh if no subsequent close has traded back into the gap.
    let isFresh = true;
    for (let j = i + 1; j < candles.length; j++) {
      const c = candles[j];
      if (c.c >= bottom && c.c <= top) {
        isFresh = false;
        break;
      }
    }

    fvgs.push({
      direction,
      top,
      bottom,
      ts: c3.ts,
      ageBars: candles.length - 1 - i,
      isFresh,
    });
  }

  return fvgs;
}

export const fvgFeature: FeatureDefinition<FvgInput, FvgOutput> = {
  name: "features_fvg",
  version: "1.0.0",
  dependencies: [],

  compute(input): FvgOutput {
    return { fvgs: detectFvgs(input.candles) };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`)
        .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.fvgs
        .map(
          (f) =>
            `${f.ts.toISOString()}:${f.direction}:${f.top}:${f.bottom}:${f.ageBars}:${f.isFresh}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.fvgs.map((f) => ({
      direction: f.direction,
      top: f.top,
      bottom: f.bottom,
      ts: f.ts,
      age_bars: f.ageBars,
      is_fresh: f.isFresh,
    }));
  },

  deserialize(rows): FvgOutput {
    return {
      fvgs: rows.map((r) => ({
        direction: r.direction as Direction,
        top: r.top as number,
        bottom: r.bottom as number,
        ts: new Date(r.ts as string),
        ageBars: (r.age_bars as number) ?? 0,
        isFresh: (r.is_fresh as boolean) ?? true,
      })),
    };
  },
};
