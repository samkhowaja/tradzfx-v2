#!/usr/bin/env node
/**
 * Apply quarantine decisions (human-approved writes).
 *
 * Reads a proposal file from propose-quarantine-decisions.js and applies a
 * selected decision batch to candle_quarantine:
 *
 *   node scripts/apply-quarantine-decisions.js \
 *     --proposals=reports/quarantine-decision-proposals-2026-08-04.json \
 *     --decision=KEEP --reviewer=<name> --apply
 *
 * Safety properties:
 *   - Dry-run by default; --apply required for any write.
 *   - Only proposals whose proposedDecision matches --decision are touched.
 *   - REPLACED proposals additionally require linked replacement evidence
 *     (re-checked at apply time, not just at proposal time).
 *   - Updates only rows that are still undecided (decision UNKNOWN/NULL or
 *     unapproved) — never overwrites a different human decision.
 *   - Sets decision, approved_at, approved_by, and notes citing the evidence
 *     basis so the certification gate can resolve them.
 *   - Never touches raw/canonical candles. Quarantine metadata only.
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');

const argv = process.argv.slice(2);
function argValue(name) {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : null;
}
const PROPOSALS_PATH = argValue('proposals');
const DECISION = argValue('decision');
const REVIEWER = argValue('reviewer');
const APPLY = argv.includes('--apply');

async function main() {
  if (!PROPOSALS_PATH || !DECISION || !REVIEWER) {
    console.error('Required: --proposals=<path> --decision=KEEP|EXCLUDE|REPLACED --reviewer=<name> [--apply]');
    process.exit(1);
  }
  if (!['KEEP', 'EXCLUDE', 'REPLACED'].includes(DECISION)) {
    console.error('--decision must be KEEP, EXCLUDE, or REPLACED (UNKNOWN rows are never batch-applied)');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(PROPOSALS_PATH, 'utf8'));
  // Scaffold guard: a scaffold file (scaffoldOnly:true) carries SUGGESTED dispositions.
  // Refuse to apply any row a human has not explicitly flipped to humanReviewed:true.
  if (doc.scaffoldOnly === true) {
    const unreviewed = (doc.proposals ?? []).filter((p) => p.humanReviewed !== true && p.proposedDecision === DECISION);
    if (unreviewed.length) {
      console.error(`REFUSED: ${unreviewed.length} ${DECISION} row(s) in scaffold ${PROPOSALS_PATH} have humanReviewed!=true. Adjudicate and flip humanReviewed before --apply.`);
      process.exit(1);
    }
  }
  const batch = (doc.proposals ?? []).filter((p) => p.proposedDecision === DECISION && (doc.scaffoldOnly === true ? p.humanReviewed === true : true));
  if (!batch.length) {
    console.log(JSON.stringify({ applied: 0, skipped: 0, reason: `no ${DECISION} proposals in ${PROPOSALS_PATH}` }));
    return;
  }

  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: 'postgres',
    password: process.env.TM_DB_PASSWORD,
  });
  const client = await pool.connect();
  const applied = [];
  const skipped = [];
  try {
    if (APPLY) await client.query('BEGIN');
    for (const p of batch) {
      // Re-read current state; never overwrite a different human decision.
      const { rows: cur } = await client.query(
        `SELECT id, decision, approved_at, superseded_at FROM candle_quarantine WHERE id=$1`,
        [p.quarantineId]);
      const row = cur[0];
      if (!row || row.superseded_at) { skipped.push({ id: p.quarantineId, reason: 'missing or superseded' }); continue; }
      const decided = row.decision && row.decision !== 'UNKNOWN' && row.decision !== DECISION && row.approved_at;
      if (decided) { skipped.push({ id: p.quarantineId, reason: `already decided ${row.decision}` }); continue; }

      if (DECISION === 'REPLACED') {
        const { rows: ev } = await client.query(
          `SELECT 1 FROM market.candle_replacement_evidence
           WHERE symbol=$1 AND event_time=$2 AND blocked_broker=$3 LIMIT 1`,
          [p.symbol, p.eventTime, p.broker]);
        if (!ev.length) { skipped.push({ id: p.quarantineId, reason: 'no linked replacement evidence' }); continue; }
      }

      if (APPLY) {
        await client.query(
          `UPDATE candle_quarantine
           SET decision=$2, approved_at=now(), approved_by=$3, notes=$4
           WHERE id=$1`,
          [p.quarantineId, DECISION, REVIEWER,
           `batch decision ${DECISION} by ${REVIEWER}; evidence: ${p.basis}; proposals file: ${PROPOSALS_PATH}`]);
      }
      applied.push({ id: p.quarantineId, symbol: p.symbol, eventTime: p.eventTime, decision: DECISION });
    }
    if (APPLY) {
      await client.query('COMMIT');
      console.log(JSON.stringify({ mode: 'APPLY', applied: applied.length, skipped: skipped.length, appliedRows: applied, skippedRows: skipped }, null, 2));
    } else {
      console.log(JSON.stringify({ mode: 'DRY-RUN (no writes; pass --apply to commit)', wouldApply: applied.length, wouldSkip: skipped.length, appliedRows: applied, skippedRows: skipped }, null, 2));
    }
  } catch (err) {
    if (APPLY) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
