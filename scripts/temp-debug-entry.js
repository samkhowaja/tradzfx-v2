const {Client} = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();

  // Strat 3: Show DB spec to confirm entry TFs and lookback settings
  const spec3 = await c.query(`SELECT base_spec FROM strategy_families WHERE name='gold_scalp_3_choch_fvg'`);
  const s3 = spec3.rows[0]?.base_spec;
  console.log('Setup entries:');
  if (s3?.setup) s3.setup.forEach((x,i) => console.log(`  setup[${i}]:`, JSON.stringify(x)));
  if (s3?.entry) s3.entry.forEach((x,i) => console.log(`  entry[${i}]:`, JSON.stringify(x)));

  // Now check ifvg row counts with LOOKBACK SIMILAR TO COMPILER
  // Compiler uses buildLookbackInterval -> if cond.lookbackBars exists use it, else registry defaultLookbackBars
  // Registry ifvg defaultLookbackBars=96 for 15m = 24h
  console.log('\n--- Checking entry LATERAL for strat 3 ---');
  const q = await c.query(`
    WITH setup_candidates AS (
      SELECT ts, 'bullish'::text as bias_direction
      FROM features_bias
      WHERE symbol='XAUUSD' AND tf='1h' AND direction='bullish'
        AND ts >= '2026-07-07' AND ts < '2026-07-10'
        AND EXISTS (SELECT 1 FROM features_structure st WHERE st.symbol='XAUUSD' AND st.tf='1h'
          AND st.ts <= features_bias.ts AND st.ts >= features_bias.ts - interval '240 hours'
          AND st.event_type='bos' AND st.direction='bullish')
        AND EXISTS (SELECT 1 FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='1h'
          AND z.ts <= features_bias.ts AND z.ts >= features_bias.ts - interval '240 hours'
          AND z.zone_kind='fvg' AND (z.fill_pct IS NULL OR z.fill_pct<0.8)
          AND (z.mitigated_at IS NULL OR z.mitigated_at>features_bias.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at>features_bias.ts))
    )
    SELECT s.ts::text,
      (SELECT jsonb_agg(jsonb_build_object('ts', f.ts, 'direction', f.direction, 'strength', f.strength_score))
        FROM features_ifvg f
        WHERE f.symbol='XAUUSD' AND f.tf='15m'
          AND f.ts <= s.ts AND f.ts >= s.ts - interval '24 hours'
          AND f.direction = s.bias_direction
          AND (f.invalidated_at IS NULL OR f.invalidated_at > s.ts)
      ) as ifvg_rows,
      (SELECT count(*)::int FROM features_ifvg f
        WHERE f.symbol='XAUUSD' AND f.tf='15m'
          AND f.ts <= s.ts AND f.ts >= s.ts - interval '24 hours'
          AND f.direction = s.bias_direction
          AND (f.invalidated_at IS NULL OR f.invalidated_at > s.ts)
      ) as ifvg_cnt
    FROM setup_candidates s
    ORDER BY s.ts
  `);
  
  let totalWithIfvg = 0;
  for (const row of q.rows) {
    const cnt = parseInt(row.ifvg_cnt || '0');
    if (cnt > 0) {
      totalWithIfvg++;
      console.log(`  ${row.ts}: ifvg_cnt=${cnt}, rows=${JSON.stringify(row.ifvg_rows)}`);
    }
  }
  console.log(`\nTotal setup candidates with IFVG: ${totalWithIfvg}/${q.rows.length}`);

  // Now check: maybe the issue is that the compiler's LATERAL uses DISTINCT ON 
  // and the tieBreaker filters our rows
  console.log('\n--- Checking IFVG row before/after each bias timestamp ---');
  const q2 = await c.query(`
    WITH setup_ts AS (
      SELECT ts FROM features_bias
      WHERE symbol='XAUUSD' AND tf='1h' AND direction='bullish'
        AND ts >= '2026-07-07 11:00' AND ts < '2026-07-07 12:00'
    )
    SELECT s.ts::text as bias_ts,
      (SELECT jsonb_agg(jsonb_build_object('ts', f.ts, 'strength', f.strength_score, 'top', f.top, 'bottom', f.bottom))
        FROM (
          SELECT ts, strength_score, top, bottom FROM features_ifvg
          WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
            AND ts <= s.ts AND ts >= s.ts - interval '24 hours'
            AND (invalidated_at IS NULL OR invalidated_at > s.ts)
          ORDER BY strength_score DESC NULLS LAST, ts DESC
          LIMIT 3
        ) f
      ) as best_ifvg
    FROM setup_ts s
  `);
  for (const row of q2.rows) {
    console.log(`  bias ${row.bias_ts}: best_ifvg=${JSON.stringify(row.best_ifvg)}`);
  }

  await c.end();
})();
