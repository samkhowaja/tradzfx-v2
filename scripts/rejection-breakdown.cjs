const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const pool = new Pool(getDbConfig());

async function main() {
  const res = await pool.query(`
    SELECT strategy_id, reason, count(*)::int as cnt, max(ts) as last_seen
    FROM live_signal_rejection
    WHERE ts > NOW() - INTERVAL '72 hours'
      AND strategy_id IN (
        'scalper_20sma_1m','doyle_sd','gold_anti_bias_sniper_v1',
        'orb_scalper_1m','gold_9sma_scalper_1m','orb_classic',
        'gold_mssnr_scalper_1m','watukushay_no1'
      )
    GROUP BY strategy_id, reason
    ORDER BY strategy_id, count(*) DESC
  `);

  let current = "";
  for (const row of res.rows) {
    if (row.strategy_id !== current) {
      console.log(`\n  ${"=".repeat(50)}`);
      console.log(`  STRATEGY: ${row.strategy_id}`);
      console.log(`  ${"=".repeat(50)}`);
      current = row.strategy_id;
    }
    // Truncate reason to keep it readable
    let reason = row.reason;
    if (reason.length > 80) reason = reason.substring(0, 77) + "...";
    console.log(`    ${reason.padEnd(80)} x${row.cnt.toString().padStart(5)}  [last: ${row.last_seen}]`);
  }

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
