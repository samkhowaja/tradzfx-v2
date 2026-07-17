/**
 * ATR (Average True Range) feature.
 * Computes ATR over configurable periods from raw candles.
 *
 * v1.2.0 (P0, V3 BUG-3.2): adds a self-contained, deterministic winsorization so a
 * single bad tick (amplified by the candles_5m cagg max(h)/min(l)) cannot poison
 * gates or ATR-based stops. `value` stays RAW (PIT fidelity/audit); `effectiveValue`
 * is the winsorized value consumers should use. The cap is derived from the rolling
 * median TR of the same window (cap = medianTR * WINSOR_MULT), so normal bars are
 * byte-identical (effective == value) and only outlier bars are clamped + flagged.
 */

import type {
  Candle,
  FeatureDefinition,
  AtrOutput,
} from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface AtrInput {
  candles: Candle[];
}

/** Cap = median true range over the window × this multiplier. */
const WINSOR_MULT = 6;
/** Buckets with fewer underlying 1m ticks than this are flagged sparse. */
const SPARSE_TICK_MIN = 3;

function trueRanges(candles: Candle[], period: number): number[] {
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr1 = curr.h - curr.l;
    const tr2 = Math.abs(curr.h - prev.c);
    const tr3 = Math.abs(curr.l - prev.c);
    trs.push(Math.max(tr1, tr2, tr3));
  }
  return trs;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function computeATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  const trs = trueRanges(candles, period);
  return trs.reduce((a, b) => a + b, 0) / period;
}

function validateATR(candles: Candle[], period: number, value: number): { isValid: boolean; qualityReason?: string } {
  // Check if the last candle has zero range but ATR is non-zero (or vice versa)
  const lastCandle = candles[candles.length - 1];
  const range = lastCandle.h - lastCandle.l;
  
  // If candle range is zero but ATR is non-zero, that's suspicious
  if (range === 0 && value > 0) {
    return { isValid: false, qualityReason: "zero_range_nonzero_atr" };
  }
  
  // If candle range is non-zero but ATR is zero, that's corrupt data
  if (range > 0 && value <= 0) {
    return { isValid: false, qualityReason: "nonzero_range_zero_atr" };
  }
  
  return { isValid: true };
}

export const atrFeature: FeatureDefinition<AtrInput, AtrOutput> = {
  name: "features_atr",
  version: "1.2.0",
  dependencies: [],

  compute(input): AtrOutput {
    const { candles } = input;
    const periods = [5, 14, 20];
    const lastTickCount = candles.length > 0 ? candles[candles.length - 1].tickCount : undefined;

    return {
      values: periods.map((period) => {
        const value = computeATR(candles, period);

        if (candles.length < period + 1) {
          // warmup: not enough bars for a real ATR
          return {
            period,
            value,
            effectiveValue: value,
            isValid: false,
            outlierScore: undefined,
            tickCount: lastTickCount,
            qualityReason: "warmup",
          };
        }

        const trs = trueRanges(candles, period).sort((a, b) => a - b);
        const med = median(trs);
        const cap = med > 0 ? med * WINSOR_MULT : Infinity;
        const capped = Number.isFinite(cap) && value > cap;
        const effectiveValue = capped ? cap : value;
        const outlierScore = med > 0 ? value / med : undefined;
        const sparse =
          typeof lastTickCount === "number" && lastTickCount < SPARSE_TICK_MIN;

        // Validate ATR against candle range
        const validation = validateATR(candles, period, value);
        const isValid = !capped && value > 0 && validation.isValid;
        const qualityReason = capped ? "winsorized" : sparse ? "sparse_bucket" : validation.qualityReason;

        return {
          period,
          value,
          effectiveValue,
          isValid,
          outlierScore,
          tickCount: lastTickCount,
          qualityReason,
        };
      }),
    };
  },

  hashInput(input): string {
    // :q1 tag busts the cache once so effective_value/quality columns populate.
    return (
      sha256(
        input.candles
          .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
          .join("|")
      ) + ":q1"
    );
  },

  hashOutput(output): string {
    return sha256(
      output.values
        .map((v) => `${v.period}=${(v.effectiveValue ?? v.value).toFixed(6)}`)
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.values
      .filter((v) => v.value > 0)
      .map((v) => ({
        period: v.period,
        value: v.value,
        effective_value: v.effectiveValue,
        is_valid: v.isValid,
        outlier_score: v.outlierScore,
        tick_count: v.tickCount,
        quality_reason: v.qualityReason,
      }));
  },

  deserialize(rows): AtrOutput {
    return {
      values: rows.map((r) => ({
        period: r.period as number,
        value: r.value as number,
        effectiveValue: r.effective_value as number | undefined,
        isValid: r.is_valid as boolean | undefined,
        outlierScore: r.outlier_score as number | undefined,
        tickCount: r.tick_count as number | undefined,
        qualityReason: r.quality_reason as string | undefined,
      })),
    };
  },
};
