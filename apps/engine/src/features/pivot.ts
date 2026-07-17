/**
 * Pivot (swing high / swing low) feature v1.2.0.
 *
 * Detects swing highs and lows using a TF-aware lookback.  The previous
 * default of 5 was a one-size-fits-all value that produced meaningless
 * noise on 1m/5m charts (every micro-wig became a pivot) and missed real
 * structure on 4h/1d charts (a 5-bar lookback on a daily chart only spans
 * a single week).  The COMPREHENSIVE_AUDIT_REPORT flagged this as D020.
 *
 * v1.2.0 changes (Track B — D020):
 *   - Per-timeframe lookback table: 1m=3, 5m=5, 15m=8, 1h=10, 4h=15, 1d=20.
 *   - Falls back to 8 when the TF is unknown so the engine never crashes
 *     on a new TF.
 *   - The TF is read from the feature context (when available) so the same
 *     candle stream can be pivoted differently per spec.
 */

import type { Candle, FeatureDefinition, PivotOutput, TimeFrame } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface PivotInput {
  candles: Candle[];
}

/**
 * Per-TF swing lookback.  Lower TFs need a tighter window so we don't
 * drown in micro-pivots; higher TFs need a wider window so a single
 * swing actually represents structure rather than noise.
 */
const TF_LOOKBACK: Record<TimeFrame, number> = {
  "1m": 3,
  "5m": 5,
  "15m": 8,
  "1h": 10,
  "4h": 15,
  "1d": 20,
};

const DEFAULT_LOOKBACK = 8;

function lookbackFor(tf: TimeFrame | undefined): number {
  if (!tf) return DEFAULT_LOOKBACK;
  return TF_LOOKBACK[tf] ?? DEFAULT_LOOKBACK;
}

function findPivots(
  candles: Candle[],
  lookback: number = DEFAULT_LOOKBACK
): PivotOutput["pivots"] {
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
  version: "1.2.0",
  dependencies: [],

  compute(input, context): PivotOutput {
    const tf = context?.tf as TimeFrame | undefined;
    const lookback = lookbackFor(tf);
    return { pivots: findPivots(input.candles, lookback) };
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
