/**
 * Sweep (liquidity sweep) feature v1.2.0.
 * Detects when price briefly exceeds a pivot level before reversing.
 *
 * v1.2.0 filters:
 *   - Wick size must be >= 20% of ATR (or the candle is too small to be
 *     considered a meaningful liquidity grab).
 *   - A structure event (BOS / MSS / CHoCH) must have occurred within the
 *     last 10 bars before the sweep, confirming the sweep is context-driven
 *     rather than random noise.
 *   - Sweeps are recorded on the wick-piercing candle, not on a later close.
 */

import type {
  Candle,
  FeatureDefinition,
  SweepOutput,
  Direction,
  AtrOutput,
  StructureOutput,
} from "@tm/shared";
import { sha256, computeSweepLifecycle } from "@tm/shared";
import type { PivotOutput } from "@tm/shared";

export interface SweepInput {
  candles: Candle[];
  features_pivot: PivotOutput;
  features_atr: AtrOutput;
  features_structure: StructureOutput;
}

const STRUCTURE_LOOKBACK_BARS = 10;
const MIN_WICK_SIZE_ATR_PCT = 0.2;
const VALID_STRUCTURE_EVENTS = new Set(["bos", "mss", "choch"]);

function getAtr14(input: SweepInput): number {
  const atr = input.features_atr?.values?.find((v) => v.period === 14)?.value;
  if (atr != null && Number.isFinite(atr) && atr > 0) return atr;
  const first = input.features_atr?.values?.[0]?.value;
  if (first != null && Number.isFinite(first) && first > 0) return first;
  // Fallback: compute a simple range-based ATR from the last 14 candles.
  const tail = input.candles.slice(-14);
  if (tail.length === 0) return 0;
  const sum = tail.reduce((s, c) => s + (c.h - c.l), 0);
  return sum / tail.length;
}

function hasPrecedingStructureEvent(
  events: StructureOutput["events"],
  candles: Candle[],
  sweepIdx: number
): boolean {
  const startIdx = Math.max(0, sweepIdx - STRUCTURE_LOOKBACK_BARS);
  const startTs = candles[startIdx]?.ts;
  const sweepTs = candles[sweepIdx]?.ts;
  if (!startTs || !sweepTs) return false;

  return events.some(
    (e) =>
      VALID_STRUCTURE_EVENTS.has(e.eventType) &&
      e.ts >= startTs &&
      e.ts <= sweepTs
  );
}

function detectSweeps(input: SweepInput): SweepOutput["sweeps"] {
  const { candles, features_pivot: pivotFeature, features_structure: structureFeature } = input;
  const pivots = pivotFeature?.pivots ?? [];
  const events = structureFeature?.events ?? [];
  const atr = getAtr14(input);
  const minWickSize = atr * MIN_WICK_SIZE_ATR_PCT;

  const sweeps: SweepOutput["sweeps"] = [];

  for (const pivot of pivots) {
    const pivotIdx = candles.findIndex((c) => c.ts >= pivot.ts);
    if (pivotIdx < 0) continue;

    const lookAhead = candles.slice(pivotIdx, pivotIdx + 10);

    for (let i = 0; i < lookAhead.length; i++) {
      const candle = lookAhead[i];
      const sweepIdx = pivotIdx + i;

      if (pivot.kind === "low") {
        // Bullish sweep: wick below low, close back above
        const wickSize = pivot.price - candle.l;
        if (
          candle.l < pivot.price &&
          candle.c > pivot.price &&
          wickSize >= minWickSize &&
          hasPrecedingStructureEvent(events, candles, sweepIdx)
        ) {
          sweeps.push({
            direction: "bullish",
            level: pivot.price,
            extreme: candle.l,
            close: candle.c,
            ts: candle.ts,
            evidence: {
              pivotTs: pivot.ts.toISOString(),
              wickPct: ((pivot.price - candle.l) / (candle.h - candle.l)) * 100,
              wickSizeAtrPct: atr > 0 ? wickSize / atr : 0,
              structureWithinBars: STRUCTURE_LOOKBACK_BARS,
            },
          });
          break; // One sweep per pivot
        }
      } else {
        // Bearish sweep: wick above high, close back below
        const wickSize = candle.h - pivot.price;
        if (
          candle.h > pivot.price &&
          candle.c < pivot.price &&
          wickSize >= minWickSize &&
          hasPrecedingStructureEvent(events, candles, sweepIdx)
        ) {
          sweeps.push({
            direction: "bearish",
            level: pivot.price,
            extreme: candle.h,
            close: candle.c,
            ts: candle.ts,
            evidence: {
              pivotTs: pivot.ts.toISOString(),
              wickPct: ((candle.h - pivot.price) / (candle.h - candle.l)) * 100,
              wickSizeAtrPct: atr > 0 ? wickSize / atr : 0,
              structureWithinBars: STRUCTURE_LOOKBACK_BARS,
            },
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
  version: "1.2.0",
  dependencies: ["features_pivot", "features_atr", "features_structure"],

  compute(input): SweepOutput {
    const sweeps = detectSweeps(input);
    for (const sweep of sweeps) {
      const idx = input.candles.findIndex((c) => c.ts.getTime() === sweep.ts.getTime());
      if (idx >= 0) {
        const lifecycle = computeSweepLifecycle(
          { direction: sweep.direction, level: sweep.level },
          input.candles,
          idx
        );
        sweep.mitigatedAt = lifecycle.mitigatedAt;
      }
    }
    return { sweeps };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|") +
        "|" +
        input.features_pivot.pivots
          .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
          .join("|") +
        "|" +
        input.features_atr.values.map((v) => `${v.period}:${v.value}`).join("|") +
        "|" +
        input.features_structure.events
          .map((e) => `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}`)
          .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.sweeps
        .map(
          (s) =>
            `${s.ts.toISOString()}:${s.direction}:${s.level}:${s.extreme}:${s.close}:${s.mitigatedAt?.toISOString() ?? ""}`
        )
        .join("|")
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
      mitigated_at: s.mitigatedAt ?? null,
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
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at as string) : undefined,
      })),
    };
  },
};
