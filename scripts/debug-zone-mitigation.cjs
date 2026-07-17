const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradzfx_v2",
  user: "postgres",
  password: "2k16Dub@i",
});

async function main() {
  try {
    // Check if zones are created with mitigated_at already set
    const r1 = await pool.query(`
      SELECT symbol, tf, zone_kind, direction, count(*)::int,
        sum(CASE WHEN mitigated_at IS NOT NULL THEN 1 ELSE 0 END)::int as mitigated,
        sum(CASE WHEN invalidated_at IS NOT NULL THEN 1 ELSE 0 END)::int as invalidated,
        max(ts) as latest_ts,
        min(ts) as earliest_ts
      FROM features_zone
      WHERE symbol='EURUSD' AND tf='5m' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY symbol, tf, zone_kind, direction
      ORDER BY zone_kind, direction
    `);
    console.log("EURUSD 5m zone breakdown:", JSON.stringify(r1.rows, null, 2));

    // Check what mitigated_at looks like for recent zones
    const r2 = await pool.query(`
      SELECT symbol, ts, zone_kind, direction, top, bottom, mitigated_at, invalidated_at, created_at
      FROM features_zone
      WHERE symbol='EURUSD' AND tf='5m' AND ts > NOW() - INTERVAL '6 hours'
      ORDER BY ts DESC LIMIT 20
    `);
    console.log("EURUSD 5m recent zones:", JSON.stringify(r2.rows, null, 2));

    // Check if mitigated_at == ts (immediately mitigated)
    const r3 = await pool.query(`
      SELECT count(*)::int as imm_mitigated
      FROM features_zone
      WHERE symbol='EURUSD' AND tf='5m' AND ts > NOW() - INTERVAL '24 hours'
        AND mitigated_at IS NOT NULL
        AND mitigated_at = ts
    `);
    console.log("EURUSD 5m mitigated_at == ts:", JSON.stringify(r3.rows));

    // Check XAUUSD 5m zone details
    const r4 = await pool.query(`
      SELECT symbol, ts, zone_kind, direction, top, bottom, mitigated_at, invalidated_at
      FROM features_zone
      WHERE symbol='XAUUSD' AND tf='5m' AND ts > NOW() - INTERVAL '24 hours'
      ORDER BY ts DESC LIMIT 20
    `);
    console.log("XAUUSD 5m recent zones:", JSON.stringify(r4.rows, null, 2));

    // Check features_opening_range data and why it's stale
    const r5 = await pool.query(`
      SELECT * FROM features_opening_range
      WHERE ts > NOW() - INTERVAL '48 hours'
      ORDER BY ts DESC LIMIT 10
    `);
    console.log("OPENING_RANGE recent:", JSON.stringify(r5.rows, null, 2));

    // Check if there's a zone_mitigation_job or similar process
    const r6 = await pool.query(`
      SELECT schemaname, relname, n_tup_upd, n_tup_del, last_autovacuum, last_vacuum, last_analyze
      FROM pg_stat_user_tables
      WHERE relname = 'features_zone'
    `);
    console.log("Zone table stats:", JSON.stringify(r6.rows, null, 2));

  } catch (e) {
    console.error("ERROR:", e.message);
  }
  await pool.end();
}

main();
