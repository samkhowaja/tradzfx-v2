/**
 * Keltner Channel feature.
 * Middle = EMA(emaPeriod) of closes; channel width = multiplier * ATR(atrPeriod).
 */

import type { Candle, FeatureDefinition, KeltnerOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface KeltnerInput {
  candles: Candle[];
}

function parseConfigs(env?: string): Array<{ emaPeriod: number; atrPeriod: number; multiplier: number }> {
  if (!env) {
    return [{ emaPeriod: 20, atrPeriod: 10, multiplier: 2.0 }];
  }
  return env.split(",").map((part) => {
    const [ema, atr, mult] = part.split("x");
    return {
      emaPeriod: parseInt(ema.trim(), 10),
      atrPeriod: parseInt(atr.trim(), 10),
      multiplier: parseFloat(mult?.trim() ?? "2"),
    };
  }).filter((c) => !isNaN(c.emaPeriod) && c.emaPeriod > 0 && !isNaN(c.atrPeriod) && c.atrPeriod > 0 && !isNaN(c.multiplier));
}

const CONFIGS = parseConfigs(process.env.KELTNER_CONFIGS);

function computeEMA(values: number[], period: number): number {
  if (values.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c));
    sum += tr;
  }
  return sum / period;
}

export const keltnerFeature: FeatureDefinition<KeltnerInput, KeltnerOutput> = {
  name: "features_keltner",
  version: "1.1.0",
  dependencies: [],

  compute(input): KeltnerOutput {
    const { candles } = input;
    const closes = candles.map((c) => c.c);
    const ts = candles[candles.length - 1]?.ts ?? new Date();
    const values: KeltnerOutput["values"] = [];

    for (const { emaPeriod, atrPeriod, multiplier } of CONFIGS) {
      if (candles.length < Math.max(emaPeriod, atrPeriod) + 1) continue;
      const middle = computeEMA(closes, emaPeriod);
      const atr = computeATR(candles, atrPeriod);
      const offset = multiplier * atr;
      values.push({
        emaPeriod,
        atrPeriod,
        multiplier,
        upperChannel: middle + offset,
        middleChannel: middle,
        lowerChannel: middle - offset,
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
      output.values.map((v) => `${v.emaPeriod}:${v.atrPeriod}:${v.multiplier}:${v.upperChannel.toFixed(6)}:${v.lowerChannel.toFixed(6)}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.values.map((v) => ({
      ema_period: v.emaPeriod,
      atr_period: v.atrPeriod,
      multiplier: v.multiplier,
      upper_channel: v.upperChannel,
      middle_channel: v.middleChannel,
      lower_channel: v.lowerChannel,
      ts: v.ts,
    }));
  },

  deserialize(rows): KeltnerOutput {
    return {
      values: rows.map((r) => ({
        emaPeriod: r.ema_period as number,
        atrPeriod: r.atr_period as number,
        multiplier: r.multiplier as number,
        upperChannel: r.upper_channel as number,
        middleChannel: r.middle_channel as number,
        lowerChannel: r.lower_channel as number,
        ts: r.ts ? new Date(r.ts as string) : undefined,
      })),
    };
  },
};
