/**
 * EMA/SMA Cross feature.
 * Computes current cross direction for common fast/slow moving-average pairs.
 */

import type { Candle, FeatureDefinition, EmaCrossOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface EmaCrossInput {
  candles: Candle[];
}

function computeEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function parsePairs(env?: string): Array<{ fast: number; slow: number }> {
  if (!env) {
    return [
      { fast: 9, slow: 21 },
      { fast: 15, slow: 250 },
      { fast: 20, slow: 50 },
      { fast: 50, slow: 200 },
    ];
  }
  return env.split(",").map((part) => {
    const [fast, slow] = part.split("/");
    return { fast: parseInt(fast.trim(), 10), slow: parseInt(slow.trim(), 10) };
  }).filter((p) => !isNaN(p.fast) && p.fast > 0 && !isNaN(p.slow) && p.slow > 0);
}

const PAIRS = parsePairs(process.env.EMA_CROSS_PAIRS);

function computeCrosses(candles: Candle[]): EmaCrossOutput["crosses"] {
  if (candles.length < 2) return [];
  const closes = candles.map((c) => c.c);
  const last = candles[candles.length - 1];
  const crosses: EmaCrossOutput["crosses"] = [];

  for (const { fast, slow } of PAIRS) {
    if (closes.length < slow) continue;
    const fastValue = computeEMA(closes, fast);
    const slowValue = computeEMA(closes, slow);
    let direction: EmaCrossOutput["crosses"][number]["direction"];
    if (fastValue > slowValue) direction = "bullish";
    else if (fastValue < slowValue) direction = "bearish";
    else direction = "neutral";

    crosses.push({
      fastPeriod: fast,
      slowPeriod: slow,
      direction,
      fastValue,
      slowValue,
      ts: last.ts,
    });
  }

  return crosses;
}

export const emaCrossFeature: FeatureDefinition<EmaCrossInput, EmaCrossOutput> = {
  name: "features_ema_cross",
  version: "1.1.0",
  dependencies: [],

  compute(input): EmaCrossOutput {
    return { crosses: computeCrosses(input.candles) };
  },

  hashInput(input): string {
    return sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.crosses
        .map((c) => `${c.fastPeriod}:${c.slowPeriod}:${c.direction}:${c.fastValue}:${c.slowValue}`)
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.crosses.map((c) => ({
      fast_period: c.fastPeriod,
      slow_period: c.slowPeriod,
      direction: c.direction,
      fast_value: c.fastValue,
      slow_value: c.slowValue,
      ts: c.ts,
    }));
  },

  deserialize(rows): EmaCrossOutput {
    return {
      crosses: rows.map((r) => ({
        fastPeriod: r.fast_period as number,
        slowPeriod: r.slow_period as number,
        direction: r.direction as EmaCrossOutput["crosses"][number]["direction"],
        fastValue: r.fast_value as number,
        slowValue: r.slow_value as number,
        ts: new Date(r.ts as string),
      })),
    };
  },
};
