#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const OUT = path.resolve(__dirname, '..', 'reports');
const iso = (v) => v instanceof Date ? v.toISOString() : v;

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: process.env.TM_DB_USER || 'postgres',
    password: process.env.TM_DB_PASSWORD,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = await client.query(`SELECT current_database() database_name, version() database_version, now() snapshot_at`);
    const rows = await client.query(`
      SELECT q.id::text AS quarantine_id, q.symbol, q.broker, q.timeframe, q.event_time,
             q.detector_version, q.flags, q.severity, q.decision, q.approved_at,
             q.approved_by, q.superseded_at, q.superseded_by,
             raw.effective_broker_identity(q.broker) AS effective_broker,
             (SELECT COUNT(*) FROM candles_1m a
               WHERE a.symbol=q.symbol AND a.ts=q.event_time
                 AND raw.effective_broker_identity(a.broker) IS DISTINCT FROM raw.effective_broker_identity(q.broker))::int AS alternate_count,
             EXISTS (SELECT 1 FROM candles_1m a
               WHERE a.symbol=q.symbol AND a.ts=q.event_time
                 AND raw.effective_broker_identity(a.broker) IS DISTINCT FROM raw.effective_broker_identity(q.broker)) AS has_alternate,
             EXISTS (SELECT 1 FROM market.candle_replacement_evidence e
               WHERE e.symbol=q.symbol AND e.event_time=q.event_time AND e.blocked_broker=q.broker) AS has_replacement_evidence
        FROM candle_quarantine q
       WHERE q.broker <> 'smoke-test'
       ORDER BY q.symbol, q.event_time, q.id`);
    await client.query('ROLLBACK');

    const all = rows.rows.map(r => ({
      ...r,
      event_time: iso(r.event_time),
      approved_at: iso(r.approved_at),
      superseded_at: iso(r.superseded_at),
      active: r.superseded_at == null,
      normalized_decision: r.approved_at == null ? 'UNRESOLVED' : (r.decision || 'UNRESOLVED'),
      identity_key: [r.symbol, r.effective_broker, r.timeframe || '1m', r.event_time].join('|'),
      blocker_reason: (r.flags || []).slice().sort().join('+') || 'NO_FLAG',
      population_bucket: null,
    }));
    const active = all.filter(r => r.active && r.normalized_decision !== 'KEEP');
    const identities = new Map();
    for (const r of active) {
      if (!identities.has(r.identity_key)) identities.set(r.identity_key, []);
      identities.get(r.identity_key).push(r);
    }
    const classify = (items) => {
      const hasAlt = items.some(r => r.has_alternate);
      const hasEvidence = items.some(r => r.has_replacement_evidence);
      // Historical 85/287 estimate is not imported as truth. These are evidence-based
      // reconciliation buckets, explicitly named to prevent false equivalence.
      if (hasAlt && !hasEvidence) return 'ALTERNATE_EVIDENCE_REVIEW';
      if (!hasAlt) return 'NO_ALTERNATE_MANUAL_POLICY';
      return 'REVIEW_REQUIRED';
    };
    const identityRows = [...identities.entries()].map(([key, items]) => ({
      identity_key: key,
      symbol: items[0].symbol,
      effective_broker: items[0].effective_broker,
      timeframe: items[0].timeframe || '1m',
      event_time: items[0].event_time,
      active_row_count: items.length,
      quarantine_ids: items.map(r => r.quarantine_id),
      blocker_reasons: [...new Set(items.map(r => r.blocker_reason))].sort(),
      detector_versions: [...new Set(items.map(r => r.detector_version))].sort(),
      has_alternate: items.some(r => r.has_alternate),
      alternate_count_max: Math.max(...items.map(r => Number(r.alternate_count || 0))),
      has_replacement_evidence: items.some(r => r.has_replacement_evidence),
      normalized_decisions: [...new Set(items.map(r => r.normalized_decision))].sort(),
      superseded_rows: items.filter(r => r.superseded_at).length,
      population_bucket: classify(items),
    }));
    const count = (list, key) => list.reduce((m, r) => { const v = r[key] ?? 'NULL'; m[v] = (m[v] || 0) + 1; return m; }, {});
    const by = (list, fn) => list.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});
    const report = {
      schema: 'canonical-blocker-population-reconciliation-readonly-v1',
      generated_at: new Date().toISOString(),
      mode: 'REPEATABLE READ READ ONLY',
      database: identity.rows[0],
      accounting: { database_writes: 0, source_state_changes: 0, artifact_writes: 2 },
      requested_population: { total: 372, alternate: 85, manual: 287, source: 'user-supplied prior estimate; not treated as evidence' },
      observed_population: {
        all_rows: all.length,
        active_blocker_rows: active.length,
        active_blocker_identities: identityRows.length,
        active_rows_minus_identities: active.length - identityRows.length,
        active_duplicate_row_excess: active.length - identityRows.length,
        superseded_rows: all.filter(r => !r.active).length,
        approved_rows: all.filter(r => r.approved_at != null).length,
      },
      reconciliation: {
        row_identity_mismatch: active.length !== identityRows.length,
        requested_total_mismatch: identityRows.length !== 372,
        requested_buckets_not_proven: true,
        explanation: 'Rows and identities are separate populations; historical 85/287 bucket provenance is absent from current snapshot.',
      },
      active_by_symbol: count(active, 'symbol'),
      active_by_broker: count(active, 'broker'),
      active_by_effective_broker: count(active, 'effective_broker'),
      active_by_timeframe: count(active, 'timeframe'),
      active_by_reason: count(active, 'blocker_reason'),
      active_by_detector: count(active, 'detector_version'),
      active_by_decision: count(active, 'normalized_decision'),
      active_by_bucket: count(identityRows, 'population_bucket'),
      identity_multiplicity: by(identityRows, r => String(r.active_row_count)),
      identities: identityRows,
      rows: all,
      limitations: [
        'Historical 85 replaceable / 287 manual membership cannot be inferred from counts alone.',
        'ALTERNATE_EVIDENCE_REVIEW is not REPLACED and does not authorize migration.',
        'NO_ALTERNATE_MANUAL_POLICY is not EXCLUDE and does not authorize migration.',
        'Superseded rows are retained for audit and excluded from active blocker population.',
      ],
    };
    fs.mkdirSync(OUT, { recursive: true });
    const date = report.generated_at.slice(0, 10);
    const jsonPath = path.join(OUT, `canonical-blocker-reconciliation-${date}.json`);
    const mdPath = path.join(OUT, `canonical-blocker-reconciliation-${date}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    const md = [
      `# Canonical Blocker Population Reconciliation — ${date}`,
      '', `Mode: \`${report.mode}\``, '',
      '## Count reconciliation', '',
      `- Requested prior estimate: **372 identities** = 85 alternate + 287 manual.`,
      `- Observed active blocker rows: **${active.length}**.`,
      `- Observed active blocker identities: **${identityRows.length}**.`,
      `- Duplicate active-row excess: **${active.length - identityRows.length}**.`,
      `- Superseded rows retained separately: **${report.observed_population.superseded_rows}**.`, '',
      '## Evidence-based buckets', '',
      ...Object.entries(report.active_by_bucket).map(([k, v]) => `- ${k}: ${v} identities`), '',
      'These buckets do not equal historical 85/287 claims. They are review buckets only.', '',
      '## Active rows by symbol', '',
      ...Object.entries(report.active_by_symbol).map(([k, v]) => `- ${k}: ${v}`), '',
      '## Active rows by blocker reason', '',
      ...Object.entries(report.active_by_reason).map(([k, v]) => `- ${k}: ${v}`), '',
      '## Decision', '',
      '**No decision migration is authorized.** Population mismatch remains unresolved.', '',
      'Database writes: `0`. Source state changes: `0`.', '',
    ].join('\n');
    fs.writeFileSync(mdPath, md);
    console.log(JSON.stringify({ jsonPath, mdPath, activeRows: active.length, activeIdentities: identityRows.length, activeBuckets: report.active_by_bucket, databaseWrites: 0 }, null, 2));
  } finally { client.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
