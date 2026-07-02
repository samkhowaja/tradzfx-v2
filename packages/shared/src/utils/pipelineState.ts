/**
 * Distributed pipeline trigger checkpoint.
 *
 * Replaces the per-process `lastProcessed` Map so multiple server processes can
 * agree on whether a given 15m bucket has already been processed.
 */

import type { Pool } from "./db";

export interface PipelineState {
  symbol: string;
  bucket: number;
  updatedAt: Date;
}

/**
 * Attempt to claim a bucket for a symbol. Returns true only if this call was
 * the first to advance the stored bucket (or create the row).
 */
export async function acquirePipelineBucket(
  pool: Pool,
  symbol: string,
  bucket: number
): Promise<boolean> {
  try {
    // Insert-only acquisition keyed by (symbol, bucket). The unique index
    // idx_pipeline_trigger_state_symbol_bucket guarantees that only the first
    // transaction to claim this exact bucket returns a row; all concurrent or
    // duplicate attempts are silently ignored.
    const { rows } = await pool.query<{ bucket: number; updated_at: Date }>(
      `INSERT INTO pipeline_trigger_state (symbol, bucket, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (symbol, bucket) DO NOTHING
       RETURNING bucket, updated_at`,
      [symbol, bucket]
    );
    const acquired = rows.length > 0;
    if (acquired) {
      // Keep the lock table small: retain the current bucket and any buckets
      // from the last 24 hours, but remove older history for this symbol.
      pool.query(
        `DELETE FROM pipeline_trigger_state
         WHERE symbol = $1 AND bucket < $2::bigint - 86400000`,
        [symbol, bucket]
      ).catch((err) => {
        console.warn(`[pipelineState] Cleanup failed for ${symbol}:`, err.message);
      });
    }
    return acquired;
  } catch (err: any) {
    console.error(`[pipelineState] Failed to acquire bucket for ${symbol}:`, err.message);
    // Fail-closed: if we cannot verify the bucket was claimed, do not trigger
    // the pipeline. This prevents duplicate runs when the checkpoint table is
    // missing or the DB is unreachable.
    return false;
  }
}

/**
 * Read the currently stored bucket for a symbol, or 0 if none exists.
 */
export async function getPipelineBucket(
  pool: Pool,
  symbol: string
): Promise<number> {
  try {
    // With the composite (symbol, bucket) lock there may be multiple rows per
    // symbol; the latest processed bucket is the highest value.
    const { rows } = await pool.query<{ bucket: number }>(
      `SELECT MAX(bucket) AS bucket FROM pipeline_trigger_state WHERE symbol = $1`,
      [symbol]
    );
    return rows[0]?.bucket ?? 0;
  } catch (err: any) {
    console.warn(`[pipelineState] Failed to read bucket for ${symbol}:`, err.message);
    return 0;
  }
}

/**
 * Release/reset a symbol's checkpoint. Useful for backfills and tests.
 */
export async function resetPipelineBucket(
  pool: Pool,
  symbol: string
): Promise<void> {
  await pool.query(
    `DELETE FROM pipeline_trigger_state WHERE symbol = $1`,
    [symbol]
  );
}
