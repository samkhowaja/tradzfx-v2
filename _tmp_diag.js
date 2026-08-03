require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost", port: 5432, database: "tradzfx_v2",
  user: "postgres", password: process.env.TM_DB_PASSWORD
});

async function main() {
  // Get columns
  for (const tbl of ['features_candle_pattern', 'features_structure']) {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position", [tbl]
    );
    console.log(`=== ${tbl} columns ===`);
    console.log(rows.map(r => r.column_name).join(', '));
  }
  
  // Check spec in DB
  const { rows: specs } = await pool.query(
    "SELECT id, spec_json FROM strategy_specs WHERE id = 'cct_rectangle_xau_v1'"
  );
  if (!specs.length) { console.log("SPEC NOT FOUND IN DB"); return; }
  const s = specs[0].spec_json;
  console.log("\n=== SPEC: cct_rectangle_xau_v1 ===");
  console.log("steps:", JSON.stringify(s.steps?.map(x => ({id: x.id, table: x.table, ttlDirection: x.ttlDirection, ttlMinutes: x.ttlMinutes, filter: x.filter}))));
  console.log("entry:", JSON.stringify(s.entry?.map(x => ({id: x.id, feature: x.feature, tf: x.tf, ttlDirection: x.ttlDirection, ttlMinutes: x.ttlMinutes, filter: x.filter}))));
  console.log("signalSource:", s.signalSource);
  console.log("timeframe:", s.timeframe);
  
  // Data volumes
  const { rows: cp4h } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM features_candle_pattern WHERE symbol = 'XAUUSD' AND tf = '4h' AND ts >= '2026-04-25'"
  );
  console.log("\nfeatures_candle_pattern@4h count:", cp4h[0].cnt);
  
  const { rows: st15 } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM features_structure WHERE symbol = 'XAUUSD' AND tf = '15m' AND ts >= '2026-04-25'"
  );
  console.log("features_structure@15m count:", st15[0].cnt);
  
  const { rows: st1 } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM features_structure WHERE symbol = 'XAUUSD' AND tf = '1m' AND ts >= '2026-04-25'"
  );
  console.log("features_structure@1m count:", st1[0].cnt);
  
  // Candle directions in range
  const { rows: cpDirs } = await pool.query(
    `SELECT direction, COUNT(*)::int AS cnt FROM features_candle_pattern
     WHERE symbol = 'XAUUSD' AND tf = '4h' AND ts >= '2026-04-25' AND ts <= '2026-07-24'
       AND direction IN ('bullish','bearish')
     GROUP BY direction ORDER BY cnt DESC`
  );
  console.log("\nCandle directions (bullish/bearish only):");
  for (const r of cpDirs) console.log(`  ${r.direction}: ${r.cnt}`);
  
  // 15m structure types in range
  const { rows: st15t } = await pool.query(
    `SELECT direction, event_type, COUNT(*)::int AS cnt FROM features_structure
     WHERE symbol = 'XAUUSD' AND tf = '15m' AND ts >= '2026-04-25' AND ts <= '2026-07-24'
     GROUP BY direction, event_type ORDER BY cnt DESC LIMIT 10`
  );
  console.log("\n15m structure event types:");
  for (const r of st15t) console.log(`  ${r.direction} ${r.event_type}: ${r.cnt}`);
  
  // 1m structure types in range
  const { rows: st1t } = await pool.query(
    `SELECT direction, event_type, COUNT(*)::int AS cnt FROM features_structure
     WHERE symbol = 'XAUUSD' AND tf = '1m' AND ts >= '2026-04-25' AND ts <= '2026-07-24'
     GROUP BY direction, event_type ORDER BY cnt DESC LIMIT 10`
  );
  console.log("\n1m structure event types:");
  for (const r of st1t) console.log(`  ${r.direction} ${r.event_type}: ${r.cnt}`);
  
  // 3-stage forward join
  const { rows: threeStage } = await pool.query(`
    WITH dir_candle AS (
      SELECT ts, symbol, direction FROM features_candle_pattern
      WHERE symbol = 'XAUUSD' AND tf = '4h'
        AND ts >= '2026-04-25' AND ts <= '2026-07-24'
        AND direction IN ('bullish', 'bearish')
    )
    SELECT dc.ts AS candle_ts, dc.direction AS candle_dir,
           w.ts AS weak_ts, w.event_type AS weak_event, w.direction AS weak_dir,
           b.ts AS breakout_ts, b.event_type AS breakout_event, b.direction AS breakout_dir
    FROM dir_candle dc
    CROSS JOIN LATERAL (
      SELECT ts, event_type, direction FROM features_structure
      WHERE symbol = dc.symbol AND tf = '15m'
        AND ts >= dc.ts AND ts <= dc.ts + INTERVAL '720 minutes'
      ORDER BY ts ASC LIMIT 1
    ) w
    CROSS JOIN LATERAL (
      SELECT ts, event_type, direction FROM features_structure
      WHERE symbol = dc.symbol AND tf = '1m'
        AND ts >= w.ts AND ts <= w.ts + INTERVAL '120 minutes'
      ORDER BY ts ASC LIMIT 1
    ) b
    ORDER BY dc.ts LIMIT 30
  `);
  console.log(`\n=== 3-stage forward join: ${threeStage.length} rows ===`);
  for (const r of threeStage) {
    const cts = r.candle_ts?.toISOString?.()?.slice(0,19) ?? r.candle_ts;
    const wts = r.weak_ts?.toISOString?.()?.slice(0,19) ?? r.weak_ts;
    const bts = r.breakout_ts?.toISOString?.()?.slice(0,19) ?? r.breakout_ts;
    console.log(`  candle:${cts} ${r.candle_dir} | weakness:${wts} ${r.weak_event} ${r.weak_dir} | breakout:${bts} ${r.breakout_event} ${r.breakout_dir}`);
  }
  
  // Also count full join
  const { rows: fullCount } = await pool.query(`
    WITH dir_candle AS (
      SELECT ts, symbol, direction FROM features_candle_pattern
      WHERE symbol = 'XAUUSD' AND tf = '4h'
        AND ts >= '2026-04-25' AND ts <= '2026-07-24'
        AND direction IN ('bullish', 'bearish')
    ),
    with_weakness AS (
      SELECT dc.ts AS dc_ts, dc.direction AS dc_dir, dc.symbol AS dc_sym,
             w.ts AS w_ts, w.event_type AS w_evt, w.direction AS w_dir
      FROM dir_candle dc
      CROSS JOIN LATERAL (
        SELECT ts, event_type, direction FROM features_structure
        WHERE symbol = dc.symbol AND tf = '15m'
          AND ts >= dc.ts AND ts <= dc.ts + INTERVAL '720 minutes'
        ORDER BY ts ASC LIMIT 1
      ) w
    )
    SELECT COUNT(*)::int AS cnt
    FROM with_weakness ww
    CROSS JOIN LATERAL (
      SELECT ts, event_type, direction FROM features_structure
      WHERE symbol = ww.dc_sym AND tf = '1m'
        AND ts >= ww.w_ts AND ts <= ww.w_ts + INTERVAL '120 minutes'
      ORDER BY ts ASC LIMIT 1
    ) b
  `);
  console.log(`\nFull 3-stage join count: ${fullCount[0].cnt}`);
  
  await pool.end();
}
main().catch(e => { console.error(e.message, e.stack?.slice(0,300)); process.exit(1); });
