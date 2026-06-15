/**
 * ATR (Average True Range) feature.
 * Computes ATR over configurable periods from raw candles.
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

function computeATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;

  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr1 = curr.h - curr.l;
    const tr2 = Math.abs(curr.h - prev.c);
    const tr3 = Math.abs(curr.l - prev.c);
    sum += Math.max(tr1, tr2, tr3);
  }

  return sum / period;
}

export const atrFeature: FeatureDefinition<AtrInput, AtrOutput> = {
  name: "features_atr",
  version: "1.0.0",
  dependencies: [],

  compute(input): AtrOutput {
    const { candles } = input;
    const periods = [5, 14, 20];

    return {
      values: periods.map((period) => ({
        period,
        value: computeATR(candles, period),
      })),
    };
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
      output.values.map((v) => `${v.period}=${v.value.toFixed(6)}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    // This is a per-timeframe feature, not per-row.
    // We return a single row with the latest values.
    return output.values.map((v) => ({
      period: v.period,
      value: v.value,
    }));
  },

  deserialize(rows): AtrOutput {
    return {
      values: rows.map((r) => ({
        period: r.period as number,
        value: r.value as number,
      })),
    };
  },
};
