#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const VERSION = 'candle-detector-v3-robust';
const LOOKBACK = 60;
const THRESHOLDS = { DXY: { madMultiplier: 8, hardFloor: 0.02 }, default: { madMultiplier: 8, hardFloor: 0.005 } };
const DXY_COMPONENTS = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'];
const DXY_COMPONENT_JUMP_FLOOR = 0.001;
const summaryOnly = process.argv.includes('--summary');

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function evaluate(values, field, threshold) {
  const scored = [];
  for (let i = 0; i < values.length; i++) {
    const sample = values.slice(Math.max(0, i - LOOKBACK), i).map((x) => x[field]).filter(Number.isFinite);
    if (sample.length < LOOKBACK) continue;
    const center = median(sample);
    const mad = median(sample.map((x) => Math.abs(x - center)));
    const value = values[i][field];
    const deviation = Math.abs(value - center);
    const robustLimit = threshold.madMultiplier * Math.max(mad || 0, 1e-12);
    scored.push({ ts: values[i].ts, value, center, mad, deviation, robustOutlier: deviation > robustLimit, hardFloorOutlier: Math.abs(value) > threshold.hardFloor });
  }
  return scored;
}
async function findDxyBoundaryRows(pool, window) {
  if (window.symbol !== 'DXY') return [];
  const { rows } = await pool.query(`
    SELECT symbol, ts, c, lag(c) OVER (PARTITION BY symbol ORDER BY ts) previous_c
    FROM market.candles_1m_canonical
    WHERE symbol = ANY($1) AND ts BETWEEN $2 AND $3
    ORDER BY ts, symbol`, [DXY_COMPONENTS, window.window_start, window.window_end]);
  const byTs = new Map();
  for (const row of rows) {
    if (!byTs.has(row.ts.toISOString())) byTs.set(row.ts.toISOString(), []);
    const previous = Number(row.previous_c);
    const current = Number(row.c);
    if (Number.isFinite(previous) && previous !== 0 && Number.isFinite(current)) {
      byTs.get(row.ts.toISOString()).push(Math.abs((current - previous) / previous));
    }
  }
  return [...byTs.entries()]
    .filter(([, jumps]) => jumps.length === DXY_COMPONENTS.length && jumps.filter((jump) => jump >= DXY_COMPONENT_JUMP_FLOOR).length >= 2)
    .map(([ts]) => ts);
}

async function main() {
  const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });
  try {
    const { rows: windows } = await pool.query("SELECT window_id, symbol, timeframe, window_start, window_end, gate_summary->>'effectiveBroker' AS broker FROM market.trusted_windows WHERE status='candidate' ORDER BY window_id");
    const report = [];
    for (const window of windows) {
      const { rows } = await pool.query(`SELECT ts, o, h, l, c, spread FROM market.candles_1m_canonical WHERE symbol=$1 AND effective_broker_identity=$2 AND ts BETWEEN $3 AND $4 ORDER BY ts`, [window.symbol, window.broker, window.window_start, window.window_end]);
      const values = rows.map((row, index) => ({ ts: row.ts, ret: index && Number(row.c) && Number(rows[index - 1].c) ? (Number(row.c) - Number(rows[index - 1].c)) / Number(rows[index - 1].c) : null, range: Number(row.o) ? (Number(row.h) - Number(row.l)) / Number(row.o) : null, spread: row.spread == null ? null : Number(row.spread) }));
      const threshold = THRESHOLDS[window.symbol] || THRESHOLDS.default;
      const zeroSpreadRows = rows.filter((row) => row.spread != null && Number(row.spread) === 0).length;
      const syntheticBoundaryTimestamps = await findDxyBoundaryRows(pool, window);
      const metrics = Object.fromEntries(['ret', 'range', 'spread'].map((field) => {
        const scored = evaluate(values, field, threshold);
        return [field, { evaluated: scored.length, robustOutliers: scored.filter((x) => x.robustOutlier).length, hardFloorOutliers: field === 'ret' ? scored.filter((x) => x.hardFloorOutlier).length : null, firstOutliers: scored.filter((x) => x.robustOutlier).slice(0, 10) }];
      }));
      const blockers = [];
      if (metrics.ret.robustOutliers || metrics.range.robustOutliers || metrics.spread.robustOutliers) blockers.push('v3_robust_outliers');
      if (metrics.ret.hardFloorOutliers) blockers.push('v3_hard_floor_outliers');
      if (zeroSpreadRows > 0) blockers.push('spread_zero_unresolved');
      if (syntheticBoundaryTimestamps.length > 0) blockers.push('synthetic_boundary_unresolved');
      report.push({ ...window, detectorVersion: VERSION, lookbackBars: LOOKBACK, rows: rows.length, zeroSpreadRows, syntheticBoundaryTimestamps, metrics, blockers, promotion: blockers.length ? 'blocked' : 'eligible_for_manual_review' });
    }
    const output = summaryOnly ? {
      detectorVersion: VERSION,
      readOnly: true,
      windows: report.map((window) => ({
        window_id: window.window_id,
        symbol: window.symbol,
        rows: window.rows,
        blockers: window.blockers,
        promotion: window.promotion,
        zeroSpreadRows: window.zeroSpreadRows,
        syntheticBoundaryTimestamps: window.syntheticBoundaryTimestamps,
        metrics: Object.fromEntries(Object.entries(window.metrics).map(([name, metric]) => [name, {
          evaluated: metric.evaluated,
          robustOutliers: metric.robustOutliers,
          hardFloorOutliers: metric.hardFloorOutliers,
          firstOutlierTimestamps: metric.firstOutliers.map((outlier) => outlier.ts),
        }])),
      })),
    } : { detectorVersion: VERSION, readOnly: true, windows: report };
    console.log(JSON.stringify(output, null, 2));
    if (report.some((x) => x.blockers.length)) process.exitCode = 2;
  } finally { await pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
