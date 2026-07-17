const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost", port: 5432, database: "tradzfx_v2",
  user: "postgres", password: "2k16Dub@i",
});

async function main() {
  const r = await pool.query(`
    SELECT strategy_id,
      CASE
        WHEN reason = 'no_signal' THEN 'no_signal'
        WHEN reason LIKE 'stale_signal%' THEN 'stale_signal'
        WHEN reason LIKE 'stale_data%' THEN 'stale_data'
        WHEN reason LIKE 'stale_state%' THEN 'stale_state'
        WHEN reason LIKE '%volatil%' OR reason LIKE '%atr%' THEN 'volatility'
        ELSE 'other'
      END as cat,
      count(*)::int as cnt
    FROM live_signal_rejection
    WHERE ts > NOW() - INTERVAL '72 hours'
      AND strategy_id IN (
        'scalper_20sma_1m','doyle_sd','gold_anti_bias_sniper_v1',
        'orb_scalper_1m','gold_9sma_scalper_1m','orb_classic',
        'gold_mssnr_scalper_1m','watukushay_no1'
      )
    GROUP BY strategy_id, cat
    ORDER BY strategy_id, cat
  `);

  let s = "";
  for (const row of r.rows) {
    if (row.strategy_id !== s) {
      console.log(`\n  ${row.strategy_id}`);
      s = row.strategy_id;
    }
    console.log(`    ${row.cat}: ${row.cnt}`);
  }

  await pool.end();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
