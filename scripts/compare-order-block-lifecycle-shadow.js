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
    const mismatchBreakdown = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (event_id) *
        FROM public.order_block_lifecycle_replay_shadow
        ORDER BY event_id, effective_at DESC
      ), differences AS (
        SELECT e.symbol, e.tf, s.engine_ver,
               floor(extract(epoch FROM (clock_timestamp() - e.formed_at)) / 86400)::int AS age_days,
               s.is_fresh IS DISTINCT FROM r.is_fresh AS fresh_diff,
               s.first_touch_at IS DISTINCT FROM r.first_touch_at AS touch_diff,
               s.mitigated_at IS DISTINCT FROM r.mitigated_at AS mitigation_diff,
               s.invalidated_at IS DISTINCT FROM r.invalidated_at AS invalidation_diff,
               abs(s.fill_pct - r.fill_pct) > 1e-9 AS fill_diff
        FROM public.order_block_state_shadow s
        JOIN public.order_block_event_shadow e USING (event_id)
        JOIN latest r USING (event_id)
      )
      SELECT symbol, tf, engine_ver,
             CASE WHEN age_days < 10 THEN '00-09d'
                  WHEN age_days < 30 THEN '10-29d'
                  WHEN age_days < 60 THEN '30-59d'
                  WHEN age_days < 90 THEN '60-89d'
                  ELSE '90d+' END AS age_bucket,
             count(*) FILTER (WHERE fresh_diff OR touch_diff OR mitigation_diff OR invalidation_diff)::int AS lifecycle_mismatches,
             count(*) FILTER (WHERE fill_diff)::int AS fill_mismatches,
             count(*) FILTER (WHERE touch_diff)::int AS touch_mismatches,
             count(*) FILTER (WHERE mitigation_diff)::int AS mitigation_mismatches,
             count(*) FILTER (WHERE invalidation_diff)::int AS invalidation_mismatches,
             count(*) FILTER (WHERE fresh_diff)::int AS freshness_mismatches
      FROM differences
      WHERE fresh_diff OR touch_diff OR mitigation_diff OR invalidation_diff OR fill_diff
      GROUP BY symbol, tf, engine_ver, age_bucket
      ORDER BY lifecycle_mismatches DESC, fill_mismatches DESC, symbol, tf, engine_ver, age_bucket`);
    const mismatchSamples = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (event_id) *
        FROM public.order_block_lifecycle_replay_shadow
        ORDER BY event_id, effective_at DESC
      )
      SELECT s.event_id, e.symbol, e.tf, e.formed_at, s.engine_ver,
             s.is_fresh AS observed_fresh, r.is_fresh AS replay_fresh,
             s.first_touch_at AS observed_touch, r.first_touch_at AS replay_touch,
             s.fill_pct AS observed_fill, r.fill_pct AS replay_fill,
             s.mitigated_at AS observed_mitigation, r.mitigated_at AS replay_mitigation,
             s.invalidated_at AS observed_invalidation, r.invalidated_at AS replay_invalidation
      FROM public.order_block_state_shadow s
      JOIN public.order_block_event_shadow e USING (event_id)
      JOIN latest r USING (event_id)
      WHERE (s.is_fresh, s.first_touch_at, s.mitigated_at, s.invalidated_at)
              IS DISTINCT FROM
            (r.is_fresh, r.first_touch_at, r.mitigated_at, r.invalidated_at)
         OR abs(s.fill_pct - r.fill_pct) > 1e-9
      ORDER BY e.symbol, e.tf, e.formed_at
      LIMIT 50`);
    await pool.query("ROLLBACK");
    console.log(JSON.stringify({
      summary: summary.rows[0],
      integrity: integrity.rows[0],
      kinds: kinds.rows,
      mismatch_breakdown: mismatchBreakdown.rows,
      mismatch_samples: mismatchSamples.rows,
    }, null, 2));
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
