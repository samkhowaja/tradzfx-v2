/**
 * Opening Range (ORB) feature.
 * Computes opening range high/low/midpoint for the first N minutes of each session.
 */

import type { Candle, FeatureDefinition, OpeningRangeOutput, TimeFrame } from "@tm/shared";
import { sha256, getTfMs } from "@tm/shared";

export interface OpeningRangeInput {
  candles: Candle[];
}

type SessionKey = "ny" | "london" | "asia";

const SESSION_START_HOUR: Record<SessionKey, number> = {
  asia: 0,
  london: 7,
  ny: 16,
};

const TF_TO_RANGE_MINUTES: Record<TimeFrame, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

function computeOpeningRange(
  candles: Candle[],
  session: SessionKey,
  rangeMinutes: number
): OpeningRangeOutput["ranges"][number] | null {
  if (candles.length === 0) return null;

  const startHour = SESSION_START_HOUR[session];
  const last = candles[candles.length - 1];
  const date = last.ts.toISOString().split("T")[0];

  // Find candles within the first `rangeMinutes` of the session start
  const sessionStart = new Date(`${date}T${String(startHour).padStart(2, "0")}:00:00Z`);

  // Find the most recent session start before the last candle
  let startMs = sessionStart.getTime();
  const lastMs = last.ts.getTime();
  while (startMs + 24 * 60 * 60_000 <= lastMs) {
    startMs += 24 * 60 * 60_000;
  }
  while (startMs > lastMs) {
    startMs -= 24 * 60 * 60_000;
  }

  const endMs = startMs + rangeMinutes * 60_000;
  const rangeCandles = candles.filter((c) => {
    const t = c.ts.getTime();
    return t >= startMs && t < endMs;
  });

  if (rangeCandles.length === 0) return null;

  const high = Math.max(...rangeCandles.map((c) => c.h));
  const low = Math.min(...rangeCandles.map((c) => c.l));

  return {
    session,
    rangeMinutes,
    high,
    low,
    midpoint: (high + low) / 2,
    date: new Date(startMs).toISOString().split("T")[0],
  };
}

function computeAllOpeningRanges(candles: Candle[], tf: TimeFrame): OpeningRangeOutput["ranges"] {
  const results: OpeningRangeOutput["ranges"] = [];
  const sessions: SessionKey[] = ["asia", "london", "ny"];
  const rangeMinutes = TF_TO_RANGE_MINUTES[tf] ?? 15;

  for (const session of sessions) {
    const range = computeOpeningRange(candles, session, rangeMinutes);
    if (range) results.push(range);
  }

  // Sort by date desc, session
  const sessionOrder = ["asia", "london", "ny"] as SessionKey[];
  results.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return sessionOrder.indexOf(a.session) - sessionOrder.indexOf(b.session);
  });

  return results;
}

export const openingRangeFeature: FeatureDefinition<OpeningRangeInput, OpeningRangeOutput> = {
  name: "features_opening_range",
  version: "1.1.0",
  dependencies: [],

  compute(input, opts?: { tf?: TimeFrame }): OpeningRangeOutput {
    return { ranges: computeAllOpeningRanges(input.candles, opts?.tf ?? "15m") };
  },

  hashInput(input): string {
    const last = input.candles[input.candles.length - 1];
    const date = last ? last.ts.toISOString().split("T")[0] : "unknown";
    return sha256(date);
  },

  hashOutput(output): string {
    return sha256(
      output.ranges.map((r) => `${r.date}:${r.session}:${r.rangeMinutes}:${r.high}:${r.low}:${r.midpoint}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.ranges.map((r) => ({
      date: r.date,
      session: r.session,
      range_minutes: r.rangeMinutes,
      high: r.high,
      low: r.low,
      midpoint: r.midpoint,
    }));
  },

  deserialize(rows): OpeningRangeOutput {
    return {
      ranges: rows.map((r) => ({
        session: r.session as OpeningRangeOutput["ranges"][number]["session"],
        rangeMinutes: r.range_minutes as number,
        high: r.high as number,
        low: r.low as number,
        midpoint: r.midpoint as number,
        date: r.date as string,
      })),
    };
  },
};
