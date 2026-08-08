#!/usr/bin/env node
/**
 * READ-ONLY 15m bucket child classifier for XAUUSD.
 *
 * Re-classifies the wall-clock "incomplete 15m buckets" under the frozen
 * XAUUSD calendar contract (marketCalendar.ts): FX 24/5 week
 * (Sun 21:00 UTC -> Fri 21:00 UTC), XAUUSD daily break 21:00-22:00 UTC,
 * holidays not modelled (1xTrade streams through).
 *
 * Per-child classes:
 *   weekend_closure            - Sat, or Sun before 21:00 UTC
 *   friday_close               - Fri at/after 21:00 UTC
 *   daily_break                - XAUUSD 21:00-22:00 UTC maintenance halt
 *   canonical_excluded_present_raw - raw candles_1m has the bar, canonical view does not
 *   modeled_break_edge       - absent in raw inside the modeled break-edge window
 *                              (pre-break halt from 20:50Z / post-break resume until 22:05Z);
 *                              policy in marketCalendar.ts BREAK_EDGE_POLICY_BY_SYMBOL
 *   documented_outage_gap    - inside KNOWN_FEED_OUTAGES registry (genuine outage;
 *                              permanent hard blocker until replaced or waived)
 *   possible_timezone_shift  - tradable child absent OUTSIDE break edges, raw bar
 *                              exists at +/-1/2/3h same minute
 *   genuine_unresolved_gap   - tradable, absent in raw, no shifted candidate
 *
 * Bucket classes:
 *   calendar_explained  - fully closed bucket OR all absences calendar-explained
 *   boundary_partial    - mix of tradable-present and calendar-explained absences
 *   break_edge_partial  - all absences modeled_break_edge (modeled closure)
 *   documented_outage   - all absences documented_outage_gap (HARD FAIL until resolved)
 *   data_gap            - any genuine_unresolved_gap child
 *   exclusion_suspect   - any canonical_excluded_present_raw child
 *   timezone_suspect    - any possible_timezone_shift child (and no worse class)
 *
 * Exit code 1 if any documented_outage / data_gap / timezone_suspect /
 * exclusion_suspect bucket exists (fail-closed).
 *
 * NO WRITES to the database. Output goes to reports/ only.
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const SYMBOL = "XAUUSD";
const START = new Date("2026-07-19T22:00:00Z");
const END_EXCLUSIVE = new Date("2026-08-06T18:45:00Z");
const LOOKBACK_BARS = 500;
const LOOKBACK_START = new Date(START.getTime() - LOOKBACK_BARS * 15 * 60_000);
const BREAK_START_MIN = 21 * 60;
const BREAK_END_MIN = 22 * 60;

// Mirrors packages/shared/src/utils/marketCalendar.ts BREAK_EDGE_POLICY_BY_SYMBOL
// and KNOWN_FEED_OUTAGES (CJS script cannot import the TS module; keep in sync).
const BREAK_EDGE_POLICY = { preBreakHaltFromMinUTC: 20 * 60 + 50, postBreakResumeMinUTC: 22 * 60 + 5 };
const KNOWN_FEED_OUTAGES = [];
// STRUCTURAL_BROKER_HOLE (2026-08-07 decision): broker-proven absence, three
// agreeing evidence classes (live, re-export, on-demand CopyRates). Expected-
// incomplete: documented, non-blocking. Mirror of STRUCTURAL_BROKER_HOLES in
// packages/shared/src/utils/marketCalendar.ts — keep in sync.
const STRUCTURAL_BROKER_HOLES = [
  { startUTC: "2026-07-29T12:00:00Z", endExclusiveUTC: "2026-07-29T12:08:00Z",
    provenanceArtifact: "fefc1b2b-87cc-4f53-98e3-871e25b8df5d" },
];

function inBreakEdgeWindow(ts) {
  const mins = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  return (mins >= BREAK_EDGE_POLICY.preBreakHaltFromMinUTC && mins < BREAK_START_MIN) ||
         (mins >= BREAK_END_MIN && mins < BREAK_EDGE_POLICY.postBreakResumeMinUTC);
}
function inKnownFeedOutage(ts) {
  const t = ts.getTime();
  return KNOWN_FEED_OUTAGES.some(o => t >= new Date(o.startUTC).getTime() && t < new Date(o.endExclusiveUTC).getTime());
}
function inStructuralBrokerHole(ts) {
  const t = ts.getTime();
  return STRUCTURAL_BROKER_HOLES.some(o => t >= new Date(o.startUTC).getTime() && t < new Date(o.endExclusiveUTC).getTime());
}

function sha256File(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

function closureClass(ts) {
  const dow = ts.getUTCDay();
  const h = ts.getUTCHours();
  if (dow === 6) return "weekend_closure";
  if (dow === 0 && h < 21) return "weekend_closure";
  if (dow === 5 && h >= 21) return "friday_close";
  const mins = h * 60 + ts.getUTCMinutes();
  if (mins >= BREAK_START_MIN && mins < BREAK_END_MIN) return "daily_break";
  return null; // tradable
}

async function main() {
  const stateMachinePath = "docs/repro/LINEAGE-STATE-MACHINE.md";
  const calendarPath = "packages/shared/src/utils/marketCalendar.ts";
  const certifierPath = "scripts/certify-15m-atr-windows.js";
  const manifestPath = "reports/backfill-runs/2026-08-06T23-34-27-732Z.json";
  for (const p of [stateMachinePath, calendarPath, certifierPath, manifestPath]) {
    if (!fs.existsSync(p)) throw new Error(`frozen contract input missing: ${p}`);
  }

  const contract = {
    stateMachineDoc: { path: stateMachinePath, sha256: sha256File(stateMachinePath) },
    sourceManifest: { path: manifestPath, sha256: sha256File(manifestPath) },
    calendarPolicy: {
      path: calendarPath,
      sha256: sha256File(calendarPath),
      week: "FX 24/5: Sun 21:00 UTC -> Fri 21:00 UTC",
      dailyBreaks: { XAUUSD: ["21:00-22:00 UTC"] },
      holidays: "not modelled (1xTrade feed streams through US holidays)",
    },
    certifier: { path: certifierPath, sha256: sha256File(certifierPath) },
    parserIdentity: "backfill-candles-from-mt5-csv.js + ingestion-server.js (pointsToPips, getPipSize)",
    parserConfiguration: "--tz-offset-minutes=180 --broker=MT5, corrupt-bar reject, magnitude-suspect quarantine",
    timezonePolicy: "UTC everywhere; MT5 CSV shifted by fixed +180min; no DST handling",
    symbolMapping: "XAUUSD only; effective_broker_identity = 1x Trade Ltd. (legacy raw label MT5)",
    rowOrdering: "ts ASC; bucket = date_bin('15 minutes', ts, timestamptz '1970-01-01')",
    breakEdgePolicy: { XAUUSD: { preBreakHaltFromUTC: "20:50", postBreakResumeUTC: "22:05", source: "marketCalendar.ts BREAK_EDGE_POLICY_BY_SYMBOL (mirrored)" } },
    knownFeedOutages: KNOWN_FEED_OUTAGES,
    structuralBrokerHoles: STRUCTURAL_BROKER_HOLES,
    candidateWindow: { start: START.toISOString(), endExclusive: END_EXCLUSIVE.toISOString(), lookbackStart: LOOKBACK_START.toISOString(), lookbackBars: LOOKBACK_BARS },
  };
  contract.contractHash = crypto.createHash("sha256").update(JSON.stringify(contract)).digest("hex");

  const p = new Pool(getDbConfig());
  try {
    const canonical = await p.query(
      `SELECT ts FROM market.candles_1m_canonical WHERE symbol=$1 AND ts >= $2 AND ts < $3 ORDER BY ts`,
      [SYMBOL, LOOKBACK_START, END_EXCLUSIVE]);
    const rawLo = new Date(LOOKBACK_START.getTime() - 3 * 3_600_000);
    const rawHi = new Date(END_EXCLUSIVE.getTime() + 3 * 3_600_000);
    const raw = await p.query(
      `SELECT DISTINCT ts FROM candles_1m WHERE symbol=$1 AND ts >= $2 AND ts < $3 ORDER BY ts`,
      [SYMBOL, rawLo, rawHi]);
    const canonicalSet = new Set(canonical.rows.map(r => new Date(r.ts).getTime()));
    const rawSet = new Set(raw.rows.map(r => new Date(r.ts).getTime()));

    // Per-day empirical break edges from raw feed (evidence for the policy).
    const edgeRows = await p.query(
      `SELECT (ts AT TIME ZONE 'UTC')::date AS day,
              max(ts) FILTER (WHERE (ts AT TIME ZONE 'UTC')::time < time '21:00') AS last_pre_break,
              min(ts) FILTER (WHERE (ts AT TIME ZONE 'UTC')::time >= time '22:00') AS first_post_break
       FROM candles_1m WHERE symbol=$1 AND ts >= $2 AND ts < $3
         AND extract(isodow FROM ts AT TIME ZONE 'UTC') BETWEEN 1 AND 4
       GROUP BY 1 ORDER BY 1`,
      [SYMBOL, LOOKBACK_START, END_EXCLUSIVE]);
    const empiricalBreakEdges = edgeRows.rows.map(r => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      lastPreBreakBarUTC: r.last_pre_break ? new Date(r.last_pre_break).toISOString() : null,
      firstPostBreakBarUTC: r.first_post_break ? new Date(r.first_post_break).toISOString() : null,
    }));

    const buckets = [];
    const classCounts = {};
    const bucketClassCounts = {};
    for (let b = Math.floor(LOOKBACK_START.getTime() / 900_000) * 900_000; b < END_EXCLUSIVE.getTime(); b += 900_000) {
      const children = [];
      let present = 0, tradable = 0;
      const missing = [];
      for (let i = 0; i < 15; i++) {
        const ts = new Date(b + i * 60_000);
        const closed = closureClass(ts);
        const inCanonical = canonicalSet.has(ts.getTime());
        if (inCanonical) present++;
        if (!closed) tradable++;
        if (!inCanonical) {
          let cls;
          if (closed) cls = closed;
          else if (rawSet.has(ts.getTime())) cls = "canonical_excluded_present_raw";
          else if (inKnownFeedOutage(ts)) cls = "documented_outage_gap";
          else if (inStructuralBrokerHole(ts)) cls = "structural_broker_hole";
          else if (inBreakEdgeWindow(ts)) cls = "modeled_break_edge";
          else {
            const shifted = [1, 2, 3, -1, -2, -3].some(h => rawSet.has(ts.getTime() + h * 3_600_000));
            cls = shifted ? "possible_timezone_shift" : "genuine_unresolved_gap";
          }
          missing.push({ ts: ts.toISOString(), class: cls });
          classCounts[cls] = (classCounts[cls] || 0) + 1;
        }
        children.push(ts);
      }
      let bucketClass;
      if (present === 0 && tradable === 0) bucketClass = "calendar_explained"; // fully closed, omitted upstream
      else if (missing.length === 0) bucketClass = "complete";
      else if (missing.some(m => m.class === "genuine_unresolved_gap")) bucketClass = "data_gap";
      else if (missing.some(m => m.class === "documented_outage_gap")) bucketClass = "documented_outage";
      else if (missing.some(m => m.class === "structural_broker_hole")) bucketClass = "structural_hole"; // expected-incomplete, non-blocking
      else if (missing.some(m => m.class === "canonical_excluded_present_raw")) bucketClass = "exclusion_suspect";
      else if (missing.some(m => m.class === "possible_timezone_shift")) bucketClass = "timezone_suspect";
      else if (missing.every(m => m.class === "modeled_break_edge")) bucketClass = "break_edge_partial";
      else if (present > 0) bucketClass = "boundary_partial";
      else bucketClass = "calendar_explained";
      if (bucketClass !== "complete" && bucketClass !== "calendar_explained") {
        bucketClassCounts[bucketClass] = (bucketClassCounts[bucketClass] || 0) + 1;
        buckets.push({
          bucket_start: new Date(b).toISOString(),
          child_count: present,
          tradable_expected: tradable,
          classification: bucketClass,
          missing,
        });
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: "READ-ONLY (no database writes)",
      symbol: SYMBOL,
      contract,
      totals: {
        canonicalChildren: canonicalSet.size,
        rawDistinctTsInWindow: raw.rows.filter(r => { const t = new Date(r.ts).getTime(); return t >= LOOKBACK_START.getTime() && t < END_EXCLUSIVE.getTime(); }).length,
        nonConformingBuckets: buckets.length,
        missingChildClasses: classCounts,
        bucketClasses: bucketClassCounts,
      },
      empiricalBreakEdges,
      buckets,
    };
    fs.mkdirSync("reports", { recursive: true });
    const out = `reports/xauusd-15m-bucket-child-classification-${Date.now()}.json`;
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ out, contractHash: contract.contractHash, totals: report.totals }, null, 2));
    const hardFail = ["documented_outage", "data_gap", "timezone_suspect", "exclusion_suspect"];
    const failing = Object.keys(bucketClassCounts).filter(c => hardFail.includes(c));
    if (failing.length) {
      console.error(`BLOCKED: hard-fail bucket classes present: ${failing.join(", ")}`);
      process.exit(1);
    }
  } finally {
    await p.end();
  }
}

main().catch(e => { console.error(`BLOCKED: ${e.message}`); process.exit(1); });
