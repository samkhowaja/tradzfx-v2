#!/usr/bin/env node
/**
 * No-alternate quarantine bucketing report (read-only).
 *
 * Buckets active quarantine rows that have NO alternate-broker candle at the
 * same symbol/timestamp. Suggested dispositions (never applied automatically):
 *
 *   EXCLUDE  — INVALID_OHLC or IMPOSSIBLE_SPREAD (structurally corrupt row)
 *   KEEP     — flags fully explained by the market calendar (gap is expected)
 *   SYNTHETIC_BOUNDARY — DXY row at a verified synchronized component reset
 *   UNKNOWN  — unexplained large jump or mixed/insufficient evidence
 *
 * Output: reports/no-alternate-bucketing-<date>.json + .md
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');

const DXY_COMPONENTS = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'];
const DXY_COMPONENT_JUMP_FLOOR = 0.001;

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: 'postgres',
    password: process.env.TM_DB_PASSWORD,
  });
  try {
    // DXY synthetic-boundary timestamps for SYNTHETIC_BOUNDARY bucket.
    const { rows: boundaryRows } = await pool.query(`
      SELECT ts FROM (
        SELECT ts, COUNT(*) FILTER (WHERE jump >= $1) AS jumped, COUNT(*) AS present
        FROM (
          SELECT symbol, ts, ABS((c - lag(c) OVER (PARTITION BY symbol ORDER BY ts)) / NULLIF(lag(c) OVER (PARTITION BY symbol ORDER BY ts), 0)) AS jump
          FROM market.candles_1m_canonical WHERE symbol = ANY($2)
        ) j GROUP BY ts
      ) x WHERE present = $3 AND jumped >= 2`, [DXY_COMPONENT_JUMP_FLOOR, DXY_COMPONENTS, DXY_COMPONENTS.length]);
    const dxyBoundaryTs = new Set(boundaryRows.map((r) => new Date(r.ts).toISOString()));

    const { rows } = await pool.query(`
      SELECT q.symbol, q.broker, q.event_time, q.flags, q.severity, q.detector_version,
             raw.effective_broker_identity(q.broker) AS identity
      FROM candle_quarantine q
      WHERE q.superseded_at IS NULL
        AND q.decision IS DISTINCT FROM 'KEEP'
        AND q.broker <> 'smoke-test'
        AND NOT EXISTS (
          SELECT 1 FROM candles_1m a
          WHERE a.symbol = q.symbol AND a.ts = q.event_time
            AND raw.effective_broker_identity(a.broker) <> raw.effective_broker_identity(q.broker)
        )
      ORDER BY q.symbol, q.event_time`);

    const buckets = { EXCLUDE: [], KEEP: [], SYNTHETIC_BOUNDARY: [], UNKNOWN: [] };
    for (const r of rows) {
      const flags = r.flags;
      const eventIso = new Date(r.event_time).toISOString();
      const entry = { symbol: r.symbol, broker: r.broker, eventTime: eventIso, flags, severity: r.severity, detectorVersion: r.detector_version };

      if (flags.includes('INVALID_OHLC') || flags.includes('IMPOSSIBLE_SPREAD')) {
        buckets.EXCLUDE.push({ ...entry, reason: flags.includes('INVALID_OHLC') ? 'invalid_ohlc' : 'impossible_spread' });
        continue;
      }
      if (r.symbol === 'DXY' && dxyBoundaryTs.has(eventIso)) {
        buckets.SYNTHETIC_BOUNDARY.push({ ...entry, reason: 'verified synchronized component feed reset (formula-derived)' });
        continue;
      }
      if (flags.every((f) => f === 'UNEXPECTED_GAP')) {
        const { rows: gap } = await pool.query(
          `WITH prev AS (SELECT max(ts) prev_ts FROM market.candles_1m_canonical WHERE symbol=$1 AND ts<$2)
           SELECT market.classify_candle_gap($1, $3, prev.prev_ts, $2) AS gap_class FROM prev`,
          [r.symbol, r.event_time, r.identity]);
        if (gap[0]?.gap_class && gap[0].gap_class !== 'UNEXPECTED') {
          buckets.KEEP.push({ ...entry, reason: `calendar-explained (${gap[0].gap_class})` });
          continue;
        }
      }
      buckets.UNKNOWN.push({ ...entry, reason: flags.includes('LARGE_JUMP_ROBUST') || flags.includes('LARGE_JUMP_RELATIVE') ? 'unexplained large jump' : 'mixed or insufficient evidence' });
    }

    const summary = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
    const bySymbol = {};
    for (const [bucket, list] of Object.entries(buckets)) {
      for (const e of list) {
        bySymbol[e.symbol] = bySymbol[e.symbol] || {};
        bySymbol[e.symbol][bucket] = (bySymbol[e.symbol][bucket] || 0) + 1;
      }
    }

    const date = new Date().toISOString().slice(0, 10);
    const jsonPath = `reports/no-alternate-bucketing-${date}.json`;
    const mdPath = `reports/no-alternate-bucketing-${date}.md`;
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, summary, bySymbol, buckets }, null, 2));

    const lines = [`# No-Alternate Quarantine Bucketing — ${date}`, '',
      'Read-only. Suggested dispositions only — no quarantine decisions changed.', '',
      '## Summary', '', '| Bucket | Count | Meaning |', '|---|---|---|',
      `| EXCLUDE | ${summary.EXCLUDE} | invalid OHLC or impossible spread — structurally corrupt |`,
      `| KEEP | ${summary.KEEP} | calendar-explained gap |`,
      `| SYNTHETIC_BOUNDARY | ${summary.SYNTHETIC_BOUNDARY} | DXY verified formula-derived component reset |`,
      `| UNKNOWN | ${summary.UNKNOWN} | unexplained large jump or insufficient evidence |`, '',
      '## By symbol', '', '| Symbol | EXCLUDE | KEEP | SYNTHETIC_BOUNDARY | UNKNOWN |', '|---|---|---|---|---|'];
    for (const [sym, b] of Object.entries(bySymbol).sort()) {
      lines.push(`| ${sym} | ${b.EXCLUDE ?? 0} | ${b.KEEP ?? 0} | ${b.SYNTHETIC_BOUNDARY ?? 0} | ${b.UNKNOWN ?? 0} |`);
    }
    lines.push('', '## Notes', '',
      '- Rows here have no alternate-broker candle at the same timestamp; replacement is not an option.',
      '- EXCLUDE rows must never enter trusted windows regardless of broker policy.',
      '- KEEP rows are expected feed closures (weekend/daily break) — evidence for unblocking after review.',
      '- UNKNOWN rows stay quarantined until manually reviewed.');
    fs.writeFileSync(mdPath, lines.join('\n'));

    console.log(JSON.stringify({ jsonPath, mdPath, summary, bySymbol }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
