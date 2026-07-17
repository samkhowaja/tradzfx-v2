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
    // Rejection summary by strategy (last 72h)
    const r = await pool.query(`
      SELECT strategy_id, reason, count(*)::int,
        min(ts) as first_seen, max(ts) as last_seen
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
    console.log("REJECTIONS BY ACTIVE STRATEGY:");
    for (const row of r.rows) {
      console.log(`  ${row.strategy_id}: ${row.reason} x${row.cnt} [${row.first_seen} to ${row.last_seen}]`);
    }

    // Check features_moving_average freshness for all symbols
    const syms = ['EURUSD','GBPUSD','AUDUSD','NZDUSD','USDCAD','USDCHF','USDJPY','XAUUSD'];
    for (const sym of syms) {
      const r2 = await pool.query(`
        SELECT tf, ma_type, period, count(*)::int, max(ts) as latest_ts
        FROM features_moving_average
        WHERE symbol=$1 AND ts > NOW() - INTERVAL '6 hours'
        GROUP BY tf, ma_type, period ORDER BY tf, ma_type, period
      `, [sym]);
      if (r2.rows.length > 0) {
        console.log(`  MA ${sym}:`, JSON.stringify(r2.rows));
      }
    }

    // Check actual live_signal for these strategies
    const r3 = await pool.query(`
      SELECT strategy_id, count(*)::int, min(ts) as first_ts, max(ts) as last_ts
      FROM live_signal
      WHERE strategy_id IN (
        'scalper_20sma_1m','doyle_sd','gold_anti_bias_sniper_v1',
        'orb_scalper_1m','gold_9sma_scalper_1m','orb_classic',
        'gold_mssnr_scalper_1m','watukushay_no1'
      )
      GROUP BY strategy_id
    `);
    console.log("LIVE SIGNALS:");
    for (const row of r3.rows) {
      console.log(`  ${row.strategy_id}: ${row.cnt} [${row.first_ts} to ${row.last_ts}]`);
    }

    // Check features_pricing position distribution - needed by zone strategies
    const r4 = await pool.query(`
      SELECT symbol, position, count(*)::int, max(ts) as latest_ts
      FROM features_pricing
      WHERE symbol IN ('EURUSD','XAUUSD') AND tf='15m' AND ts > NOW() - INTERVAL '6 hours'
      GROUP BY symbol, position ORDER BY symbol, position
    `);
    console.log("PRICING POSITIONS (15m, 6h):", JSON.stringify(r4.rows));

    // Check if features_opening_range has ANY data or is empty
    const r5 = await pool.query(`
      SELECT tablename FROM pg_catalog.pg_tables WHERE tablename LIKE 'features_opening_range%'
    `);
    console.log("Opening range tables:", JSON.stringify(r5.rows));

    // Count and latest for opening_range across symbols
    const r6 = await pool.query(`
      SELECT symbol, count(*)::int, max(ts) as latest_ts
      FROM features_opening_range
      GROUP BY symbol ORDER BY symbol
    `);
    console.log("OPENING RANGE by symbol (all):", JSON.stringify(r6.rows));

  } catch (e) {
    console.error("ERROR:", e.message);
  }
  await pool.end();
}

main();
