/**
 * Regime Bias feature (replaces the legacy EMA-cross bias).
 *
 * Computes a weighted, explainable directional bias from:
 *   - HTF alignment (features_htf_bias)
 *   - EMA20/50 slope normalized by ATR
 *   - Recent structure events (BOS/MSS/CHoCH)
 *   - Volume impulse vs 20-bar average
 *   - Time-of-day edge
 *   - Volatility regime (ATR percentile)
 *
 * Weights are initial defaults and can be tuned via backtesting.
 */

import type {
  Candle,
  Direction,
  FeatureDefinition,
  RegimeBiasOutput,
  RegimeBiasFactorScores,
  HtfBiasOutput,
  AtrOutput,
  StructureOutput,
  TimeOfDayEdgeOutput,
} from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface BiasInput {
  candles: Candle[];
  features_structure: StructureOutput;
  features_htf_bias: HtfBiasOutput;
  features_atr: AtrOutput;
  features_time_of_day_edge: TimeOfDayEdgeOutput;
}

const WEIGHTS: Record<keyof RegimeBiasFactorScores, number> = {
  htfAlignment: 0.30,
  emaSlope: 0.20,
  structure: 0.20,
  volume: 0.15,
  session: 0.10,
  volatility: 0.05,
};

function computeEMA(values: number[], period: number): number[] {
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

function getAtr14(atr: AtrOutput): number {
  return atr.values.find((v) => v.period === 14)?.value ?? 0;
}

function htfAlignmentScore(htf: HtfBiasOutput): number {
  if (htf.direction === "bullish") return htf.confidence;
  if (htf.direction === "bearish") return -htf.confidence;
  return 0;
}

function emaSlopeScore(candles: Candle[], atr14: number): number {
  if (candles.length < 50 || atr14 <= 0) return 0;
  const closes = candles.map((c) => c.c);
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const diff = ema20[ema20.length - 1] - ema50[ema50.length - 1];
  // Normalize so 1x ATR ~= 50 points, 2x ATR ~= 100 points
  const raw = (diff / atr14) * 50;
  return Math.max(-100, Math.min(100, raw));
}

function structureScore(events: StructureOutput["events"]): number {
  const recent = events.slice(-5);
  if (recent.length === 0) return 0;
  let bullish = 0;
  let bearish = 0;
  for (const e of recent) {
    // CHoCH/MSS are stronger trend-change signals than BOS
    const weight = e.eventType === "choch" || e.eventType === "mss" ? 1.5 : 1.0;
    if (e.direction === "bullish") bullish += weight;
    else if (e.direction === "bearish") bearish += weight;
  }
  const net = bullish - bearish;
  const max = Math.max(bullish, bearish, 1);
  // Scale to ~ ±100 based on the dominant side
  return Math.max(-100, Math.min(100, (net / max) * 100));
}

function volumeScore(candles: Candle[]): number {
  if (candles.length < 21) return 0;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const window = candles.slice(-21, -1);
  const avg = window.reduce((s, c) => s + (c.v ?? 0), 0) / window.length;
  if (avg <= 0) return 0;
  const ratio = (last.v ?? 0) / avg;
  const impulse = Math.min(100, (ratio - 1) * 100); // 2x avg -> 100
  const direction: Direction =
    last.c > (prev?.o ?? last.o) ? "bullish" : last.c < (prev?.o ?? last.o) ? "bearish" : "neutral";
  if (direction === "bullish") return impulse;
  if (direction === "bearish") return -impulse;
  return 0;
}

function sessionScore(edge: TimeOfDayEdgeOutput): number {
  // Center the 0-100 edge score around 50 and expand to ±100
  return Math.max(-100, Math.min(100, (edge.score - 50) * 2));
}

function volatilityScore(candles: Candle[], atr14: number): number {
  if (candles.length < 20 || atr14 <= 0) return 50;
  const atrs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.h - curr.l,
      Math.abs(curr.h - prev.c),
      Math.abs(curr.l - prev.c)
    );
    atrs.push(tr);
  }
  const window = atrs.slice(-100);
  const min = Math.min(...window);
  const max = Math.max(...window);
  if (max <= min) return 50;
  const percentile = (atr14 - min) / (max - min);
  // Reward "normal" volatility near the 50th percentile; penalize extremes
  return Math.max(0, Math.min(100, 100 - Math.abs(percentile - 0.5) * 200));
}

function classifyRegime(
  atrPercentile: number,
  emaScore: number,
  htfScore: number,
  structureScoreValue: number,
  events: StructureOutput["events"]
): RegimeBiasOutput["regime"] {
  if (atrPercentile > 0.75) return "volatile";
  if (atrPercentile < 0.2) return "low_volatility";

  const hasStrongDirection =
    Math.abs(emaScore) > 50 || Math.abs(htfScore) >= 70 || Math.abs(structureScoreValue) > 50;
  if (hasStrongDirection) return "trending";

  const recent = events.slice(-5);
  const bullish = recent.filter((e) => e.direction === "bullish").length;
  const bearish = recent.filter((e) => e.direction === "bearish").length;
  if (recent.length >= 3 && bullish > 0 && bearish > 0) return "ranging";

  return "trending";
}

