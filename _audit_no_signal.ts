import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getPool } from "./packages/shared/src/utils/db";

async function main() {
  const pool = getPool();

  // 1. Raw data availability at pipeline ticks - last 24h
  // Pipeline runs every 15min at :00/:15/:30/:45 UTC
  console.log("=== Pipeline ticks vs feature row counts (last 24h) ===");
  // Generate 15-min tick grid for last 24h
  const { rows: tickGrid } = await pool.query(`
    SELECT ts as tick_ts FROM generate_series(
      date_trunc('hour', NOW() - INTERVAL '24 hours') + INTERVAL '15 min' * FLOOR(date_part('minute', NOW() - INTERVAL '24 hours') / 15)::int,
      date_trunc('hour', NOW()),
      INTERVAL '15 min'
    ) ts
  `);

  // For each recent tick, check if raw data existed
  const { rows: recentTicks } = await pool.query(`
    WITH ticks AS (
      SELECT ts as tick_ts FROM generate_series(
        NOW() - INTERVAL '24 hours',
        NOW(),
        INTERVAL '15 min'
      ) ts
    )
    SELECT 
      t.tick_ts,
      (SELECT COUNT(*) FROM features_structure WHERE symbol = 'XAUUSD' AND tf = '5m' AND ts <= t.tick_ts AND ts >= t.tick_ts - INTERVAL '5 hours') AS structure_5m_rows,
      (SELECT direction FROM features_bias WHERE symbol = 'XAUUSD' AND tf = '5m' AND ts <= t.tick_ts ORDER BY ts DESC LIMIT 1) AS bias_5m_dir,
      (SELECT COUNT(*) FROM features_candle_pattern WHERE symbol = 'XAUUSD' AND tf = '1m' AND ts <= t.tick_ts AND ts >= t.tick_ts - INTERVAL '192 minutes') AS candle_1m_rows,
      (SELECT COUNT(*) FROM features_bias WHERE symbol = 'XAUUSD' AND tf = '5m' AND ts <= t.tick_ts AND ts >= t.tick_ts - INTERVAL '8 hours') AS bias_5m_rows,
      (SELECT MAX(ts) FROM candles_1m WHERE symbol = 'XAUUSD' AND ts <= t.tick_ts) AS latest_candle_ts
    FROM ticks t
    ORDER BY t.tick_ts DESC
    LIMIT 48
  `);
  for (const r of recentTicks) {
    const candleLag = r.latest_candle_ts ? (new Date(r.tick_ts).getTime() - new Date(r.latest_candle_ts).getTime()) / 60000 : -1;
    console.log(
      r.tick_ts.toISOString().slice(11,16),
      "struct5m:", String(r.structure_5m_rows).padStart(2),
      "bias5m:", String(r.bias_5m_rows).padStart(2), r.bias_5m_dir?.padStart(7) ?? " NULL  ",
      "candle1m:", String(r.candle_1m_rows).padStart(2),
      "candleLag:", candleLag.toFixed(0)+"m",
      candleLag > 10 ? "⚠️ STALE" : ""
    );
  }

  // 2. What does the compiled SQL actually return now?
  console.log("\n=== Compiled SQL execution result ===");
  const { rows: signalResult } = await pool.query(`
    WITH bias_candidates AS (
      SELECT symbol, ts, direction, regime
      FROM features_bias
      WHERE tf = '5m'
        AND ts >= NOW() - INTERVAL '24 hours'
    ),
    setup_candidates AS (
      SELECT b.symbol, b.ts, b.direction as bias_direction
      FROM bias_candidates b,
      LATERAL (
        SELECT DISTINCT ON (symbol, event_type, direction) *
        FROM features_structure
        WHERE symbol = b.symbol
          AND tf = '5m'
        AND features_structure.ts <= b.ts
        AND features_structure.ts >= b.ts - INTERVAL '5 hours'
          AND (features_structure.invalidated_at IS NULL OR features_structure.invalidated_at > b.ts)
        ORDER BY symbol, event_type, direction, CASE strength WHEN 'strong' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END DESC NULLS LAST, ts DESC
      ) AS pit_structure_trend
      WHERE (pit_structure_trend.event_type IN ('bos', 'mss') AND pit_structure_trend.direction IN ('bullish', 'bearish') AND (pit_structure_trend.invalidated_at IS NULL OR pit_structure_trend.invalidated_at > b.ts))
        AND (b.direction = 'bearish')
    ),
    entry_signals AS (
      SELECT DISTINCT ON (s.symbol, s.ts) s.symbol, s.ts, s.bias_direction
      FROM setup_candidates s,
      LATERAL (
        SELECT DISTINCT ON (symbol, pattern_name, direction) *
        FROM features_candle_pattern
        WHERE symbol = s.symbol
          AND tf = '1m'
        AND features_candle_pattern.ts <= s.ts
        AND features_candle_pattern.ts >= s.ts - INTERVAL '192 minutes'
        AND direction = 'bearish'
        ORDER BY symbol, pattern_name, direction, confidence DESC NULLS LAST, ts DESC
      ) AS pit_candle_confirmation
      WHERE (pit_candle_confirmation.direction = 'bearish' AND pit_candle_confirmation.pattern_name IN ('engulfing_bear', 'evening_star', 'hanging_man', 'pin_bar', 'three_black_crows', 'wick_close_bear') AND pit_candle_confirmation.confidence >= 0.5)
    )
    SELECT COUNT(*) as signal_count FROM entry_signals
  `);
  console.log("Current signal count:", signalResult[0]?.signal_count);

  // 3. Check each stage count separately
  console.log("\n=== Stage-by-stage counts ===");
  const { rows: biasCount } = await pool.query(`
    SELECT COUNT(*) as cnt FROM features_bias WHERE symbol='XAUUSD' AND tf='5m' AND ts >= NOW() - INTERVAL '24 hours' AND direction='bearish'
  `);
  console.log("Bias 5m bearish rows:", biasCount[0]?.cnt);

  const { rows: structCount } = await pool.query(`
    SELECT COUNT(*) as cnt FROM features_structure WHERE symbol='XAUUSD' AND tf='5m' AND ts >= NOW() - INTERVAL '24 hours' AND event_type IN ('bos','mss')
  `);
  console.log("Structure 5m BOS/MSS rows:", structCount[0]?.cnt);

  const { rows: structBearish } = await pool.query(`
    SELECT COUNT(*) as cnt FROM features_structure WHERE symbol='XAUUSD' AND tf='5m' AND ts >= NOW() - INTERVAL '24 hours' AND event_type IN ('bos','mss') AND direction='bearish'
  `);
  console.log("Structure 5m bearish BOS/MSS:", structBearish[0]?.cnt);

  const { rows: candleBearish } = await pool.query(`
    SELECT COUNT(*) as cnt FROM features_candle_pattern WHERE symbol='XAUUSD' AND tf='1m' AND ts >= NOW() - INTERVAL '24 hours' AND direction='bearish' AND confidence >= 0.5
  `);
  console.log("Candle 1m bearish conf>=0.5:", candleBearish[0]?.cnt);

  const { rows: candlePatterns } = await pool.query(`
    SELECT pattern_name, COUNT(*) as cnt, ROUND(AVG(confidence)::numeric,2) as avg_conf
    FROM features_candle_pattern WHERE symbol='XAUUSD' AND tf='1m' AND ts >= NOW() - INTERVAL '24 hours' AND direction='bearish'
    GROUP BY pattern_name ORDER BY cnt DESC
  `);
  console.log("Candle 1m bearish pattern breakdown:");
  for (const r of candlePatterns) console.log("  ", r.pattern_name, r.cnt, "avg_conf:", r.avg_conf);

  // 4. Check if any join produces rows but then is filtered
  console.log("\n=== Debug: FULL join output check (no predicate filters) ===");
  const { rows: joinCheck } = await pool.query(`
    WITH recent_bias AS (
      SELECT ts, direction FROM features_bias 
      WHERE symbol='XAUUSD' AND tf='5m' AND ts >= NOW() - INTERVAL '6 hours' AND direction='bearish'
      ORDER BY ts DESC LIMIT 20
    ),
    recent_structure AS (
      SELECT ts, event_type, direction, strength FROM features_structure 
      WHERE symbol='XAUUSD' AND tf='5m' AND ts >= NOW() - INTERVAL '6 hours'
      ORDER BY ts DESC LIMIT 20
    )
    SELECT 'bias' as source, ts, direction as val FROM recent_bias
    UNION ALL
    SELECT 'structure_5m', ts, event_type || '/' || direction || '/' || COALESCE(strength,'normal'), NULL FROM recent_structure
    ORDER BY ts DESC
  `);
  for (const r of joinCheck) console.log(" ", r.ts.toISOString().slice(11,19), r.source, r.val);

  await pool.end();
}
main().catch(console.error);
