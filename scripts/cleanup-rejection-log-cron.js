/**
 * Rejection-log retention cron.
 *
 * Deletes rows from live_signal_rejection older than REJECTION_LOG_RETENTION_DAYS
 * (default 7). Runs on a configurable interval (default 1h).
 *
 * 35k rows / 10 days ≈ 3.5k/day ≈ 1.8 MB/day. At 7-day retention the table
 * stays under 15 MB. Without cleanup, it grows unbounded and slows the
 * dashboard rejections endpoint.
 *
 * Managed by PM2 via ecosystem.config.js.
 */

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST ?? "localhost",
  port: Number(process.env.TM_DB_PORT ?? 5432),
  database: process.env.TM_DB_NAME ?? "tradzfx_v2",
  user: process.env.TM_DB_USER ?? "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: process.env.TM_DB_APPLICATION_NAME ?? "tradzfx-cleanup-rejections",
  max: Number(process.env.TM_DB_POOL_MAX ?? 2),
  connectionTimeoutMillis: Number(process.env.TM_DB_CONNECTION_TIMEOUT ?? 5000),
  idleTimeoutMillis: Number(process.env.TM_DB_IDLE_TIMEOUT ?? 30000),
});

const INTERVAL_MS = Number(process.env.CLEANUP_REJECTION_LOG_INTERVAL_MS ?? 3_600_000); // 1h
const RETENTION_DAYS = Number(process.env.REJECTION_LOG_RETENTION_DAYS ?? 7);

async function deleteOldRejections() {
  const { rowCount } = await pool.query(
    `DELETE FROM live_signal_rejection
     WHERE created_at < NOW() - ($1::text || ' days')::INTERVAL`,
    [String(RETENTION_DAYS)]
  );
  if (rowCount > 0) {
    console.log(`[cleanup-rejection-log] Deleted ${rowCount} rows older than ${RETENTION_DAYS} days`);
  }
}

async function runLoop() {
  console.log(
    `[cleanup-rejection-log] Started — interval=${INTERVAL_MS}ms, retention=${RETENTION_DAYS}d`
  );

  // Run once immediately, then on interval.
  try {
    await deleteOldRejections();
  } catch (err) {
    console.error("[cleanup-rejection-log] Initial run failed:", err.message);
  }

  setInterval(async () => {
    try {
      await deleteOldRejections();
    } catch (err) {
      console.error("[cleanup-rejection-log] Run failed:", err.message);
    }
  }, INTERVAL_MS);
}

runLoop().catch((err) => {
  console.error("[cleanup-rejection-log] Fatal:", err.message);
  process.exit(1);
});
