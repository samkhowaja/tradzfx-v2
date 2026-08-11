#!/usr/bin/env node
/* Read-only evidence report. Never creates schema, lineage, candidates, or trusted rows. */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const symbol = "XAUUSD";
const manifestName = "2026-08-06T23-34-27-732Z.json";
const manifestPath = path.resolve("reports/backfill-runs", manifestName);
const start = "2026-07-19T22:05:00Z";
const end = "2026-08-06T18:54:00Z";
const candidateEnd = "2026-08-06T18:45:00Z";

async function main() {
  const pool = new Pool(getDbConfig());
  try {
    const q = (text, params = []) => pool.query(text, params);
    const schema = await q(`SELECT to_regclass('market.candle_source_runs') candle_source_runs,
      to_regclass('market.candle_source_lineage') candle_source_lineage,
      to_regclass('market.canonical_candle_lineage') canonical_candle_lineage,
      to_regclass('market.candle_producer_lineage') candle_producer_lineage`);
    const rawKeyColumn = await q(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='market' AND table_name='candles_1m_canonical' AND column_name='raw_source_key') exists`);
    const lineageRelation = schema.rows[0].canonical_candle_lineage || schema.rows[0].candle_source_lineage || schema.rows[0].candle_producer_lineage;
    const counts = await q(`SELECT count(*)::int canonical_count,
      ${rawKeyColumn.rows[0].exists ? "count(*) FILTER (WHERE raw_source_key IS NOT NULL)" : "0"}::int valid_raw_source_key_count,
      0::int provable_ingestion_lineage_count,
      count(*)::int without_representable_lineage_count
      FROM market.candles_1m_canonical WHERE symbol=$1 AND ts >= $2 AND ts < $3`, [symbol, start, end]);
    const brokers = await q(`SELECT effective_broker_identity broker, count(*)::int candles
      FROM market.candles_1m_canonical WHERE symbol=$1 AND ts >= $2 AND ts < $3
      GROUP BY effective_broker_identity ORDER BY broker`, [symbol, start, end]);
    const buckets = await q(`WITH b AS (
      SELECT date_bin('15 minutes', ts, timestamptz '1970-01-01') bucket,
        count(*)::int children, min(ts) first_child, max(ts) last_child
      FROM market.candles_1m_canonical WHERE symbol=$1 AND ts >= $2 AND ts < $3 GROUP BY 1
    ) SELECT CASE WHEN children=15 THEN 'full' WHEN children BETWEEN 1 AND 14 THEN 'partial_or_incomplete' ELSE 'unexpected' END AS classification,
      count(*)::int buckets FROM b GROUP BY 1`, [symbol, start, candidateEnd]);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const report = {
      reportType: "xauusd-15m-lineage-readonly",
      generatedAt: new Date().toISOString(), readOnly: true,
      source: { manifestName, manifestPath, trustedMode: manifest.trustedGate?.mode,
        featureRuns: manifest.cells?.map(c => c.producerRunId).filter(Boolean) },
      interval: { coverageStart: start, coverageEndExclusive: end, candidateEndExclusive: candidateEnd },
      schemaRelations: schema.rows[0], counts: counts.rows[0], sourceRunsGroupedByBroker: brokers.rows,
      ingestionSourceRunCounts: lineageRelation ? "relation exists but no ingestion lineage rows were assumed" : "NO DEDICATED INGESTION RELATION",
      buckets: { preliminary: buckets.rows, note: "Frozen market-calendar classification required; no wall-clock closed-period claim made." },
      conclusion: "FAIL-CLOSED / PRODUCER-LINEAGE-NOT-REPRESENTABLE",
      actions: ["No migration applied", "No lineage rows inserted", "No candidate created", "No trusted window promoted"]
    };
    const out = path.resolve("reports", `xauusd-15m-lineage-readonly-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ output: out, report }, null, 2));
  } finally { await pool.end(); }
}
main().catch(async e => { console.error(e.message); process.exitCode = 1; });
