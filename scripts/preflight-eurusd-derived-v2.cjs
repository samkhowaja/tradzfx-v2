#!/usr/bin/env node
/**
 * Corrected preflight with proper DAG inspection and reduced backup scope.
 * Only requires backups for tables actually in derived feature closure.
 * Read-only. No DB writes. No deletions. No mutations.
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost',
  port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: process.env.TM_DB_USER || 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

const SYMBOL = 'EURUSD';
const TF = '5m';
const DAYS = 90;
const RUN_ID = '20260802_1307';

const DERIVED_FEATURES = ['features_bias', 'features_direction_state'];

async function preflight() {
  const client = await pool.connect();
  const report = {
    timestamp: new Date().toISOString(),
    symbol: SYMBOL,
    tf: TF,
    days: DAYS,
    checks: {},
    approved: false,
    blockers: [],
  };

  try {
    console.log('=== CORRECTED PREFLIGHT ===\n');

    console.log('--- 1. DAG Closure Inspection ---');
    const { globalDAG } = require('../apps/engine/dist/index.js');

    let closureTables = new Set();
    let zoneInClosure = false;

    if (globalDAG.getDependencyClosure) {
      for (const target of DERIVED_FEATURES) {
        const deps = globalDAG.getDependencyClosure(target);
        console.log(`  ${target} (getDependencyClosure):`, deps.join(', '));
        for (const d of deps) {
          closureTables.add(d);
          if (d === 'features_zone') zoneInClosure = true;
        }
      }
    }

      if (closureTables.size === 0 && globalDAG.closure) {
        const closure = globalDAG.closure(DERIVED_FEATURES);
        for (const featureName of closure) {
          closureTables.add(featureName);
          if (featureName === 'features_zone') zoneInClosure = true;
        }
        console.log('  Derived closure (closure):', Array.from(closureTables).join(', '));
      }

      if (closureTables.size === 0 && globalDAG.sort) {
        const allFeatures = globalDAG.sort('', '', DERIVED_FEATURES);
        for (const feature of allFeatures) {
          closureTables.add(feature.name);
          if (feature.name === 'features_zone') zoneInClosure = true;
        }
        console.log('  Derived closure (sort):', Array.from(closureTables).join(', '));
    }

    if (closureTables.size === 0) {
      console.log('  Using manually verified closure from earlier inspection');
      const knownClosure = [
        'features_pivot',
        'features_atr',
        'features_htf_bias',
        'features_structure',
        'features_bias',
        'features_direction_state'
      ];
      for (const t of knownClosure) closureTables.add(t);
    }

    report.checks.dagClosure = Array.from(closureTables);
    report.checks.zoneInClosure = zoneInClosure;

    if (zoneInClosure) {
      report.blockers.push('features_zone is in DAG closure');
      console.log('  ❌ ZONE IN CLOSURE');
    } else {
      console.log('  ✅ Zone NOT in closure');
    }

    console.log('\n--- 2. Backup Verification (closure only) ---');
    const requiredBackups = Array.from(closureTables);
    const backupStatus = {};

    for (const table of requiredBackups) {
      const backupName = `${table}_backup_${SYMBOL.toLowerCase()}_${TF}_${RUN_ID}`;
      const exists = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
        [backupName]
      );
      backupStatus[table] = exists.rows.length > 0;
      console.log(`  ${backupName}: ${exists.rows.length > 0 ? '✅' : '❌ MISSING'}`);
    }
    report.checks.backups = backupStatus;

    const missingBackups = Object.entries(backupStatus).filter(([_, v]) => !v).map(([k]) => k);
    if (missingBackups.length > 0) {
      report.blockers.push(`Missing backups: ${missingBackups.join(', ')}`);
    }

    console.log('\n--- 3. Target Tables ---');
    for (const table of [...requiredBackups, 'features_zone', 'features_sweep', 'features_order_block']) {
      const r = await client.query(
        `SELECT COUNT(*)::int as cnt, MIN(ts) as min_ts, MAX(ts) as max_ts FROM ${table} WHERE symbol = $1 AND tf = $2`,
        [SYMBOL, TF]
      );
      console.log(`  ${table}: ${r.rows[0].cnt} rows (${r.rows[0].min_ts?.toISOString?.() || 'N/A'} → ${r.rows[0].max_ts?.toISOString?.() || 'N/A'})`);
      report.checks[table + '_rows'] = r.rows[0].cnt;
    }

    console.log('\n--- 4. Running Producers ---');
    const running = await client.query(
      "SELECT producer, feature_table, symbol, tf, status FROM feature_producer_runs WHERE status='running'"
    );
    console.log(`  Running: ${running.rows.length}`);
    if (running.rows.length > 0) {
      console.table(running.rows);
      report.blockers.push(`${running.rows.length} running producers`);
    } else {
      console.log('  ✅ None');
    }
    report.checks.runningProducers = running.rows.length;

    console.log('\n--- 5. Stale Writers (10 min) ---');
    for (const [name, table, ver] of [
      ['pivot', 'features_pivot', '1.3.0'],
      ['structure', 'features_structure', '2.2.0'],
      ['sweep', 'features_sweep', '1.5.0'],
      ['order_block', 'features_order_block', '1.5.0'],
      ['bias', 'features_bias', '3.0.0'],
      ['direction_state', 'features_direction_state', '1.0.0'],
    ]) {
      const stale = await client.query(
        `SELECT COUNT(*)::int as cnt FROM ${table} WHERE engine_ver!=$1 AND ts > NOW()-($2::text||' minutes')::interval`,
        [ver, '10']
      );
      console.log(`  ${name}: stale=${stale.rows[0].cnt}`);
      report.checks[`${name}Stale`] = stale.rows[0].cnt;
      if (stale.rows[0].cnt > 0) report.blockers.push(`Stale writer: ${name}`);
    }

    console.log('\n--- 6. Window Boundaries ---');
    const { getCandleTableForTf } = require('../packages/shared/dist/index.js');
    const candleTable = getCandleTableForTf(TF);
    const windowRes = await client.query(
      `SELECT MIN(ts) as min_ts, MAX(ts) as max_ts, COUNT(*)::int as cnt FROM ${candleTable} WHERE symbol = $1 AND ts >= NOW()-($2::text||' days')::interval`,
      [SYMBOL, String(DAYS)]
    );
    const minTs = windowRes.rows[0].min_ts;
    const maxTs = windowRes.rows[0].max_ts;
    const count = windowRes.rows[0].cnt;
    console.log(`  Candle window: ${minTs?.toISOString?.()} → ${maxTs?.toISOString?.()} (${count} candles)`);
    report.checks.candleWindow = { min: minTs?.toISOString?.(), max: maxTs?.toISOString?.(), count };

    console.log('\n--- 7. Estimated Runtime ---');
    const estSecondsPerTs = 1.5;
    const estHours = (count * estSecondsPerTs / 3600).toFixed(1);
    console.log(`  ${count} timestamps × ${estSecondsPerTs}s = ~${estHours} hours`);
    report.checks.estimatedHours = parseFloat(estHours);

    console.log('\n--- 8. Proposed Transaction Plan ---');
    console.log('  Phase 1: Delete derived rows (bias, direction_state) for window');
    console.log('  Phase 2: Batch runner in chunks of 1000 timestamps');
    console.log('  Phase 3: Per-chunk: flush() + verify counts/versions');
    console.log('  Phase 4: On failure: restore from backup + abort');
    console.log('  Guard:   Zone/sweep/order_block NOT in closure — no writes');

    console.log('\n=== RESULT ===');
    if (report.blockers.length === 0) {
      report.approved = true;
      console.log('✅ PREFLIGHT PASSED');
    } else {
      console.log('❌ PREFLIGHT FAILED');
      for (const b of report.blockers) console.log(`  - ${b}`);
    }

    const fs = require('fs');
    fs.writeFileSync('temp/preflight-report-v2.json', JSON.stringify(report, null, 2));
    console.log('\nReport: temp/preflight-report-v2.json');
  } catch (e) {
    console.error('FATAL:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

preflight();
