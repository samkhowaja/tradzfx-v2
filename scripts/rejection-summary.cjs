const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost", port: 5432, database: "tradzfx_v2",
  user: "postgres", password: "2k16Dub@i",
});

async function main() {
  const r = await pool.query(`
    SELECT strategy_id, reason, count(*)::int as cnt
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

  let cur = "";
  const summary = {};

  for (const row of r.rows) {
    if (row.strategy_id !== cur) {
      console.log(`\n=== ${row.strategy_id} ===`);
      cur = row.strategy_id;
      summary[row.strategy_id] = { no_signal: 0, stale_signal: 0, stale_data: 0, volatility: 0, other: 0 };
    }
    
    let cat = "other";
    if (row.reason.startsWith("no_signal")) cat = "no_signal";
    else if (row.reason.startsWith("stale_signal")) cat = "stale_signal";
    else if (row.reason.startsWith("stale_data")) cat = "stale_data";
    else if (row.reason.includes("volatility") || row.reason.includes("atr") || row.reason.includes("maxAtr")) cat = "volatility";
    summary[row.strategy_id][cat] += row.cnt;

    // Only print no_signal rows aggregated
    if (row.reason === "no_signal") {
      console.log(`  no_signal: ${row.cnt}`);
    } else if (!row.reason.startsWith("no_signal")) {
      // Print first few chars to distinguish
      const brief = row.reason.length > 50 ? row.reason.substring(0, 47) + "..." : row.reason;
      console.log(`  ${brief}: ${row.cnt}`);
    }
  }

  console.log("\n\n========== SUMMARY ==========");
  console.log("STRATEGY              NO_SIG  STALE_SIG  STALE_DAT  VOLAT  OTHER");
  for (const [sid, cats] of Object.entries(summary)) {
    console.log(
      `${sid.padEnd(22)} ${String(cats.no_signal).padStart(7)} ${String(cats.stale_signal).padStart(9)} ${String(cats.stale_data).padStart(9)} ${String(cats.volatility).padStart(6)} ${String(cats.other).padStart(6)}`
    );
  }

  await pool.end();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
