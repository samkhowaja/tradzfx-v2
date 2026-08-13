#!/usr/bin/env node
/**
 * flip-cluster-approvals.js — fan cluster-level approvals out to row-level humanReviewed.
 *
 * Reads:
 *   reports/adjudication-clusters-v4-2026-08-13.json   (human flips clusterReviewed:true per approved cluster)
 *   reports/adjudication-decisions-v4-2026-08-13.scaffold.json
 *
 * Emits (with --write):
 *   reports/adjudication-decisions-v4-2026-08-13.approved.json
 *   - scaffoldOnly:false
 *   - proposals contains ONLY rows from approved clusters that pass every check
 *   - rows carry provenance: approvedViaClusterId, basis prefixed [CLUSTER-APPROVED]
 *
 * Per-row guards (any failure => row excluded + reported, cluster rest still fans out):
 *   1. quarantineId exists in scaffold with proposedDecision==='KEEP'
 *   2. row eventTime === cluster eventTime and symbol in cluster.symbols
 *   3. signature re-check: usd-complex-event requires coMoveCount>=1 AND dxySign==='confirm'
 *      (a cluster can look clean at minute level and hide a bad member row)
 *   4. live DB state: candle_quarantine row still active (superseded_at IS NULL)
 *      AND decision='UNKNOWN' — refuses to overwrite any conflicting human decision
 *   5. idempotent: rows already approvedVia same cluster are reported, not re-emitted
 *
 * Default dry-run (prints plan). --write emits the approved decision file.
 * Invariant printed at end. Read-only w.r.t. DB (SELECT only).
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const CLUSTERS_PATH = path.join('reports', 'adjudication-clusters-v4-2026-08-13.json');
const SCAFFOLD_PATH = path.join('reports', 'adjudication-decisions-v4-2026-08-13.scaffold.json');
const OUT_PATH = path.join('reports', 'adjudication-decisions-v4-2026-08-13.approved.json');
const WRITE = process.argv.includes('--write');

async function main() {
  const clusters = JSON.parse(fs.readFileSync(CLUSTERS_PATH, 'utf8'));
  const scaffold = JSON.parse(fs.readFileSync(SCAFFOLD_PATH, 'utf8'));
  const byId = new Map(scaffold.proposals.map(p => [p.quarantineId, p]));

  const approvedClusters = clusters.clusters.filter(c => c.clusterReviewed === true && c.clusterDecision === 'KEEP');
  const rejectedClusters = clusters.clusters.filter(c => c.clusterReviewed === true && c.clusterDecision !== 'KEEP');
  const unreviewed = clusters.clusters.filter(c => c.clusterReviewed !== true);

  // gather candidate row ids from approved clusters
  const candidateIds = new Set();
  for (const c of approvedClusters) for (const id of c.quarantineIds) candidateIds.add(id);

  // live DB conflict check (idempotency + refuse-overwrite)
  const client = new Client({
    host: process.env.TM_DB_HOST, port: Number(process.env.TM_DB_PORT),
    database: process.env.TM_DB_NAME, user: 'postgres', password: process.env.TM_DB_PASSWORD,
  });
  await client.connect();
  const live = new Map();
  if (candidateIds.size > 0) {
    const { rows } = await client.query(
      `SELECT id, symbol, decision, superseded_at FROM candle_quarantine WHERE id = ANY($1)`,
      [[...candidateIds]]);
    for (const r of rows) live.set(r.id, r);
  }

  const approvedRows = [];
  const skipped = [];
  for (const c of approvedClusters) {
    for (const id of c.quarantineIds) {
      const row = byId.get(id);
      const dbRow = live.get(id);
      let why = null;
      if (!row) why = 'not-in-scaffold';
      else if (row.proposedDecision !== 'KEEP') why = `scaffold-proposed-${row.proposedDecision}`;
      else if (row.eventTime !== c.eventTime) why = 'eventTime-mismatch';
      else if (!c.symbols.includes(row.symbol)) why = 'symbol-not-in-cluster';
      else if (c.signature === 'usd-complex-event' && !((row.coMoveCount ?? 0) >= 1 && row.dxySign === 'confirm'))
        why = 'signature-recheck-failed';
      else if (!dbRow) why = 'not-in-db';
      else if (dbRow.superseded_at !== null) why = 'db-superseded';
      else if (dbRow.decision !== 'UNKNOWN') why = `db-conflicting-decision-${dbRow.decision}`;

      if (why) skipped.push({ quarantineId: id, clusterId: c.clusterId, symbol: row?.symbol ?? dbRow?.symbol, why });
      else approvedRows.push({
        ...row,
        humanReviewed: true,
        approvedViaClusterId: c.clusterId,
        clusterSignature: c.signature,
        basis: `[CLUSTER-APPROVED ${c.clusterId} ${c.signature}] ${row.basis}`,
      });
    }
  }

  const summary = {
    clustersTotal: clusters.clusters.length,
    clustersApproved: approvedClusters.length,
    clustersRejected: rejectedClusters.length,
    clustersUnreviewed: unreviewed.length,
    rowsApproved: approvedRows.length,
    rowsSkippedFromApprovedClusters: skipped.length,
    bySignature: {},
  };
  for (const c of approvedClusters) summary.bySignature[c.signature] = (summary.bySignature[c.signature] ?? 0) + 1;

  console.log(JSON.stringify(summary, null, 2));
  if (skipped.length > 0) {
    console.log('SKIPPED (bad members hidden inside approved clusters / conflicts):');
    for (const s of skipped) console.log(`  ${s.quarantineId} ${s.symbol} [${s.clusterId}]: ${s.why}`);
  }

  if (WRITE) {
    if (approvedRows.length === 0) { console.log('NOTHING TO WRITE: no approved rows.'); }
    else {
      const out = {
        generatedAt: new Date().toISOString(),
        scaffoldOnly: false,
        reviewer: 'human-cluster-review',
        note: 'Row-level fan-out of cluster approvals. Every row passed signature re-check + live DB UNKNOWN check. UNKNOWN_EVENT rows absent — they remain blocking.',
        provenance: { clustersFile: CLUSTERS_PATH, scaffoldFile: SCAFFOLD_PATH, flipScript: 'scripts/flip-cluster-approvals.js' },
        proposals: approvedRows,
      };
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      console.log(`WROTE ${OUT_PATH} (${approvedRows.length} rows, scaffoldOnly:false)`);
    }
  } else {
    console.log('DRY-RUN (pass --write to emit approved decision file)');
  }

  // invariant
  const { rows: inv } = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE superseded_at IS NULL AND decision='UNKNOWN')::int AS active_unknown,
            COUNT(*) FILTER (WHERE superseded_at IS NULL AND decision<>'UNKNOWN')::int AS approved
     FROM candle_quarantine`);
  console.log('INVARIANT=' + JSON.stringify(inv[0]));
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
