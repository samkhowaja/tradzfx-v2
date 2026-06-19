/**
 * Configurable moving averages feature.
 * Computes SMA and EMA for a configurable set of periods per timeframe.
 */

import type { Candle, FeatureDefinition, MovingAverageOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface MovingAverageInput {
  candles: Candle[];
}

function parsePeriods(env?: string): number[] {
  if (!env) {
    // Default covers common ICT/strategy MA periods
    return [9, 15, 20, 21, 50, 100, 200, 250];
  }
  return env
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

const PERIODS = parsePeriods(process.env.MA_PERIODS);

function computeSMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + c.c, 0);
  return sum / period;
}

function computeEMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = candles[0].c;
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].c * k + ema * (1 - k);
  }
  return ema;
}

export const movingAverageFeature: FeatureDefinition<MovingAverageInput, MovingAverageOutput> = {
  name: "features_moving_average",
  version: "1.1.0",
  dependencies: [],

  compute(input): MovingAverageOutput {
    const { candles } = input;
    const ts = candles[candles.length - 1]?.ts ?? new Date();
    const values: MovingAverageOutput["values"] = [];

    for (const period of PERIODS) {
      if (candles.length >= period) {
        values.push({ maType: "sma", period, value: computeSMA(candles, period), ts });
        values.push({ maType: "ema", period, value: computeEMA(candles, period), ts });
      }
    }

    return { values };
  },

  hashInput(input): string {
    return sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.values.map((v) => `${v.maType}:${v.period}=${v.value.toFixed(6)}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.values.map((v) => ({
      ma_type: v.maType,
      period: v.period,
      value: v.value,
      ts: v.ts,
    }));
  },

  deserialize(rows): MovingAverageOutput {
    return {
      values: rows.map((r) => ({
        maType: r.ma_type as "sma" | "ema",
        period: r.period as number,
        value: r.value as number,
        ts: r.ts ? new Date(r.ts as string) : undefined,
      })),
    };
  },
};
