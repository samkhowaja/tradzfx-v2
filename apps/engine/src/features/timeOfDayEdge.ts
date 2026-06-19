/**
 * Time-of-day edge feature.
 * Scores the current UTC hour for a symbol based on historical win-rate profiles.
 */

import type { Candle, FeatureDefinition, TimeOfDayEdgeOutput } from "@tm/shared";
import { sha256, getPairCharacteristics } from "@tm/shared";

export interface TimeOfDayEdgeInput {
  candles: Candle[];
}

type HourlyProfile = { wr: number; n: number; r?: number };
type SessionBucket = TimeOfDayEdgeOutput["session"];

function utcHourToSessionBucket(h: number): SessionBucket {
  if (h < 7) return "ASIA";
  if (h < 13) return "LONDON";
  if (h < 17) return "OVERLAP";
  if (h <= 20) return "NY";
  return "LATE_NY";
}

const HOURLY_PROFILES: Record<string, Partial<Record<number, HourlyProfile>>> = {
  XAUUSD: {
    7: { wr: 0.71, n: 14, r: 1.19 },
    8: { wr: 0.58, n: 12, r: 0.8 },
    9: { wr: 0.55, n: 11, r: 0.57 },
    10: { wr: 0.53, n: 15, r: 0.14 },
    11: { wr: 0.33, n: 12, r: -0.22 },
    12: { wr: 0.11, n: 9, r: -0.71 },
    13: { wr: 0.0, n: 15, r: -1.0 },
    14: { wr: 0.25, n: 4, r: -0.01 },
    15: { wr: 0.75, n: 8, r: 0.94 },
    16: { wr: 0.6, n: 5, r: 0.58 },
    17: { wr: 0.5, n: 8, r: 0.2 },
    18: { wr: 0.89, n: 19, r: 1.13 },
    19: { wr: 0.59, n: 151, r: 0.44 },
    20: { wr: 0.56, n: 9, r: 0.21 },
    21: { wr: 0.88, n: 17, r: 1.15 },
    22: { wr: 0.71, n: 14, r: 1.06 },
    23: { wr: 0.57, n: 21, r: 0.38 },
  },
};

const SESSION_PROFILES: Record<string, Partial<Record<SessionBucket, { wr: number; n: number }>>> = {
  XAUUSD: {
    ASIA: { wr: 0.5, n: 116 },
    LONDON: { wr: 0.55, n: 98 },
    OVERLAP: { wr: 0.22, n: 94 },
    NY: { wr: 0.62, n: 35 },
    LATE_NY: { wr: 0.69, n: 24 },
  },
  EURUSD: {
    ASIA: { wr: 0.48, n: 44 },
    LONDON: { wr: 0.52, n: 30 },
    OVERLAP: { wr: 0.6, n: 32 },
    NY: { wr: 0.55, n: 30 },
    LATE_NY: { wr: 0.6, n: 20 },
  },
  GBPUSD: {
    ASIA: { wr: 0.55, n: 320 },
    LONDON: { wr: 0.53, n: 380 },
    OVERLAP: { wr: 0.5, n: 332 },
    NY: { wr: 0.48, n: 189 },
    LATE_NY: { wr: 0.52, n: 119 },
  },
  USDJPY: {
    ASIA: { wr: 0.52, n: 259 },
    LONDON: { wr: 0.56, n: 300 },
    OVERLAP: { wr: 0.54, n: 214 },
    NY: { wr: 0.54, n: 153 },
    LATE_NY: { wr: 0.56, n: 120 },
  },
  USDCAD: {
    ASIA: { wr: 0.52, n: 271 },
    LONDON: { wr: 0.56, n: 437 },
    OVERLAP: { wr: 0.5, n: 429 },
    NY: { wr: 0.54, n: 304 },
    LATE_NY: { wr: 0.5, n: 167 },
  },
  USDCHF: {
    ASIA: { wr: 0.52, n: 221 },
    LONDON: { wr: 0.55, n: 356 },
    OVERLAP: { wr: 0.49, n: 222 },
    NY: { wr: 0.55, n: 140 },
    LATE_NY: { wr: 0.53, n: 118 },
  },
  AUDUSD: {
    ASIA: { wr: 0.5, n: 392 },
    LONDON: { wr: 0.52, n: 413 },
    OVERLAP: { wr: 0.46, n: 369 },
    NY: { wr: 0.49, n: 187 },
    LATE_NY: { wr: 0.51, n: 153 },
  },
  NZDUSD: {
    ASIA: { wr: 0.52, n: 337 },
    LONDON: { wr: 0.54, n: 318 },
    OVERLAP: { wr: 0.47, n: 284 },
    NY: { wr: 0.55, n: 207 },
    LATE_NY: { wr: 0.51, n: 153 },
  },
};

