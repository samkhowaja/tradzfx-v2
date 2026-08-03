import { validateCandleEligibility, type Pool, type TimeFrame } from "@tm/shared";
import { DAGRunner } from "../index";
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
  "features_volatility_normalized",
  "features_pivot",
  "features_structure",
  "features_sweep",
  "features_liquidity_pools",
  "features_zone",
  "features_pricing",
  "features_bias",
  "features_session",
  "features_time_of_day_edge",
  "features_displacement",
  "features_indicator",
  "features_session_hl",
  "features_opening_range",
  "features_candle_pattern",
  "features_moving_average",
  "features_bollinger",
  "features_keltner",
  "features_ifvg",
  "features_order_block",
  "features_eq_liquidity",
  "features_htf_bias",
  "features_direction_state",
  "features_spread",
  "features_zone_retest",
  "features_push_pull",
];

/**
 * Claim one pending feature job from the queue in an atomic UPDATE ... RETURNING.
 * Only claims jobs whose feature_name is in requestedFeatures.
 */
async function claimJob(pool: Pool, requestedFeatures: string[]): Promise<FeatureJob | null> {
  const placeholders = requestedFeatures.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await pool.query<FeatureJob>(
    `UPDATE feature_jobs
     SET status = 'processing', processed_at = NOW()
     WHERE id = (
       SELECT fj.id
       FROM feature_jobs fj
       JOIN ops.feature_pipeline_symbols u
         ON u.symbol = fj.symbol
        AND u.enabled = true
        AND fj.tf = ANY(u.required_timeframes)
        AND u.required_feature_profile = 'live-complete'
        AND u.profile_version = 1
       WHERE fj.status = 'pending'
         AND fj.feature_name IN (${placeholders})
         AND (fj.feature_name <> 'features_spread' OR fj.tf = '1m')
       ORDER BY fj.created_at ASC, fj.id ASC
       FOR UPDATE OF fj SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, symbol, tf, ts, feature_name`,
    requestedFeatures
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

async function markBlocked(pool: Pool, jobId: number, reason: string, endTs: Date): Promise<void> {
  await pool.query(
    `UPDATE feature_jobs SET status = 'blocked', blocked_reason = $2,
            input_end_ts = $3, processed_at = NOW() WHERE id = $1`,
    [jobId, reason, endTs]
  );
}

async function validateInputCandles(pool: Pool, symbol: string, endTs: Date, lookbackBars: number): Promise<void> {
  const { rows } = await pool.query<{ broker: string; ts: Date }>(
    `SELECT c.broker, c.ts
       FROM candles_1m c
       JOIN LATERAL (
         SELECT 1 FROM raw.symbol_broker_policy p
          WHERE p.symbol=c.symbol AND p.broker_id=c.broker
            AND p.effective_from <= c.ts
            AND (p.effective_to IS NULL OR c.ts < p.effective_to)
          ORDER BY p.priority ASC,p.effective_from DESC,p.policy_id DESC LIMIT 1
       ) policy ON true
      WHERE c.symbol=$1 AND c.ts <= $2
      ORDER BY c.ts DESC LIMIT $3`,
    [symbol, endTs, lookbackBars]
  );
  for (const row of rows) {
    const state = await validateCandleEligibility(pool, { symbol, broker: row.broker, timeframe: "1m", ts: row.ts });
    if (state !== "CLEAN") {
      throw new Error(`BLOCKED_DATA:CANONICAL_CANDLES_BLOCKED:${state}:${symbol}:${row.ts.toISOString()}`);
    }
  }
  const { rows: canonicalRows } = await pool.query<{ ts: Date }>(
    `SELECT ts FROM market.candles_1m_canonical
      WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT $3`,
    [symbol, endTs, lookbackBars]
  );
  if (canonicalRows.length === 0) {
    throw new Error(`BLOCKED_DATA:CANONICAL_CANDLES_MISSING:${symbol}:1m:${endTs.toISOString()}`);
  }
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

    const job = await claimJob(pool, requestedFeatures);
    if (!job) {
      if (once) break;
      idleStreak++;
      await sleep(pollIntervalMs);
      continue;
    }

    idleStreak = 0;
    const start = performance.now();
    try {
      await validateInputCandles(pool, job.symbol, job.ts, lookbackBars);
      await runner.run({
        symbol: job.symbol,
        tf: job.tf,
        endTs: job.ts,
        requestedFeatures: [job.feature_name],
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
      const message = err.message ?? String(err);
      if (message.startsWith("BLOCKED_DATA:")) {
        await markBlocked(pool, job.id, message.slice("BLOCKED_DATA:".length), job.ts);
      } else {
        await markError(pool, job.id, message);
      }
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
