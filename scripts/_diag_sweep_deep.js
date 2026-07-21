// Deep-dive: characterize features_sweep vs features_displacement density and
// direction vocabulary, to explain the chain collapse at the sweep stage.
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT,
  database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD,
});
const DAYS = parseInt(process.argv[2] || "90", 10);
const FROM = new Date(Date.now() - DAYS * 86400000);
const TO = new Date();
const PAIRS = ["EURUSD","XAUUSD","GBPUSD","USDSEK"];

async function q(sql, params) { const { rows } = await pool.query(sql, params); return rows; }

async function main() {
  console.log(`Feature density deep-dive — ${DAYS}d\n`);
  for (const sym of PAIRS) {
    const S = sym.toUpperCase();
    console.log(`=== ${S} ===`);
    const sweep = await q(`
      SELECT direction, COUNT(*) n,
        MIN(ts) first_ts, MAX(ts) last_ts
      FROM features_sweep WHERE symbol=$1 AND tf='5m' AND ts BETWEEN $2 AND $3
      GROUP BY direction ORDER BY n DESC`, [S, FROM, TO]);
    console.log("  sweep(5m) by direction:", JSON.stringify(sweep));
    const disp = await q(`
      SELECT direction, grade, COUNT(*) n FROM features_displacement
      WHERE symbol=$1 AND tf='5m' AND ts BETWEEN $2 AND $3
      GROUP BY direction, grade ORDER BY n DESC`, [S, FROM, TO]);
    console.log("  displacement(5m) by dir/grade:", JSON.stringify(disp));
    // How many sweeps have a displacement (MEDIUM/HIGH, same dir) within 30m AFTER?
    const after = await q(`
      SELECT COUNT(*) n FROM features_sweep s
      WHERE s.symbol=$1 AND s.tf='5m' AND s.ts BETWEEN $2 AND $3
        AND EXISTS (SELECT 1 FROM features_displacement d
          WHERE d.symbol=$1 AND d.tf='5m'
            AND d.ts BETWEEN s.ts AND s.ts + INTERVAL '30 minutes'
            AND d.direction = s.direction AND d.grade IN ('MEDIUM','HIGH'))`, [S, FROM, TO]);
    console.log("  sweeps WITH displacement(30m after, same dir, M/H):", after[0].n);
    // Sweeps per day avg
    const perday = await q(`SELECT COUNT(*)/$4::float avg FROM features_sweep WHERE symbol=$1 AND tf='5m' AND ts BETWEEN $2 AND $3`, [S, FROM, TO, DAYS]);
    console.log("  sweep avg/day:", perday[0].avg);
    console.log("");
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
