"use strict";
// Audit: compare drain SQL lifecycle formula vs replay JS formula.
// Both use candals_1m_canonical. Isolate pure formula diff by
// computing lifecycle INLINE in SQL (same CTE as drain function)
// and comparing to what replay stored.

const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const REPLAY_VERSION = "order-block-lifecycle-v1";

async function main() {
  const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 120000, application_name: "ob-formula-audit" }));
  try {
    await pool.query("BEGIN READ ONLY");

    const symbol = "XAUUSD";

    // Get events with their OB geometry
    const events = await pool.query(`
      SELECT e.event_id, e.symbol, e.formed_at, e.ob_kind, e.tf,
             s.top, s.bottom
      FROM public.order_block_event_shadow e
      JOIN public.order_block_state_shadow s USING (event_id)
      WHERE e.symbol = $1 AND s.top IS NOT NULL AND s.bottom IS NOT NULL
      ORDER BY e.event_id
    `, [symbol]);

    console.log(`Total ${symbol} events: ${events.rows.length}`);

    // For each event, check if drain updated it recently.
    // We can't directly tell, but we CAN compute the drain's lifecycle
    // inline and compare BOTH to state_shadow vs replay_shadow.
    //
    // If state_shadow == drain_computed AND replay == drain_computed:
    //   → all three agree, lifecycle correct
    // If state_shadow != drain_computed AND replay == drain_computed:
    //   → state_shadow is stale engine data, replay is correct
    // If state_shadow == drain_computed AND replay != drain_computed:
    //   → replay formula bug
    // If state_shadow != drain_computed AND replay != drain_computed
    //   AND state_shadow != replay:
    //   → both stale from different sources

    // Let's look at specific mismatched events
    const mismatches = await pool.query(`
      WITH latest_replay AS (
        SELECT DISTINCT ON (event_id) *
        FROM public.order_block_lifecycle_replay_shadow
        WHERE replay_version = $3
        ORDER BY event_id, effective_at DESC
      ),
      candidate_events AS (
        SELECT e.event_id, e.symbol, e.formed_at, e.ob_kind, e.tf,
               s.top, s.bottom,
               s.is_fresh AS state_fresh, s.first_touch_at AS state_touch,
               s.fill_pct AS state_fill, s.mitigated_at AS state_mit,
               s.invalidated_at AS state_inv
        FROM public.order_block_event_shadow e
        JOIN public.order_block_state_shadow s USING (event_id)
        WHERE e.symbol = $1
          AND s.top IS NOT NULL AND s.bottom IS NOT NULL
      ),
      state_with_latest AS (
        SELECT ce.*,
               r.is_fresh AS replay_fresh, r.first_touch_at AS replay_touch,
               r.fill_pct AS replay_fill, r.mitigated_at AS replay_mit,
               r.invalidated_at AS replay_inv
        FROM candidate_events ce
        LEFT JOIN latest_replay r USING (event_id)
      )
      SELECT *,
             (state_fresh IS DISTINCT FROM replay_fresh
              OR state_touch IS DISTINCT FROM replay_touch
              OR state_mit IS DISTINCT FROM replay_mit
              OR state_inv IS DISTINCT FROM replay_inv) AS lifecycle_diff,
             abs(state_fill - replay_fill) > 1e-9 AND replay_fill IS NOT NULL AS fill_diff
      FROM state_with_latest
      WHERE (state_fresh IS DISTINCT FROM replay_fresh
             OR state_touch IS DISTINCT FROM replay_touch
             OR state_mit IS DISTINCT FROM replay_mit
             OR state_inv IS DISTINCT FROM replay_inv
             OR (abs(state_fill - replay_fill) > 1e-9 AND replay_fill IS NOT NULL))
      ORDER BY event_id
      LIMIT 5
    `, [symbol, symbol, REPLAY_VERSION]);

    console.log(`\nMismatch samples (${symbol}):`);
    for (const row of mismatches.rows) {
      console.log(`\n=== event_id: ${row.event_id} ${row.tf} ${row.ob_kind} ===`);
      console.log(`  formed_at: ${row.formed_at}`);
      console.log(`  top/bottom: ${row.top} / ${row.bottom}`);

      // Compute drain-style lifecycle inline for this event
      const computed = await pool.query(`
        WITH event AS (
          SELECT $1::bigint AS event_id,
                 $2::text AS symbol,
                 $3::timestamptz AS formed_at,
                 $4::text AS ob_kind,
                 $5::double precision AS top,
                 $6::double precision AS bottom
        ), candle_pen AS (
          SELECT e.event_id, c.ts,
                 c.h >= e.bottom AND c.l <= e.top AS touched,
                 CASE
                   WHEN e.top <= e.bottom THEN 0::double precision
                   WHEN e.ob_kind = 'bullish'
                     THEN LEAST(1::double precision, GREATEST(0::double precision,
                       (e.top - GREATEST(e.bottom, c.l)) / NULLIF(e.top - e.bottom, 0)))
                   ELSE LEAST(1::double precision, GREATEST(0::double precision,
                       (LEAST(e.top, c.h) - e.bottom) / NULLIF(e.top - e.bottom, 0)))
                 END AS penetration,
                 (e.ob_kind = 'bullish' AND c.c < e.bottom)
                   OR (e.ob_kind = 'bearish' AND c.c > e.top) AS invalidated
          FROM event e
          JOIN market.candles_1m_canonical c
            ON c.symbol = e.symbol AND c.ts > e.formed_at
        ), milestones AS (
          SELECT e.event_id, e.formed_at,
                 MIN(c.ts) FILTER (WHERE c.touched) AS first_touch_at,
                 MIN(c.ts) FILTER (WHERE c.touched AND c.penetration >= 0.5) AS fill_mitigation_at,
                 MIN(c.ts) FILTER (WHERE c.invalidated) AS invalidated_at
          FROM event e
          LEFT JOIN candle_pen c USING (event_id)
          GROUP BY e.event_id, e.formed_at
        ), running AS (
          SELECT event_id, ts, touched, penetration,
                 MAX(penetration) FILTER (WHERE touched) OVER (
                   PARTITION BY event_id ORDER BY ts
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) AS running_fill
          FROM candle_pen
        )
        SELECT m.event_id,
               m.first_touch_at,
               COALESCE((SELECT MAX(c.penetration) FILTER (WHERE c.touched)
                         FROM candle_pen c WHERE c.event_id = m.event_id), 0)::double precision AS fill_pct,
               COALESCE(m.fill_mitigation_at, m.invalidated_at) AS mitigated_at,
               m.invalidated_at,
               m.invalidated_at IS NULL AS is_fresh
        FROM milestones m
        ORDER BY m.event_id
      `, [row.event_id, row.symbol, row.formed_at, row.ob_kind, row.top, row.bottom]);

      const c = computed.rows[0];
      console.log(`  DRAIN-COMPUTED (1m candles):`);
      console.log(`    first_touch_at: ${c.first_touch_at}`);
      console.log(`    fill_pct:       ${c.fill_pct}`);
      console.log(`    mitigated_at:   ${c.mitigated_at}`);
      console.log(`    invalidated_at: ${c.invalidated_at}`);
      console.log(`    is_fresh:       ${c.is_fresh}`);

      console.log(`  REPLAY-SHADOW (latest):`);
      console.log(`    first_touch_at: ${row.replay_touch}`);
      console.log(`    fill_pct:       ${row.replay_fill}`);
      console.log(`    mitigated_at:   ${row.replay_mit}`);
      console.log(`    invalidated_at: ${row.replay_inv}`);
      console.log(`    is_fresh:       ${row.replay_fresh}`);

      console.log(`  STATE-SHADOW (mirror):`);
      console.log(`    first_touch_at: ${row.state_touch}`);
      console.log(`    fill_pct:       ${row.state_fill}`);
      console.log(`    mitigated_at:   ${row.state_mit}`);
      console.log(`    invalidated_at: ${row.state_inv}`);
      console.log(`    is_fresh:       ${row.state_fresh}`);

      // Determine who matches whom
      const drainEqReplay =
        c.first_touch_at?.getTime() === row.replay_touch?.getTime() &&
        Math.abs(c.fill_pct - row.replay_fill) < 1e-9 &&
        c.mitigated_at?.getTime() === row.replay_mit?.getTime() &&
        c.invalidated_at?.getTime() === row.replay_inv?.getTime() &&
        c.is_fresh === row.replay_fresh;

      const drainEqState =
        c.first_touch_at?.getTime() === row.state_touch?.getTime() &&
        Math.abs(c.fill_pct - row.state_fill) < 1e-9 &&
        c.mitigated_at?.getTime() === row.state_mit?.getTime() &&
        c.invalidated_at?.getTime() === row.state_inv?.getTime() &&
        c.is_fresh === row.state_fresh;

      if (drainEqReplay && drainEqState) {
        console.log(`  ✅ ALL THREE AGREE`);
      } else if (drainEqReplay && !drainEqState) {
        console.log(`  ⚠️  DRAIN==REPLAY but STATE differs → state_shadow stale (engine-wrote after drain)`);
      } else if (!drainEqReplay && drainEqState) {
        console.log(`  ⚠️  DRAIN==STATE but REPLAY differs → replay formula bug`);
      } else {
        console.log(`  ❌ All three differ or drain matches neither → investigate`);
      }

      // ALSO: count total candles scanned for this event
      const candleCount = await pool.query(`
        SELECT count(*)::int AS candles
        FROM market.candles_1m_canonical
        WHERE symbol = $1 AND ts > $2 AND ts <= NOW()
      `, [row.symbol, row.formed_at]);
      console.log(`  Candle scan range: ${candleCount.rows[0].candles} 1m candles`);
    }

    // Summary counts: how many events have state != computed formula?
    const bulkCheck = await pool.query(`
      WITH event_base AS (
        SELECT e.event_id, e.formed_at, e.ob_kind, e.tf,
               s.top, s.bottom,
               s.first_touch_at AS state_touch,
               s.fill_pct AS state_fill,
               s.mitigated_at AS state_mit,
               s.invalidated_at AS state_inv,
               s.engine_ver
        FROM public.order_block_event_shadow e
        JOIN public.order_block_state_shadow s USING (event_id)
        WHERE e.symbol = $1 AND s.top IS NOT NULL AND s.bottom IS NOT NULL
      ),
      computed AS (
        SELECT e.event_id,
               MIN(c.ts) FILTER (WHERE c.h >= e.bottom AND c.l <= e.top) AS first_touch_at,
               COALESCE(
                 (SELECT MAX(sub.penetration) FILTER (WHERE sub.touched)
                  FROM (
                    SELECT c2.ts,
                           c2.h >= e.bottom AND c2.l <= e.top AS touched,
                           CASE
                             WHEN e.top <= e.bottom THEN 0::double precision
                             WHEN e.ob_kind = 'bullish'
                               THEN LEAST(1, GREATEST(0, (e.top - GREATEST(e.bottom, c2.l)) / NULLIF(e.top - e.bottom, 0)))
                             ELSE LEAST(1, GREATEST(0, (LEAST(e.top, c2.h) - e.bottom) / NULLIF(e.top - e.bottom, 0)))
                           END AS penetration
                    FROM market.candles_1m_canonical c2
                    WHERE c2.symbol = e.symbol AND c2.ts > e.formed_at AND c2.ts <= NOW()
                  ) sub
                 ), 0)::double precision AS fill_pct,
               COALESCE(
                 MIN(c.ts) FILTER (WHERE c.touched AND c.penetration >= 0.5),
                 MIN(c.ts) FILTER (WHERE c.invalidated)
               ) AS mitigated_at,
               MIN(c.ts) FILTER (WHERE (e.ob_kind = 'bullish' AND c.c < e.bottom)
                                      OR (e.ob_kind = 'bearish' AND c.c > e.top)) AS invalidated_at
        FROM event_base e
        JOIN LATERAL (
          SELECT c.ts, c.h, c.l, c.c,
                 c.h >= e.bottom AND c.l <= e.top AS touched,
                 CASE
                   WHEN e.top <= e.bottom THEN 0::double precision
                   WHEN e.ob_kind = 'bullish'
                     THEN LEAST(1, GREATEST(0, (e.top - GREATEST(e.bottom, c.l)) / NULLIF(e.top - e.bottom, 0)))
                   ELSE LEAST(1, GREATEST(0, (LEAST(e.top, c.h) - e.bottom) / NULLIF(e.top - e.bottom, 0)))
                 END AS penetration,
                 (e.ob_kind = 'bullish' AND c.c < e.bottom)
                   OR (e.ob_kind = 'bearish' AND c.c > e.top) AS invalidated
          FROM market.candles_1m_canonical c
          WHERE c.symbol = e.symbol AND c.ts > e.formed_at AND c.ts <= NOW()
        ) c ON TRUE
        GROUP BY e.event_id, e.formed_at, e.ob_kind, e.top, e.bottom
      ),
      with_replay AS (
        SELECT e.event_id, e.tf, e.engine_ver,
               e.state_touch, e.state_fill, e.state_mit, e.state_inv,
               c.first_touch_at AS drain_touch, c.fill_pct AS drain_fill,
               c.mitigated_at AS drain_mit, c.invalidated_at AS drain_inv,
               r.first_touch_at AS replay_touch, r.fill_pct AS replay_fill,
               r.mitigated_at AS replay_mit, r.invalidated_at AS replay_inv
        FROM event_base e
        JOIN computed c USING (event_id)
        LEFT JOIN LATERAL (
          SELECT r.first_touch_at, r.fill_pct, r.mitigated_at, r.invalidated_at
          FROM public.order_block_lifecycle_replay_shadow r
          WHERE r.event_id = e.event_id
          ORDER BY r.effective_at DESC
          LIMIT 1
        ) r ON TRUE
      )
      SELECT count(*)::int AS total_events,
             count(*) FILTER (WHERE (drain_touch, drain_fill, drain_mit, drain_inv)
               IS DISTINCT FROM (replay_touch, replay_fill, replay_mit, replay_inv))::int AS replay_mismatch,
             count(*) FILTER (WHERE (state_touch, state_fill, state_mit, state_inv)
               IS DISTINCT FROM (drain_touch, drain_fill, drain_mit, drain_inv))::int AS state_drain_mismatch,
             count(*) FILTER (WHERE (state_touch, state_fill, state_mit, state_inv)
               IS DISTINCT FROM (replay_touch, replay_fill, replay_mit, replay_inv))::int AS state_replay_mismatch
      FROM with_replay
    `, [symbol]);

    console.log(`\n=== 3-way bulk comparison (${symbol}) ===`);
    console.log(JSON.stringify(bulkCheck.rows[0], null, 2));

    await pool.query("ROLLBACK");
  } catch (e) {
    console.error(e);
    try { await pool.query("ROLLBACK"); } catch {}
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
