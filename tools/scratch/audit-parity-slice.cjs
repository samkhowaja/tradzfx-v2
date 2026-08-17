require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});
const STRATEGY = "watukushay_no1";
const SYMBOL = "XAUUSD";
const FROM = "2026-07-19T00:00:00Z";
const TO = "2026-07-23T00:00:00Z";
async function columns(client, table, schema = "public") {
  const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, table]);
  return rows.map((r) => r.column_name);
}
async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '2min'");
    const q = async (label, sql, params = []) => {
      const { rows } = await client.query(sql, params);
      console.log(`\n=== ${label} (${rows.length}) ===`);
      console.log(JSON.stringify(rows, null, 2));
      return rows;
    };
    await q("slice", "SELECT $1::text strategy, $2::text symbol, $3::timestamptz from_ts, $4::timestamptz to_ts", [STRATEGY, SYMBOL, FROM, TO]);
    const liveCols = await columns(client, "live_signal");
    const liveTime = liveCols.includes("created_at") ? "created_at" : liveCols.includes("ts") ? "ts" : null;
    if (liveTime) await q("live_signal", `SELECT * FROM live_signal WHERE strategy_id=$1 AND symbol=$2 AND ${liveTime}>=$3 AND ${liveTime}<$4 ORDER BY ${liveTime}`, [STRATEGY, SYMBOL, FROM, TO]);
    else console.log("\n=== live_signal ===\nNo timestamp column found");
    await q("live_deployment", "SELECT * FROM live_deployment WHERE strategy_id=$1 ORDER BY started_at DESC LIMIT 10", [STRATEGY]);
    await q("canonical coverage", "SELECT COUNT(*)::int rows, MIN(ts) min_ts, MAX(ts) max_ts, COUNT(*) FILTER (WHERE ts >= $2 AND ts < $3)::int slice_rows FROM market.candles_1m_canonical WHERE symbol=$1", [SYMBOL, FROM, TO]);
    const quarantineCols = await columns(client, "candle_quarantine");
    await q("candle_quarantine schema", "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='candle_quarantine' ORDER BY ordinal_position");
    await q("backtest_results schema", "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='backtest_results' ORDER BY ordinal_position");
    const qt = quarantineCols.includes("ts") ? "ts" : quarantineCols.includes("candle_ts") ? "candle_ts" : null;
    if (qt) await q("candle quarantine", `SELECT * FROM candle_quarantine WHERE symbol=$1 AND ${qt}>=$2 AND ${qt}<$3 ORDER BY ${qt}`, [SYMBOL, FROM, TO]);
    else if (quarantineCols.includes("event_time")) await q("candle quarantine", `SELECT * FROM candle_quarantine WHERE symbol=$1 AND event_time>=$2 AND event_time<$3 ORDER BY event_time`, [SYMBOL, FROM, TO]);
    else console.log("\n=== candle_quarantine ===\nNo timestamp column found");
    await q("backtest exact timestamp", `SELECT * FROM backtest_results WHERE variant_id=$1 AND symbol=$2 AND ts=$3 ORDER BY created_at DESC`, [STRATEGY, SYMBOL, "2026-07-22T14:00:00Z"]);
    await q("setup evaluations exact timestamp", `SELECT * FROM setup_evaluations WHERE symbol=$1 AND ts=$2 ORDER BY created_at DESC`, [SYMBOL, "2026-07-22T14:00:00Z"]);
    await q("live snapshot identities", `SELECT d.deployment_id,d.strategy_snapshot_id,d.feature_snapshot_id,d.compiled_strategy_snapshot_id,ss.*,fs.* FROM live_deployment d LEFT JOIN strategy_settings_snapshot ss ON ss.snapshot_id=d.strategy_snapshot_id LEFT JOIN feature_config_snapshot fs ON fs.snapshot_id=d.feature_snapshot_id WHERE d.deployment_id=(SELECT deployment_id FROM live_signal WHERE strategy_id=$1 AND symbol=$2 AND ts=$3 ORDER BY created_at DESC LIMIT 1)`, [STRATEGY, SYMBOL, "2026-07-22T14:00:00Z"]);
    await q("backtest nearby XAUUSD", `SELECT * FROM backtest_results WHERE variant_id=$1 AND symbol=$2 AND ts >= $3 AND ts < $4 ORDER BY ts`, [STRATEGY, SYMBOL, FROM, TO]);
    for (const table of ["backtest_runs", "backtest_run", "backtest_results"]) {
      const cs = await columns(client, table);
      if (cs.length) { await q(table, `SELECT * FROM ${table} ORDER BY ${cs.includes("created_at") ? "created_at" : cs[0]} DESC LIMIT 20`); break; }
    }
    await client.query("ROLLBACK");
  } finally { client.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
