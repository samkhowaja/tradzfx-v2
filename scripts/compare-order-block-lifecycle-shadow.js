"use strict";

const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

async function main() {
  const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 60000, application_name: "order-block-lifecycle-compare" }));
  try {
    await pool.query("BEGIN READ ONLY");
    const summary = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (event_id) *
        FROM public.order_block_lifecycle_replay_shadow
        ORDER BY event_id, effective_at DESC
      )
      SELECT count(*)::int AS events,
             count(*) FILTER (WHERE r.event_id IS NULL)::int AS missing_replay,
             count(*) FILTER (WHERE r.event_id IS NOT NULL AND
               (s.is_fresh, s.first_touch_at, s.mitigated_at, s.invalidated_at)
               IS DISTINCT FROM
               (r.is_fresh, r.first_touch_at, r.mitigated_at, r.invalidated_at))::int AS lifecycle_mismatches,
             count(*) FILTER (WHERE r.event_id IS NOT NULL AND abs(s.fill_pct - r.fill_pct) > 1e-9)::int AS fill_mismatches
      FROM public.order_block_state_shadow s
      LEFT JOIN latest r USING (event_id)`);
    const integrity = await pool.query(`
      SELECT count(*) FILTER (WHERE effective_at < e.formed_at)::int AS before_formation,
             count(*) FILTER (WHERE first_touch_at > effective_at)::int AS future_touch,
             count(*) FILTER (WHERE mitigated_at > effective_at)::int AS future_mitigation,
             count(*) FILTER (WHERE invalidated_at > effective_at)::int AS future_invalidation,
             count(*) FILTER (WHERE effective_at <= lag_effective)::int AS non_monotonic,
             count(*)::int AS replay_rows
      FROM (
        SELECT r.*, lag(effective_at) OVER (PARTITION BY event_id ORDER BY effective_at) AS lag_effective
        FROM public.order_block_lifecycle_replay_shadow r
      ) r
      JOIN public.order_block_event_shadow e USING (event_id)`);
    const kinds = await pool.query(`
      SELECT transition_kind, count(*)::int AS rows
      FROM public.order_block_lifecycle_replay_shadow
      GROUP BY transition_kind ORDER BY transition_kind`);
    await pool.query("ROLLBACK");
    console.log(JSON.stringify({ summary: summary.rows[0], integrity: integrity.rows[0], kinds: kinds.rows }, null, 2));
    const bad = summary.rows[0].missing_replay || integrity.rows[0].before_formation ||
      integrity.rows[0].future_touch || integrity.rows[0].future_mitigation ||
      integrity.rows[0].future_invalidation || integrity.rows[0].non_monotonic;
    if (bad) process.exitCode = 1;
  } catch (error) {
    try { await pool.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
