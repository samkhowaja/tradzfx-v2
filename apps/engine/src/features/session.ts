/**
 * Session feature.
 * Classifies the trading session based on UTC hour.
 */

import type { Candle, FeatureDefinition, SessionOutput, SessionWindows } from "@tm/shared";
import { sha256, getSession, DEFAULT_SESSION_WINDOWS } from "@tm/shared";

export interface SessionInput {
  candles: Candle[];
}

function parseSessionWindows(env?: string): SessionWindows {
  if (!env) return DEFAULT_SESSION_WINDOWS;
  try {
    const parsed = JSON.parse(env);
    if (
      parsed.ASIA && parsed.LONDON && parsed.OVERLAP && parsed.NY &&
      Array.isArray(parsed.ASIA) && Array.isArray(parsed.LONDON) &&
      Array.isArray(parsed.OVERLAP) && Array.isArray(parsed.NY)
    ) {
      return parsed as SessionWindows;
    }
  } catch {
    // fallthrough
  }
  return DEFAULT_SESSION_WINDOWS;
}

const SESSION_WINDOWS = parseSessionWindows(process.env.SESSION_WINDOWS);

export const sessionFeature: FeatureDefinition<SessionInput, SessionOutput> = {
  name: "features_session",
  version: "1.2.0",
  dependencies: [],

  compute(input): SessionOutput {
    const last = input.candles[input.candles.length - 1];
    const utcHour = last.ts.getUTCHours();
    return {
      session: getSession(utcHour, SESSION_WINDOWS),
      utcHour,
    };
  },

  hashInput(input): string {
    return sha256(
      input.candles.map((c) => c.ts.toISOString()).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(`${output.session}:${output.utcHour}`);
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        session: output.session,
        utc_hour: output.utcHour,
      },
    ];
  },

  deserialize(rows): SessionOutput {
    const r = rows[0];
    if (!r) return { session: "OFF_HOURS", utcHour: 0 };
    return {
      session: r.session as SessionOutput["session"],
      utcHour: r.utc_hour as number,
    };
  },
};
