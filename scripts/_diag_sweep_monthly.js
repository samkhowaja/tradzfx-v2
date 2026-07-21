// Check sweep rows BEFORE 2026-07-01 for the pairs that looked truncated.
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT,
  database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD,
});
const PAIRS = ["GBPUSD","NZDUSD","USDCAD","USDCHF","USDJPY","USDSEK","AUDUSD","EURUSD"];
async function q(sql, params) { const { rows } = await pool.query(sql, params); return rows; }
async function main() {
  console.log("Sweep(5m) rows by month for pairs that looked truncated:\n");
  for (const sym of PAIRS) {
    const S = sym.toUpperCase();
    const rows = await q(`
      SELECT date_trunc('month', ts)::date mon, COUNT(*) n
      FROM features_sweep WHERE symbol=$1 AND tf='5m' AND ts >= '2026-04-01'
      GROUP BY mon ORDER BY mon`, [S]);
    const byMon = rows.map(r => `${r.mon.toISOString().slice(0,7)}:${r.n}`).join("  ");
    console.log(`${S.padEnd(8)} ${byMon}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
