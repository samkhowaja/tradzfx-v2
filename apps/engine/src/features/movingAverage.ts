/**
 * Configurable moving averages feature.
 * Computes SMA and EMA values for configured periods, plus EMA/SMA cross
 * directions for configured fast/slow pairs. All output is stored in the
 * single `features_moving_average` table.
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

function parsePairs(env?: string): Array<{ fast: number; slow: number }> {
  if (!env) return [];
  return env
    .split(",")
    .map((part) => {
      const [fast, slow] = part.split("/");
      return {
        fast: parseInt(fast.trim(), 10),
        slow: parseInt(slow.trim(), 10),
      };
    })
    .filter((p) => !isNaN(p.fast) && p.fast > 0 && !isNaN(p.slow) && p.slow > 0);
}

const PERIODS = parsePeriods(process.env.MA_PERIODS);
const EMA_CROSS_PAIRS = parsePairs(process.env.EMA_CROSS_PAIRS);
const SMA_CROSS_PAIRS = parsePairs(process.env.SMA_CROSS_PAIRS);

// Defaults per Phase 2 spec: EMA 9/21, SMA 50/200.
if (EMA_CROSS_PAIRS.length === 0 && !process.env.EMA_CROSS_PAIRS) {
  EMA_CROSS_PAIRS.push({ fast: 9, slow: 21 });
}
if (SMA_CROSS_PAIRS.length === 0 && !process.env.SMA_CROSS_PAIRS) {
  SMA_CROSS_PAIRS.push({ fast: 50, slow: 200 });
}

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

function getValue(values: MovingAverageOutput["values"], maType: "sma" | "ema", period: number): number | undefined {
  return values.find((v) => v.maType === maType && v.period === period)?.value;
}

function computeCrosses(values: MovingAverageOutput["values"], ts: Date): MovingAverageOutput["crosses"] {
  const crosses: MovingAverageOutput["crosses"] = [];

  for (const { fast, slow } of EMA_CROSS_PAIRS) {
    const fastValue = getValue(values, "ema", fast);
    const slowValue = getValue(values, "ema", slow);
    if (fastValue === undefined || slowValue === undefined) continue;
    let direction: MovingAverageOutput["crosses"][number]["direction"];
    if (fastValue > slowValue) direction = "bullish";
    else if (fastValue < slowValue) direction = "bearish";
    else direction = "neutral";
    crosses.push({ maType: "ema", fastPeriod: fast, slowPeriod: slow, direction, fastValue, slowValue, ts });
  }

  for (const { fast, slow } of SMA_CROSS_PAIRS) {
    const fastValue = getValue(values, "sma", fast);
    const slowValue = getValue(values, "sma", slow);
    if (fastValue === undefined || slowValue === undefined) continue;
    let direction: MovingAverageOutput["crosses"][number]["direction"];
    if (fastValue > slowValue) direction = "bullish";
    else if (fastValue < slowValue) direction = "bearish";
    else direction = "neutral";
    crosses.push({ maType: "sma", fastPeriod: fast, slowPeriod: slow, direction, fastValue, slowValue, ts });
  }

  return crosses;
}

export const movingAverageFeature: FeatureDefinition<MovingAverageInput, MovingAverageOutput> = {
  name: "features_moving_average",
  version: "2.0.0",
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

    return { values, crosses: computeCrosses(values, ts) };
  },

  hashInput(input): string {
    return sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
    );
  },

  hashOutput(output): string {
    const valuePart = output.values
      .map((v) => `${v.maType}:${v.period}=${v.value.toFixed(6)}`)
      .join("|");
    const crossPart = output.crosses
      .map((c) => `${c.maType}:${c.fastPeriod}/${c.slowPeriod}:${c.direction}:${c.fastValue}:${c.slowValue}`)
      .join("|");
    return sha256(`${valuePart}::${crossPart}`);
  },

  serialize(output): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const v of output.values) {
      rows.push({
        ma_type: v.maType,
        period: v.period,
        value: v.value,
        fast_period: 0,
        slow_period: 0,
        ts: v.ts,
      });
    }
    for (const c of output.crosses) {
      rows.push({
        ma_type: `${c.maType}_cross`,
        period: 0,
        value: 0,
        fast_period: c.fastPeriod,
        slow_period: c.slowPeriod,
        direction: c.direction,
        fast_value: c.fastValue,
        slow_value: c.slowValue,
        ts: c.ts,
      });
    }
    return rows;
  },

  deserialize(rows): MovingAverageOutput {
    const values: MovingAverageOutput["values"] = [];
    const crosses: MovingAverageOutput["crosses"] = [];
    for (const r of rows) {
      const fastPeriod = (r.fast_period as number) ?? 0;
      if (fastPeriod > 0) {
        const maType = String(r.ma_type).replace("_cross", "") as "sma" | "ema";
        crosses.push({
          maType,
          fastPeriod,
          slowPeriod: (r.slow_period as number) ?? 0,
          direction: r.direction as MovingAverageOutput["crosses"][number]["direction"],
          fastValue: r.fast_value as number,
          slowValue: r.slow_value as number,
          ts: r.ts ? new Date(r.ts as string) : undefined,
        });
      } else {
        values.push({
          maType: r.ma_type as "sma" | "ema",
          period: r.period as number,
          value: r.value as number,
          ts: r.ts ? new Date(r.ts as string) : undefined,
        });
      }
    }
    return { values, crosses };
  },
};
