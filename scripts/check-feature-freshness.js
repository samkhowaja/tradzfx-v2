#!/usr/bin/env node
/**
 * Feature Freshness Check — verifies all feature tables are fresh
 * Run: node scripts/check-feature-freshness.js [SYMBOL]
 */

require("dotenv").config({ path: ".env.local" });
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
  statement_timeout: 30000,
});

const FEATURE_TABLES = [
  'features_atr',
  'features_bias',
  'features_bollinger',
  'features_candle_pattern',
  'features_correlation',
  'features_direction_state',
  'features_displacement',
  'features_eq_liquidity',
  'features_fvg_backup',
  'features_htf_bias',
  'features_ifvg',
  'features_indicator',
  'features_keltner',
  'features_liquidity_pools',
  'features_moving_average',
  'features_opening_range',
  'features_order_block',
  'features_pivot',
  'features_pricing',
  'features_session',
  'features_session_hl',
  'features_spread',
  'features_structure',
  'features_sweep',
  'features_time_of_day_edge',
  'features_zone',
  'features_zone_retest',
];

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

const STALE_THRESHOLDS = {
  '1m': 30 * 60 * 1000,      // 30 min
  '5m': 30 * 60 * 1000,      // 30 min
  '15m': 60 * 60 * 1000,     // 1 hour
  '1h': 2 * 60 * 60 * 1000,  // 2 hours
  '4h': 6 * 60 * 60 * 1000,  // 6 hours
  '1d': 24 * 60 * 60 * 1000, // 24 hours
};

async function checkFreshness(symbol = 'XAUUSD') {
  console.log(`\n=== Feature Freshness Check for ${symbol} ===`);
  console.log(`Thresholds: 1m/5m=30m, 15m=1h, 1h=2h, 4h=6h, 1d=24h\n`);

  const results = [];
  let hasCritical = false;

  for (const table of FEATURE_TABLES) {
    for (const tf of TIMEFRAMES) {
      try {
        const { rows } = await pool.query(
          `SELECT MAX(ts) as last_ts, COUNT(*) as cnt
           FROM ${table}
           WHERE symbol = $1 AND tf = $2`,
          [symbol, tf]
        );

        const row = rows[0];
        if (!row.last_ts || row.cnt === '0') {
          results.push({ table, tf, status: 'EMPTY', last_ts: null, count: 0, staleMs: null });
          continue;
        }

        const lastTs = new Date(row.last_ts).getTime();
        const now = Date.now();
        const staleMs = now - lastTs;
        const threshold = STALE_THRESHOLDS[tf];
        const isStale = staleMs > threshold;

        const status = isStale ? 'STALE' : 'FRESH';
        if (isStale) hasCritical = true;

        results.push({
          table,
          tf,
          status,
          last_ts: row.last_ts,
          count: parseInt(row.cnt),
          staleMs,
          threshold,
        });
      } catch (err) {
        if (err.code === '42P01') {
          // Table doesn't exist
          results.push({ table, tf, status: 'MISSING_TABLE', last_ts: null, count: 0, staleMs: null });
        } else {
          results.push({ table, tf, status: 'ERROR', error: err.message });
        }
      }
    }
  }

  // Print summary table
  console.log('TABLE'.padEnd(30) + 'TF'.padEnd(6) + 'STATUS'.padEnd(12) + 'COUNT'.padEnd(10) + 'LAST_TS'.padEnd(25) + 'STALE');
  console.log('-'.repeat(110));

  for (const r of results) {
    if (r.status === 'EMPTY' || r.status === 'MISSING_TABLE') {
      console.log(
        r.table.padEnd(30) +
        r.tf.padEnd(6) +
        r.status.padEnd(12) +
        String(r.count).padEnd(10) +
        'N/A'.padEnd(25) +
        'N/A'
      );
    } else if (r.status === 'ERROR') {
      console.log(
        r.table.padEnd(30) +
        r.tf.padEnd(6) +
        'ERROR'.padEnd(12) +
        'N/A'.padEnd(10) +
        'N/A'.padEnd(25) +
        r.error
      );
    } else {
      const staleStr = r.staleMs >= 0
        ? `${Math.round(r.staleMs / 60000)}m ago`
        : 'future?';
      const lastTsStr = r.last_ts ? new Date(r.last_ts).toISOString() : 'N/A';

      console.log(
        r.table.padEnd(30) +
        r.tf.padEnd(6) +
        r.status.padEnd(12) +
        String(r.count).padEnd(10) +
        lastTsStr.padEnd(25) +
        staleStr
      );
    }
  }

  console.log('\n=== SUMMARY ===');
  const stale = results.filter(r => r.status === 'STALE');
  const empty = results.filter(r => r.status === 'EMPTY');
  const missing = results.filter(r => r.status === 'MISSING_TABLE');
  const fresh = results.filter(r => r.status === 'FRESH');

  console.log(`FRESH: ${fresh.length}`);
  console.log(`STALE: ${stale.length} ${hasCritical ? '🔴 CRITICAL' : ''}`);
  console.log(`EMPTY: ${empty.length}`);
  console.log(`MISSING TABLE: ${missing.length}`);

  if (stale.length > 0) {
    console.log('\n🔴 STALE TABLES (exceed threshold):');
    for (const r of stale) {
      const hrs = (r.staleMs / 3600000).toFixed(1);
      console.log(`  ${r.table} @ ${r.tf}: ${hrs}h stale (threshold: ${r.threshold / 3600000}h)`);
    }
  }

  if (missing.length > 0) {
    console.log('\n🔴 MISSING TABLES:');
    for (const r of missing) {
      console.log(`  ${r.table} @ ${r.tf}`);
    }
  }

  await pool.end();
  process.exit(hasCritical ? 1 : 0);
}

const symbol = process.argv[2] || 'XAUUSD';
checkFreshness(symbol).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});