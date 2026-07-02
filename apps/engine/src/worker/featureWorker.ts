import type { Pool, TimeFrame } from "@tm/shared";
import { DAGRunner } from "../dag/runner";
import { updateLifecycleForSymbol } from "../lifecycleUpdater";

export interface FeatureWorkerOptions {
  /** How often to poll the queue (ms). */
  pollIntervalMs?: number;
  /** How many jobs to process before stopping (infinite if undefined). */
  maxJobs?: number;
  /** Number of candles to feed into each feature computation. */
  lookbackBars?: number;
  /** Features to compute for each claimed job. Defaults to all registered features. */
  requestedFeatures?: string[];
  /** Set false to keep the worker polling forever. */
  once?: boolean;
}

interface FeatureJob {
  id: number;
  symbol: string;
  tf: TimeFrame;
  ts: Date;
  feature_name: string;
}

const DEFAULT_REQUESTED_FEATURES: string[] = [
  "features_atr",
  "features_pivot",
  "features_structure",
  "features_sweep",
  "features_zone",
  "features_pricing",
  "features_bias",
  "features_session",
  "features_displacement",
  "features_indicator",
  "features_session_hl",
  "features_opening_range",
  "features_candle_pattern",
  "features_ema_cross",
  "features_moving_average",
  "features_bollinger",
  "features_keltner",
  "features_ifvg",
  "features_order_block",
  "features_eq_liquidity",
  "features_htf_bias",
  "features_spread",
];

/**
 * Claim one pending feature job from the queue in an atomic UPDATE ... RETURNING.
 */
async function claimJob(pool: Pool): Promise<FeatureJob | null> {
  const { rows } = await pool.query<FeatureJob>(
    `UPDATE feature_jobs
     SET status = 'processing', processed_at = NOW()
     WHERE id = (
       SELECT id FROM feature_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, symbol, tf, ts, feature_name`,
    []
  );
  return rows[0] ?? null;
}

async function markDone(pool: Pool, jobId: number): Promise<void> {
  await pool.query(
    `UPDATE feature_jobs SET status = 'done', processed_at = NOW() WHERE id = $1`,
    [jobId]
  );
}

async function markError(pool: Pool, jobId: number, message: string): Promise<void> {
  await pool.query(
    `UPDATE feature_jobs SET status = 'error', error_message = $2, processed_at = NOW() WHERE id = $1`,
    [jobId, message]
  );
}

/**
 * Poll-and-process loop for incremental feature jobs.
 */
export async function runFeatureWorker(
  pool: Pool,
  opts: FeatureWorkerOptions = {}
): Promise<void> {
  const {
    pollIntervalMs = 1000,
    maxJobs,
    lookbackBars = 500,
    requestedFeatures = DEFAULT_REQUESTED_FEATURES,
    once = false,
  } = opts;

  const runner = new DAGRunner(pool);
  let processed = 0;
  let idleStreak = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (maxJobs != null && processed >= maxJobs) break;

    const job = await claimJob(pool);
    if (!job) {
      if (once) break;
      idleStreak++;
      await sleep(pollIntervalMs);
      continue;
    }

    idleStreak = 0;
    const start = performance.now();
    try {
      await runner.run({
        symbol: job.symbol,
        tf: job.tf,
        endTs: job.ts,
        requestedFeatures,
        lookbackBars,
        batchInserts: true,
        skipLifecycle: true,
      });

      // Refresh lifecycle columns for the symbol we just updated.
      await updateLifecycleForSymbol(pool, job.symbol, {
        asOf: job.ts,
        lookbackDays: 10,
        limit: 10000,
      });

      await markDone(pool, job.id);
      const elapsed = performance.now() - start;
      console.log(
        `[featureWorker] ${job.symbol} ${job.tf} ${job.ts.toISOString()} (${job.feature_name}) in ${elapsed.toFixed(1)}ms`
      );
    } catch (err: any) {
      await markError(pool, job.id, err.message ?? String(err));
      console.error(
        `[featureWorker] ${job.symbol} ${job.tf} ${job.ts.toISOString()} failed:`,
        err.message
      );
    }
    processed++;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
