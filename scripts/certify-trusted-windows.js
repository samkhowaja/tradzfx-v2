#!/usr/bin/env node
/**
 * Certify recent trusted windows per priority symbol.
 *
 * Goal: find 2-3 recent contiguous candle islands per priority symbol that
 * pass the frozen v5.1 certifier with ZERO blockers, and register them as
 * candidate trusted windows with full governance metadata in gate_summary:
 *   effectiveBroker, detectorVersion (frozen dated), quarantineStatus,
 *   calendarPolicy, spreadProvenance, syntheticPolicy, featureCoverageStatus.
 *
 * Windows with any blocker are reported but NOT inserted. Promotion to
 * status='trusted' still requires separate explicit manual review — this
 * script only creates candidates that are eligible for that review.
 *
 * Requires --parity-confirmed (calendar parity gate) for writes, same as
 * discover-trusted-windows.js. Idempotent via the candidate-identity unique
 * index (symbol,timeframe,window_start,window_end,detector_version).
 *
 * Usage:
 *   node scripts/certify-trusted-windows.js [--symbols=XAUUSD,EURUSD,USDJPY,DXY]
 *     [--windows=3] [--min-rows=1000] [--max-windows-per-symbol=10] [--write --parity-confirmed]
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const LOOKBACK = 60;
// v5 calibrated rules: ret symmetric (MAD mult + hard floor), range one-sided
// upper (MAD mult + hard floor), spread one-sided absolute cap in pips.
//
// v5 range change (2026-08-04, replaces v4): hardFloorRange is now RELATIVE
// ((h-l)/o) and per-symbol, sized from the empirical July regime as a
// quiet-regime backstop only — far above a quiet rolling median, far below
// what `center + 8*MAD` yields in normal regimes, so the MAD term dominates
// whenever the regime has any real spread. Empirical basis (2026-07-05 →
// 08-04, canonical 1m): XAUUSD median 0.031% / MAD 0.0121% (center+8MAD ≈
// 0.127% ≈ p99), EURUSD 0.0088% / 0.0027%, USDJPY 0.0074% / 0.0043%.
// v4 used hardFloorRange=0.003 for all FX, which for XAUUSD was ~25x the
// rolling median and flagged 657 normal candles; its floating-point compare
// could also flag zero-range rows. v5 fixes both. Frozen: do not retune
// without a similarly evidenced bug report.
const THRESHOLDS = {
  DXY: { madMultiplier: 8, hardFloorRet: 0.02, hardFloorRange: 0.001, spreadCapPips: 50 },
  XAUUSD: { madMultiplier: 8, hardFloorRet: 0.01, hardFloorRange: 0.0015, spreadCapPips: 50 },
  EURUSD: { madMultiplier: 8, hardFloorRet: 0.005, hardFloorRange: 0.0005, spreadCapPips: 30 },
  USDJPY: { madMultiplier: 8, hardFloorRet: 0.005, hardFloorRange: 0.0006, spreadCapPips: 30 },
  USDSEK: { madMultiplier: 10, hardFloorRet: 0.01, hardFloorRange: 0.0008, spreadCapPips: 80 },
  default: { madMultiplier: 8, hardFloorRet: 0.005, hardFloorRange: 0.0005, spreadCapPips: 30 },
};
const DXY_COMPONENTS = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'];
const DXY_COMPONENT_JUMP_FLOOR = 0.001;
const CALENDAR_POLICY_VERSION = 'market-calendar-midpoint-v1';
const SPREAD_PROVENANCE = 'spread=pips; zero=missing_unresolved (importer encodes unavailable as 0)';
const SYNTHETIC_POLICY = 'dxy=formula(6 components); boundary candidate >=2 components @0.1%; UNRESOLVED only if DXY row present AND deviates >0.5% from formula (#655 formula-validation) => synthetic_boundary_unresolved blocker';

const symbols = (process.argv.find((x) => x.startsWith('--symbols='))?.split('=')[1] || 'XAUUSD,EURUSD,USDJPY,DXY').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const targetWindows = Number(process.argv.find((x) => x.startsWith('--windows='))?.split('=')[1] || 3);
const minRows = Number(process.argv.find((x) => x.startsWith('--min-rows='))?.split('=')[1] || 1000);
const maxIslands = Number(process.argv.find((x) => x.startsWith('--max-windows-per-symbol='))?.split('=')[1] || 10);
const write = process.argv.includes('--write');
const parityConfirmed = process.argv.includes('--parity-confirmed');
// v5.3 (2026-08-05): zero-spread KEEP-review exception, mirroring the v5.1
// ret-outlier KEEP path. A spread=0 row (importer zero-encodes unavailable
// spread; verified missing at source in raw candles, not corruption) is a
// hard blocker unless its timestamp carries an approved KEEP quarantine
// decision (human reviewed — e.g. GBPUSD 2026-07-22..07-30, 11 rows approved
// by salman with note "spread missing at source; price clean"). Only
// timestamps actually zero are checked, so KEEP rows elsewhere do not mask
// unreviewed missing-spread rows. Fail-closed on anything else.
const FROZEN_VERSION = `window-certifier-v5.3-spreadzero-keep@${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

if (write && !parityConfirmed) {
  console.error('Refusing --write: run pnpm calendar:parity, verify passed=true, then add --parity-confirmed.');
  process.exit(2);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
function evaluateSymmetric(values, field, threshold) {
  let robustOutliers = 0;
  let hardFloorOutliers = 0;
  const outlierTimes = [];
  for (let i = 0; i < values.length; i++) {
    const sample = values.slice(Math.max(0, i - LOOKBACK), i).map((x) => x[field]).filter(Number.isFinite);
    if (sample.length < LOOKBACK) continue;
    const center = median(sample);
    const mad = median(sample.map((x) => Math.abs(x - center)));
    const value = values[i][field];
    if (!Number.isFinite(value)) continue;
    if (Math.abs(value - center) > Math.max(threshold.hardFloorRet, threshold.madMultiplier * Math.max(mad || 0, 1e-12))) {
      robustOutliers++;
      if (outlierTimes.length < 500) outlierTimes.push(values[i].ts);
    }
  }
  return { robustOutliers, hardFloorOutliers, outlierTimes };
}
function evaluateRange(values, threshold) {
  let robustOutliers = 0;
  for (let i = 0; i < values.length; i++) {
    const sample = values.slice(Math.max(0, i - LOOKBACK), i).map((x) => x.range).filter(Number.isFinite);
    if (sample.length < LOOKBACK) continue;
    const center = median(sample);
    const mad = median(sample.map((x) => Math.abs(x - center)));
    const value = values[i].range;
    if (!Number.isFinite(value)) continue;
    // Epsilon absorbs floating-point noise in (h-l)/o so that a candle whose
    // range equals the threshold to within ~1e-12 is never flagged (v4 bug:
    // range≈0 rows could be flagged when mad was 0 and the hard floor was
    // hit by rounding error).
    if (value - center > Math.max(threshold.hardFloorRange, threshold.madMultiplier * Math.max(mad || 0, 1e-12)) + 1e-12) robustOutliers++;
  }
  return { robustOutliers, hardFloorOutliers: 0 };
}
function evaluateSpread(values, threshold) {
  let robustOutliers = 0;
  for (const v of values) {
    if (Number.isFinite(v.spread) && v.spread > threshold.spreadCapPips) robustOutliers++;
  }
  return { robustOutliers, hardFloorOutliers: 0 };
}

const DXY_FORMULA_CONSTANT = 50.14348112;
const DXY_EXPONENTS = { EURUSD: -0.576, USDJPY: 0.136, GBPUSD: -0.119, USDCAD: 0.091, USDSEK: 0.042, USDCHF: 0.036 };
const DXY_FORMULA_TOLERANCE_PCT = 0.5;

/**
 * v5.1 DXY synthetic boundary with formula-value validation (#655 lesson).
 *
 * The component-jump heuristic (all 6 components present, >=2 jumped
 * >=0.1% same minute) is necessary but NOT sufficient to distrust a DXY
 * candle: the corrupt 2026-07-07 episode (DXY halved 101→51→52→101 while
 * components merely shifted) passed the heuristic, and was only caught by
 * checking the DXY value against the formula (deviation >> 0.5%).
 *
 * A boundary timestamp is UNRESOLVED (blocks) only when a DXY canonical row
 * EXISTS at ts AND its close deviates from the formula value by more than
 * DXY_FORMULA_TOLERANCE_PCT. Resolved (no block) when:
 *   - DXY row present and formula-consistent (genuine synchronized repricing:
 *     session opens, news repricing all components at once), or
 *   - DXY row absent at ts (nothing to distrust; any gap is handled by
 *     island formation, and corrupt rows already EXCLUDE'd from canonical).
 */
