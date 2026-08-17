#!/usr/bin/env node
/**
 * review-adjudication-clusters.js — batch cluster adjudication editor (dry-run default).
 *
 * Encodes the v4 human adjudication policy as explicit per-cluster decisions and writes
 * clusterReviewed:true / clusterDecision / macroEventTag / excludeReason / reviewNote into
 * reports/adjudication-clusters-v4-2026-08-13.json, ready for flip-cluster-approvals.js.
 *
 * Policy (from human review 2026-08-13):
 *   - Weekday 21:00 UTC usd-complex/cross-symbol cohorts = chart-confirmed macro USD events.
 *       -> KEEP, tagged per catalyst. STILL requires human chart sign-off via --confirm-charts.
 *   - Saturday clusters = systemic extended-hours MT5 feed (1x Trade), NOT corruption.
 *       -> UNKNOWN_EVENT (fail-closed, stays blocking), tagged weekend-feed-pending-193.
 *   - Sunday 21:00+ UTC = legitimate FX weekly reopen (tradable).
 *       -> KEEP if rubric signature holds, tagged fx-weekly-reopen.
 *   - Sunday before 21:00 UTC = pre-open extended feed.
 *       -> UNKNOWN_EVENT, tagged weekend-feed-pending-193.
 *
 * Default: DRY-RUN (prints planned flips, writes nothing).
 * --write        : persist the flips into the clusters JSON.
 * --confirm-charts : required to flip any weekday KEEP (asserts human chart verification done).
 *
 * Read-only w.r.t. DB. Only edits the clusters review file.
 */
const fs = require('fs');
const PATH = 'reports/adjudication-clusters-v4-2026-08-13.json';
const WRITE = process.argv.includes('--write');
const CHARTS_OK = process.argv.includes('--confirm-charts');
const COHORTS_ARG = process.argv.find(a => a.startsWith('--cohorts='));
const COHORTS = COHORTS_ARG ? COHORTS_ARG.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : null;

const doc = JSON.parse(fs.readFileSync(PATH, 'utf8'));

// Per-event catalyst tags for chart-confirmed weekday 21:00 cohorts.
const MACRO_TAG = {
  '2026-06-17': 'warsh-fomc-2026-06-17',
  '2026-06-11': 'usd-macro-2026-06-11',
  '2026-04-30': 'usd-macro-2026-04-30',
  '2026-06-18': 'usd-macro-2026-06-18',
};

function classify(cl) {
  const d = new Date(cl.eventTime);
  const dow = d.getUTCDay();           // 0=Sun .. 6=Sat
  const hr = d.getUTCHours();
  const dateKey = cl.eventTime.slice(0, 10);

  if (dow === 6) {
    return { decision: 'UNKNOWN_EVENT', tag: 'weekend-feed-pending-193', note: 'Saturday extended-hours MT5 feed (1x Trade); calendar unresolved, held migration 193. Fail-closed, not corruption.' };
  }
  if (dow === 0) {
    if (hr >= 21) {
      // legitimate weekly reopen — treat like a macro/tradable move if signature holds
      return { decision: 'KEEP', tag: 'fx-weekly-reopen', note: 'Sunday 21:00+ UTC FX weekly reopen; tradable session start.', needsCharts: true };
    }
    return { decision: 'UNKNOWN_EVENT', tag: 'weekend-feed-pending-193', note: 'Sunday pre-open extended feed; calendar unresolved, held migration 193.' };
  }
  // weekday 21:00 macro cohorts
  if (hr === 21 && MACRO_TAG[dateKey]) {
    return { decision: 'KEEP', tag: MACRO_TAG[dateKey], note: 'Weekday 21:00 UTC usd-complex macro event; chart-confirmed.', needsCharts: true };
  }
  return null; // leave for individual human review
}

const plan = [];
let skippedCharts = 0;
let skippedScope = 0;
for (const cl of doc.clusters) {
  if (cl.clusterReviewed === true) continue; // idempotent: don't re-decide
  const c = classify(cl);
  if (!c) continue;
  if (COHORTS && !COHORTS.includes(c.tag)) { skippedScope++; continue; }
  if (c.needsCharts && c.decision === 'KEEP' && !CHARTS_OK) { skippedCharts++; plan.push({ clusterId: cl.clusterId, action: 'SKIP-needs-confirm-charts', decision: c.decision, tag: c.tag }); continue; }
  plan.push({ clusterId: cl.clusterId, action: 'FLIP', decision: c.decision, tag: c.tag, size: cl.size, symbols: cl.symbols.join(','), signature: cl.signature });
  if (WRITE) {
    cl.clusterReviewed = true;
    cl.clusterDecision = c.decision;
    cl.macroEventTag = c.tag;
    cl.reviewNote = c.note;
    if (c.decision === 'EXCLUDE') cl.excludeReason = c.note;
  }
}

const summary = {
  mode: WRITE ? 'WRITE' : 'DRY-RUN',
  chartsConfirmed: CHARTS_OK,
  cohortScope: COHORTS,
  plannedFlips: plan.filter(p => p.action === 'FLIP').length,
  skippedNeedsCharts: skippedCharts,
  skippedOutOfScope: skippedScope,
  keep: plan.filter(p => p.decision === 'KEEP' && p.action === 'FLIP').length,
  unknownEvent: plan.filter(p => p.decision === 'UNKNOWN_EVENT' && p.action === 'FLIP').length,
};
console.log(JSON.stringify(summary, null, 2));
for (const p of plan) console.log(`  [${p.action}] ${p.clusterId} -> ${p.decision} (${p.tag ?? ''}) ${p.size ?? ''}rows ${p.symbols ?? ''} ${p.signature ?? ''}`);

if (WRITE) {
  doc.reviewedAt = new Date().toISOString();
  doc.reviewPolicy = 'v4-human-2026-08-13';
  fs.writeFileSync(PATH, JSON.stringify(doc, null, 2));
  console.log(`WROTE ${PATH}`);
} else {
  console.log('DRY-RUN (pass --write to persist; add --confirm-charts to flip weekday KEEP)');
}
