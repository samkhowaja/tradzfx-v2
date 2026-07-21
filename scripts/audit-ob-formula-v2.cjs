"use strict";
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const fs = require("fs");
const REPLAY_VERSION = "order-block-lifecycle-v1";

async function main() {
  const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 120000, application_name: "ob-formula-audit" }));
  const lines = [];
  const out = (s) => { console.log(s); lines.push(s); };
  try {
    await pool.query("BEGIN READ ONLY");

    // Get XAUUSD events where state_shadow != replay_shadow
    const mismatches = await pool.query(`
      WITH latest_replay AS (
        SELECT DISTINCT ON (event_id) *
        FROM public.order_block_lifecycle_replay_shadow
        WHERE replay_version = $1
        ORDER BY event_id, effective_at DESC
      )
      SELECT e.event_id, e.symbol, e.tf, e.formed_at, e.ob_kind,
             s.top, s.bottom, s.engine_ver,
             s.is_fresh AS state_fresh,
             s.first_touch_at AS state_touch,
             s.fill_pct::double precision AS state_fill,
             s.mitigated_at AS state_mit,
             s.invalidated_at AS state_inv,
             r.is_fresh AS replay_fresh,
             r.first_touch_at AS replay_touch,
             r.fill_pct::double precision AS replay_fill,
             r.mitigated_at AS replay_mit,
             r.invalidated_at AS replay_inv
      FROM public.order_block_event_shadow e
      JOIN public.order_block_state_shadow s USING (event_id)
      LEFT JOIN latest_replay r USING (event_id)
      WHERE e.symbol = $2
        AND s.top IS NOT NULL AND s.bottom IS NOT NULL
        AND r.event_id IS NOT NULL
        AND (s.is_fresh IS DISTINCT FROM r.is_fresh
             OR s.first_touch_at IS DISTINCT FROM r.first_touch_at
             OR s.mitigated_at IS DISTINCT FROM r.mitigated_at
             OR s.invalidated_at IS DISTINCT FROM r.invalidated_at
             OR abs(s.fill_pct - r.fill_pct) > 1e-9)
      ORDER BY e.event_id
    `, [REPLAY_VERSION, "XAUUSD"]);

    out(`XAUUSD mismatches: ${mismatches.rows.length}`);

    // Deep-dive first mismatch
    if (mismatches.rows.length > 0) {
      const row = mismatches.rows[0];
      out(`\n=== event_id=${row.event_id} tf=${row.tf} kind=${row.ob_kind} ===`);
      out(`  top=${row.top} bottom=${row.bottom} formed_at=${row.formed_at}`);

      const computed = await pool.query(`
        WITH event AS (
          SELECT $1::timestamptz AS formed_at, $2::text AS ob_kind,
                 $3::double precision AS top, $4::double precision AS bottom
        ), pen AS (
          SELECT c.ts,
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
          JOIN market.candles_1m_canonical c ON c.symbol = 'XAUUSD' AND c.ts > e.formed_at
        )
        SELECT
          MIN(ts) FILTER (WHERE touched) AS first_touch_at,
          COALESCE((SELECT MAX(p.penetration) FILTER (WHERE p.touched) FROM pen p), 0)::double precision AS fill_pct,
          COALESCE(MIN(ts) FILTER (WHERE touched AND penetration >= 0.5),
                   MIN(ts) FILTER (WHERE invalidated)) AS mitigated_at,
          MIN(ts) FILTER (WHERE invalidated) AS invalidated_at,
          MIN(ts) FILTER (WHERE invalidated) IS NULL AS is_fresh
        FROM pen
      `, [row.formed_at, row.ob_kind, row.top, row.bottom]);

      const c = computed.rows[0];
      out("\n=== COMPARISON (DRAIN-SQL | REPLAY-JS | STATE-SHADOW) ===");
      out(`first_touch_at  | ${c.first_touch_at} | ${row.replay_touch} | ${row.state_touch}`);
      out(`fill_pct        | ${c.fill_pct} | ${row.replay_fill} | ${row.state_fill}`);
      out(`mitigated_at    | ${c.mitigated_at} | ${row.replay_mit} | ${row.state_mit}`);
      out(`invalidated_at  | ${c.invalidated_at} | ${row.replay_inv} | ${row.state_inv}`);
      out(`is_fresh        | ${c.is_fresh} | ${row.replay_fresh} | ${row.state_fresh}`);

      const drainEqReplay =
        (c.first_touch_at?.getTime() ?? null) === (row.replay_touch?.getTime() ?? null) &&
        Math.abs(c.fill_pct - (row.replay_fill ?? 0)) < 1e-9 &&
        (c.mitigated_at?.getTime() ?? null) === (row.replay_mit?.getTime() ?? null) &&
        (c.invalidated_at?.getTime() ?? null) === (row.replay_inv?.getTime() ?? null) &&
        c.is_fresh === row.replay_fresh;

      const drainEqState =
        (c.first_touch_at?.getTime() ?? null) === (row.state_touch?.getTime() ?? null) &&
        Math.abs(c.fill_pct - (row.state_fill ?? 0)) < 1e-9 &&
        (c.mitigated_at?.getTime() ?? null) === (row.state_mit?.getTime() ?? null) &&
        (c.invalidated_at?.getTime() ?? null) === (row.state_inv?.getTime() ?? null) &&
        c.is_fresh === row.state_fresh;

      if (drainEqReplay && drainEqState) out(`\n✅ ALL THREE AGREE`);
      else if (drainEqReplay && !drainEqState) out(`\n✅ DRAIN==REPLAY — formula correct. STATE stale (engine overwrote after drain).`);
      else if (!drainEqReplay && drainEqState) out(`\n❌ REPLAY differs — bug in replay formula`);
      else out(`\n❌ All three diverge`);
    }

    // Bulk: count drain_eq_replay and state_drain_diff for XAUUSD
    const bulk = await pool.query(`
      WITH event_base AS (
        SELECT e.event_id, e.formed_at, e.ob_kind,
               s.top, s.bottom,
               s.first_touch_at AS state_touch, s.fill_pct AS state_fill,
               s.mitigated_at AS state_mit, s.invalidated_at AS state_inv
        FROM public.order_block_event_shadow e
        JOIN public.order_block_state_shadow s USING (event_id)
        WHERE e.symbol = 'XAUUSD' AND s.top IS NOT NULL AND s.bottom IS NOT NULL
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
        JOIN market.candles_1m_canonical c ON c.symbol = 'XAUUSD' AND c.ts > e.formed_at
        GROUP BY e.event_id
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE (drain_touch, drain_fill, drain_mit, drain_inv, drain_fresh)
          IS NOT DISTINCT FROM (r.first_touch_at, r.fill_pct, r.mitigated_at, r.invalidated_at, r.is_fresh))::int AS drain_eq_replay,
        count(*) FILTER (WHERE (eb.state_touch, eb.state_fill, eb.state_mit, eb.state_inv)
          IS DISTINCT FROM (drain_touch, drain_fill, drain_mit, drain_inv))::int AS state_drain_diff
      FROM drain d
      JOIN event_base eb USING (event_id)
      LEFT JOIN LATERAL (
        SELECT r.first_touch_at, r.fill_pct, r.mitigated_at, r.invalidated_at, r.is_fresh
        FROM public.order_block_lifecycle_replay_shadow r
        WHERE r.event_id = d.event_id
        ORDER BY r.effective_at DESC LIMIT 1
      ) r ON TRUE
    `);

    out(`\n=== Bulk XAUUSD ===`);
    out(JSON.stringify(bulk.rows[0], null, 2));

    // If drain==replay for all, check: how many state_drain_diff?
    // Those are events where drain hasn't caught up / engine overwrote
    const { total, drain_eq_replay, state_drain_diff } = bulk.rows[0];
    if (drain_eq_replay === total) {
      out(`\n✅ LIFE-CYCLE FORMULA CORRECT (drain SQL == replay JS for all ${total} events)`);
      out(`   ${state_drain_diff}/${total} events have stale state_shadow (engine overwrote after drain)`);
    } else {
      out(`\n⚠️  Lifecycle formula mismatch: ${total - drain_eq_replay}/${total} events disagree between drain and replay`);
    }

    await pool.query("ROLLBACK");
  } catch (e) {
    out(`ERROR: ${e.message}`);
    try { await pool.query("ROLLBACK"); } catch {}
    process.exitCode = 1;
  } finally {
    await pool.end();
    fs.writeFileSync("scripts/audit-ob-formula-output.txt", lines.join("\n"), "utf8");
  }
}
main();
