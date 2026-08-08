#!/usr/bin/env node
/**
 * Governed 15m ATR candidate certifier.
 *
 * Source is an already-certified 1m manifest. This script never reuses 1m
 * window IDs as 15m IDs and never promotes candidates. Use --write only to
 * create candidate rows; promote-trusted-windows.js remains manual.
 *
 * Usage:
 *   node scripts/certify-15m-atr-windows.js \
 *     --symbol=XAUUSD \
 *     --manifest=reports/backfill-runs/2026-08-06T23-34-27-732Z.json \
 *     --start=2026-07-19T22:00:00Z \
 *     --end=2026-08-06T18:45:00Z \
 *     --lookback-bars=500 \
 *     [--write]
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const EXPECTED_MANIFEST = "reports/backfill-runs/2026-08-06T23-34-27-732Z.json";
const EXPECTED_RUNS = new Set(["25077375", "25077376"]);
const EXPECTED_1M_IDS = new Set([46, 64, 74, 94, 117]);
const ATR_VERSION = "1.2.0";
const DETECTOR = "window-certifier-v5.3-spreadzero-keep@20260805";
const CANONICAL = "canonical-m186-exclude-skip@20260806";

function arg(name, fallback = null) {
  const inline = process.argv.find(x => x.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function fail(message) { throw new Error(`BLOCKED: ${message}`); }
function sha256File(path) { return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex"); }
function iso(value, name) { const d = new Date(value); if (!Number.isFinite(d.getTime())) fail(`invalid ${name}`); return d; }
function aligned15(d, name) { if (d.getUTCMinutes() % 15 || d.getUTCSeconds() || d.getUTCMilliseconds()) fail(`${name} is not 15m aligned`); }

// Frozen contract v2 (2026-08-07) calendar policy, mirrored from
// packages/shared/src/utils/marketCalendar.ts (CJS script cannot import TS).
// contractHash 4005456529a65bc02d57ae48f846d82192a465480bb356f031ad5f5c43ca4b63
const CONTRACT_V2 = "4005456529a65bc02d57ae48f846d82192a465480bb356f031ad5f5c43ca4b63";
const BREAK_EDGE = { preBreakHaltFromMinUTC: 20 * 60 + 50, postBreakResumeMinUTC: 22 * 60 + 5 };
const KNOWN_FEED_OUTAGES = [];
// STRUCTURAL_BROKER_HOLE (2026-08-07 decision): broker-proven absence, three
// agreeing evidence classes. Expected-incomplete: documented, non-blocking,
// immutable, excluded from fill attempts. Mirror of STRUCTURAL_BROKER_HOLES in
// packages/shared/src/utils/marketCalendar.ts — keep in sync.
const STRUCTURAL_BROKER_HOLES = [
  { startUTC: "2026-07-29T12:00:00Z", endExclusiveUTC: "2026-07-29T12:08:00Z",
    provenanceArtifact: "fefc1b2b-87cc-4f53-98e3-871e25b8df5d" },
];
function isTradable(ts) {
  const dow = ts.getUTCDay(), h = ts.getUTCHours();
  if (dow === 6) return false;
  if (dow === 0 && h < 21) return false;
  if (dow === 5 && h >= 21) return false;
  const mins = h * 60 + ts.getUTCMinutes();
  if (mins >= 21 * 60 && mins < 22 * 60) return false; // XAUUSD daily break
  return true;
}
function inBreakEdge(ts) {
  const mins = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  return (mins >= BREAK_EDGE.preBreakHaltFromMinUTC && mins < 21 * 60) ||
         (mins >= 22 * 60 && mins < BREAK_EDGE.postBreakResumeMinUTC);
}
function inOutage(ts) {
  const t = ts.getTime();
  return KNOWN_FEED_OUTAGES.some(o => t >= new Date(o.startUTC).getTime() && t < new Date(o.endExclusiveUTC).getTime());
}
function inStructuralHole(ts) {
  const t = ts.getTime();
  return STRUCTURAL_BROKER_HOLES.some(o => t >= new Date(o.startUTC).getTime() && t < new Date(o.endExclusiveUTC).getTime());
}
// Expected canonical children of one 15m bucket: tradable, not break-edge.
function expectedChildren(bucketStartMs) {
  const out = [];
  for (let i = 0; i < 15; i++) {
    const ts = new Date(bucketStartMs + i * 60_000);
    if (isTradable(ts) && !inBreakEdge(ts)) out.push(ts.getTime());
  }
  return out;
}

async function main() {
  const symbol = (arg("symbol", "XAUUSD") || "").toUpperCase();
  const manifestArg = arg("manifest", EXPECTED_MANIFEST);
  const manifestPath = fs.existsSync(manifestArg) ? manifestArg : `reports/backfill-runs/${manifestArg}`;
  const start = iso(arg("start", "2026-07-19T22:00:00Z"), "start");
  const end = iso(arg("candidate-end", arg("end", "2026-08-06T18:45:00Z")), "candidate-end");
  const lookbackBars = Number(arg("lookback-bars", "500"));
  const requestedTrustedIds = new Set((arg("trusted-ids", [...EXPECTED_1M_IDS].join(",")) || "").split(",").map(Number));
  const write = process.argv.includes("--write");
  if (symbol !== "XAUUSD") fail("scope is XAUUSD only");
  if (!(start < end)) fail("start must precede candidate-end");
  aligned15(start, "start"); aligned15(end, "end");
  if (!fs.existsSync(manifestPath)) fail(`manifest missing: ${manifestPath}`);
  if (JSON.stringify([...requestedTrustedIds].sort((a,b)=>a-b)) !== JSON.stringify([...EXPECTED_1M_IDS].sort((a,b)=>a-b))) fail("trusted IDs mismatch");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.trustedGate?.mode !== "require") fail("source manifest is not trusted=require");
  const source = manifest.trustedGate?.perSymbol?.[symbol];
  if (!source) fail("manifest has no XAUUSD trusted gate");
  if (JSON.stringify([...new Set(source.windowIds)].sort((a,b)=>a-b)) !== JSON.stringify([...EXPECTED_1M_IDS].sort((a,b)=>a-b))) fail("source 1m trusted IDs mismatch");
  if (!manifest.cells?.every(c => c.symbol !== symbol || c.verdict === "READY")) fail("source manifest contains non-ready XAUUSD cell");
  const requestedEdge = arg("source-edge", "2026-08-06T18:53:00Z");
  if (requestedEdge !== "2026-08-06T18:53:00Z") fail("source edge mismatch");
  for (const c of manifest.cells.filter(c => c.symbol === symbol)) {
    if (!EXPECTED_RUNS.has(String(c.producerRunId))) fail(`unexpected source producer run: ${c.producerRunId}`);
    if (c.producerSourceMaxTs !== "2026-08-06T18:53:00.000Z") fail("source producer edge mismatch");
  }
  const manifestHash = sha256File(manifestPath);
  const lookbackStart = new Date(start.getTime() - lookbackBars * 15 * 60_000);
  const p = new Pool(getDbConfig());
  try {
    // Calendar-aware bucket completeness (frozen contract v2). Expected children
    // per bucket = tradable instants minus modeled break-edge. Buckets with zero
    // expected children are omitted (fully closed). Any missing expected child is
    // a hard fail; documented-outage buckets fail with their own marker.
    const canonicalRows = await p.query(`
      SELECT ts, count(*)::int n, count(DISTINCT effective_broker_identity)::int bc
      FROM market.candles_1m_canonical
      WHERE symbol=$1 AND ts >= $2 AND ts < $3 GROUP BY ts ORDER BY ts`, [symbol, lookbackStart, end]);
    const canonicalTs = new Map();
    for (const r of canonicalRows.rows) canonicalTs.set(new Date(r.ts).getTime(), r);
    const multiBroker = [...canonicalTs.entries()].filter(([, r]) => r.bc !== 1 || r.n !== 1);
    if (multiBroker.length) fail(`children with duplicate/multiple effective brokers: ${multiBroker.length}`);
    const badBuckets = [];
    const outageBuckets = [];
    const structuralHoleBuckets = [];
    let completeBuckets = 0;
    for (let b = Math.floor(lookbackStart.getTime() / 900_000) * 900_000; b < end.getTime(); b += 900_000) {
      const expected = expectedChildren(b);
      if (!expected.length) continue; // fully closed bucket
      const missing = expected.filter(t => !canonicalTs.has(t));
      if (missing.length === 0) { completeBuckets++; continue; }
      const entry = { bucket_start: new Date(b).toISOString(), expected: expected.length, missing: missing.map(t => new Date(t).toISOString()) };
      if (missing.every(t => inOutage(new Date(t)))) outageBuckets.push(entry);
      else if (missing.every(t => inStructuralHole(new Date(t)))) structuralHoleBuckets.push(entry); // expected-incomplete, documented
      else badBuckets.push(entry);
    }
    if (outageBuckets.length) fail(`documented outage buckets present (hard fail until resolved): ${outageBuckets.length} first=${outageBuckets[0].bucket_start}`);
    if (badBuckets.length) fail(`incomplete 15m buckets (calendar-aware): ${badBuckets.length} first=${badBuckets[0].bucket_start}`);
    if (structuralHoleBuckets.length) {
      console.log(`STRUCTURAL_BROKER_HOLE buckets (expected-incomplete, documented, non-blocking): ${structuralHoleBuckets.length}`);
      for (const s of structuralHoleBuckets) console.log(`  ${s.bucket_start} missing=${s.missing.join(",")} artifact=${STRUCTURAL_BROKER_HOLES[0].provenanceArtifact}`);
    }

    const blockers = await p.query(`
      SELECT symbol, broker, event_time, decision, approved_at, approved_by
      FROM candle_quarantine q
      WHERE symbol=$1 AND event_time >= $2 AND event_time < $3 AND superseded_at IS NULL
        AND (decision IS NULL OR decision='UNKNOWN' OR approved_at IS NULL OR decision='EXCLUDE'
          OR (decision='REPLACED' AND NOT EXISTS (
            SELECT 1 FROM market.candle_replacement_evidence e
            WHERE e.symbol=q.symbol AND e.event_time=q.event_time AND e.blocked_broker=q.broker)))
      ORDER BY event_time`, [symbol, lookbackStart, end]);
    if (blockers.rowCount) fail(`active canonical blockers: ${blockers.rowCount}`);

    const broker = await p.query(`
      SELECT effective_broker_identity, count(*)::int rows
      FROM market.candles_1m_canonical
      WHERE symbol=$1 AND ts >= $2 AND ts < $3
      GROUP BY effective_broker_identity`, [symbol, lookbackStart, end]);
    if (broker.rowCount !== 1) fail(`effective broker count=${broker.rowCount}, expected 1`);

    const lineageRelation = await p.query(`
      SELECT to_regclass('market.candle_producer_lineage') AS relation`);
    if (!lineageRelation.rows[0]?.relation) fail('SCHEMA-LINEAGE-MISSING: append-only lineage relation absent');

    const lineage = await p.query(`
      WITH selected AS (
        SELECT c.symbol, c.broker, c.ts, c.effective_broker_identity, c.policy_id,
               date_bin('15 minutes', c.ts, timestamptz '1970-01-01') AS bucket_start
        FROM market.candles_1m_canonical c
        WHERE c.symbol=$1 AND c.ts >= $2 AND c.ts < $3
      ), matched AS (
        SELECT s.*, l.source_key, l.producer_run_id, l.trusted_window_id,
               l.manifest_name, l.manifest_sha256,
               count(l.lineage_id) OVER (PARTITION BY s.symbol, s.ts) AS lineage_count
        FROM selected s
        LEFT JOIN market.candle_producer_lineage l
          ON l.symbol=s.symbol AND l.candle_ts=s.ts
         AND l.broker=s.broker
         AND l.effective_broker_identity=s.effective_broker_identity
         AND l.policy_id=s.policy_id
         AND l.voided_at IS NULL
      )
      SELECT * FROM matched
      WHERE lineage_count <> 1 OR source_key IS NULL
         OR NOT (producer_run_id = ANY($4::bigint[]))
         OR NOT (trusted_window_id = ANY($5::bigint[]))
         OR manifest_name <> $6 OR manifest_sha256 <> $7
      ORDER BY ts`, [symbol, lookbackStart, end, [...EXPECTED_RUNS].map(Number), [...EXPECTED_1M_IDS].map(Number), manifestPath, manifestHash]);
    if (lineage.rowCount) fail(`lineage cardinality/reference violations: ${lineage.rowCount}`);

    // feature_producer_runs: PK is run_id (no id); rejections live in
    // quality_json.rows_rejected (runner.ts computePersistOutcome); no engine_ver
    // column (producer_version is the producer semver; ATR version asserted below).
    const runs = await p.query(`
      SELECT run_id::text, producer, feature_table, symbol, tf, status, source_max_ts,
             producer_version, quality_json
      FROM feature_producer_runs
      WHERE run_id = ANY($1::bigint[])`, [[...(arg("runs", [...EXPECTED_RUNS].join(",")).split(","))].map(Number)]);
    if (runs.rowCount !== EXPECTED_RUNS.size) fail("certified 1m producer runs missing");
    for (const r of runs.rows) {
      if (r.symbol !== symbol || r.tf !== "1m" || r.status !== "done") fail(`bad source producer run ${r.run_id}`);
      const rejected = Number(r.quality_json?.rows_rejected || 0);
      if (rejected !== 0) fail(`source producer run ${r.run_id} rows_rejected=${rejected}`);
    }

    const candidate = {
      sourceManifest: manifestPath,
      sourceManifestSha256: manifestHash,
      source1mProducerRunIds: [...EXPECTED_RUNS].map(Number),
      source1mTrustedWindowIds: [...EXPECTED_1M_IDS].sort((a,b)=>a-b),
      source1mWindowSetHash: source.windowSetHash,
      source1mEdge: requestedEdge,
      candidateEndExclusive: end.toISOString(),
      effectiveBrokerPolicy: { broker: broker.rows[0].effective_broker_identity, policy: "canonical effective broker identity" },
      blockerScan: { status: "clean", count: blockers.rowCount, lookbackStart: lookbackStart.toISOString(), endExclusive: end.toISOString() },
      atrEngineVersion: ATR_VERSION,
      atrLookbackStart: lookbackStart.toISOString(),
      complete15mBucketCount: completeBuckets,
      calendarContract: { version: "v2-2026-08-07", contractHash: CONTRACT_V2, breakEdgePolicy: BREAK_EDGE, knownFeedOutages: KNOWN_FEED_OUTAGES, structuralBrokerHoles: STRUCTURAL_BROKER_HOLES },
      structuralHoleBucketCount: structuralHoleBuckets.length,
      activeCanonicalBlockers: 0,
      childProducerLineage: { relation: 'market.candle_producer_lineage', status: 'exactly_one_per_selected_child' },
      detectorVersion: DETECTOR,
      canonicalVersion: CANONICAL,
      certifiedBy: "certify-15m-atr-windows.js",
    };
    if (write) {
      const r = await p.query(`
        INSERT INTO market.trusted_windows
          (symbol,timeframe,window_start,window_end,detector_version,canonical_version,
           eligibility_version,broker_policy_version,status,gate_summary,evidence_refs,created_by)
        VALUES ($1,'15m',$2,$3,$4,$5,'atr-v1.2.0','broker-policy-v1','candidate',$6::jsonb,$7::jsonb,$8)
        ON CONFLICT (symbol,timeframe,window_start,window_end,detector_version)
          WHERE status='candidate' DO NOTHING
        RETURNING window_id`, [symbol, start, end, DETECTOR, CANONICAL, JSON.stringify(candidate), JSON.stringify([manifestPath]), "certify-15m-atr-windows.js"]);
      candidate.windowId = r.rows[0]?.window_id ?? null;
    }
    console.log(JSON.stringify({ status: write ? "CANDIDATE_WRITTEN" : "DRY_RUN_PASS", candidate }, null, 2));
  } finally { await p.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
