/**
 * Debug: check each of the 8 setup timestamps for iFVG availability
 */
const { Pool } = require('pg');
const path = require('path');
const { getDbConfig } = require('./db-config.cjs');
const pool = new Pool(getDbConfig());
const { compileStrategy } = require(path.join(__dirname, '..', 'packages', 'strategies', 'dist', 'compiler.js'));

async function main() {
  const { rows } = await pool.query(`SELECT base_spec FROM strategy_families WHERE id = 'gold_scalp_3_choch_fvg'`);
  const spec = typeof rows[0].base_spec === 'string' ? JSON.parse(rows[0].base_spec) : rows[0].base_spec;

  const fromDate = new Date('2026-06-13T00:00:00Z');
  const toDate = new Date('2026-07-13T00:00:00Z');

  const compResult = compileStrategy(spec, {
    mode: 'pit', from: fromDate, to: toDate, symbol: 'XAUUSD',
    debug: true, trustStoredLifecycle: false,
  });

  // Run just the first 2 CTEs to get setup timestamps
  // We can't easily strip CTE, so just run the setup SQL directly
  const setupTsSql = `
WITH bias_candidates AS (
  SELECT symbol, ts, direction, regime
  FROM features_bias
  WHERE tf = '1h' AND symbol = 'XAUUSD'
    AND ts >= '${fromDate.toISOString()}'::timestamptz AND ts <= '${toDate.toISOString()}'::timestamptz
    AND (EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
      OR EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
),
setup_candidates AS (
  SELECT b.symbol, b.ts, b.direction as bias_direction
  FROM bias_candidates b,
  LATERAL (
    SELECT DISTINCT ON (symbol, event_type, direction) *
    FROM features_structure
    WHERE symbol = b.symbol AND tf = '1h'
      AND features_structure.ts <= b.ts
      AND features_structure.ts >= b.ts - INTERVAL '8 hours'
      AND event_type = 'bos' AND direction = 'bullish'
      AND (features_structure.invalidated_at IS NULL OR features_structure.invalidated_at > b.ts)
    ORDER BY symbol, event_type, direction, strength DESC NULLS LAST, ts DESC
  ) AS pit_htf_choch,
  LATERAL (
    SELECT DISTINCT ON (symbol, zone_kind, direction) *
    FROM features_zone
    WHERE symbol = b.symbol AND tf = '1h'
      AND features_zone.ts <= b.ts
      AND features_zone.ts >= b.ts - INTERVAL '10 days'
      AND zone_kind = 'fvg'
    ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC
  ) AS pit_htf_fvg_zone
  WHERE b.direction = 'bullish'
    AND pit_htf_choch.event_type = 'bos' AND pit_htf_choch.direction = 'bullish'
    AND (pit_htf_choch.invalidated_at IS NULL OR pit_htf_choch.invalidated_at > b.ts)
    AND pit_htf_fvg_zone.zone_kind = 'fvg'
    AND pit_htf_fvg_zone.fill_pct < 0.8
    AND (pit_htf_fvg_zone.invalidated_at IS NULL OR pit_htf_fvg_zone.invalidated_at > b.ts)
)
SELECT s.ts as setup_ts, s.bias_direction
FROM setup_candidates s
ORDER BY s.ts
`;
  const tsResult = await pool.query(setupTsSql);
  console.log(`\n=== ${tsResult.rows.length} setup timestamps ===`);
  
  if (tsResult.rows.length === 0) {
    console.log('NO SETUP ROWS');
    await pool.end();
    return;
  }
  
  for (const row of tsResult.rows) {
    const sts = row.setup_ts;
    
    // Check if "best" iFVG exists within 24h before this timestamp
    const ifvgCheck = await pool.query(`
      SELECT ts, direction, strength_score, mitigated_at, invalidated_at
      FROM features_ifvg
      WHERE symbol = 'XAUUSD' AND tf = '15m'
        AND ts <= $1::timestamptz
        AND ts >= $1::timestamptz - INTERVAL '1 days'
        AND direction = 'bullish'
      ORDER BY strength_score DESC NULLS LAST, ts DESC
      LIMIT 3
    `, [sts]);
    
    // Also check mitigated_at condition
    const ifvgValid = await pool.query(`
      SELECT count(*) as valid_cnt
      FROM features_ifvg
      WHERE symbol = 'XAUUSD' AND tf = '15m'
        AND ts <= $1::timestamptz
        AND ts >= $1::timestamptz - INTERVAL '1 days'
        AND direction = 'bullish'
        AND (mitigated_at IS NULL OR mitigated_at > $1::timestamptz)
        AND (invalidated_at IS NULL OR invalidated_at > $1::timestamptz)
    `, [sts]);

    console.log(`\nSetup ts: ${sts.toISOString()}`);
    console.log(`  iFVG bullish rows in lookback: ${ifvgCheck.rows.length}`);
    console.log(`  Valid iFVG (not mitigated/invalidated): ${ifvgValid.rows[0].valid_cnt}`);
    if (ifvgCheck.rows.length > 0) {
      console.log(`  Best iFVG: ts=${ifvgCheck.rows[0].ts.toISOString()}, strength=${ifvgCheck.rows[0].strength_score}, mitigated=${ifvgCheck.rows[0].mitigated_at}, invalidated=${ifvgCheck.rows[0].invalidated_at}`);
    }
  }

  // Also check: how many iFVGs in total for the whole period?
  const totalIfvg = await pool.query(`
    SELECT count(*) FROM features_ifvg
    WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
      AND ts >= '2026-07-01' AND ts <= '2026-07-13'
  `);
  console.log(`\nTotal bullish iFVG 15m July 1-13: ${totalIfvg.rows[0].count}`);

  const validIfvg = await pool.query(`
    SELECT count(*) FROM features_ifvg
    WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
      AND ts >= '2026-07-01' AND ts <= '2026-07-13'
      AND (mitigated_at IS NULL OR mitigated_at > ts)
      AND (invalidated_at IS NULL OR invalidated_at > ts)
  `);
  console.log(`Valid (unmitigated, uninvalidated): ${validIfvg.rows[0].count}`);
  
  // Also check what the entry LATERAL DISTINCT ON actually returns for one setup time
  if (tsResult.rows.length > 0) {
    const sts = tsResult.rows[0].setup_ts;
    console.log(`\n=== Entry LATERAL details for first setup ts ${sts.toISOString()} ===`);
    const lateralResult = await pool.query(`
      SELECT DISTINCT ON (symbol, direction) *
      FROM features_ifvg
      WHERE symbol = 'XAUUSD' AND tf = '15m'
        AND ts <= $1::timestamptz
        AND ts >= $1::timestamptz - INTERVAL '1 days'
        AND direction = 'bullish'
        AND (mitigated_at IS NULL OR mitigated_at > $1::timestamptz)
        AND (invalidated_at IS NULL OR invalidated_at > $1::timestamptz)
      ORDER BY symbol, direction, strength_score DESC NULLS LAST, ts DESC
    `, [sts]);
    console.log(`LATERAL returns: ${lateralResult.rows.length} rows`);
    if (lateralResult.rows.length > 0) {
      console.log(JSON.stringify(lateralResult.rows[0], null, 2));
    }
  }

  await pool.end();
}

main().catch(console.error);
