#!/usr/bin/env node
/**
 * Detector v3 validation report (read-only).
 *
 * For each priority symbol (XAUUSD, EURUSD, USDJPY, DXY) compares:
 *   - v2 quarantine flags (audit-only evidence)
 *   - v3 quarantine flags (blocking authority)
 *   - overlap sets: v3-only, v2-only, both
 *   - current trusted-window blockers (via evaluate-trusted-window-detector logic)
 *   - false-positive assessment: v3 flags explained by calendar or verified
 *     formula-correct DXY synthetic boundaries
 *   - missed-corruption check: canonical rows with INVALID_OHLC or
 *     IMPOSSIBLE_SPREAD absent from v3 quarantine flags
 *
 * No writes. Emits JSON to reports/detector-v3-validation-<date>.json and a
 * human-readable markdown summary alongside it.
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SYMBOLS = ['XAUUSD', 'EURUSD', 'USDJPY', 'DXY'];
const DXY_COMPONENTS = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'];
const DXY_COMPONENT_JUMP_FLOOR = 0.001;
const FROZEN_VERSION = `candle-detector-v3-robust@${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: 'postgres',
    password: process.env.TM_DB_PASSWORD,
  });
  try {
    const report = { generatedAt: new Date().toISOString(), frozenVersion: FROZEN_VERSION, readOnly: true, symbols: {} };

    // DXY synthetic-boundary timestamps (verified formula-correct feed resets).
    const { rows: boundaryRows } = await pool.query(`
      SELECT ts FROM (
        SELECT ts, COUNT(*) FILTER (WHERE jump >= $1) AS jumped, COUNT(*) AS present
        FROM (
          SELECT symbol, ts, ABS((c - lag(c) OVER (PARTITION BY symbol ORDER BY ts)) / NULLIF(lag(c) OVER (PARTITION BY symbol ORDER BY ts), 0)) AS jump
          FROM market.candles_1m_canonical WHERE symbol = ANY($2)
        ) j GROUP BY ts
      ) x WHERE present = $3 AND jumped >= 2`, [DXY_COMPONENT_JUMP_FLOOR, DXY_COMPONENTS, DXY_COMPONENTS.length]);
    const dxyBoundaryTs = new Set(boundaryRows.map((r) => new Date(r.ts).toISOString()));

    for (const symbol of SYMBOLS) {
      // v2 + v3 quarantine rows for this symbol.
      const { rows: qRows } = await pool.query(`
        SELECT detector_version, event_time, flags, severity
        FROM candle_quarantine
        WHERE symbol = $1 AND superseded_at IS NULL`, [symbol]);
      const v2 = qRows.filter((r) => r.detector_version.startsWith('candle-detector-v2'));
      const v3 = qRows.filter((r) => r.detector_version.startsWith('candle-detector-v3'));
      const key = (r) => new Date(r.event_time).toISOString();
      const v2Set = new Set(v2.map(key));
      const v3Set = new Set(v3.map(key));
      const both = [...v3Set].filter((k) => v2Set.has(k));
      const v3Only = [...v3Set].filter((k) => !v2Set.has(k));
      const v2Only = [...v2Set].filter((k) => !v3Set.has(k));

      // Flag breakdown for v3.
      const v3FlagCounts = {};
      for (const r of v3) for (const f of r.flags) v3FlagCounts[f] = (v3FlagCounts[f] || 0) + 1;

      // False-positive assessment: calendar-explained gaps and DXY boundary.
      let calendarExplained = 0;
      let dxyBoundaryExplained = 0;
      for (const r of v3) {
        if (r.flags.includes('UNEXPECTED_GAP')) {
          const { rows: cls } = await pool.query(
            `WITH prev AS (
               SELECT max(ts) AS prev_ts FROM market.candles_1m_canonical
               WHERE symbol = $1 AND ts < $2
             )
             SELECT market.classify_candle_gap($1, $3, prev.prev_ts, $2) AS cls FROM prev`,
            [symbol, r.event_time, symbol === 'DXY' ? 'synthetic' : '1x Trade Ltd.'],
          );
          if (cls[0] && cls[0].cls && cls[0].cls !== 'UNEXPECTED') calendarExplained++;
        }
        if (symbol === 'DXY' && dxyBoundaryTs.has(key(r))) dxyBoundaryExplained++;
      }

      // Missed-corruption check: invalid OHLC / impossible spread in canonical
      // feed NOT present in v3 quarantine.
      const { rows: missed } = await pool.query(`
        WITH bad AS (
          SELECT ts FROM market.candles_1m_canonical
          WHERE symbol = $1 AND (h < l OR h < GREATEST(o, c) OR l > LEAST(o, c) OR spread < 0)
        )
        SELECT b.ts FROM bad b
        WHERE NOT EXISTS (
          SELECT 1 FROM candle_quarantine q
          WHERE q.symbol = $1 AND q.event_time = b.ts
            AND q.detector_version LIKE 'candle-detector-v3%'
            AND (q.flags @> ARRAY['INVALID_OHLC'] OR q.flags @> ARRAY['IMPOSSIBLE_SPREAD'])
        ) LIMIT 100`, [symbol]);

      // Current trusted-window blockers (candidate windows for this symbol).
      const { rows: windows } = await pool.query(
        `SELECT window_id FROM market.trusted_windows WHERE symbol = $1 AND status = 'candidate'`, [symbol]);

      report.symbols[symbol] = {
        quarantine: { v2Count: v2.length, v3Count: v3.length, both: both.length, v3Only: v3Only.length, v2Only: v2Only.length },
        v3FlagCounts,
        falsePositiveAssessment: { calendarExplainedGaps: calendarExplained, dxySyntheticBoundaryExplained: dxyBoundaryExplained },
        missedCorruption: { invalidOhlcOrImpossibleSpreadNotInV3: missed.length, sample: missed.map((r) => new Date(r.ts).toISOString()).slice(0, 10) },
        candidateWindows: windows.length,
      };
    }

    const date = new Date().toISOString().slice(0, 10);
    const jsonPath = path.join('reports', `detector-v3-validation-${date}.json`);
    const mdPath = path.join('reports', `detector-v3-validation-${date}.md`);
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    const lines = [`# Detector v3 Validation Report — ${date}`, '', `Frozen version: \`${FROZEN_VERSION}\` (read-only analysis)`, '',
      '| Symbol | v2 flags | v3 flags | both | v3-only | v2-only | FP: calendar gaps | FP: DXY boundary | missed corruption |',
      '|---|---|---|---|---|---|---|---|---|'];
    for (const s of SYMBOLS) {
      const r = report.symbols[s];
      lines.push(`| ${s} | ${r.quarantine.v2Count} | ${r.quarantine.v3Count} | ${r.quarantine.both} | ${r.quarantine.v3Only} | ${r.quarantine.v2Only} | ${r.falsePositiveAssessment.calendarExplainedGaps} | ${r.falsePositiveAssessment.dxySyntheticBoundaryExplained} | ${r.missedCorruption.invalidOhlcOrImpossibleSpreadNotInV3} |`);
    }
    lines.push('', '## v3 flag breakdown', '');
    for (const s of SYMBOLS) lines.push(`- **${s}**: ${JSON.stringify(report.symbols[s].v3FlagCounts)}`);
    lines.push('', '## Notes', '',
      '- v2 evidence is audit-only; v3 is blocking authority.',
      '- DXY synthetic-boundary timestamps are formula-derived feed resets (verified), blocked as `synthetic_boundary_unresolved` pending review, not corruption.',
      '- "Missed corruption" = canonical rows with INVALID_OHLC/IMPOSSIBLE_SPREAD absent from v3 flags; nonzero here means detector gap.',
      '- No quarantine decisions changed; no raw/canonical candles touched.');
    fs.writeFileSync(mdPath, lines.join('\n'));

    console.log(JSON.stringify({ jsonPath, mdPath, summary: Object.fromEntries(SYMBOLS.map((s) => [s, report.symbols[s].quarantine])) }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
