/**
 * feature_producer_runs ledger + freshness assertions (P0-C, skeleton SK-36/52/56).
 *
 * Producers (engine compute, lifecycle refresh, ingestion) call
 * `recordProducerRun` after a unit of work so the system can answer
 * "who last produced <feature_table> for <symbol>@<tf>, and is it within SLA?"
 *
 * `assertProducerFresh` is the read side: it checks the ledger (and, for level
 * features, `lifecycle_refresh_state`) so a feature table with rows but a dead
 * producer is detected — closing the gap where health read only MAX(ts).
 */

import type { Queryable } from "../utils/db";
import { isTradableInstant, getLatestTradableCandle } from "../utils/marketCalendar";
import type { TimeFrame } from "../types/feature";

export type ProducerName = "engine" | "lifecycle" | "ingestion";

export interface ProducerRunRow {
  producer: ProducerName;
  feature_table: string;
  symbol: string;
  tf?: string | null;
  source_min_ts?: Date | null;
  source_max_ts?: Date | null;
  rows_seen?: number | null;
  rows_inserted?: number | null;
  rows_updated?: number | null;
  rows_invalidated?: number | null;
  status?: "running" | "done" | "error";
  error_message?: string | null;
  producer_version?: string | null;
  watermark_ts?: Date | null;
  quality_json?: Record<string, unknown> | null;
}

/**
 * Insert one completed (or running) producer-run row. Best-effort: callers
 * should wrap in try/catch so a ledger failure never fails the producer.
 * Returns the new run_id, or null if the insert failed.
 */
export async function recordProducerRun(
  pool: Queryable,
  row: ProducerRunRow
): Promise<number | null> {
  const status = row.status ?? "done";
  const finished = status === "running" ? null : new Date();
  try {
    const { rows } = await pool.query(
      `INSERT INTO feature_producer_runs
         (producer, feature_table, symbol, tf, source_min_ts, source_max_ts,
          rows_seen, rows_inserted, rows_updated, rows_invalidated,
          finished_at, status, error_message, producer_version, watermark_ts, quality_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING run_id`,
      [
        row.producer,
        row.feature_table,
        row.symbol,
        row.tf ?? null,
        row.source_min_ts ?? null,
        row.source_max_ts ?? null,
        row.rows_seen ?? null,
        row.rows_inserted ?? null,
        row.rows_updated ?? null,
        row.rows_invalidated ?? null,
        finished,
        status,
        row.error_message ?? null,
        row.producer_version ?? null,
        row.watermark_ts ?? null,
        row.quality_json ? JSON.stringify(row.quality_json) : null,
      ]
    );
    const r = rows[0] as { run_id?: number } | undefined;
    return r?.run_id ?? null;
  } catch {
    return null;
  }
}

export interface ProducerFreshnessResult {
  fresh: boolean;
  ageMinutes: number | null;
  lastFinishedAt: Date | null;
  watermarkTs: Date | null;
  lifecycleAgeMinutes: number | null;
  reason?: string;
}

/**
 * Is the producer for (feature_table, symbol@tf) within maxAgeMinutes?
 * For level features (`crossCheckLifecycle: true`) the lifecycle refresh cursor
 * (`lifecycle_refresh_state.last_processed_ts`) must ALSO be within the window —
 * this is the check that catches the XAUUSD death-spiral where MAX(ts) of the
 * level table looked fresh while invalidation had not run for weeks.
 *
 * No ledger row yet (producers just instrumented) → treated as unknown/fresh so
 * the gate does not block during the initial rollout before runs accumulate.
 */
