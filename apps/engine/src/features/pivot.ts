/**
 * Pivot (swing high / swing low) feature.
 * Detects swing highs and lows using a configurable lookback.
 */

import type { Candle, FeatureDefinition, PivotOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface PivotInput {
  candles: Candle[];
}

function findPivots(candles: Candle[], lookback: number = 5): PivotOutput["pivots"] {
  const pivots: PivotOutput["pivots"] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const candle = candles[i];

    // Check swing high
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= candle.h || candles[i + j].h >= candle.h) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      pivots.push({
        kind: "high",
        price: candle.h,
        confidence: 1.0,
        ts: candle.ts,
      });
    }

    // Check swing low
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].l <= candle.l || candles[i + j].l <= candle.l) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      pivots.push({
        kind: "low",
        price: candle.l,
        confidence: 1.0,
        ts: candle.ts,
      });
    }
  }

  return pivots;
}

export const pivotFeature: FeatureDefinition<PivotInput, PivotOutput> = {
  name: "features_pivot",
  version: "1.1.0",
  dependencies: [],

  compute(input): PivotOutput {
    return { pivots: findPivots(input.candles) };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.pivots.map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.pivots.map((p) => ({
      kind: p.kind,
      price: p.price,
      confidence: p.confidence,
      ts: p.ts,
    }));
  },

  deserialize(rows): PivotOutput {
    return {
      pivots: rows.map((r) => ({
        kind: r.kind as "high" | "low",
        price: r.price as number,
        confidence: r.confidence as number,
        ts: new Date(r.ts as string),
      })),
    };
  },
};
