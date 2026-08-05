#!/usr/bin/env node
/**
 * Certifier v5.1 — range-warning policy, successor to frozen v4.
 *
 * Motivation (evidence: certification dry-runs 2026-08-04 and rolling-MAD
 * diagnostics _tmp_mult_sweep.cjs / _tmp_v5_diag.cjs):
 *
 *   v4 applied its range rule as a BLOCKER with hardFloorRange=0.003 raw for
 *   all FX. Two demonstrated bugs:
 *     (1) XAUUSD: 0.003 raw is ~25x the rolling median relative range
 *         (0.031%), so 657 normal candles in the 2026-07-19→08-04 island were
 *         flagged — the entire recent island was uncertifiable regardless of
 *         quarantine review.
 *     (2) EURUSD: floating-point compare at mad=0 flagged a range≈0 candle.
 *
 *   v5 (superseded before freeze) made hardFloorRange relative + per-symbol
 *   and added the epsilon, cutting flags ~20x (XAUUSD 657→30). But a rolling
 *   center+mult*MAD rule on a heavy right tail flags ~3% of ALL candles at
 *   any multiplier 8..25 — tail volatility is structural, not corruption.
 *
 * v5.1 policy — BLOCK CORRUPTION, NOT VOLATILITY:
 *   range outliers  -> WARNING only. Recorded in gate_summary (count +
 *                      volatilityRegime label) as regime evidence; never
 *                      block certification.
 *   ret outliers    -> HARD BLOCK unless every flagged timestamp carries an
 *                      approved KEEP quarantine decision (human-reviewed real
 *                      event, e.g. USDJPY 2026-07-31 08:55 crash). Unreviewed
 *                      price discontinuities fail closed.
 *   spread cap      -> HARD BLOCK (implausible spread = corruption).
 *   zero spread     -> HARD BLOCK (spread=0 means missing/unresolved).
 *   DXY boundary    -> HARD BLOCK (synchronized component jump without
 *                      formula-value validation = synthetic reset unresolved;
 *                      see quarantine #655 correction lesson).
 *   quarantine      -> HARD BLOCK (undecided/UNKNOWN, or REPLACED without
 *                      linked market.candle_replacement_evidence).
 *
 * Frozen as window-certifier-v5.1-range-warning@YYYYMMDD (immutable; any
 * change requires a new dated version).
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const FREEZE_DATE = process.env.DETECTOR_FREEZE_DATE || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const VERSION = `window-certifier-v5.2-dxy-formula@${FREEZE_DATE}`;

const CONFIG = {
  schemaVersion: 5.2,
  frozenAt: null,
  supersedes: 'window-certifier-v5.1-range-warning@20260805',
  policy: 'block_corruption_not_volatility',
  calibrationEvidence: 'certify-trusted-windows dry-runs 2026-08-04; _tmp_range_stats.cjs (relative-range med/MAD per symbol, 2026-07-05→08-04); _tmp_mult_sweep.cjs (rolling center+mult*MAD flags ~3% of candles at any multiplier 8..25 — tail is structural)',
  metricRules: {
    range: {
      side: 'upper_only',
      formula: 'rel_range - rolling_median > max(hardFloorRange, madMultiplier * MAD) + 1e-12',
      relRange: '(h - l) / o',
      action: 'warning_only',
      evidence: 'gate_summary.rangeOutliers + volatilityRegime',
    },
    ret: {
      side: 'symmetric',
      formula: '|rel_ret - rolling_median| > max(hardFloorRet, madMultiplier * MAD)',
      action: 'block_unless_keep_reviewed',
      keepResolution: 'approved KEEP quarantine row at the flagged timestamp (superseded_at IS NULL, approved_at/by NOT NULL)',
    },
    spread: { action: 'block', capRule: 'absolute_cap_pips', zeroMeans: 'missing_unresolved_block' },
    dxySyntheticBoundary: {
      action: 'block_unresolved_only',
      componentJumpFloor: 0.001,
      minJumpedComponents: 2,
      formulaValidation: 'DXY row present AND |close - formula| / formula > 0.5% => UNRESOLVED (blocks); row present and formula-consistent => resolved (genuine synchronized repricing); row absent => resolved (nothing to distrust, gap handled by island formation)',
      note: 'component-jump heuristic alone insufficient — corrupt 2026-07-07 DXY halving passed it; formula-value validation is the actual corruption signal (quarantine #655 lesson)',
    },
    quarantine: { action: 'block', undecidedOrUnknown: true, replacedRequiresEvidence: true, excludedDroppedByCanonical: 'migration 186 market.candles_1m_canonical NOT EXISTS filter' },
  },
  baseline: { method: 'median_mad', scope: 'rolling', lookbackBars: 60 },
  thresholds: {
    DXY: { madMultiplier: 8, hardFloorRet: 0.02, hardFloorRange: 0.001, spreadCapPips: 50 },
    XAUUSD: { madMultiplier: 8, hardFloorRet: 0.01, hardFloorRange: 0.0015, spreadCapPips: 50 },
    EURUSD: { madMultiplier: 8, hardFloorRet: 0.005, hardFloorRange: 0.0005, spreadCapPips: 30 },
    USDJPY: { madMultiplier: 8, hardFloorRet: 0.005, hardFloorRange: 0.0006, spreadCapPips: 30 },
    USDSEK: { madMultiplier: 10, hardFloorRet: 0.01, hardFloorRange: 0.0008, spreadCapPips: 80 },
    default: { madMultiplier: 8, hardFloorRet: 0.005, hardFloorRange: 0.0005, spreadCapPips: 30 },
  },
  thresholdUnits: { hardFloorRet: 'relative', hardFloorRange: 'relative ((h-l)/o)', spreadCapPips: 'pips' },
  volatilityRegime: { source: 'rangeOutliers/rows', high: '>0.5%', mixed: '>0.05%', calm: '<=0.05%' },
  blockingAuthority: 'v5.2',
  v3: 'audit_only_superseded',
  v4: 'audit_only_superseded',
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
       VALUES ($1, 'draft', $2::jsonb, 'freeze-certifier-v5_2-dxy-formula.js')
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
      console.log(JSON.stringify({ detectorVersion: VERSION, action: 'frozen', status: 'draft' }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