async function findDxyBoundaryCount(pool, start, end) {
  const { rows } = await pool.query(`
    SELECT ts, COUNT(*) FILTER (WHERE jump >= $1) AS jumped, COUNT(*) AS present FROM (
      SELECT symbol, ts, ABS((c - lag(c) OVER (PARTITION BY symbol ORDER BY ts)) / NULLIF(lag(c) OVER (PARTITION BY symbol ORDER BY ts), 0)) AS jump
      FROM market.candles_1m_canonical WHERE symbol = ANY($2) AND ts BETWEEN $3 AND $4
    ) j GROUP BY ts`, [DXY_COMPONENT_JUMP_FLOOR, DXY_COMPONENTS, start, end]);
  const candidates = rows.filter((r) => Number(r.present) === DXY_COMPONENTS.length && Number(r.jumped) >= 2);
  if (!candidates.length) return 0;

  let unresolved = 0;
  for (const cand of candidates) {
    const ts = cand.ts;
    const { rows: dxy } = await pool.query(
      `SELECT c FROM market.candles_1m_canonical WHERE symbol='DXY' AND ts=$1`, [ts]);
    if (!dxy.length) continue; // absent DXY row: nothing to distrust
    const { rows: comp } = await pool.query(
      `SELECT symbol, c FROM market.candles_1m_canonical WHERE symbol = ANY($1) AND ts = $2`, [DXY_COMPONENTS, ts]);
    if (comp.length !== DXY_COMPONENTS.length) { unresolved++; continue; } // can't validate -> fail closed
    let formula = DXY_FORMULA_CONSTANT;
    for (const r of comp) formula *= Math.pow(Number(r.c), DXY_EXPONENTS[r.symbol]);
    const deviationPct = Math.abs((Number(dxy[0].c) - formula) / formula) * 100;
    if (deviationPct > DXY_FORMULA_TOLERANCE_PCT) unresolved++;
  }
  return unresolved;
}

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: 'postgres',
    password: process.env.TM_DB_PASSWORD,
  });
  try {
    const result = { frozenVersion: FROZEN_VERSION, write, targetWindows, minRows, symbols: {} };

    for (const symbol of symbols) {
      // Contiguous islands (gap > 2h starts a new island), most recent first.
      const { rows: islands } = await pool.query(`
        WITH ordered AS (
          SELECT ts, effective_broker_identity,
                 lag(ts) OVER (PARTITION BY effective_broker_identity ORDER BY ts) prev_ts
          FROM market.candles_1m_canonical WHERE symbol = $1
        ), marked AS (
          SELECT *, CASE WHEN prev_ts IS NULL OR ts - prev_ts > interval '2 hours' THEN 1 ELSE 0 END AS new_island
          FROM ordered
        ), grouped AS (
          SELECT *, SUM(new_island) OVER (PARTITION BY effective_broker_identity ORDER BY ts) AS island_id
          FROM marked
        )
        SELECT effective_broker_identity AS broker, min(ts) AS window_start, max(ts) AS window_end, COUNT(*)::int AS rows
        FROM grouped GROUP BY effective_broker_identity, island_id
        HAVING COUNT(*) >= $2
        ORDER BY window_end DESC LIMIT $3`, [symbol, minRows, maxIslands]);

      const symbolResult = { islandsEvaluated: islands.length, certified: [], blocked: [] };
      for (const island of islands) {
        if (symbolResult.certified.length >= targetWindows) break;

        const { rows } = await pool.query(
          `SELECT ts, o, h, l, c, spread FROM market.candles_1m_canonical WHERE symbol=$1 AND effective_broker_identity=$2 AND ts BETWEEN $3 AND $4 ORDER BY ts`,
          [symbol, island.broker, island.window_start, island.window_end]);
        const values = rows.map((row, i) => ({
          ts: row.ts,
          ret: i && Number(row.c) && Number(rows[i - 1].c) ? (Number(row.c) - Number(rows[i - 1].c)) / Number(rows[i - 1].c) : null,
          range: Number(row.o) ? (Number(row.h) - Number(row.l)) / Number(row.o) : null,
          spread: row.spread == null ? null : Number(row.spread),
        }));
        const threshold = THRESHOLDS[symbol] || THRESHOLDS.default;
        const metrics = {
          ret: evaluateSymmetric(values, 'ret', threshold),
          range: evaluateRange(values, threshold),
          spread: evaluateSpread(values, threshold),
        };
        const zeroSpreadTimes = rows.filter((r) => r.spread != null && Number(r.spread) === 0).map((r) => r.ts);
        const zeroSpreadRows = zeroSpreadTimes.length;
        // v5.3: zero-spread KEEP-review (see header note by FROZEN_VERSION).
        let keepResolvedZeroSpread = 0;
        let unresolvedZeroSpread = zeroSpreadRows;
        if (zeroSpreadRows > 0) {
          const { rows: keepZs } = await pool.query(
            `SELECT DISTINCT event_time FROM candle_quarantine
             WHERE symbol=$1 AND event_time = ANY($2) AND superseded_at IS NULL
               AND decision='KEEP' AND approved_at IS NOT NULL AND approved_by IS NOT NULL`,
            [symbol, zeroSpreadTimes]);
          const keepZsSet = new Set(keepZs.map((r) => r.event_time.toISOString()));
          keepResolvedZeroSpread = zeroSpreadTimes.filter((t) => keepZsSet.has(t.toISOString())).length;
          unresolvedZeroSpread = zeroSpreadRows - keepResolvedZeroSpread;
        }
        const boundaryCount = symbol === 'DXY' ? await findDxyBoundaryCount(pool, island.window_start, island.window_end) : 0;

        // Quarantine rows inside the window. A row is RESOLVED only when a
        // human explicitly decided it:
        //   KEEP     + approved  — reviewed, row is fine
        //   REPLACED + approved  — must have linked replacement evidence
        // EXCLUDE and UNKNOWN never resolve a blocker here. EXCLUDE'd candles
        // are already dropped by market.candles_1m_canonical (migration 186),
        // so islands re-form around them; any EXCLUDE row still inside an
        // island boundary means the exclusion did not split it and the window
        // stays untrusted. UNKNOWN rows are fail-closed.
        const { rows: qRows } = await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE decision IS NULL OR decision = 'UNKNOWN' OR approved_at IS NULL)::int AS undecided,
             COUNT(*) FILTER (WHERE decision = 'REPLACED' AND approved_at IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM market.candle_replacement_evidence e
                 WHERE e.symbol = candle_quarantine.symbol AND e.event_time = candle_quarantine.event_time
                   AND e.blocked_broker = candle_quarantine.broker
               ))::int AS replaced_without_evidence
           FROM candle_quarantine
           WHERE symbol=$1 AND event_time BETWEEN $2 AND $3 AND superseded_at IS NULL`,
          [symbol, island.window_start, island.window_end]);
        const unresolvedQuarantine = qRows[0].undecided + qRows[0].replaced_without_evidence;

        // v5.1 ret-outlier resolution: a ret outlier is a hard blocker unless
        // its timestamp carries an approved KEEP quarantine decision (human
        // reviewed, real event — e.g. USDJPY 2026-07-31 08:55 crash). Only
        // timestamps actually flagged are checked, so KEEP rows elsewhere do
        // not mask unreviewed discontinuities. Fail-closed on anything else.
        let unresolvedRetOutliers = metrics.ret.robustOutliers;
        let keepResolvedRetOutliers = 0;
        if (metrics.ret.robustOutliers > 0 && metrics.ret.outlierTimes.length) {
          const { rows: keepRows } = await pool.query(
            `SELECT DISTINCT event_time FROM candle_quarantine
             WHERE symbol=$1 AND event_time = ANY($2) AND superseded_at IS NULL
               AND decision='KEEP' AND approved_at IS NOT NULL AND approved_by IS NOT NULL`,
            [symbol, metrics.ret.outlierTimes]);
          const keepSet = new Set(keepRows.map((r) => r.event_time.toISOString()));
          keepResolvedRetOutliers = metrics.ret.outlierTimes.filter((t) => keepSet.has(t.toISOString())).length;
          unresolvedRetOutliers = metrics.ret.robustOutliers - keepResolvedRetOutliers;
        }

        // v5.1 policy: block corruption, not volatility.
        //   range outliers  -> WARNING only (heavy-tail vol is real; recorded
        //                      in gate_summary as evidence, never blocks).
        //   ret outliers    -> block unless KEEP-reviewed (above).
        //   spread cap      -> block (implausible spread = corruption).
        //   zero spread     -> block (missing spread unresolved).
        //   DXY boundary    -> block (synthetic reset unresolved).
        //   quarantine      -> block (undecided / REPLACED-without-evidence).
        const blockers = [];
        const warnings = [];
        if (unresolvedRetOutliers > 0 || metrics.spread.robustOutliers) blockers.push('v5_robust_outliers');
        if (metrics.ret.hardFloorOutliers) blockers.push('v5_hard_floor_outliers');
        if (unresolvedZeroSpread > 0) blockers.push('spread_zero_unresolved');
        if (boundaryCount > 0) blockers.push('synthetic_boundary_unresolved');
        if (unresolvedQuarantine > 0) blockers.push('unresolved_quarantine_rows');
        if (metrics.range.robustOutliers > 0) warnings.push('range_volatility_tail');
        if (keepResolvedRetOutliers > 0) warnings.push('ret_outliers_keep_reviewed');
        if (keepResolvedZeroSpread > 0) warnings.push('spread_zero_keep_reviewed');

        // Volatility regime label from range-tail evidence: fraction of
        // flagged range outliers over evaluated rows. Lets downstream training
        // deliberately mix calm and high-vol windows instead of silently
        // over-fitting whichever regime happened to certify.
        const rangeTailFrac = island.rows > 0 ? metrics.range.robustOutliers / island.rows : 0;
        const volatilityRegime = rangeTailFrac > 0.005 ? 'high' : rangeTailFrac > 0.0005 ? 'mixed' : 'calm';

        const entry = {
          broker: island.broker, windowStart: island.window_start, windowEnd: island.window_end,
          rows: island.rows, metrics, zeroSpreadRows, keepResolvedZeroSpread, syntheticBoundaryCount: boundaryCount,
          unresolvedQuarantine, keepResolvedRetOutliers, volatilityRegime, blockers, warnings,
        };

        if (blockers.length === 0 && write) {
          const gateSummary = {
            effectiveBroker: island.broker,
            detectorVersion: FROZEN_VERSION,
            certificationPolicy: 'v5.1: block corruption not volatility; range=warning, ret=block-unless-KEEP, spread/zero-spread/dxy-boundary/unresolved-quarantine=block',
            quarantineStatus: 'clean_zero_unresolved',
            calendarPolicyVersion: CALENDAR_POLICY_VERSION,
            spreadProvenance: SPREAD_PROVENANCE,
            syntheticPolicy: SYNTHETIC_POLICY,
            featureCoverageStatus: 'not_backfilled',
            volatilityRegime,
            warnings,
            rangeOutliers: metrics.range.robustOutliers,
            retOutliers: metrics.ret.robustOutliers,
            keepResolvedRetOutliers,
            certifiedBy: 'certify-trusted-windows.js',
            certifiedAt: new Date().toISOString(),
          };
          const { rows: inserted } = await pool.query(
            `INSERT INTO market.trusted_windows
               (symbol, timeframe, window_start, window_end, detector_version, canonical_version, eligibility_version, broker_policy_version, status, gate_summary, evidence_refs, created_by)
             VALUES ($1,'1m',$2,$3,$4,'canonical-v1','eligibility-v1','broker-policy-v1','candidate',$5::jsonb,'[]'::jsonb,'certify-trusted-windows.js')
             ON CONFLICT (symbol,timeframe,window_start,window_end,detector_version) WHERE status='candidate' DO NOTHING
             RETURNING window_id`,
            [symbol, island.window_start, island.window_end, FROZEN_VERSION, JSON.stringify(gateSummary)]);
          entry.insertedWindowId = inserted[0]?.window_id ?? null;
          symbolResult.certified.push(entry);
        } else if (blockers.length === 0) {
          symbolResult.certified.push({ ...entry, dryRun: true });
        } else {
          symbolResult.blocked.push(entry);
        }
      }
      result.symbols[symbol] = symbolResult;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