export async function assertProducerFresh(
  pool: Queryable,
  opts: {
    symbol: string;
    feature_table: string;
    tf?: string | null;
    maxAgeMinutes: number;
    producer?: ProducerName;
    crossCheckLifecycle?: boolean;
  }
): Promise<ProducerFreshnessResult> {
  const { symbol, feature_table, tf, maxAgeMinutes, producer, crossCheckLifecycle } = opts;
  let lastFinishedAt: Date | null = null;
  let watermarkTs: Date | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT finished_at, watermark_ts, status, error_message FROM feature_producer_runs
       WHERE symbol = $1 AND feature_table = $2
         AND ($3::text IS NULL OR tf = $3)
         AND ($4::text IS NULL OR producer = $4)
       ORDER BY COALESCE(finished_at, started_at) DESC, run_id DESC
       LIMIT 1`,
      [symbol, feature_table, tf ?? null, producer ?? null]
    );
    const r = rows[0] as { finished_at?: string; watermark_ts?: string; status?: string; error_message?: string } | undefined;
    lastFinishedAt = r?.finished_at ? new Date(r.finished_at) : null;
    watermarkTs = r?.watermark_ts ? new Date(r.watermark_ts) : null;
    if (r?.status && r.status !== "done") {
      return {
        fresh: false,
        ageMinutes: null,
        lastFinishedAt,
        watermarkTs,
        lifecycleAgeMinutes: null,
        reason: `BLOCKED_PRODUCER_ERROR: ${feature_table}@${tf ?? "*"} latest run ${r.status}${r.error_message ? `: ${r.error_message}` : ""}`,
      };
    }
  } catch {
    // Query failed (e.g. DB connection error). Fail-closed: return not fresh so
    // the producer freshness gate can block trades during a DB outage rather than
    // silently passing everything (which would let trades through on stale features).
    return { fresh: false, ageMinutes: null, lastFinishedAt: null, watermarkTs: null, lifecycleAgeMinutes: null, reason: "BLOCKED_PRODUCER_QUERY_FAILED: could not query feature_producer_runs" };
  }

  const now = Date.now();
  const ageMinutes = lastFinishedAt ? (now - lastFinishedAt.getTime()) / 60000 : null;

  let lifecycleAgeMinutes: number | null = null;
  if (crossCheckLifecycle) {
    try {
      const { rows } = await pool.query(
        `SELECT last_processed_ts FROM lifecycle_refresh_state
         WHERE table_name = $1 AND symbol = $2`,
        [feature_table, symbol]
      );
      const r = rows[0] as { last_processed_ts?: string } | undefined;
      const lts = r?.last_processed_ts ? new Date(r.last_processed_ts) : null;
      lifecycleAgeMinutes = lts ? (now - lts.getTime()) / 60000 : null;
    } catch {
      lifecycleAgeMinutes = null;
    }
  }

  if (lastFinishedAt == null) {
    return { fresh: true, ageMinutes: null, lastFinishedAt: null, watermarkTs, lifecycleAgeMinutes };
  }

  if (ageMinutes != null && ageMinutes > maxAgeMinutes) {
    return {
      fresh: false, ageMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes,
      reason: `BLOCKED_PRODUCER_STALE: ${feature_table}@${tf ?? "*"} producer age ${ageMinutes.toFixed(0)}m > ${maxAgeMinutes}m`,
    };
  }
  if (crossCheckLifecycle && lifecycleAgeMinutes != null && lifecycleAgeMinutes > maxAgeMinutes) {
    return {
      fresh: false, ageMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes,
      reason: `BLOCKED_PRODUCER_STALE: ${feature_table}@${tf ?? "*"} lifecycle age ${lifecycleAgeMinutes.toFixed(0)}m > ${maxAgeMinutes}m`,
    };
  }
  return { fresh: true, ageMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes };
}

/**
 * Freshness check against the latest TRADABLE candle (not raw MAX(ts)).
 * This prevents weekend candles from making features appear stale when markets are closed.
 * Uses marketCalendar.isTradableInstant to find the latest tradable bucket.
 */
export async function assertProducerFreshTradable(
  pool: Queryable,
  opts: {
    symbol: string;
    feature_table: string;
    tf?: string | null;
    maxAgeMinutes: number;
    producer?: ProducerName;
    crossCheckLifecycle?: boolean;
  }
): Promise<ProducerFreshnessResult> {
  const { symbol, feature_table, tf, maxAgeMinutes, producer, crossCheckLifecycle } = opts;
  
  // First check the producer ledger (same as assertProducerFresh)
  let lastFinishedAt: Date | null = null;
  let watermarkTs: Date | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT finished_at, watermark_ts FROM feature_producer_runs
       WHERE symbol = $1 AND feature_table = $2
         AND ($3::text IS NULL OR tf = $3)
         AND ($4::text IS NULL OR producer = $4)
         AND status = 'done'
       ORDER BY finished_at DESC NULLS LAST
       LIMIT 1`,
      [symbol, feature_table, tf ?? null, producer ?? null]
    );
    const r = rows[0] as { finished_at?: string; watermark_ts?: string } | undefined;
    lastFinishedAt = r?.finished_at ? new Date(r.finished_at) : null;
    watermarkTs = r?.watermark_ts ? new Date(r.watermark_ts) : null;
  } catch {
    return { fresh: true, ageMinutes: null, lastFinishedAt: null, watermarkTs: null, lifecycleAgeMinutes: null };
  }

  const now = Date.now();
  const ageMinutes = lastFinishedAt ? (now - lastFinishedAt.getTime()) / 60000 : null;

  let lifecycleAgeMinutes: number | null = null;
  if (crossCheckLifecycle) {
    try {
      const { rows } = await pool.query(
        `SELECT last_processed_ts FROM lifecycle_refresh_state
         WHERE table_name = $1 AND symbol = $2`,
        [feature_table, symbol]
      );
      const r = rows[0] as { last_processed_ts?: string } | undefined;
      const lts = r?.last_processed_ts ? new Date(r.last_processed_ts) : null;
      lifecycleAgeMinutes = lts ? (now - lts.getTime()) / 60000 : null;
    } catch {
      lifecycleAgeMinutes = null;
    }
  }

  if (lastFinishedAt == null) {
    return { fresh: true, ageMinutes: null, lastFinishedAt: null, watermarkTs, lifecycleAgeMinutes };
  }

  // Check if the producer's watermark is within the tradable window
  // If the watermark is on a weekend, it's not actually stale
  if (watermarkTs) {
    const { isTradableInstant } = await import('../utils/marketCalendar.js');
    if (!isTradableInstant(watermarkTs, symbol)) {
      // Watermark is on a non-tradable instant (weekend/holiday)
      // Find the latest tradable instant before the watermark
      const { getLatestTradableCandle } = await import('../utils/marketCalendar.js');
      const latestTradable = await getLatestTradableCandle(pool, symbol, (tf as any) || '1m', 7);
      if (latestTradable) {
        const tradableAgeMinutes = (now - latestTradable.getTime()) / 60000;
        if (tradableAgeMinutes > maxAgeMinutes) {
          return {
            fresh: false, ageMinutes: tradableAgeMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes,
            reason: `BLOCKED_PRODUCER_STALE: ${feature_table}@${tf ?? "*"} tradable age ${tradableAgeMinutes.toFixed(0)}m > ${maxAgeMinutes}m`,
          };
        }
        // Watermark is on weekend but tradable time is fresh
        return { fresh: true, ageMinutes: tradableAgeMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes };
      }
    }
  }

  if (ageMinutes != null && ageMinutes > maxAgeMinutes) {
    return {
      fresh: false, ageMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes,
      reason: `BLOCKED_PRODUCER_STALE: ${feature_table}@${tf ?? "*"} producer age ${ageMinutes.toFixed(0)}m > ${maxAgeMinutes}m`,
    };
  }
  if (crossCheckLifecycle && lifecycleAgeMinutes != null && lifecycleAgeMinutes > maxAgeMinutes) {
    return {
      fresh: false, ageMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes,
      reason: `BLOCKED_PRODUCER_STALE: ${feature_table}@${tf ?? "*"} lifecycle age ${lifecycleAgeMinutes.toFixed(0)}m > ${maxAgeMinutes}m`,
    };
  }
  return { fresh: true, ageMinutes, lastFinishedAt, watermarkTs, lifecycleAgeMinutes };
}