function computeAtrPercentile(candles: Candle[], atr14: number): number {
  if (candles.length < 20 || atr14 <= 0) return 0.5;
  const atrs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.h - curr.l,
      Math.abs(curr.h - prev.c),
      Math.abs(curr.l - prev.c)
    );
    atrs.push(tr);
  }
  const window = atrs.slice(-100);
  const min = Math.min(...window);
  const max = Math.max(...window);
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (atr14 - min) / (max - min)));
}

function detectRegimeBias(input: BiasInput): RegimeBiasOutput {
  const { candles, features_structure, features_htf_bias, features_atr, features_time_of_day_edge } =
    input;

  if (candles.length < 50) {
    return {
      direction: "neutral",
      confidence: 0,
      regime: "low_volatility",
      score: {
        htfAlignment: 0,
        emaSlope: 0,
        structure: 0,
        volume: 0,
        session: 0,
        volatility: 0,
      },
      reason: "insufficient candle history",
      factors: ["insufficient_history"],
    };
  }

  const atr14 = getAtr14(features_atr);
  const atrPercentile = computeAtrPercentile(candles, atr14);

  const scores: RegimeBiasFactorScores = {
    htfAlignment: htfAlignmentScore(features_htf_bias),
    emaSlope: emaSlopeScore(candles, atr14),
    structure: structureScore(features_structure.events),
    volume: volumeScore(candles),
    session: sessionScore(features_time_of_day_edge),
    volatility: volatilityScore(candles, atr14),
  };

  let net = 0;
  for (const key of Object.keys(WEIGHTS) as Array<keyof RegimeBiasFactorScores>) {
    net += scores[key] * WEIGHTS[key];
  }

  // Volatility acts as a confidence dampener, not a directional factor
  const volatilityDampener = 0.5 + scores.volatility / 200; // 0.5 -> 1.0
  net *= volatilityDampener;

  const confidence = Math.max(0, Math.min(100, Math.abs(net)));
  let direction: Direction = "neutral";
  if (net > 0) direction = "bullish";
  else if (net < 0) direction = "bearish";

  const regime = classifyRegime(
    atrPercentile,
    scores.emaSlope,
    scores.htfAlignment,
    scores.structure,
    features_structure.events
  );

  const factors = Object.entries(scores)
    .filter(([_, v]) => Math.abs(v) > 5)
    .map(([k, v]) => `${k}:${v > 0 ? "+" : ""}${v.toFixed(0)}`);

  const reason = `${direction} ${regime} | confidence=${confidence.toFixed(0)} | ` +
    Object.entries(scores)
      .map(([k, v]) => `${k}=${v > 0 ? "+" : ""}${v.toFixed(0)}`)
      .join(", ");

  return {
    direction,
    confidence: Math.round(confidence),
    regime,
    score: scores,
    reason,
    factors,
  };
}

export const biasFeature: FeatureDefinition<BiasInput, RegimeBiasOutput> = {
  name: "features_bias",
  version: "2.0.0",
  dependencies: [
    "features_structure",
    "features_htf_bias",
    "features_atr",
    "features_time_of_day_edge",
  ],

  compute(input): RegimeBiasOutput {
    return detectRegimeBias(input);
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`)
        .join("|") +
        "|" +
        input.features_structure.events
          .map((e) => `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}`)
          .join("|") +
        "|" +
        `${input.features_htf_bias.direction}:${input.features_htf_bias.confidence}:${input.features_htf_bias.score}` +
        "|" +
        input.features_atr.values.map((v) => `${v.period}=${v.value.toFixed(6)}`).join("|") +
        "|" +
        `${input.features_time_of_day_edge.edge}:${input.features_time_of_day_edge.score}:${input.features_time_of_day_edge.session}`
    );
  },

  hashOutput(output): string {
    return sha256(
      `${output.direction}:${output.confidence}:${output.regime}:` +
        Object.entries(output.score)
          .map(([k, v]) => `${k}=${v.toFixed(2)}`)
          .join("|") +
        `:${output.factors.join(",")}`
    );
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        direction: output.direction,
        confidence: output.confidence,
        reason: output.reason,
        regime: output.regime,
        score_htf_alignment: output.score.htfAlignment,
        score_ema_slope: output.score.emaSlope,
        score_structure: output.score.structure,
        score_volume: output.score.volume,
        score_session: output.score.session,
        score_volatility: output.score.volatility,
        factors: output.factors.join(","),
      },
    ];
  },

  deserialize(rows): RegimeBiasOutput {
    const r = rows[0];
    if (!r) {
      return {
        direction: "neutral",
        confidence: 0,
        regime: "low_volatility",
        score: { htfAlignment: 0, emaSlope: 0, structure: 0, volume: 0, session: 0, volatility: 0 },
        reason: "no_data",
        factors: ["no_data"],
      };
    }
    return {
      direction: r.direction as Direction,
      confidence: (r.confidence as number) ?? 0,
      regime: (r.regime as RegimeBiasOutput["regime"]) ?? "trending",
      score: {
        htfAlignment: (r.score_htf_alignment as number) ?? 0,
        emaSlope: (r.score_ema_slope as number) ?? 0,
        structure: (r.score_structure as number) ?? 0,
        volume: (r.score_volume as number) ?? 0,
        session: (r.score_session as number) ?? 0,
        volatility: (r.score_volatility as number) ?? 0,
      },
      reason: (r.reason as string) ?? "",
      factors: typeof r.factors === "string" ? (r.factors as string).split(",") : [],
    };
  },
};
