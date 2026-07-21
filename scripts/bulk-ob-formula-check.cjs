"use strict";
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
async function main() {
  const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 300000 }));
  try {
    await pool.query("BEGIN READ ONLY");
    const r = await pool.query(`
      WITH event_base AS (
        SELECT e.event_id, e.symbol, e.formed_at, e.ob_kind,
               s.top, s.bottom
        FROM public.order_block_event_shadow e
        JOIN public.order_block_state_shadow s USING (event_id)
        WHERE s.top IS NOT NULL AND s.bottom IS NOT NULL
      ), drain AS (
        SELECT e.event_id,
               MIN(c.ts) FILTER (WHERE c.h >= e.bottom AND c.l <= e.top) AS drain_touch,
               COALESCE(MAX(CASE
                 WHEN e.top <= e.bottom THEN 0
                 WHEN e.ob_kind = 'bullish'
                   THEN LEAST(1, GREATEST(0, (e.top - GREATEST(e.bottom, c.l)) / NULLIF(e.top - e.bottom, 0)))
                 ELSE LEAST(1, GREATEST(0, (LEAST(e.top, c.h) - e.bottom) / NULLIF(e.top - e.bottom, 0)))
               END) FILTER (WHERE c.h >= e.bottom AND c.l <= e.top), 0) AS drain_fill,
               COALESCE(
                 MIN(c.ts) FILTER (WHERE c.h >= e.bottom AND c.l <= e.top
                   AND CASE WHEN e.ob_kind = 'bullish'
                     THEN (e.top - GREATEST(e.bottom, c.l)) / NULLIF(e.top - e.bottom, 0) >= 0.5
                     ELSE (LEAST(e.top, c.h) - e.bottom) / NULLIF(e.top - e.bottom, 0) >= 0.5
                   END),
                 MIN(c.ts) FILTER (WHERE (e.ob_kind='bullish' AND c.c<e.bottom) OR (e.ob_kind='bearish' AND c.c>e.top))
               ) AS drain_mit,
               MIN(c.ts) FILTER (WHERE (e.ob_kind='bullish' AND c.c<e.bottom) OR (e.ob_kind='bearish' AND c.c>e.top)) AS drain_inv,
               MIN(c.ts) FILTER (WHERE (e.ob_kind='bullish' AND c.c<e.bottom) OR (e.ob_kind='bearish' AND c.c>e.top)) IS NULL AS drain_fresh
        FROM event_base e
        JOIN market.candles_1m_canonical c ON c.symbol = e.symbol AND c.ts > e.formed_at
        GROUP BY e.event_id
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE (drain_touch, drain_fill, drain_mit, drain_inv, drain_fresh)
          IS NOT DISTINCT FROM (r.first_touch_at, r.fill_pct, r.mitigated_at, r.invalidated_at, r.is_fresh))::int AS drain_eq_replay,
        count(*) FILTER (WHERE (drain_touch, drain_fill, drain_mit, drain_inv, drain_fresh)
          IS NOT DISTINCT FROM (r.first_touch_at, r.fill_pct, r.mitigated_at, r.invalidated_at, r.is_fresh))::int AS drain_eq_replay,
        count(*) FILTER (WHERE (drain_touch, drain_fill, drain_mit, drain_inv, drain_fresh)
          IS DISTINCT FROM (r.first_touch_at, r.fill_pct, r.mitigated_at, r.invalidated_at, r.is_fresh))::int AS drain_ne_replay,
        count(*) FILTER (WHERE r.first_touch_at IS NULL AND r.fill_pct IS NULL)::int AS missing_replay
      FROM drain d
      LEFT JOIN LATERAL (
        SELECT r.first_touch_at, r.fill_pct, r.mitigated_at, r.invalidated_at, r.is_fresh
        FROM public.order_block_lifecycle_replay_shadow r
        WHERE r.event_id = d.event_id
        ORDER BY r.effective_at DESC LIMIT 1
      ) r ON TRUE
    `);
    console.log(JSON.stringify(r.rows[0]));
    await pool.query("ROLLBACK");
  } catch(e) { console.error("ERROR:", e.message); process.exit(1); }
  finally { await pool.end(); }
}
main();
