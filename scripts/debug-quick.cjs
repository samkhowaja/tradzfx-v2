const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const pool = new Pool(getDbConfig());

(async () => {
  try {
    const r1 = await pool.query("SELECT reason, COUNT(*)::int AS cnt FROM live_signal_rejection WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY reason ORDER BY cnt DESC");
    console.log("REJECTIONS:", JSON.stringify(r1.rows, null, 2));

    const r2 = await pool.query("SELECT COUNT(*)::int AS cnt FROM candles_1m WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '1 hour'");
    console.log("XAUUSD 1h candles:", JSON.stringify(r2.rows));

    const r3 = await pool.query("SELECT symbol, session, p50, p95, p99 FROM market_volatility_profile WHERE symbol IN ('XAUUSD','EURUSD') ORDER BY symbol, session");
    console.log("VOLATILITY_PROFILE:", JSON.stringify(r3.rows, null, 2));

    const r4 = await pool.query("SELECT variant_id, symbol, COUNT(*)::int AS rej FROM live_signal_rejection WHERE created_at >= NOW() - INTERVAL '24 hours' AND reason LIKE '%volatility%' GROUP BY variant_id, symbol ORDER BY rej DESC LIMIT 20");
    console.log("VOL_REJ_BY_VARIANT:", JSON.stringify(r4.rows, null, 2));

    const r5 = await pool.query("SELECT MAX(ts) AS last_ts FROM candles_1m WHERE symbol = 'XAUUSD'");
    console.log("XAUUSD last candle:", JSON.stringify(r5.rows));

    const r6 = await pool.query("SELECT variant_id, spec ->> 'filters' AS filters FROM strategy_variants WHERE is_active = true");
    console.log("VARIANT FILTERS:", JSON.stringify(r6.rows.map(r => ({ variant_id: r.variant_id, filters: r.filters })), null, 2));
  } catch (e) {
    console.error("ERROR:", e.message);
  }
  await pool.end();
})();
