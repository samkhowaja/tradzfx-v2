#!/usr/bin/env node
/**
 * report-canonical-gaps.js — audit deliberate canonical holes vs unresolved blocking cells.
 *
 * Read-only. Classifies every active quarantine row into:
 *   EXCLUDE  -> intentional canonical hole (deliberate scar, verified absent from canonical)
 *   UNKNOWN  -> unresolved blocking cell (wound; still blocked from canonical, awaiting verdict)
 *   KEEP/REPLACED -> approved (should flow through canonical; verified present)
 *
 * Cross-checks against market.candles_1m_canonical so the report reflects actual
 * canonical behavior, not just decision metadata. View contract (migration 186):
 *   - UNKNOWN rows STAY in canonical by design; they block trusted-window
 *     certification, not the view. So UNKNOWN + inCanonical = ok_cert_blocked
 *     (fail-closed at the gate), NOT a leak.
 *   - EXCLUDE row but canonical HAS the cell  -> hole_missing (BAD)
 *   - KEEP/REPLACED jump row but canonical lacks -> blocked_approved (BAD)
 *   - UNEXPECTED_GAP rows record a timing expectation (missing minute), NOT tick
 *     corruption. A candle may still exist at that cell (backfill, overlapping
 *     gap window, or jump+gap co-flag). Canonical presence alongside a gap flag
 *     is NOT an anomaly. Gap rows are reported as ok_gap_* and excluded from
 *     present/absent anomaly checks.
 *   - aligned                                 -> ok
 *
 * Outputs:
 *   reports/canonical-gap-audit-<date>.json  (machine)
 *   reports/canonical-gap-audit-<date>.md    (human)
 *
 * Usage: node scripts/report-canonical-gaps.js [--symbol=NZDUSD]
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');

const argv = process.argv.slice(2);
const SYM_ARG = argv.find(a => a.startsWith('--symbol='));
const SYM = SYM_ARG ? SYM_ARG.split('=')[1] : null;
const DATE = new Date().toISOString().slice(0, 10);

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD,
  });
  const client = await pool.connect();
  try {
    const where = SYM ? `WHERE symbol = $1` : '';
    const params = SYM ? [SYM] : [];
    const { rows: q } = await client.query(
      `SELECT id, symbol, broker, timeframe, event_time, flags, detector_version,
              decision, approved_by, approved_at, superseded_at
       FROM candle_quarantine ${where} ORDER BY symbol, event_time, id`, params);

    const active = q.filter(r => r.superseded_at === null);
    const superseded = q.filter(r => r.superseded_at !== null);

    // canonical membership check for active rows
    const cells = [...new Set(active.map(r => `${r.symbol}|${new Date(r.event_time).toISOString()}`))];
    const canonSet = new Set();
    if (cells.length) {
      const syms = [...new Set(active.map(r => r.symbol))];
      const times = [...new Set(active.map(r => new Date(r.event_time).toISOString()))];
      const { rows: cr } = await client.query(
        `SELECT symbol, ts FROM market.candles_1m_canonical
         WHERE symbol = ANY($1) AND ts = ANY($2::timestamptz[])`, [syms, times]);
      for (const r of cr) canonSet.add(`${r.symbol}|${new Date(r.ts).toISOString()}`);
    }

    const rows = active.map(r => {
      const ts = new Date(r.event_time).toISOString();
      const inCanonical = canonSet.has(`${r.symbol}|${ts}`);
      const isGap = (r.flags ?? []).includes('UNEXPECTED_GAP');
      let status;
      if (isGap) {
        // gap rows are timing markers; canonical presence is not anomalous
        // (backfilled cell, overlapping gap window, or co-flagged jump). Track but never flag.
        status = inCanonical ? 'ok_gap_present' : 'ok_gap_absent';
      } else if (r.decision === 'EXCLUDE') status = inCanonical ? 'hole_missing' : 'ok_hole';
      else if (r.decision === 'UNKNOWN' || r.decision === null) status = inCanonical ? 'ok_cert_blocked' : 'ok_blocking';
      else status = inCanonical ? 'ok_flowing' : 'blocked_approved';
      return {
        id: r.id, symbol: r.symbol, eventTime: ts, decision: r.decision ?? 'UNKNOWN',
        detector: r.detector_version, flags: r.flags, inCanonical, status,
        approvedBy: r.approved_by,
      };
    });

    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    const bySymbol = {};
    for (const r of rows) {
      bySymbol[r.symbol] = bySymbol[r.symbol] ?? { exclude_holes: 0, unknown_blocking: 0, keep_flowing: 0, anomalies: 0 };
      if (r.status === 'ok_hole') bySymbol[r.symbol].exclude_holes++;
      else if (r.status === 'ok_blocking' || r.status === 'ok_cert_blocked') bySymbol[r.symbol].unknown_blocking++;
      else if (r.status === 'ok_flowing') bySymbol[r.symbol].keep_flowing++;
      else bySymbol[r.symbol].anomalies++;
    }

    const anomalies = rows.filter(r => !r.status.startsWith('ok_'));
    const holes = rows.filter(r => r.status === 'ok_hole');
    // blocking = UNKNOWN rows whether they sit in canonical (cert-gated) or out
    const blocking = rows.filter(r => r.status === 'ok_blocking' || r.status === 'ok_cert_blocked');

    const summary = {
      generatedAt: new Date().toISOString(), symbolScope: SYM ?? 'ALL',
      activeRows: active.length, supersededRows: superseded.length,
      byStatus,
      anomalyCount: anomalies.length,
      excludeHoles: holes.length,
      unknownBlocking: blocking.length,
    };

    const json = { summary, bySymbol, anomalies, holes, blocking: blocking.map(r => ({ id: r.id, symbol: r.symbol, eventTime: r.eventTime, detector: r.detector })) };
    const jsonPath = `reports/canonical-gap-audit-${DATE}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));

    const md = [
      `# Canonical Gap Audit — ${DATE}`, '',
      `Read-only. Scope: ${summary.symbolScope}. Active quarantine rows: ${summary.activeRows} (superseded history: ${summary.supersededRows}).`, '',
      '## Summary', '',
      `| Class | Count | Meaning |`, `|---|---|---|`,
      `| Intentional EXCLUDE holes | ${holes.length} | deliberate canonical scars (approved corruption) |`,
      `| UNKNOWN blocking | ${blocking.length} | unresolved; cert-gate blocks (fail-closed), view keeps them by design |`,
      `| Anomalies | ${anomalies.length} | hole_missing / blocked_approved — MUST be 0 |`, '',
      '## Per-symbol', '',
      '| Symbol | EXCLUDE holes | UNKNOWN blocking | KEEP flowing | Anomalies |', '|---|---|---|---|---|',
      ...Object.entries(bySymbol).sort().map(([s, b]) => `| ${s} | ${b.exclude_holes} | ${b.unknown_blocking} | ${b.keep_flowing} | ${b.anomalies} |`),
      '', '## Intentional holes (EXCLUDE)', '',
      ...(holes.length ? holes.map(h => `- ${h.symbol} ${h.eventTime} (id ${h.id}, ${h.detector}, by ${h.approvedBy})`) : ['(none)']),
      '',
    ];
    if (anomalies.length) {
      md.push('## ANOMALIES (investigate)', '');
      for (const a of anomalies) md.push(`- **${a.status}**: id ${a.id} ${a.symbol} ${a.eventTime} decision=${a.decision} inCanonical=${a.inCanonical}`);
      md.push('');
    }
    const mdPath = `reports/canonical-gap-audit-${DATE}.md`;
    fs.writeFileSync(mdPath, md.join('\n'));

    console.log(JSON.stringify(summary, null, 2));
    console.log(`WROTE ${jsonPath} + ${mdPath}`);
    if (anomalies.length) { console.log('ANOMALIES PRESENT — see md report.'); process.exit(1); }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
