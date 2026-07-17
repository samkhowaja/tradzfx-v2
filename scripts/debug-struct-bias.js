const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2' });

async function main() {
  // Structure BOS bullish 1h events with details
  const struct = await pool.query(`
    SELECT ts, direction, strength, invalidated_at
    FROM features_structure
    WHERE symbol='XAUUSD' AND tf='1h' AND event_type='bos' AND direction='bullish'
      AND ts>='2026-06-13' AND ts<='2026-07-13'
    ORDER BY ts
  `);
  console.log('=== Structure BOS bullish 1h ===');
  struct.rows.forEach(r => console.log(`  ${r.ts.toISOString()} str=${r.strength} invalidated=${r.invalidated_at?.toISOString?.() || r.invalidated_at}`));

  // For each structure BOS, check if there's a bullish bias within 8h AFTER during trading hours
  console.log('\n=== Structure -> bias following within 8h ===');
  for (const row of struct.rows) {
    const st = row.ts;
    const biasAfter = await pool.query(`
      SELECT ts FROM features_bias
      WHERE symbol='XAUUSD' AND tf='1h' AND direction='bullish'
        AND ts > $1::timestamptz AND ts <= $1::timestamptz + INTERVAL '8 hours'
        AND (EXTRACT(HOUR FROM ts)*60+EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
          OR EXTRACT(HOUR FROM ts)*60+EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
      ORDER BY ts
    `, [st]);
    if (biasAfter.rows.length > 0) {
      console.log(`  Struct at ${st.toISOString()}: Following bias ->`);
      biasAfter.rows.forEach(b => console.log(`    ${b.ts.toISOString()}`));
    } else {
      console.log(`  Struct at ${st.toISOString()}: NO following bullish bias in trading hours`);
    }
  }

  // Also check if we need to extend structure lookback
  console.log('\n=== Expanding structure lookback test ===');
  for (const hours of [12, 24, 48, 96]) {
    const r = await pool.query(`
      SELECT count(*) as cnt
      FROM features_bias b
      CROSS JOIN LATERAL (
        SELECT 1 FROM features_structure
        WHERE symbol=b.symbol AND tf='1h' AND ts<=b.ts AND ts>=b.ts-INTERVAL '${hours} hours'
          AND event_type='bos' AND direction='bullish'
          AND (invalidated_at IS NULL OR invalidated_at>b.ts)
        LIMIT 1
      ) s
      CROSS JOIN LATERAL (
        SELECT 1 FROM features_zone
        WHERE symbol=b.symbol AND tf='1h' AND ts<=b.ts AND ts>=b.ts-INTERVAL '10 days'
          AND zone_kind='fvg' AND fill_pct<0.8
          AND (invalidated_at IS NULL OR invalidated_at>b.ts)
        LIMIT 1
      ) z
      WHERE b.tf='1h' AND b.symbol='XAUUSD' AND b.direction='bullish'
        AND b.ts>='2026-06-13' AND b.ts<='2026-07-13'
        AND (EXTRACT(HOUR FROM b.ts)*60+EXTRACT(MINUTE FROM b.ts) BETWEEN 420 AND 660
          OR EXTRACT(HOUR FROM b.ts)*60+EXTRACT(MINUTE FROM b.ts) BETWEEN 780 AND 990)
    `);
    console.log(`  ${hours}h structure lookback: ${r.rows[0].cnt} setups`);
  }

  await pool.end();
}

main().catch(console.error);
