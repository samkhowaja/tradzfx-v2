"use strict";

const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const REPLAY_VERSION = "order-block-lifecycle-v1";

function parseArgs(argv) {
  const args = { symbol: null, batchSize: 250, dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--symbol=")) args.symbol = arg.slice(9).trim().toUpperCase();
    else if (arg.startsWith("--batch-size=")) args.batchSize = Number(arg.slice(13));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > 2000) {
    throw new Error("--batch-size must be an integer from 1 to 2000");
  }
  return args;
}

const REPLAY_SQL = `
WITH selected AS (
  SELECT e.event_id, e.symbol, e.formed_at, e.ob_kind, s.top, s.bottom
  FROM public.order_block_event_shadow e
  JOIN public.order_block_state_shadow s USING (event_id)
  WHERE e.event_id = ANY($1::bigint[])
), candle_penetration AS (
  SELECT x.event_id, c.ts,
         c.h >= x.bottom AND c.l <= x.top AS touched,
         CASE
           WHEN x.top <= x.bottom THEN 0::double precision
           WHEN x.ob_kind = 'bullish'
             THEN LEAST(1::double precision, GREATEST(0::double precision,
               (x.top - GREATEST(x.bottom, c.l)) / NULLIF(x.top - x.bottom, 0)))
           ELSE LEAST(1::double precision, GREATEST(0::double precision,
               (LEAST(x.top, c.h) - x.bottom) / NULLIF(x.top - x.bottom, 0)))
         END AS penetration,
         (x.ob_kind = 'bullish' AND c.c < x.bottom)
           OR (x.ob_kind = 'bearish' AND c.c > x.top) AS invalidated
  FROM selected x
  JOIN market.candles_1m_canonical c
    ON c.symbol = x.symbol AND c.ts > x.formed_at
), milestones AS (
  SELECT x.event_id, x.formed_at,
         MIN(c.ts) FILTER (WHERE c.touched) AS first_touch_at,
         MIN(c.ts) FILTER (WHERE c.touched AND c.penetration >= 0.5) AS fill_mitigation_at,
         MIN(c.ts) FILTER (WHERE c.invalidated) AS invalidated_at
  FROM selected x
  LEFT JOIN candle_penetration c USING (event_id)
  GROUP BY x.event_id, x.formed_at
), penetration_running AS (
  SELECT event_id, ts, touched, penetration,
         MAX(penetration) FILTER (WHERE touched) OVER (
           PARTITION BY event_id ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS running_fill
  FROM candle_penetration
), penetration_progress AS (
  SELECT event_id, ts
  FROM (
    SELECT event_id, ts, touched, running_fill,
           LAG(running_fill, 1, 0::double precision) OVER (PARTITION BY event_id ORDER BY ts) AS prior_fill
    FROM penetration_running
  ) p
  WHERE touched AND running_fill > prior_fill
), effective_points AS (
  SELECT event_id, formed_at AS effective_at FROM milestones
  UNION
  SELECT event_id, first_touch_at FROM milestones WHERE first_touch_at IS NOT NULL
  UNION
  SELECT event_id, ts FROM penetration_progress
  UNION
  SELECT event_id, COALESCE(fill_mitigation_at, invalidated_at)
  FROM milestones WHERE COALESCE(fill_mitigation_at, invalidated_at) IS NOT NULL
  UNION
  SELECT event_id, invalidated_at FROM milestones WHERE invalidated_at IS NOT NULL
), states AS (
  SELECT p.event_id, p.effective_at,
         CASE
           WHEN p.effective_at = m.invalidated_at THEN 'invalidation'
           WHEN p.effective_at = COALESCE(m.fill_mitigation_at, m.invalidated_at)
             THEN 'mitigation'
           WHEN p.effective_at = m.first_touch_at THEN 'first_touch'
           WHEN p.effective_at = m.formed_at THEN 'formation'
           ELSE 'fill_progress'
         END AS transition_kind,
         NOT (m.invalidated_at IS NOT NULL AND m.invalidated_at <= p.effective_at) AS is_fresh,
         CASE WHEN m.first_touch_at <= p.effective_at THEN m.first_touch_at END AS first_touch_at,
         COALESCE((
           SELECT MAX(c.penetration) FILTER (WHERE c.touched)
           FROM candle_penetration c
           WHERE c.event_id = p.event_id AND c.ts <= p.effective_at
         ), 0)::double precision AS fill_pct,
         CASE
           WHEN COALESCE(m.fill_mitigation_at, m.invalidated_at) <= p.effective_at
             THEN COALESCE(m.fill_mitigation_at, m.invalidated_at)
         END AS mitigated_at,
         CASE WHEN m.invalidated_at <= p.effective_at THEN m.invalidated_at END AS invalidated_at
  FROM effective_points p
  JOIN milestones m USING (event_id)
), deleted AS (
  DELETE FROM public.order_block_lifecycle_replay_shadow
  WHERE event_id = ANY($1::bigint[])
)
INSERT INTO public.order_block_lifecycle_replay_shadow (
  event_id, effective_at, transition_kind, is_fresh, first_touch_at,
  fill_pct, mitigated_at, invalidated_at, replay_version
)
SELECT event_id, effective_at, transition_kind, is_fresh, first_touch_at,
       fill_pct, mitigated_at, invalidated_at, $2
FROM states
ORDER BY event_id, effective_at
ON CONFLICT (event_id, effective_at) DO UPDATE SET
  transition_kind = EXCLUDED.transition_kind,
  is_fresh = EXCLUDED.is_fresh,
  first_touch_at = EXCLUDED.first_touch_at,
  fill_pct = EXCLUDED.fill_pct,
  mitigated_at = EXCLUDED.mitigated_at,
  invalidated_at = EXCLUDED.invalidated_at,
  replayed_at = clock_timestamp(),
  replay_version = EXCLUDED.replay_version
RETURNING event_id`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool(getDbConfig({
    max: 1,
    statement_timeout: 0,
    application_name: "order-block-lifecycle-replay",
  }));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (args.dryRun) await client.query("SET TRANSACTION READ ONLY");
    const selectEvents = async (missingOnly) => client.query(
      `SELECT e.event_id
       FROM public.order_block_event_shadow e
       JOIN public.order_block_state_shadow s USING (event_id)
       WHERE ($1::text IS NULL OR e.symbol = $1)
         AND (NOT $2::boolean OR NOT EXISTS (
           SELECT 1 FROM public.order_block_lifecycle_replay_shadow r
           WHERE r.event_id = e.event_id AND r.replay_version = $3
         ))
       ORDER BY e.event_id`,
      [args.symbol, missingOnly, REPLAY_VERSION]
    );
    const initial = await selectEvents(false);
    let written = 0;
    let events = initial.rows.length;
    let rows = initial.rows;
    let pass = 0;
    if (!args.dryRun) {
      while (rows.length > 0) {
        pass++;
        if (pass > 10) throw new Error("Replay catch-up did not stabilize within 10 passes");
        for (let i = 0; i < rows.length; i += args.batchSize) {
          const ids = rows.slice(i, i + args.batchSize).map((row) => row.event_id);
          const result = await client.query(REPLAY_SQL, [ids, REPLAY_VERSION]);
          written += result.rowCount ?? 0;
        }
        const catchUp = await selectEvents(true);
        rows = catchUp.rows;
        events += rows.length;
      }
    }
    if (args.dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    console.log(JSON.stringify({ events, rowsWritten: written, passes: pass, dryRun: args.dryRun, replayVersion: REPLAY_VERSION }));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, REPLAY_SQL, REPLAY_VERSION };
