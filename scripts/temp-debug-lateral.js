const {Client} = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();

  // Simulate PIT-style LATERAL entry join for one setup row
  // Strat 3: ifvg (required), structure (optional), ob (optional)
  console.log('=== PIT entry LATERAL for bias=2026-07-07 20:00 (strat 3, 15m) ===');
  const cj = await c.query(`
    WITH bias_ts AS (
      SELECT ts::timestamptz, 'bullish'::text as bias_direction FROM features_bias 
      WHERE symbol='XAUUSD' AND tf='1h' AND ts='2026-07-07 20:00:00+00'
    )
    SELECT b.ts::text, 
      f.ts::text as fvg_ts, f.strength_score,
      s.ts::text as s_ts, s.event_type,
      o.ts::text as ob_ts, o.ob_kind
    FROM bias_ts b
    LEFT JOIN LATERAL (
      SELECT ts, strength_score FROM features_ifvg 
      WHERE symbol='XAUUSD' AND tf='15m' AND ts<=b.ts AND ts>=b.ts-interval '24 hours'
      AND direction=b.bias_direction AND (invalidated_at IS NULL OR invalidated_at>b.ts)
      ORDER BY strength_score DESC NULLS LAST, ts DESC LIMIT 1
    ) f ON true
    LEFT JOIN LATERAL (
      SELECT ts, event_type FROM features_structure
      WHERE symbol='XAUUSD' AND tf='15m' AND ts<=b.ts AND ts>=b.ts-interval '24 hours'
      AND event_type IN ('bos','mss') AND direction=b.bias_direction AND (invalidated_at IS NULL OR invalidated_at>b.ts)
      ORDER BY ts DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT ts, ob_kind FROM features_order_block
      WHERE symbol='XAUUSD' AND tf='15m' AND ts<=b.ts AND ts>=b.ts-interval '24 hours'
      AND ob_kind='bullish' AND (mitigated_at IS NULL OR mitigated_at>b.ts) AND (invalidated_at IS NULL OR invalidated_at>b.ts)
      ORDER BY ts DESC LIMIT 1
    ) o ON true
  `);
  cj.rows.forEach(x => console.log(`  fvg_ts=${x.fvg_ts} s_ts=${x.s_ts} ob_ts=${x.ob_ts}`));

  // Check what compiler actually sees at signal-generation level
  console.log('\n=== Strat 2 entry candidates (5m, 8h lookback) ===');
  const s2 = await c.query(`
    WITH setup_ts AS (
      SELECT ts, 'bullish'::text as bias_dir FROM features_bias
      WHERE symbol='XAUUSD' AND tf='1h' AND direction='bullish'
        AND ts>='2026-07-07' AND ts<'2026-07-10'
        AND EXISTS(SELECT 1 FROM features_structure st WHERE st.symbol='XAUUSD' AND st.tf='1h'
          AND st.ts<=features_bias.ts AND st.ts>=features_bias.ts-interval '10 days'
          AND st.event_type='bos' AND st.direction='bullish')
        AND EXISTS(SELECT 1 FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='1h'
          AND z.ts<=features_bias.ts AND z.ts>=features_bias.ts-interval '10 days'
          AND z.zone_kind='demand' AND (z.fill_pct IS NULL OR z.fill_pct<0.8)
          AND (z.mitigated_at IS NULL OR z.mitigated_at>features_bias.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at>features_bias.ts))
    )
    SELECT s.ts::text,
      (SELECT count(*)::int FROM features_structure s2 WHERE s2.symbol='XAUUSD' AND s2.tf='5m'
        AND s2.ts<=s.ts AND s2.ts>=s.ts-interval '8 hours'
        AND s2.event_type IN ('bos','mss') AND s2.direction='bearish'
        AND (s2.invalidated_at IS NULL OR s2.invalidated_at>s.ts)
      ) as mss_bear_cnt,
      (SELECT count(*)::int FROM features_structure s3 WHERE s3.symbol='XAUUSD' AND s3.tf='5m'
        AND s3.ts<=s.ts AND s3.ts>=s.ts-interval '8 hours'
        AND s3.event_type IN ('bos','mss') AND s3.direction='bullish'
        AND (s3.invalidated_at IS NULL OR s3.invalidated_at>s.ts)
      ) as bos_bull_cnt,
      (SELECT count(*)::int FROM features_order_block ob WHERE ob.symbol='XAUUSD' AND ob.tf='5m'
        AND ob.ts<=s.ts AND ob.ts>=s.ts-interval '8 hours'
        AND ob.ob_kind='bullish' AND ob.degree IN ('major','swing')
        AND (ob.mitigated_at IS NULL OR ob.mitigated_at>s.ts) AND (ob.invalidated_at IS NULL OR ob.invalidated_at>s.ts)
      ) as ob_cnt,
      (SELECT count(*)::int FROM features_ifvg f WHERE f.symbol='XAUUSD' AND f.tf='5m'
        AND f.ts<=s.ts AND f.ts>=s.ts-interval '8 hours'
        AND f.direction='bullish' AND (f.invalidated_at IS NULL OR f.invalidated_at>s.ts)
      ) as ifvg_cnt
    FROM setup_ts s ORDER BY s.ts
  `);
  let s2hasEntry = 0;
  for (const row of s2.rows) {
    if (parseInt(row.mss_bear_cnt) > 0 && parseInt(row.bos_bull_cnt) > 0 && parseInt(row.ob_cnt) > 0) {
      s2hasEntry++;
      console.log(`  ✅ ${row.ts}: mss_bear=${row.mss_bear_cnt} bos_bull=${row.bos_bull_cnt} ob=${row.ob_cnt} ifvg=${row.ifvg_cnt}`);
    }
  }
  console.log(`  Total full entry candidates: ${s2hasEntry}/${s2.rows.length}`);

  // 5m feature counts
  console.log('\n=== 5m feature rows July 7-9 ===');
  for (const ft of ['features_structure', 'features_order_block', 'features_ifvg']) {
    const rr = await c.query(`SELECT count(*)::int c FROM ${ft} WHERE symbol='XAUUSD' AND tf='5m' AND ts>='2026-07-07' AND ts<'2026-07-10'`);
    console.log(`  ${ft}: ${rr.rows[0].c}`);
  }

  await c.end();
})();
