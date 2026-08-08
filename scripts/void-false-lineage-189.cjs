#!/usr/bin/env node
/** Apply migration 189 (void-and-strike) + void the 106 false-provenance rows.
 *
 *  False provenance: rows inserted by apply-migration-187-proven-lineage.cjs
 *  bound candles to feature-consumer runs 25077375/25077376 + a CopyRates
 *  reverification artifact. That is consistency evidence, NOT ingestion
 *  lineage (source_key must be the original immutable ingestion identity;
 *  producer_run_id the ingestion run that produced the candle).
 *
 *  Precise target: source_key = 'ondemand:artifact:96648c09-...',
 *  producer_run_id in (25077375, 25077376), voided_at IS NULL.
 *  Asserts exactly 106 rows voided.
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const MIGRATION = "infra/migrations/189_lineage_void_strike.sql";
const LEDGER = "189_lineage_void_strike.sql";
const SOURCE_KEY = "ondemand:artifact:96648c09-6468-4270-a6be-0cd3ad49518f";
const FALSE_RUNS = [25077375, 25077376];
const EXPECTED_ROWS = 106;
const REASON = "FALSE_PROVENANCE: bound to feature-consumer runs 25077375/25077376 and CopyRates reverification artifact 96648c09 (consistency evidence), not to ingestion-side lineage (ingest batch/EA payload/spool + ingestion producer_run). Voided per void-and-strike policy; see migration 189.";

(async () => {
  const pool = new Pool(getDbConfig());
  try {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    if (/TRUNCATE|DROP TABLE|DROP COLUMN|ALTER TABLE .* DROP/i.test(sql)) {
      throw new Error("abort: destructive SQL detected in 189");
    }
    await pool.query(sql);
    await pool.query(
      `insert into market.schema_migrations (filename) values ($1) on conflict do nothing`, [LEDGER]
    ).catch(() => {});
    console.log("schema: void columns + amended trigger applied");

    const target = await pool.query(
      `select count(*)::int n from market.candle_producer_lineage
       where source_key=$1 and producer_run_id = any($2::bigint[]) and voided_at is null`,
      [SOURCE_KEY, FALSE_RUNS]);
    if (target.rows[0].n !== EXPECTED_ROWS) {
      throw new Error(`abort: target rows=${target.rows[0].n}, expected ${EXPECTED_ROWS} (refusing ambiguous void)`);
    }

    const upd = await pool.query(
      `update market.candle_producer_lineage
       set voided_at = now(), void_reason = $3
       where source_key=$1 and producer_run_id = any($2::bigint[]) and voided_at is null`,
      [SOURCE_KEY, FALSE_RUNS, REASON]);
    if (upd.rowCount !== EXPECTED_ROWS) throw new Error(`abort: voided=${upd.rowCount}, expected ${EXPECTED_ROWS}`);
    console.log(`voided: ${upd.rowCount} rows`);

    const live = await pool.query(
      `select count(*)::int n from market.candle_producer_lineage where voided_at is null`);
    const total = await pool.query(
      `select count(*)::int n from market.candle_producer_lineage`);
    console.log(`lineage rows: total=${total.rows[0].n} live(unvoided)=${live.rows[0].n}`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
