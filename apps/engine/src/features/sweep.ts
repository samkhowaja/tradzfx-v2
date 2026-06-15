/**
 * Sweep (liquidity sweep) feature.
 * Detects when price briefly exceeds a pivot level before reversing.
 */

import type { Candle, FeatureDefinition, SweepOutput, Direction } from "@tm/shared";
import { sha256 } from "@tm/shared";
import type { PivotOutput } from "@tm/shared";

export interface SweepInput {
  candles: Candle[];
  features_pivot: PivotOutput;
}

function detectSweeps(
  candles: Candle[],
  pivots: PivotOutput["pivots"]
): SweepOutput["sweeps"] {
  const sweeps: SweepOutput["sweeps"] = [];

  for (const pivot of pivots) {
    // Look for a candle that wicks beyond the pivot but closes back
    const pivotIdx = candles.findIndex((c) => c.ts >= pivot.ts);
    if (pivotIdx < 0) continue;

    const lookAhead = candles.slice(pivotIdx, pivotIdx + 10);

    for (const candle of lookAhead) {
      if (pivot.kind === "low") {
        // Bullish sweep: wick below low, close back above
        if (candle.l < pivot.price && candle.c > pivot.price) {
          sweeps.push({
            direction: "bullish",
            level: pivot.price,
            extreme: candle.l,
            close: candle.c,
            ts: candle.ts,
            evidence: { pivotTs: pivot.ts.toISOString(), wickPct: ((pivot.price - candle.l) / (candle.h - candle.l)) * 100 },
          });
          break; // One sweep per pivot
        }
      } else {
        // Bearish sweep: wick above high, close back below
        if (candle.h > pivot.price && candle.c < pivot.price) {
          sweeps.push({
            direction: "bearish",
            level: pivot.price,
            extreme: candle.h,
            close: candle.c,
            ts: candle.ts,
            evidence: { pivotTs: pivot.ts.toISOString(), wickPct: ((candle.h - pivot.price) / (candle.h - candle.l)) * 100 },
          });
          break;
        }
      }
    }
  }

  return sweeps;
}

export const sweepFeature: FeatureDefinition<SweepInput, SweepOutput> = {
  name: "features_sweep",
  version: "1.0.0",
  dependencies: ["features_pivot"],

  compute(input): SweepOutput {
    return { sweeps: detectSweeps(input.candles, input.features_pivot.pivots) };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|") +
        "|" +
        input.features_pivot.pivots
          .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
          .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.sweeps.map((s) => `${s.ts.toISOString()}:${s.direction}:${s.level}:${s.extreme}:${s.close}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.sweeps.map((s) => ({
      direction: s.direction,
      level: s.level,
      extreme: s.extreme,
      close: s.close,
      ts: s.ts,
      evidence: s.evidence ? JSON.stringify(s.evidence) : null,
    }));
  },

  deserialize(rows): SweepOutput {
    return {
      sweeps: rows.map((r) => ({
        direction: r.direction as Direction,
        level: r.level as number,
        extreme: r.extreme as number,
        close: r.close as number,
        ts: new Date(r.ts as string),
        evidence: r.evidence ? JSON.parse(r.evidence as string) : undefined,
      })),
    };
  },
};
