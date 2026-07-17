const { Pool } = require('pg');
const { getDbConfig } = require('./db-config.cjs');
const pool = new Pool(getDbConfig());

async function main() {
  // July 3+ setups with structure+zone but no iFVG
  const r = await pool.query(`
    SELECT b.ts as bias_ts
    FROM features_bias b
    CROSS JOIN LATERAL (
      SELECT ts FROM features_structure
      WHERE symbol=b.symbol AND tf='1h' AND ts<=b.ts AND ts>=b.ts-INTERVAL '8 hours'
        AND event_type='bos' AND direction='bullish'
        AND (invalidated_at IS NULL OR invalidated_at>b.ts)
      ORDER BY event_type, direction, strength DESC NULLS LAST, ts DESC LIMIT 1
    ) s
    CROSS JOIN LATERAL (
      SELECT ts FROM features_zone
      WHERE symbol=b.symbol AND tf='1h' AND ts<=b.ts AND ts>=b.ts-INTERVAL '10 days'
        AND zone_kind='fvg' AND fill_pct<0.8
        AND (invalidated_at IS NULL OR invalidated_at>b.ts)
      ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC LIMIT 1
    ) z
    WHERE b.tf='1h' AND b.symbol='XAUUSD' AND b.direction='bullish'
      AND b.ts>='2026-07-03' AND b.ts<='2026-07-13'
      AND (EXTRACT(HOUR FROM b.ts)*60+EXTRACT(MINUTE FROM b.ts) BETWEEN 420 AND 660
        OR EXTRACT(HOUR FROM b.ts)*60+EXTRACT(MINUTE FROM b.ts) BETWEEN 780 AND 990)
    ORDER BY b.ts
  `);
  console.log('July 3+ setups:', r.rows.length);
  r.rows.forEach(x => console.log(' ', x.bias_ts.toISOString()));

  // For each of these, check if any iFVG exists in 24h lookback
  if (r.rows.length > 0) {
    console.log('\niFVG check per setup:');
    for (const row of r.rows) {
      const bt = row.bias_ts;
      const i = await pool.query(`
        SELECT count(*) as cnt, max(ts) as latest_ts
        FROM features_ifvg
        WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
          AND ts <= $1::timestamptz AND ts >= $1::timestamptz - INTERVAL '1 days'
          AND (mitigated_at IS NULL OR mitigated_at > $1::timestamptz)
          AND (invalidated_at IS NULL OR invalidated_at > $1::timestamptz)
      `, [bt]);
      console.log(`  ${bt.toISOString()}: ${i.rows[0].cnt} iFVG, latest=${i.rows[0].latest_ts?.(toISOString?.()) || 'none'}`);
    }
  }

  // Also check: what structure BOS exists
  const structCount = await pool.query(`
    SELECT date_trunc('day', ts) as day, count(*) as cnt
    FROM features_structure
    WHERE symbol='XAUUSD' AND tf='1h' AND event_type='bos' AND direction='bullish'
      AND ts>='2026-06-13' AND ts<='2026-07-13'
    GROUP BY 1 ORDER BY 1
  `);
  console.log('\nStructure BOS bullish 1h per day:');
  structCount.rows.forEach(r => console.log(`  ${r.day.toISOString().slice(0,10)}: ${r.cnt}`));

  await pool.end();
}

main().catch(console.error);
