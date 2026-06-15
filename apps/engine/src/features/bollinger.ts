/**
 * Bollinger Bands feature.
 * Computes upper/middle/lower bands, bandwidth and %B.
 */

import type { Candle, FeatureDefinition, BollingerOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface BollingerInput {
  candles: Candle[];
}

function parseConfigs(env?: string): Array<{ period: number; multiplier: number }> {
  if (!env) {
    return [{ period: 20, multiplier: 2.0 }];
  }
  return env.split(",").map((part) => {
    const [p, m] = part.split("x");
    return { period: parseInt(p.trim(), 10), multiplier: parseFloat(m?.trim() ?? "2") };
  }).filter((c) => !isNaN(c.period) && c.period > 0 && !isNaN(c.multiplier));
}

const CONFIGS = parseConfigs(process.env.BOLLINGER_CONFIGS);

function computeSMA(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function computeStdDev(values: number[], period: number, sma: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const variance = slice.reduce((acc, v) => acc + Math.pow(v - sma, 2), 0) / period;
  return Math.sqrt(variance);
}

export const bollingerFeature: FeatureDefinition<BollingerInput, BollingerOutput> = {
  name: "features_bollinger",
  version: "1.0.0",
  dependencies: [],

  compute(input): BollingerOutput {
    const { candles } = input;
    const closes = candles.map((c) => c.c);
    const ts = candles[candles.length - 1]?.ts ?? new Date();
    const values: BollingerOutput["values"] = [];

    for (const { period, multiplier } of CONFIGS) {
      if (candles.length < period) continue;
      const middle = computeSMA(closes, period);
      const stdDev = computeStdDev(closes, period, middle);
      const upper = middle + multiplier * stdDev;
      const lower = middle - multiplier * stdDev;
      const bandwidth = middle > 0 ? ((upper - lower) / middle) : 0;
      const lastClose = closes[closes.length - 1];
      const percentB = upper !== lower ? (lastClose - lower) / (upper - lower) : 0.5;

      values.push({
        period,
        multiplier,
        upperBand: upper,
        middleBand: middle,
        lowerBand: lower,
        bandwidth,
        percentB,
        ts,
      });
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
      output.values.map((v) => `${v.period}:${v.multiplier}:${v.upperBand.toFixed(6)}:${v.lowerBand.toFixed(6)}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.values.map((v) => ({
      period: v.period,
      multiplier: v.multiplier,
      upper_band: v.upperBand,
      middle_band: v.middleBand,
      lower_band: v.lowerBand,
      bandwidth: v.bandwidth,
      percent_b: v.percentB,
      ts: v.ts,
    }));
  },

  deserialize(rows): BollingerOutput {
    return {
      values: rows.map((r) => ({
        period: r.period as number,
        multiplier: r.multiplier as number,
        upperBand: r.upper_band as number,
        middleBand: r.middle_band as number,
        lowerBand: r.lower_band as number,
        bandwidth: r.bandwidth as number,
        percentB: r.percent_b as number,
        ts: r.ts ? new Date(r.ts as string) : undefined,
      })),
    };
  },
};
