// Check temporal alignment: when are iFVGs vs setups?
const { Pool } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const pool = new Pool({ connectionString: getDbConnectionString() });

async function main() {
  // iFVG bullish 15m distribution
  const ifvg = await pool.query(`
    SELECT ts, strength_score, mitigated_at, invalidated_at
    FROM features_ifvg
    WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
      AND ts >= '2026-06-13' AND ts <= '2026-07-13'
    ORDER BY ts
  `);
  console.log('=== iFVG bullish 15m ===');
  ifvg.rows.forEach(r => console.log(`  ${r.ts.toISOString()} strength=${r.strength_score} mitigated=${r.mitigated_at} invalidated=${r.invalidated_at}`));

  // Also check: for each setup timestamp, what's the LATEST iFVG BEFORE it?
  const setupTimestamps = ['2026-07-01T13:00:00Z', '2026-07-01T14:00:00Z', '2026-07-01T15:00:00Z',
    '2026-07-02T13:00:00Z', '2026-07-02T14:00:00Z', '2026-07-02T15:00:00Z'];
  
  console.log('\n=== Nearest iFVG to each setup time ===');
  for (const sts of setupTimestamps) {
    const before = await pool.query(`
      SELECT ts, strength_score FROM features_ifvg
      WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
        AND ts <= $1::timestamptz
      ORDER BY ts DESC LIMIT 1
    `, [sts]);
    const after = await pool.query(`
      SELECT ts, strength_score FROM features_ifvg
      WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
        AND ts >= $1::timestamptz
      ORDER BY ts ASC LIMIT 1
    `, [sts]);
    console.log(`  Setup ${sts}: nearest BEFORE=${before.rows[0]?.ts.toISOString() || 'NONE'} (${sts} - ${before.rows[0]?.ts ? (new Date(sts).getTime() - before.rows[0]?.ts.getTime())/3600000 + 'h ago' : 'N/A'}) AFTER=${after.rows[0]?.ts.toISOString() || 'NONE'}`);
  }

  // Check bias < 8h from structure BOS configuration
  // The issue is that structure lookback (8h) means structure needs BOS < 8h before bias
  const structCheck = await pool.query(`
    SELECT b.ts as bias_ts, s.ts as struct_ts, s.event_type, s.direction, 
      (b.ts - s.ts) as age
    FROM features_bias b
    CROSS JOIN LATERAL (
      SELECT DISTINCT ON (symbol, event_type, direction) *
      FROM features_structure
      WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '8 hours'
        AND event_type = 'bos' AND direction = 'bullish'
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, event_type, direction, strength DESC NULLS LAST, ts DESC
    ) s
    WHERE b.tf='1h' AND b.symbol='XAUUSD' AND b.direction='bullish'
      AND b.ts >= '2026-06-13' AND b.ts <= '2026-07-13'
      AND (EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 420 AND 660
        OR EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 780 AND 990)
    ORDER BY b.ts
  `);
  console.log('\n=== Bias+Structure matches (LATERAL) ===');
  structCheck.rows.forEach(r => console.log(`  bias=${r.bias_ts.toISOString()} struct=${r.struct_ts.toISOString()} age=${r.age}`));

  // Also check what FVG zones exist
  const zones = await pool.query(`
    SELECT ts, zone_kind, direction, fill_pct
    FROM features_zone
    WHERE symbol='XAUUSD' AND tf='1h' AND zone_kind='fvg'
      AND ts >= '2026-06-20' AND ts <= '2026-07-13'
    ORDER BY ts
  `);
  console.log(`\n=== FVG zones 1h (${zones.rows.length}) ===`);
  zones.rows.forEach(r => console.log(`  ${r.ts.toISOString()} fill=${r.fill_pct} dir=${r.direction}`));

  await pool.end();
}

main().catch(console.error);
