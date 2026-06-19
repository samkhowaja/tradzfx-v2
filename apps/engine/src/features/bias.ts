/**
 * Bias feature.
 * Determines directional bias per timeframe using EMA alignment and structure.
 */

import type { Candle, FeatureDefinition, BiasOutput, Direction } from "@tm/shared";
import { sha256 } from "@tm/shared";
import type { StructureOutput } from "@tm/shared";

export interface BiasInput {
  candles: Candle[];
  features_structure: StructureOutput;
}

function computeEMA(candles: Candle[], period: number): number[] {
  const values = candles.map((c) => c.c);
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i];
  }
  ema.push(sum / Math.min(period, values.length));

  for (let i = period; i < values.length; i++) {
    ema.push((values[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
  }

  return ema;
}

function detectBias(
  candles: Candle[],
  structure: StructureOutput["events"]
): BiasOutput {
  if (candles.length < 50) {
    return { direction: "neutral", confidence: 0 };
  }

  const ema20 = computeEMA(candles, 20);
  const ema50 = computeEMA(candles, 50);

  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];

  let direction: Direction = "neutral";
  let confidence = 0;
  let reason = "";

  if (lastEma20 > lastEma50) {
    direction = "bullish";
    confidence = 60;
    reason = "EMA20 > EMA50";
  } else if (lastEma20 < lastEma50) {
    direction = "bearish";
    confidence = 60;
    reason = "EMA20 < EMA50";
  }

  // Boost confidence with structure alignment
  const recentStructure = structure.slice(-5);
  const bullishEvents = recentStructure.filter(
    (e) => e.direction === "bullish" && e.eventType === "bos"
  ).length;
  const bearishEvents = recentStructure.filter(
    (e) => e.direction === "bearish" && e.eventType === "bos"
  ).length;

  if (direction === "bullish" && bullishEvents > bearishEvents) {
    confidence = Math.min(90, confidence + 20);
    reason += " + bullish BOS";
  } else if (direction === "bearish" && bearishEvents > bullishEvents) {
    confidence = Math.min(90, confidence + 20);
    reason += " + bearish BOS";
  }

  return { direction, confidence, reason };
}

export const biasFeature: FeatureDefinition<BiasInput, BiasOutput> = {
  name: "features_bias",
  version: "1.1.0",
  dependencies: ["features_structure"],

  compute(input): BiasOutput {
    return detectBias(input.candles, input.features_structure.events);
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|") +
        "|" +
        input.features_structure.events
          .map((e) => `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}`)
          .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(`${output.direction}:${output.confidence}:${output.reason}`);
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        direction: output.direction,
        confidence: output.confidence,
        reason: output.reason,
      },
    ];
  },

  deserialize(rows): BiasOutput {
    const r = rows[0];
    if (!r) return { direction: "neutral", confidence: 0 };
    return {
      direction: r.direction as Direction,
      confidence: r.confidence as number,
      reason: r.reason as string,
    };
  },
};
