/**
 * Reliable higher-timeframe candle source.
 *
 * All HTF candle reads must go through this module. It treats the TimescaleDB
 * continuous aggregate views (candles_5m, candles_15m, ...) as the fast path,
 * but falls back to a deterministic rollup from candles_1m whenever the cached
 * materialization is incomplete. This makes HTF candle coverage reliable by
 * construction instead of depending on backfill state.
 *
 * Daily contract (SK-11): `1d` reads candles_1d_utc (canonical). candles_1d_ny is
 * the NY-close auxiliary for the web export API only; it is never used here.
 */

import type { Queryable } from "../utils/db";
import type { Candle, TimeFrame } from "../types/feature";
import {
  TF_MS,
  VALID_TFS,
  RAW_CANDLE_TABLE_BY_TF,
  getCandleTableForTf,
  floorToTf,
} from "../utils/timeBucket";
import { expectedTradableBars, gapInfo, isTradableInstant, tradableBarStarts } from "../utils/marketCalendar";

export interface CandleCoverageInfo {
  symbol: string;
  tf: TimeFrame;
  from: Date;
  to: Date;
  /** Tradable (FX 24/5) bars expected in [from, to]. */
  expectedRows: number;
  actualRows: number;
  coverageRatio: number;
  hasGaps: boolean;
  /** Number of missing tradable bars in [from, to]. */
  gapCount: number;
  /** Longest run of consecutive missing tradable bars, in minutes. */
  largestGapMinutes: number;
  source: "cagg" | "rollup" | "insufficient";
}

export interface CandleSourceOptions {
  /** Minimum coverage ratio required before trusting the cagg view (0-1). Default 0.98. */
  minCoverageRatio?: number;
  /** If true and cagg coverage is insufficient, compute deterministically from candles_1m. Default true. */
  allowRealtimeFallback?: boolean;
  /** Explicit broker snapshot for PIT/audit reads. Otherwise resolve current governed policy. */
  canonicalBrokerId?: string;
}

const DEFAULT_MIN_COVERAGE = 0.98;

function assertValidTf(tf: TimeFrame): void {
  if (!VALID_TFS.includes(tf)) {
    throw new Error(`Invalid timeframe: ${tf}`);
  }
}

function explicitBroker(opts: CandleSourceOptions): string | null {
  const broker = opts.canonicalBrokerId?.trim();
  return broker || null;
}

// Coverage/gap math is market-calendar-aware: see utils/marketCalendar.ts
// (expectedTradableBars / gapInfo). FX week = Sun 21:00 UTC -> Fri 21:00 UTC.

function mapCandleRow(r: Record<string, unknown>): Candle {
  return {
    symbol: String(r.symbol),
    ts: r.ts as Date,
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.v != null ? Number(r.v) : undefined,
    // tick_count exists on the 5m/15m/1h/4h caggs but not on candles_1m/candles_1d_utc
    // or the 1m-rollup path; carry it when present so callers (ATR quality) keep it.
    tickCount: r.tick_count != null ? Number(r.tick_count) : undefined,
  };
}

/** Closed-market rows remain raw evidence but must not count toward strategy
 * coverage or enter feature computation. */
function filterTradableCandles(candles: Candle[], symbol: string): Candle[] {
  return candles.filter((candle) => isTradableInstant(candle.ts, symbol));
}

/**
 * Query the TimescaleDB continuous aggregate view for a timeframe.
 */
async function queryCagg(
  pool: Queryable,
  symbol: string,
  broker: string | null,
  tf: TimeFrame,
  from: Date,
  to: Date
): Promise<Candle[]> {
  const table = broker ? RAW_CANDLE_TABLE_BY_TF[tf] : getCandleTableForTf(tf);
  const tickCol = tf === "1m" ? "" : ", tick_count";
  const { rows } = broker
    ? await pool.query(
        `SELECT symbol, ts, o, h, l, c, v${tickCol}
         FROM ${table}
         WHERE symbol = $1 AND broker = $2 AND ts >= $3 AND ts <= $4
         ORDER BY ts ASC`,
        [symbol, broker, from, to]
      )
    : await pool.query(
        `SELECT symbol, ts, o, h, l, c, v${tickCol}
         FROM ${table}
         WHERE symbol = $1 AND ts >= $2 AND ts <= $3
         ORDER BY ts ASC`,
        [symbol, from, to]
      );
  return filterTradableCandles(rows.map(mapCandleRow), symbol);
}

