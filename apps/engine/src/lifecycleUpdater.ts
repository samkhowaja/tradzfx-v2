/**
 * Incremental lifecycle updater.
 *
 * The feature engine computes lifecycle columns once against a bounded candle
 * window, so older rows can stay incorrectly fresh. This module refreshes the
 * most recent open lifecycle rows after each engine run.
 */

import type { Pool } from "@tm/shared";

export interface LifecycleUpdateResult {
  tableName: string;
  rowsUpdated: number;
}

export interface UpdateLifecycleOptions {
  /** Upper bound timestamp; defaults to NOW(). */
  asOf?: Date;
  /**
   * How far back from asOf to scan for open rows. Defaults to 10 days, which
   * comfortably covers the engine's 500-bar lookback on 15m/1h timeframes.
   */
  lookbackDays?: number;
  /**
   * Maximum number of open rows to examine per table per call. Keeping this
   * bounded makes the refresh fast enough to run live after every 15m boundary.
   */
  limit?: number;
}

/**
 * Refresh lifecycle columns for every lifecycle table for one symbol.
 * Only the most recent open rows within the lookback window are examined,
 * capped at `limit` per table.
 */
export async function updateLifecycleForSymbol(
  pool: Pool,
  symbol: string,
  opts: UpdateLifecycleOptions = {}
): Promise<LifecycleUpdateResult[]> {
  const asOf = opts.asOf ?? new Date();
  const lookbackDays = opts.lookbackDays ?? 10;
  const limit = opts.limit ?? 1000;
  const { rows } = await pool.query<LifecycleUpdateResult>(
    `SELECT * FROM refresh_lifecycle_for_symbol($1, $2, make_interval(days => $3), $4)`,
    [symbol, asOf, lookbackDays, limit]
  );
  return rows;
}

/**
 * Refresh lifecycle columns for every lifecycle table for all symbols that have
 * candle data. Use sparingly; this is intended for backfills.
 */
export async function updateLifecycleForAllSymbols(
  pool: Pool,
  opts: UpdateLifecycleOptions = {}
): Promise<{ symbol: string; results: LifecycleUpdateResult[] }[]> {
  const { rows } = await pool.query<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol`
  );

  const out: { symbol: string; results: LifecycleUpdateResult[] }[] = [];
  for (const { symbol } of rows) {
    const results = await updateLifecycleForSymbol(pool, symbol, opts);
    out.push({ symbol, results });
  }
  return out;
}
