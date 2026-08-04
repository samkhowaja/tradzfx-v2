#!/usr/bin/env node
/**
 * Detector v4 — calibrated successor to frozen v3.
 *
 * Motivation (evidence: reports/detector-v3-validation-2026-08-04.json and
 * certification scan): v3 flagged ~9% of rows in a verified-clean recent
 * XAUUSD window. Root cause: v3 applied SYMMETRIC median/MAD deviation to
 * range and spread, whose distributions are heavy-tailed with near-zero MAD
 * (spread median 3.1, MAD ~0.05; any deviation trips 8×MAD). Tight spreads
 * (below median) were flagged as "outliers", which is wrong — only wide
 * spikes matter.
 *
 * v4 per-metric rules:
 *   ret    — symmetric: |r - median| > max(hardFloorReturn, madMultiplier × MAD)
 *   range  — one-sided (upper only): r - median > max(hardFloorRange, madMultiplier × MAD)
 *   spread — absolute cap in pips (data-quality cap, not trading gate);
 *            zero = missing/unresolved (separate blocker), negative = impossible
 *
 * Frozen as candle-detector-v4-calibrated@YYYYMMDD (immutable; any change
 * requires a new dated version).
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const FREEZE_DATE = process.env.DETECTOR_FREEZE_DATE || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const VERSION = `candle-detector-v4-calibrated@${FREEZE_DATE}`;

const CONFIG = {
  schemaVersion: 4,
  frozenAt: null,
  supersedes: 'candle-detector-v3-robust@20260804',
  calibrationEvidence: 'reports/detector-v3-validation-2026-08-04.json; XAUUSD recent-window scan (v3: 198/1436/1863 outliers; v4: 0/2/0)',
  pipRules: {
    source: 'packages/shared/src/pairs/pipMath.ts:getPipSize(digits)',
    pipSizeByDigits: { 2: 0.1, 3: 0.01, 4: 0.0001, 5: 0.0001 },
    registryPipSizes: { XAUUSD: 0.1, USDJPY: 0.01, standardFx: 0.0001 },
  },
  spreadRules: {
    unit: 'pips',
    zeroMeans: 'missing_unresolved',
    negativeMeans: 'impossible',
    capMeans: 'wide_spike_outlier', // one-sided absolute cap; below-median tight spreads are NEVER outliers
    capsByClassPips: { fx_major: 30, jpy: 30, sek_exotic: 80, xauusd: 50, dxy_synthetic: 50 },
  },
  gapCalendarRules: {
    authority: 'packages/shared/src/utils/marketCalendar.ts:classifyCandleGap / market.classify_candle_gap',
    classificationPoint: 'gap midpoint',
    gapThresholdHours: 2,
    fxWeekUtc: { open: 'Sunday 21:00', close: 'Friday 21:00' },
    dailyBreaks: { XAUUSD: ['21:00-22:00'] },
    classes: ['NONE', 'EXPECTED_WEEKEND', 'EXPECTED_DAILY_BREAK', 'UNEXPECTED'],
  },
  baseline: { method: 'median_mad', scope: 'symbol_effective_broker_timeframe', lookbackBars: 60 },
  metrics: {
    returns: { side: 'symmetric' },
    ranges: { side: 'upper_only' },
    spreads: { side: 'upper_only', rule: 'absolute_cap_pips' },
  },
  thresholds: {
    fx_major: { madMultiplier: 8, hardFloorReturn: 0.005, hardFloorRange: 0.003 },
    jpy: { madMultiplier: 8, hardFloorReturn: 0.005, hardFloorRange: 0.003 },
    sek_exotic: { madMultiplier: 10, hardFloorReturn: 0.01, hardFloorRange: 0.006 },
    xauusd: { madMultiplier: 8, hardFloorReturn: 0.01, hardFloorRange: 0.003 },
    dxy_synthetic: { madMultiplier: 8, hardFloorReturn: 0.02, hardFloorRange: 0.01 },
  },
  dxySyntheticRules: {
    constant: 50.14348112,
    components: ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'],
    exponents: { EURUSD: -0.576, USDJPY: 0.136, GBPUSD: -0.119, USDCAD: 0.091, USDSEK: 0.042, USDCHF: 0.036 },
    boundary: { componentJumpFloor: 0.001, minJumpedComponents: 2, blocker: 'synthetic_boundary_unresolved' },
  },
  blockingAuthority: 'v4',
  v2: 'audit_only',
  v3: 'audit_only_superseded',
};

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: 'postgres',
    password: process.env.TM_DB_PASSWORD,
  });
  try {
    CONFIG.frozenAt = new Date().toISOString();
    const { rows: inserted } = await pool.query(
      `INSERT INTO market.detector_config (detector_version, status, config, created_by)
       VALUES ($1, 'draft', $2::jsonb, 'freeze-detector-v4-calibrated.js')
       ON CONFLICT (detector_version) DO NOTHING
       RETURNING detector_version`,
      [VERSION, JSON.stringify(CONFIG)],
    );
    if (inserted.length === 0) {
      const { rows } = await pool.query(`SELECT config FROM market.detector_config WHERE detector_version = $1`, [VERSION]);
      const canon = (v) => {
        if (Array.isArray(v)) return v.map(canon);
        if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => k !== 'frozenAt').map((k) => [k, canon(v[k])]));
        return v;
      };
      if (JSON.stringify(canon(rows[0].config)) !== JSON.stringify(canon(CONFIG))) {
        console.error(`FROZEN CONFIG MISMATCH: ${VERSION} exists with different rules. Create a new dated version.`);
        process.exit(2);
      }
      console.log(JSON.stringify({ detectorVersion: VERSION, action: 'already_frozen_identical' }, null, 2));
    } else {
      console.log(JSON.stringify({ detectorVersion: VERSION, action: 'frozen', status: 'draft', config: CONFIG }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
