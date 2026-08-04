#!/usr/bin/env node
/**
 * Certify recent trusted windows per priority symbol.
 *
 * Goal: find 2-3 recent contiguous candle islands per priority symbol that
 * pass the frozen v3 detector with ZERO blockers, and register them as
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
// v4 calibrated rules: ret symmetric (MAD mult + hard floor), range one-sided
// upper (MAD mult + hard floor), spread one-sided absolute cap in pips.
const THRESHOLDS = {
  DXY: { madMultiplier: 8, hardFloorRet: 0.02, hardFloorRange: 0.01, spreadCapPips: 50 },
  XAUUSD: { madMultiplier: 8, hardFloorRet: 0.01, hardFloorRange: 0.003, spreadCapPips: 50 },
  USDSEK: { madMultiplier: 10, hardFloorRet: 0.01, hardFloorRange: 0.006, spreadCapPips: 80 },
  default: { madMultiplier: 8, hardFloorRet: 0.005, hardFloorRange: 0.003, spreadCapPips: 30 },
};
const DXY_COMPONENTS = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'];
const DXY_COMPONENT_JUMP_FLOOR = 0.001;
const CALENDAR_POLICY_VERSION = 'market-calendar-midpoint-v1';
const SPREAD_PROVENANCE = 'spread=pips; zero=missing_unresolved (importer encodes unavailable as 0)';
const SYNTHETIC_POLICY = 'dxy=formula(6 components); synchronized reset >=2 components @0.1% => synthetic_boundary_unresolved blocker';

const symbols = (process.argv.find((x) => x.startsWith('--symbols='))?.split('=')[1] || 'XAUUSD,EURUSD,USDJPY,DXY').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const targetWindows = Number(process.argv.find((x) => x.startsWith('--windows='))?.split('=')[1] || 3);
const minRows = Number(process.argv.find((x) => x.startsWith('--min-rows='))?.split('=')[1] || 1000);
const maxIslands = Number(process.argv.find((x) => x.startsWith('--max-windows-per-symbol='))?.split('=')[1] || 10);
const write = process.argv.includes('--write');
const parityConfirmed = process.argv.includes('--parity-confirmed');
const FROZEN_VERSION = `candle-detector-v4-calibrated@${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

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
  for (let i = 0; i < values.length; i++) {
    const sample = values.slice(Math.max(0, i - LOOKBACK), i).map((x) => x[field]).filter(Number.isFinite);
    if (sample.length < LOOKBACK) continue;
    const center = median(sample);
    const mad = median(sample.map((x) => Math.abs(x - center)));
    const value = values[i][field];
    if (!Number.isFinite(value)) continue;
    if (Math.abs(value - center) > Math.max(threshold.hardFloorRet, threshold.madMultiplier * Math.max(mad || 0, 1e-12))) robustOutliers++;
  }
  return { robustOutliers, hardFloorOutliers };
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
    if (value - center > Math.max(threshold.hardFloorRange, threshold.madMultiplier * Math.max(mad || 0, 1e-12))) robustOutliers++;
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

async function findDxyBoundaryCount(pool, start, end) {
  const { rows } = await pool.query(`
    SELECT ts, COUNT(*) FILTER (WHERE jump >= $1) AS jumped, COUNT(*) AS present FROM (
      SELECT symbol, ts, ABS((c - lag(c) OVER (PARTITION BY symbol ORDER BY ts)) / NULLIF(lag(c) OVER (PARTITION BY symbol ORDER BY ts), 0)) AS jump
      FROM market.candles_1m_canonical WHERE symbol = ANY($2) AND ts BETWEEN $3 AND $4
    ) j GROUP BY ts`, [DXY_COMPONENT_JUMP_FLOOR, DXY_COMPONENTS, start, end]);
  return rows.filter((r) => Number(r.present) === DXY_COMPONENTS.length && Number(r.jumped) >= 2).length;
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
        const zeroSpreadRows = rows.filter((r) => r.spread != null && Number(r.spread) === 0).length;
        const boundaryCount = symbol === 'DXY' ? await findDxyBoundaryCount(pool, island.window_start, island.window_end) : 0;

        // Quarantine rows inside the window (unresolved blockers).
        const { rows: qRows } = await pool.query(
          `SELECT COUNT(*)::int AS n FROM candle_quarantine
           WHERE symbol=$1 AND event_time BETWEEN $2 AND $3 AND superseded_at IS NULL
             AND (decision IS NULL OR decision <> 'KEEP' OR approved_at IS NULL)`,
          [symbol, island.window_start, island.window_end]);
        const unresolvedQuarantine = qRows[0].n;

        const blockers = [];
        if (metrics.ret.robustOutliers || metrics.range.robustOutliers || metrics.spread.robustOutliers) blockers.push('v3_robust_outliers');
        if (metrics.ret.hardFloorOutliers) blockers.push('v3_hard_floor_outliers');
        if (zeroSpreadRows > 0) blockers.push('spread_zero_unresolved');
        if (boundaryCount > 0) blockers.push('synthetic_boundary_unresolved');
        if (unresolvedQuarantine > 0) blockers.push('unresolved_quarantine_rows');

        const entry = {
          broker: island.broker, windowStart: island.window_start, windowEnd: island.window_end,
          rows: island.rows, metrics, zeroSpreadRows, syntheticBoundaryCount: boundaryCount,
          unresolvedQuarantine, blockers,
        };

        if (blockers.length === 0 && write) {
          const gateSummary = {
            effectiveBroker: island.broker,
            detectorVersion: FROZEN_VERSION,
            quarantineStatus: 'clean_zero_unresolved',
            calendarPolicyVersion: CALENDAR_POLICY_VERSION,
            spreadProvenance: SPREAD_PROVENANCE,
            syntheticPolicy: SYNTHETIC_POLICY,
            featureCoverageStatus: 'not_backfilled',
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
