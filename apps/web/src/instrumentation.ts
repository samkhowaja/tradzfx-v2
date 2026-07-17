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

    // Touch every symbol with an active live variant, regardless of candle
    // freshness. This decouples pipeline scheduling from ingestion liveness
    // so a temporary DB blip does not stall the pipeline for hours.
    const { rows } = await pool.query(
      `SELECT DISTINCT UNNEST(v.symbols) AS symbol
       FROM strategy_variants v
       JOIN strategy_families f ON f.id = v.family_id
       WHERE v.is_active = true
         AND f.is_archived = false
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
