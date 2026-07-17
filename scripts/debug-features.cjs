const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const pool = new Pool(getDbConfig());

async function main() {
  try {
    // 1. Check features_structure - needed by gold_mssnr_scalper_1m
    const r1 = await pool.query(`
      SELECT count(*)::int, max(ts) as latest_ts
      FROM features_structure
      WHERE symbol='XAUUSD' AND tf='5m' AND ts > NOW() - INTERVAL '48 hours'
    `);
    console.log("STRUCTURE 5m XAUUSD (48h):", JSON.stringify(r1.rows));

    // 2. Check what bias data exists for each tf
    const r2 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_bias
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("BIAS XAUUSD (24h):", JSON.stringify(r2.rows));

    // 3. Check direction_state - may be used as bias for some
    const r3 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_direction_state
      WHERE symbol='XAUUSD'
      GROUP BY tf ORDER BY tf
    `);
    console.log("DIRECTION_STATE XAUUSD (all):", JSON.stringify(r3.rows));

    // 4. Check features_zone for orb_classic (zone strategy)
    const r4 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_zone
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("ZONE XAUUSD (24h):", JSON.stringify(r4.rows));

    // 5. Check features_pricing
    const r5 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_pricing
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("PRICING XAUUSD (24h):", JSON.stringify(r5.rows));

    // 6. Check features_candle_pattern
    const r6 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts,
        (SELECT string_agg(DISTINCT pattern_name, ',') FROM features_candle_pattern
         WHERE symbol='XAUUSD' AND tf='1m' AND ts > NOW() - INTERVAL '6 hours') as patterns
      FROM features_candle_pattern
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '6 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("CANDLE_PATTERN XAUUSD (6h):", JSON.stringify(r6.rows));

    // 7. Check features_sweep
    const r7 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_sweep
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("SWEEP XAUUSD (24h):", JSON.stringify(r7.rows));

    // 8. Check features_displacement
    const r8 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_displacement
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("DISPLACEMENT XAUUSD (24h):", JSON.stringify(r8.rows));

    // 9. Check features_ifvg 
    const r9 = await pool.query(`
      SELECT count(*)::int, max(ts) as latest_ts
      FROM features_ifvg
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
    `);
    console.log("IFVG XAUUSD (24h):", JSON.stringify(r9.rows));

    // 10. Check features_spread
    const r10 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_spread
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("SPREAD XAUUSD (24h):", JSON.stringify(r10.rows));

    // 11. Check features_session_hl
    const r11 = await pool.query(`
      SELECT count(*)::int, max(ts) as latest_ts
      FROM features_session_hl
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
    `);
    console.log("SESSION_HL XAUUSD (24h):", JSON.stringify(r11.rows));

    // 12. Check features_order_block
    const r12 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_order_block
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("ORDER_BLOCK XAUUSD (24h):", JSON.stringify(r12.rows));

    // 13. Check features_eq_liquidity
    const r13 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_eq_liquidity
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("EQ_LIQUIDITY XAUUSD (24h):", JSON.stringify(r13.rows));

    // 14. Check features_atr 
    const r14 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_atr
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("ATR XAUUSD (24h):", JSON.stringify(r14.rows));

    // 15. Check features_pivot
    const r15 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_pivot
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("PIVOT XAUUSD (24h):", JSON.stringify(r15.rows));

    // 16. Check features_correlation
    const r16 = await pool.query(`
      SELECT count(*)::int, max(ts) as latest_ts
      FROM features_correlation
      WHERE ts > NOW() - INTERVAL '24 hours'
    `);
    console.log("CORRELATION (24h):", JSON.stringify(r16.rows));

    // 17. Check features_liquidity_pools
    const r17 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_liquidity_pools
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("LIQUIDITY_POOLS XAUUSD (24h):", JSON.stringify(r17.rows));

    // 18. Direct SQL test: what would scalper_20sma_1m produce?
    // This uses features_bias (5m) + features_zone (5m) + features_candle_pattern (1m)
    // Let's check if features_bias has any non-neutral direction rows for EURUSD
    const r18 = await pool.query(`
      SELECT direction, count(*)::int, max(ts) as latest_ts
      FROM features_bias
      WHERE symbol='EURUSD' AND tf='5m' AND direction != 'neutral' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY direction ORDER BY direction
    `);
    console.log("BIAS EURUSD 5m non-neutral (24h):", JSON.stringify(r18.rows));

    // 19. Check if any zone exists for EURUSD 5m
    const r19 = await pool.query(`
      SELECT zone_kind, direction, count(*)::int, max(ts) as latest_ts
      FROM features_zone
      WHERE symbol='EURUSD' AND tf='5m' AND ts > NOW() - INTERVAL '24 hours'
        AND mitigated_at IS NULL
        AND invalidated_at IS NULL
      GROUP BY zone_kind, direction ORDER BY zone_kind, direction
    `);
    console.log("ZONE EURUSD 5m unmitigated (24h):", JSON.stringify(r19.rows));

    // 20. Check if candle_pattern for EURUSD 1m
    const r20 = await pool.query(`
      SELECT direction, pattern_name, confidence, ts
      FROM features_candle_pattern
      WHERE symbol='EURUSD' AND tf='1m' AND ts > NOW() - INTERVAL '6 hours'
        AND direction IN ('bullish','bearish')
        AND confidence >= 0.5
      ORDER BY ts DESC LIMIT 20
    `);
    console.log("CANDLE_PATTERN EURUSD 1m confident (6h):", JSON.stringify(r20.rows));

    // 21. Direct query: bias_candidates for orb_classic (features_bias)
    const r21 = await pool.query(`
      SELECT direction, count(*)::int, max(ts) as latest_ts
      FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m' AND ts > NOW() - INTERVAL '48 hours'
      GROUP BY direction ORDER BY direction
    `);
    console.log("ORB BIAS XAUUSD 15m (48h):", JSON.stringify(r21.rows));

    // 22. Check features_session for session data
    const r22 = await pool.query(`
      SELECT session, count(*)::int, max(ts) as latest_ts
      FROM features_session
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY session ORDER BY session
    `);
    console.log("SESSION XAUUSD (24h):", JSON.stringify(r22.rows));

    // 23. Check features_time_of_day_edge
    const r23 = await pool.query(`
      SELECT count(*)::int, max(ts) as latest_ts
      FROM features_time_of_day_edge
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
    `);
    console.log("TIME_OF_DAY_EDGE XAUUSD (24h):", JSON.stringify(r23.rows));

    // 24. Check features_fvg
    const r24 = await pool.query(`
      SELECT tf, count(*)::int, max(ts) as latest_ts
      FROM features_fvg
      WHERE symbol='XAUUSD' AND ts > NOW() - INTERVAL '24 hours'
      GROUP BY tf ORDER BY tf
    `);
    console.log("FVG XAUUSD (24h):", JSON.stringify(r24.rows));

  } catch (e) {
    console.error("ERROR:", e.message);
  }
  await pool.end();
}

main();
