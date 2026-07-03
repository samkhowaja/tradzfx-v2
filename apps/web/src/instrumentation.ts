/**
 * Next.js server instrumentation.
 * Starts a background scheduler that keeps the V2 feature engine and live
 * pipeline warm independent of MT4/MT5 bar ingestion.
 */

const SCHEDULER_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.TM_ENGINE_SCHEDULER_INTERVAL_MS ?? 60_000)
);
const SCHEDULER_ENABLED =
  process.env.TM_ENGINE_SCHEDULER_ENABLED !== "false";

async function runSchedulerTick() {
  if (!SCHEDULER_ENABLED) return;

  try {
    const { getPool } = await import("@tm/shared");
    const { checkAndTriggerAllActive } = await import("@/lib/pipelineTrigger");
    const pool = getPool();

    // Touch only symbols that have received a candle recently.
    const { rows } = await pool.query(
      `SELECT DISTINCT symbol
       FROM candles_1m
       WHERE ts >= NOW() - INTERVAL '10 minutes'
       ORDER BY symbol`
    );

    for (const { symbol } of rows) {
      try {
        await checkAndTriggerAllActive(symbol);
      } catch (err: any) {
        console.error(`[scheduler] Pipeline failed for ${symbol}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[scheduler] Tick failed:", err.message);
  }
}

export async function register() {
  if (!SCHEDULER_ENABLED) {
    console.log("[scheduler] Engine scheduler is disabled");
    return;
  }

  console.log(`[scheduler] Starting engine scheduler every ${SCHEDULER_INTERVAL_MS}ms`);

  // Run once shortly after startup, then on the interval.
  setTimeout(runSchedulerTick, 5_000);
  setInterval(runSchedulerTick, SCHEDULER_INTERVAL_MS);
}
