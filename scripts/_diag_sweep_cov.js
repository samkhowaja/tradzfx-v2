// Check sweep coverage per pair: min/max ts, rows, and whether backfill ran.
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT,
  database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD,
});
const PAIRS = ["AUDUSD","EURUSD","GBPUSD","NZDUSD","USDCAD","USDCHF","USDJPY","USDSEK","XAUUSD"];
async function q(sql, params) { const { rows } = await pool.query(sql, params); return rows; }
async function main() {
  console.log("Sweep(5m) coverage per pair + producer ledger:\n");
  for (const sym of PAIRS) {
    const S = sym.toUpperCase();
    const cov = await q(`SELECT COUNT(*) n, MIN(ts) first_ts, MAX(ts) last_ts FROM features_sweep WHERE symbol=$1 AND tf='5m'`, [S]);
    const c = cov[0];
    // candles_5m coverage
    const cand = await q(`SELECT COUNT(*) n, MIN(ts) first_ts, MAX(ts) last_ts FROM market.candles_5m_canonical WHERE symbol=$1`, [S]);
    const cd = cand[0] || {};
    // producer runs for sweep
    const prod = await q(`SELECT MAX(started_at) last_run, COUNT(*) n FROM feature_producer_runs WHERE feature_table='features_sweep' AND symbol=$1`, [S]);
    const p = prod[0];
    const fmt = (d) => d ? new Date(d).toISOString().slice(0,10) : '-';
    console.log(`${S.padEnd(8)} sweep: n=${String(c.n).padEnd(6)} ${fmt(c.first_ts).padEnd(11)}→${fmt(c.last_ts).padEnd(11)} | candles_5m: n=${cd.n} ${fmt(cd.first_ts)}→${fmt(cd.last_ts)} | prodRuns=${p.n} last=${p.last_run||'-'}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