const MIN_SAMPLES_FOR_HOUR = 15;
const MIN_SAMPLES_FOR_SESSION = 20;

function computeEdge(symbol: string, utcHour: number): TimeOfDayEdgeOutput {
  const normalizedSymbol = (symbol ?? "").toUpperCase();
  const session = utcHourToSessionBucket(utcHour);
  const reasons: string[] = [];
  let lowSample = false;

  const hourly = HOURLY_PROFILES[normalizedSymbol]?.[utcHour];
  let wr = hourly?.wr;
  let n = hourly?.n ?? 0;

  if (hourly && n >= MIN_SAMPLES_FOR_HOUR) {
    reasons.push(`hour_${utcHour}_wr_${(wr! * 100).toFixed(0)}%`);
  } else {
    const sessionData = SESSION_PROFILES[normalizedSymbol]?.[session];
    if (sessionData && sessionData.n >= MIN_SAMPLES_FOR_SESSION) {
      wr = sessionData.wr;
      n = sessionData.n;
      reasons.push(`session_${session}_wr_${(wr * 100).toFixed(0)}%`);
      if (hourly) {
        lowSample = true;
        reasons.push(`hourly_low_sample(n=${hourly.n})`);
      }
    } else {
      return {
        edge: "NEUTRAL",
        score: 50,
        session,
        reasons: ["no_profile", `session_${session}`],
        lowSample: true,
      };
    }
  }

  // Directional penalty: Gold longs are systematically weaker in current model.
  let directionalPenalty = 0;
  const pc = getPairCharacteristics(normalizedSymbol);
  if (pc.sideAsymmetry && pc.sideAsymmetry.longSizePct < 100) {
    directionalPenalty = (100 - pc.sideAsymmetry.longSizePct) / 10;
    reasons.push("long_penalty");
  }

  const adjustedWr = Math.max(0, Math.min(1, (wr ?? 0.5) - directionalPenalty / 100));

  let edge: TimeOfDayEdgeOutput["edge"];
  let score: number;
  if (adjustedWr >= 0.7) {
    edge = "STRONG";
    score = Math.round(70 + (adjustedWr - 0.7) * 100);
  } else if (adjustedWr >= 0.55) {
    edge = "GOOD";
    score = Math.round(55 + (adjustedWr - 0.55) * 100);
  } else if (adjustedWr >= 0.45) {
    edge = "NEUTRAL";
    score = Math.round(40 + (adjustedWr - 0.45) * 100);
  } else if (adjustedWr >= 0.35) {
    edge = "WEAK";
    score = Math.round(20 + (adjustedWr - 0.35) * 100);
  } else {
    edge = "AVOID";
    score = Math.round(adjustedWr * 100);
  }

  return { edge, score, session, reasons, lowSample };
}

export const timeOfDayEdgeFeature: FeatureDefinition<TimeOfDayEdgeInput, TimeOfDayEdgeOutput> = {
  name: "features_time_of_day_edge",
  version: "1.1.0",
  dependencies: [],

  compute(input): TimeOfDayEdgeOutput {
    const last = input.candles[input.candles.length - 1];
    const symbol = last?.symbol ?? "";
    const utcHour = last ? last.ts.getUTCHours() : 0;
    return computeEdge(symbol, utcHour);
  },

  hashInput(input): string {
    const last = input.candles[input.candles.length - 1];
    if (!last) return sha256("empty");
    return sha256(`${last.symbol}:${last.ts.toISOString()}`);
  },

  hashOutput(output): string {
    return sha256(`${output.edge}:${output.score}:${output.session}:${output.reasons.join(",")}`);
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        edge: output.edge,
        score: output.score,
        session: output.session,
        reasons: output.reasons.join(","),
        low_sample: output.lowSample ?? false,
      },
    ];
  },

  deserialize(rows): TimeOfDayEdgeOutput {
    const r = rows[0];
    if (!r) return { edge: "NEUTRAL", score: 50, session: "ASIA", reasons: ["no_data"], lowSample: true };
    return {
      edge: r.edge as TimeOfDayEdgeOutput["edge"],
      score: r.score as number,
      session: r.session as SessionBucket,
      reasons: typeof r.reasons === "string" ? (r.reasons as string).split(",") : [],
      lowSample: r.low_sample as boolean,
    };
  },
};
