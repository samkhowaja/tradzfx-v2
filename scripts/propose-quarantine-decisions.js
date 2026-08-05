#!/usr/bin/env node
/**
 * Quarantine decision proposals (read-only).
 *
 * Joins the two evidence reports (alternate-broker replacement + no-alternate
 * bucketing) against active candle_quarantine rows and emits a proposed
 * decision per row:
 *
 *   KEEP_CANDIDATE / calendar-explained  -> propose KEEP
 *   SYNTHETIC_BOUNDARY (verified reset)  -> propose KEEP (formula-correct data)
 *   EXCLUDE_CANDIDATE / invalid OHLC / impossible spread -> propose EXCLUDE
 *   REPLACE_CANDIDATE                    -> propose REPLACED (only when linked
 *                                          replacement evidence exists)
 *   UNKNOWN                              -> no proposal (stays UNKNOWN)
 *
 * NOTHING is written to the database. Proposals go to
 * reports/quarantine-decision-proposals-<date>.json. Humans apply them via
 * apply-quarantine-decisions.js with explicit flags.
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');

const DATE = new Date().toISOString().slice(0, 10);

function latestReport(prefix) {
  const files = fs.readdirSync('reports').filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(`reports/${files[files.length - 1]}`, 'utf8'));
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
    const alt = latestReport('alternate-broker-replacement-');
    const noAlt = latestReport('no-alternate-bucketing-');
    if (!alt && !noAlt) {
      console.error('No evidence reports found in reports/. Run report-alternate-broker-replacement.js and report-no-alternate-bucketing.js first.');
      process.exit(1);
    }

    const { rows: qRows } = await pool.query(
      `SELECT id, symbol, broker, event_time, flags, decision, approved_at
       FROM candle_quarantine WHERE superseded_at IS NULL AND broker <> 'smoke-test'`);

    // Index replacement evidence existence for REPLACED proposals.
    const { rows: evRows } = await pool.query(
      `SELECT DISTINCT symbol, event_time, blocked_broker FROM market.candle_replacement_evidence`);
    const evSet = new Set(evRows.map((e) => `${e.symbol}|${new Date(e.event_time).toISOString()}|${e.blocked_broker}`));

    const altMap = new Map();
    for (const e of alt?.evaluated ?? []) altMap.set(`${e.symbol}|${e.eventTime}|${e.blockedBroker}`, e);
    const noAltMap = new Map();
    for (const [bucket, list] of Object.entries(noAlt?.buckets ?? {})) {
      for (const e of list) noAltMap.set(`${e.symbol}|${e.eventTime}|${e.broker}`, { bucket, reason: e.reason });
    }

    const proposals = [];
    for (const q of qRows) {
      const key = `${q.symbol}|${new Date(q.event_time).toISOString()}|${q.broker}`;
      const a = altMap.get(key);
      const n = noAltMap.get(key);
      let proposed = null;
      let basis = null;

      if (a?.suggestion === 'REPLACE_CANDIDATE' && evSet.has(key)) { proposed = 'REPLACED'; basis = 'alternate-broker report + linked replacement evidence'; }
      else if (a?.suggestion === 'REPLACE_CANDIDATE') { proposed = null; basis = 'REPLACE_CANDIDATE but no linked replacement evidence — record evidence first'; }
      else if (a?.suggestion === 'KEEP_CANDIDATE') { proposed = 'KEEP'; basis = `alternate-broker report: ${a.calendarExplainedOnly ? 'calendar-explained' : 'blocked row sane'}`; }
      else if (a?.suggestion === 'EXCLUDE_CANDIDATE') { proposed = 'EXCLUDE'; basis = 'both blocked and alternate candles invalid'; }
      else if (n?.bucket === 'KEEP') { proposed = 'KEEP'; basis = `no-alternate report: ${n.reason}`; }
      else if (n?.bucket === 'SYNTHETIC_BOUNDARY') { proposed = 'KEEP'; basis = `no-alternate report: ${n.reason}`; }
      else if (n?.bucket === 'EXCLUDE') { proposed = 'EXCLUDE'; basis = `no-alternate report: ${n.reason}`; }

      if (proposed && q.decision !== proposed) {
        proposals.push({
          quarantineId: q.id, symbol: q.symbol, broker: q.broker,
          eventTime: new Date(q.event_time).toISOString(), flags: q.flags,
          currentDecision: q.decision, proposedDecision: proposed, basis,
          alreadyApproved: q.approved_at != null,
        });
      }
    }

    const summary = {};
    for (const p of proposals) summary[p.proposedDecision] = (summary[p.proposedDecision] || 0) + 1;
    const out = { generatedAt: new Date().toISOString(), readOnly: true, sources: { alternateBroker: alt?.generatedAt, noAlternate: noAlt?.generatedAt }, summary, proposals };
    const outPath = `reports/quarantine-decision-proposals-${DATE}.json`;
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ outPath, summary, total: proposals.length }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
