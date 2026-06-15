/**
 * Session High/Low feature.
 * Computes daily high/low/open/close for each trading session.
 */

import type { Candle, FeatureDefinition, SessionHlOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface SessionHlInput {
  candles: Candle[];
}

type SessionKey = "asian" | "london" | "overlap" | "ny" | "globex";

const SESSION_HOURS: Record<SessionKey, [number, number]> = {
  asian: [0, 6],
  london: [7, 11],
  overlap: [12, 15],
  ny: [16, 20],
  globex: [21, 23],
};

function getSessionKey(utcHour: number): SessionKey {
  if (utcHour >= 0 && utcHour <= 6) return "asian";
  if (utcHour >= 7 && utcHour <= 11) return "london";
  if (utcHour >= 12 && utcHour <= 15) return "overlap";
  if (utcHour >= 16 && utcHour <= 20) return "ny";
  return "globex";
}

function computeSessionHL(candles: Candle[]): SessionHlOutput["sessions"] {
  if (candles.length === 0) return [];

  // Group candles by (date, session)
  const buckets = new Map<string, { high: number; low: number; open: number; close: number; session: SessionKey }>();

  for (const c of candles) {
    const d = new Date(c.ts);
    const date = d.toISOString().split("T")[0];
    const hour = d.getUTCHours();
    const session = getSessionKey(hour);
    const key = `${date}|${session}`;

    const existing = buckets.get(key);
    if (existing) {
      if (c.h > existing.high) existing.high = c.h;
      if (c.l < existing.low) existing.low = c.l;
      existing.close = c.c;
    } else {
      buckets.set(key, { high: c.h, low: c.l, open: c.o, close: c.c, session });
    }
  }

  const sessions: SessionHlOutput["sessions"] = [];
  for (const [key, data] of buckets) {
    const [date] = key.split("|");
    sessions.push({
      session: data.session,
      high: data.high,
      low: data.low,
      open: data.open,
      close: data.close,
      date,
    });
  }

  // Sort by date descending, then by session order
  const sessionOrder = ["asian", "london", "overlap", "ny", "globex"] as SessionKey[];
  sessions.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return sessionOrder.indexOf(a.session) - sessionOrder.indexOf(b.session);
  });

  return sessions;
}

export const sessionHlFeature: FeatureDefinition<SessionHlInput, SessionHlOutput> = {
  name: "features_session_hl",
  version: "1.0.0",
  dependencies: [],

  compute(input): SessionHlOutput {
    return { sessions: computeSessionHL(input.candles) };
  },

  hashInput(input): string {
    // Session HL is date-bound; same day = same hash regardless of tf
    const last = input.candles[input.candles.length - 1];
    const date = last ? last.ts.toISOString().split("T")[0] : "unknown";
    return sha256(date);
  },

  hashOutput(output): string {
    return sha256(
      output.sessions.map((s) => `${s.date}:${s.session}:${s.high}:${s.low}:${s.open}:${s.close}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.sessions.map((s) => ({
      date: s.date,
      session: s.session,
      high: s.high,
      low: s.low,
      open: s.open,
      close: s.close,
    }));
  },

  deserialize(rows): SessionHlOutput {
    return {
      sessions: rows.map((r) => ({
        session: r.session as SessionHlOutput["sessions"][number]["session"],
        high: r.high as number,
        low: r.low as number,
        open: r.open as number,
        close: r.close as number,
        date: r.date as string,
      })),
    };
  },
};
