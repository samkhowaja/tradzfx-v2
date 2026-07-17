/**
 * Canonical time-bucket utilities.
 *
 * Every part of the platform (ingest, engine, analyzer, pipeline trigger)
 * must use these functions so that 5m/15m/1h/4h/1d buckets are identical
 * across the live pipeline and the analyzer UI.
 */

import type { TimeFrame } from "../types/feature";

export const VALID_TFS: TimeFrame[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export const TF_MS: Record<TimeFrame, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/**
 * Map a display timeframe to its effective-dated canonical candle relation.
 * The engine, analyzer, live pipeline, and PIT sampler must agree on these names.
 * Raw broker-qualified tables/caggs are audit and source-quality surfaces only.
 *
 * Daily contract (SK-11): `1d` uses UTC midnight. The fixed-21:00-UTC NY-close
 * projection is a separate auxiliary used only by explicit export consumers.
 */
export const CANDLE_TABLE_BY_TF: Record<TimeFrame, string> = {
  "1m": "market.candles_1m_canonical",
  "5m": "market.candles_5m_canonical",
  "15m": "market.candles_15m_canonical",
  "1h": "market.candles_1h_canonical",
  "4h": "market.candles_4h_canonical",
  "1d": "market.candles_1d_utc_canonical",
};

/**
 * Broker-qualified raw relations retained for explicit audit/source snapshots.
 */
export const RAW_CANDLE_TABLE_BY_TF: Record<TimeFrame, string> = {
  "1m": "candles_1m",
  "5m": "candles_5m",
  "15m": "candles_15m",
  "1h": "candles_1h",
  "4h": "candles_4h",
  "1d": "candles_1d_utc",
};

/**
 * Bucket a UTC timestamp into the start of its timeframe interval.
 * All intervals are UTC-based and start at minute zero.
 */
export function timeBucket(ts: Date | number | string, tf: TimeFrame): Date {
  const d = new Date(ts);
  d.setUTCSeconds(0, 0);

  switch (tf) {
    case "1m":
      break;
    case "5m":
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5);
      break;
    case "15m":
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15);
      break;
    case "1h":
      d.setUTCMinutes(0);
      break;
    case "4h":
      d.setUTCHours(Math.floor(d.getUTCHours() / 4) * 4);
      d.setUTCMinutes(0);
      break;
    case "1d":
      d.setUTCHours(0);
      d.setUTCMinutes(0);
      break;
  }

  return d;
}

/**
 * Legacy alias kept for compatibility with code that already uses floorToTf.
 * Prefer timeBucket() for new code because it is explicit about UTC and
 * supports the full TimeFrame union.
 */
export function floorToTf(ts: Date, tf: TimeFrame): Date {
  return timeBucket(ts, tf);
}

/**
 * Return the millisecond width of a timeframe.
 */
export function getTfMs(tf: TimeFrame): number {
  return TF_MS[tf] ?? TF_MS["1m"];
}

/**
 * Round a bar timestamp to the nearest 1m boundary.
 * Used by ingest to normalize MT5 bars that may arrive at xx:59 and xx:00.
 */
export function roundToMinute(ts: Date | number | string): Date {
  const epoch = new Date(ts).getTime();
  return new Date(Math.round(epoch / 60_000) * 60_000);
}

/**
 * For a given raw timestamp, return all higher-timeframe buckets that include it.
 * Useful when enqueueing feature jobs after bar ingestion.
 */
export function getAllBuckets(ts: Date | number | string): Record<TimeFrame, Date> {
  const out = {} as Record<TimeFrame, Date>;
  for (const tf of VALID_TFS) {
    out[tf] = timeBucket(ts, tf);
  }
  return out;
}

/**
 * Get the candle table name for a timeframe.
 */
export function getCandleTableForTf(tf: TimeFrame): string {
  return CANDLE_TABLE_BY_TF[tf] ?? "candles_1m";
}
