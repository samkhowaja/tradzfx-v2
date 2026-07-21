const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://tradzfx:tradzfx@localhost:5432/tradzfx_v2' });
async function main() {
  const q = [
    "WITH bias_candidates AS (",
    "SELECT symbol, ts, direction",
    "FROM features_bias",
    "WHERE tf = '1d'",
    "  AND ts >= '2026-04-22'::timestamptz AND ts <= '2026-07-21'::timestamptz",
    "  AND symbol = 'XAUUSD'",
    ")",
    ", setup_candidates AS (",
    "SELECT b.symbol, b.ts, b.direction as bias_direction,",
    "  pit_push_pull.direction as signal_direction",
    "FROM bias_candidates b",
    "LEFT JOIN LATERAL (",
    "  SELECT direction, push_count, pull_count",
    "  FROM features_push_pull",
    "  WHERE symbol = b.symbol AND tf = '1h' AND ts <= b.ts",
    "  ORDER BY ts DESC",
    "  LIMIT 1",
    ") pit_push_pull ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT pattern_name, confidence, direction",
    "  FROM features_candle_pattern",
    "  WHERE symbol = b.symbol AND tf = '1h' AND ts <= b.ts",
    "  ORDER BY ts DESC",
    "  LIMIT 1",
    ") pit_candle_confirm ON TRUE",
    "WHERE (pit_push_pull.push_count >= 1)",
    "  AND (pit_candle_confirm.pattern_name IN ('pin_bar','engulfing_bull','engulfing_bear','hammer','hanging_man') AND pit_candle_confirm.confidence >= 0.5)",
    "  AND (b.direction IS NOT NULL AND b.direction != 'opposite')",
    ")",
    ", entry_signals AS (",
    "SELECT DISTINCT ON (s.symbol, s.ts) s.symbol, s.ts, s.bias_direction, s.signal_direction",
    "FROM setup_candidates s",
    ")",
    "SELECT",
    "  e.symbol, e.ts, e.bias_direction, e.signal_direction,",
    "  EXTRACT(HOUR FROM e.ts AT TIME ZONE 'UTC') as utc_hour,",
    "  CASE",
    "    WHEN COALESCE(e.signal_direction, e.bias_direction) = 'bullish' THEN 'buy'",
    "    WHEN COALESCE(e.signal_direction, e.bias_direction) = 'bearish' THEN 'sell'",
    "    ELSE NULL",
    "  END as side",
    "FROM entry_signals e",
    "ORDER BY e.ts DESC",
    "LIMIT 20",
  ].join('\n');
  const { rows } = await pool.query(q);
  console.log(rows.length + ' rows');
  for (const r of rows) {
    const ts = new Date(r.ts).toISOString();
    console.log(ts, 'bias:', r.bias_direction, 'signal_dir:', r.signal_direction, 'side:', r.side, 'utc_hour:', r.utc_hour);
  }
  pool.end();
}
main().catch(e => { console.error(e); pool.end(); });
