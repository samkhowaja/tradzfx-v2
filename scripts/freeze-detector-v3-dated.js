#!/usr/bin/env node
/**
 * Freeze detector v3 as an immutable, dated, versioned config record.
 *
 * Creates `candle-detector-v3-robust@YYYYMMDD` in market.detector_config with
 * the complete, self-contained rule set: pip sizing, spread rules, gap calendar
 * rules, median/MAD baseline, thresholds, and DXY synthetic-boundary rules.
 *
 * The frozen record is inserted with status 'draft' (detector_config status
 * CHECK only allows draft/active/retired). "Frozen" means: the config JSON is
 * never updated in place — any parameter change requires a new dated version.
 * Activation still requires the separate explicit `--activate` flow.
 *
 * Idempotent: ON CONFLICT (detector_version) verifies the existing config is
 * byte-identical; it never mutates an existing frozen row.
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const FREEZE_DATE = process.env.DETECTOR_FREEZE_DATE || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const VERSION = `candle-detector-v3-robust@${FREEZE_DATE}`;

/**
 * Complete frozen rule set. Every detector behavior must be derivable from
 * this config alone — no hidden code constants.
 */
const CONFIG = {
  schemaVersion: 3,
  frozenAt: null, // filled at insert time
  pipRules: {
    source: 'packages/shared/src/pairs/pipMath.ts:getPipSize(digits)',
    description: '5-digit FX 10 points = 1 pip; 3-digit JPY 10 points = 1 pip; 2-digit XAU 10 points = 1 pip; 4-digit 1:1.',
    pipSizeByDigits: { 2: 0.1, 3: 0.01, 4: 0.0001, 5: 0.0001 },
    registryPipSizes: { XAUUSD: 0.1, USDJPY: 0.01, standardFx: 0.0001 },
  },
  spreadRules: {
    unit: 'pips',
    zeroMeans: 'missing_unresolved', // importer encodes unavailable spread as 0; zero is unknown, NOT observed zero
    negativeMeans: 'impossible', // spread < 0 -> IMPOSSIBLE_SPREAD (CRITICAL)
  },
  gapCalendarRules: {
    authority: 'packages/shared/src/utils/marketCalendar.ts:classifyCandleGap / market.classify_candle_gap',
    classificationPoint: 'gap midpoint',
    gapThresholdHours: 2,
    fxWeekUtc: { open: 'Sunday 21:00', close: 'Friday 21:00' },
    dailyBreaks: { XAUUSD: ['21:00-22:00'] },
    classes: ['NONE', 'EXPECTED_WEEKEND', 'EXPECTED_DAILY_BREAK', 'UNEXPECTED'],
  },
  baseline: {
    method: 'median_mad',
    scope: 'symbol_effective_broker_timeframe',
    lookbackBars: 60,
  },
  metrics: ['returns', 'ranges', 'spreads'],
  thresholds: {
    fx_major: { madMultiplier: 8, hardFloorReturn: 0.005 },
    jpy: { madMultiplier: 8, hardFloorReturn: 0.005 },
    sek_exotic: { madMultiplier: 10, hardFloorReturn: 0.01 },
    xauusd: { madMultiplier: 10, hardFloorReturn: 0.01 },
    dxy_synthetic: { madMultiplier: 8, hardFloorReturn: 0.02 },
  },
  dxySyntheticRules: {
    constant: 50.14348112,
    components: ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'],
    exponents: { EURUSD: -0.576, USDJPY: 0.136, GBPUSD: -0.119, USDCAD: 0.091, USDSEK: 0.042, USDCHF: 0.036 },
    boundary: {
      description: 'Flag DXY timestamps where all 6 components present and >= 2 components jumped >= componentJumpFloor in the same minute. Such resets are formula-derived feed resets, not corruption, but block trust until reviewed.',
      componentJumpFloor: 0.001,
      minJumpedComponents: 2,
      blocker: 'synthetic_boundary_unresolved',
    },
  },
  blockingAuthority: 'v3',
  v2: 'audit_only',
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
    const configJson = JSON.stringify(CONFIG);

    const { rows: inserted } = await pool.query(
      `INSERT INTO market.detector_config (detector_version, status, config, created_by)
       VALUES ($1, 'draft', $2::jsonb, 'freeze-detector-v3-dated.js')
       ON CONFLICT (detector_version) DO NOTHING
       RETURNING detector_version`,
      [VERSION, configJson],
    );

    if (inserted.length === 0) {
      // Idempotency guard: existing row must match on all rules. Volatile
      // bookkeeping fields (frozenAt) are excluded from comparison.
      const { rows } = await pool.query(
        `SELECT config FROM market.detector_config WHERE detector_version = $1`,
        [VERSION],
      );
      // jsonb reorders keys; canonicalize (sort keys recursively) and drop
      // volatile bookkeeping before comparing.
      const canon = (v) => {
        if (Array.isArray(v)) return v.map(canon);
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.keys(v).sort().filter((k) => k !== 'frozenAt').map((k) => [k, canon(v[k])]));
        }
        return v;
      };
      if (JSON.stringify(canon(rows[0].config)) !== JSON.stringify(canon(CONFIG))) {
        console.error(`FROZEN CONFIG MISMATCH: ${VERSION} already exists with different rules. Frozen configs are immutable — create a new dated version instead.`);
        process.exit(2);
      }
      console.log(JSON.stringify({ detectorVersion: VERSION, action: 'already_frozen_identical', status: 'draft' }, null, 2));
    } else {
      console.log(JSON.stringify({ detectorVersion: VERSION, action: 'frozen', status: 'draft', config: CONFIG }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