/**
 * Compute HTF candles deterministically from candles_1m.
 */
async function queryRollup(
  pool: Queryable,
  symbol: string,
  broker: string | null,
  tf: TimeFrame,
  from: Date,
  to: Date
): Promise<Candle[]> {
  const interval = `${TF_MS[tf] / 1000} seconds`;
  const source = broker ? RAW_CANDLE_TABLE_BY_TF["1m"] : getCandleTableForTf("1m");
  const { rows } = broker
    ? await pool.query(
        `SELECT symbol, time_bucket($5::interval, ts) AS ts,
                first(o, ts) AS o, max(h) AS h, min(l) AS l, last(c, ts) AS c,
                sum(v)::bigint AS v, count(*)::int AS tick_count
         FROM ${source}
         WHERE symbol = $1 AND broker = $2 AND ts >= $3 AND ts <= $4
         GROUP BY symbol, time_bucket($5::interval, ts)
         ORDER BY ts ASC`,
        [symbol, broker, from, to, interval]
      )
    : await pool.query(
        `SELECT symbol, time_bucket($4::interval, ts) AS ts,
                first(o, ts) AS o, max(h) AS h, min(l) AS l, last(c, ts) AS c,
                sum(v)::bigint AS v, count(*)::int AS tick_count
         FROM ${source}
         WHERE symbol = $1 AND ts >= $2 AND ts <= $3
         GROUP BY symbol, time_bucket($4::interval, ts)
         ORDER BY ts ASC`,
        [symbol, from, to, interval]
      );
  return filterTradableCandles(rows.map(mapCandleRow), symbol);
}

/**
 * Return complete candles for a symbol/timeframe/range, using the cagg when
 * possible and a deterministic 1m rollup as fallback.
 */
export async function getCandles(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  from: Date,
  to: Date,
  opts: CandleSourceOptions = {}
): Promise<Candle[]> {
  assertValidTf(tf);
  const broker = explicitBroker(opts);
  if (tf === "1m") {
    return queryCagg(pool, symbol, broker, tf, from, to);
  }

  const minCoverage = opts.minCoverageRatio ?? DEFAULT_MIN_COVERAGE;
  const allowFallback = opts.allowRealtimeFallback ?? true;

  const caggRows = await queryCagg(pool, symbol, broker, tf, from, to);
  const expected = expectedTradableBars(tf, from, to, symbol);
  const caggRatio = expected > 0 ? caggRows.length / expected : 1;
  const caggHasGaps = gapInfo(caggRows, tf, from, to, symbol).hasGaps;

  if (caggRatio >= minCoverage && !caggHasGaps) {
    return caggRows;
  }

  if (!allowFallback) {
    return caggRows;
  }

  // Deterministic fallback: same governed broker, slower for large ranges.
  const rollupRows = await queryRollup(pool, symbol, broker, tf, from, to);
  return rollupRows;
}

/**
 * Return the latest candle as of a point in time. If no candle exists in the
 * cagg for the requested asOf (e.g., historical backtest date with stale
 * materialization), this rolls up the most recent 1m window on demand.
 */
export async function getLatestCandle(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf?: Date,
  opts: CandleSourceOptions = {}
): Promise<Candle | null> {
  assertValidTf(tf);
  const asOfTs = asOf ?? new Date();
  const broker = explicitBroker(opts);
  const table = broker ? RAW_CANDLE_TABLE_BY_TF[tf] : getCandleTableForTf(tf);
  const tickCol = tf === "1m" ? "" : ", tick_count";
  const { rows } = broker
    ? await pool.query(
        `SELECT symbol, ts, o, h, l, c, v${tickCol}
         FROM ${table}
         WHERE symbol = $1 AND broker = $2 AND ts <= $3
         ORDER BY ts DESC LIMIT 1`,
        [symbol, broker, asOfTs]
      )
    : await pool.query(
        `SELECT symbol, ts, o, h, l, c, v${tickCol}
         FROM ${table}
         WHERE symbol = $1 AND ts <= $2
         ORDER BY ts DESC LIMIT 1`,
        [symbol, asOfTs]
      );

  if (rows.length) {
    return mapCandleRow(rows[0]);
  }

  if (!(opts.allowRealtimeFallback ?? true)) {
    return null;
  }

  // No materialized row as of the requested time. Roll up a small window
  // around asOf from 1m data. We use the preceding bar's width as the window
  // to ensure we capture at least one completed HTF bar.
  const windowMs = Math.max(TF_MS[tf], 60_000) * 2;
  const from = new Date(asOfTs.getTime() - windowMs);
  const rollup = await queryRollup(pool, symbol, broker, tf, from, asOfTs);
  return rollup.length ? rollup[rollup.length - 1] : null;
}

/**
 * Check coverage for a requested range without returning all rows.
 */
export async function checkCandleCoverage(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  from: Date,
  to: Date,
  opts: CandleSourceOptions = {}
): Promise<CandleCoverageInfo> {
  assertValidTf(tf);
  const minCoverage = opts.minCoverageRatio ?? DEFAULT_MIN_COVERAGE;
  const broker = explicitBroker(opts);

  if (tf === "1m") {
    const rows = await queryCagg(pool, symbol, broker, tf, from, to);
    const expected = expectedTradableBars(tf, from, to, symbol);
    const actual = rows.length;
    const hasGaps = expected > 0 && actual < expected;
    return {
      symbol,
      tf,
      from,
      to,
      expectedRows: expected,
      actualRows: actual,
      coverageRatio: expected > 0 ? actual / expected : 1,
      hasGaps,
      // COUNT(*) can't localise gaps; use getCandles() for per-bar positions.
      gapCount: Math.max(0, expected - actual),
      largestGapMinutes: 0,
      source: actual >= expected * minCoverage ? "cagg" : "insufficient",
    };
  }

  const caggRows = await queryCagg(pool, symbol, broker, tf, from, to);
  const expected = expectedTradableBars(tf, from, to, symbol);
  const caggRatio = expected > 0 ? caggRows.length / expected : 1;
  const caggGap = gapInfo(caggRows, tf, from, to, symbol);

  if (caggRatio >= minCoverage && !caggGap.hasGaps) {
    return {
      symbol,
      tf,
      from,
      to,
      expectedRows: expected,
      actualRows: caggRows.length,
      coverageRatio: caggRatio,
      hasGaps: false,
      gapCount: caggGap.gapCount,
      largestGapMinutes: caggGap.largestGapMinutes,
      source: "cagg",
    };
  }

  if (!(opts.allowRealtimeFallback ?? true)) {
    return {
      symbol,
      tf,
      from,
      to,
      expectedRows: expected,
      actualRows: caggRows.length,
      coverageRatio: caggRatio,
      hasGaps: caggGap.hasGaps,
      gapCount: caggGap.gapCount,
      largestGapMinutes: caggGap.largestGapMinutes,
      source: "insufficient",
    };
  }

  const rollupRows = await queryRollup(pool, symbol, broker, tf, from, to);
  const rollupRatio = expected > 0 ? rollupRows.length / expected : 1;
  const rollupGap = gapInfo(rollupRows, tf, from, to, symbol);

  return {
    symbol,
    tf,
    from,
    to,
    expectedRows: expected,
    actualRows: rollupRows.length,
    coverageRatio: rollupRatio,
    hasGaps: rollupGap.hasGaps,
    gapCount: rollupGap.gapCount,
    largestGapMinutes: rollupGap.largestGapMinutes,
    source: "rollup",
  };
}

/**
 * Refresh continuous aggregate coverage metadata for a symbol/timeframe.
 * This is a metadata-only cache; the actual data is always available via
 * getCandles because of the deterministic fallback.
 */
export async function recordCandleCoverage(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  from: Date,
  to: Date
): Promise<CandleCoverageInfo> {
  const info = await checkCandleCoverage(pool, symbol, tf, from, to);
  await pool.query(
    `INSERT INTO candle_coverage
       (symbol, tf, source_min_ts, source_max_ts, expected_rows, actual_rows, coverage_ratio, has_gaps,
        expected_tradable_bars, gap_count, largest_gap_minutes, source, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (symbol, tf) DO UPDATE SET
       source_min_ts = EXCLUDED.source_min_ts,
       source_max_ts = EXCLUDED.source_max_ts,
       expected_rows = EXCLUDED.expected_rows,
       actual_rows = EXCLUDED.actual_rows,
       coverage_ratio = EXCLUDED.coverage_ratio,
       has_gaps = EXCLUDED.has_gaps,
       expected_tradable_bars = EXCLUDED.expected_tradable_bars,
       gap_count = EXCLUDED.gap_count,
       largest_gap_minutes = EXCLUDED.largest_gap_minutes,
       source = EXCLUDED.source,
       refreshed_at = EXCLUDED.refreshed_at`,
    [
      symbol,
      tf,
      from,
      to,
      info.expectedRows,
      info.actualRows,
      info.coverageRatio,
      info.hasGaps,
      info.expectedRows, // expectedRows is now the tradable-bar count (FX 24/5)
      info.gapCount,
      info.largestGapMinutes,
      info.source,
    ]
  );
  return info;
}

/**
 * Count-based, gap-tolerant recent-candle fetch (SK-08 hot path).
 *
 * Returns the most recent `count` bars with ts <= endTs (ASC). Uses the cagg
 * fast path and only falls back to a deterministic 1m rollup when the returned
 * series is incomplete *against the FX 24/5 calendar* (a missing tradable bar
 * between consecutive rows, or the cagg lagging behind endTs). On healthy data
 * there is no fallback, so this stays fast and preserves tick_count (ATR
 * sparse_bucket quality). Weekend/closed hours are never treated as gaps.
 */
export async function getRecentCandles(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  endTs: Date,
  count: number,
  opts: CandleSourceOptions = {}
): Promise<Candle[]> {
  assertValidTf(tf);
  if (count <= 0) return [];
  const broker = explicitBroker(opts);
  const table = broker ? RAW_CANDLE_TABLE_BY_TF[tf] : getCandleTableForTf(tf);
  const tickCol = tf === "1m" ? "" : ", tick_count";
  const { rows } = broker
    ? await pool.query(
        `SELECT symbol, ts, o, h, l, c, v${tickCol}
         FROM ${table}
         WHERE symbol = $1 AND broker = $2 AND ts <= $3
         ORDER BY ts DESC LIMIT $4`,
        [symbol, broker, endTs, count]
      )
    : await pool.query(
        `SELECT symbol, ts, o, h, l, c, v${tickCol}
         FROM ${table}
         WHERE symbol = $1 AND ts <= $2
         ORDER BY ts DESC LIMIT $3`,
        [symbol, endTs, count]
      );
  const cagg = rows.map(mapCandleRow).reverse(); // ASC

  const allowFallback = opts.allowRealtimeFallback ?? true;
  if (!allowFallback || cagg.length < 2) return cagg;

  // Internal gaps: any missing tradable bar between consecutive returned rows.
  let incomplete = false;
  for (let i = 1; i < cagg.length; i++) {
    const g = gapInfo([cagg[i - 1], cagg[i]], tf, cagg[i - 1].ts, cagg[i].ts, symbol);
    if (g.hasGaps) {
      incomplete = true;
      break;
    }
  }

  // Trailing freshness: a tradable bucket strictly after the last row and <= endTs
  // means the cagg is lagging the live edge.
  if (!incomplete) {
    const last = cagg[cagg.length - 1].ts;
    const tailFrom = new Date(last.getTime() + TF_MS[tf]);
    if (tailFrom.getTime() <= endTs.getTime() && tradableBarStarts(tf, tailFrom, endTs, symbol).length > 0) {
      incomplete = true;
    }
  }

  if (!incomplete) return cagg;

  // Fallback: rollup the span covered by this lookback and take the last `count`.
  // queryRollup is end-inclusive; endTs is a bar OPEN (bucket start), so extend the
  // upper bound to the end of endTs's bucket or the final bucket collapses to a single
  // 1m row (partial edge bar). floorToTf(endTs)+tfMs-1ms captures the full last bucket.
  const tfMs = TF_MS[tf];
  const rollupEnd = new Date(floorToTf(endTs, tf).getTime() + tfMs - 1);
  const rollup = await queryRollup(pool, symbol, broker, tf, cagg[0].ts, rollupEnd);
  return rollup.slice(-count);
}
