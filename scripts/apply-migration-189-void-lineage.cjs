#!/usr/bin/env node
/** Apply migration 189 (void-and-strike schema) + void the 106 false-provenance
 *  lineage rows inserted by apply-migration-187-proven-lineage.cjs.
 *
 *  Predicate is exact: source_key ondemand:artifact:96648c09-... AND
 *  producer_run_id IN (25077375, 25077376) AND voided_at IS NULL.
 *  Asserts voided count == 106 (or 0 if already voided on re-run -> idempotent).
 *
 *  Fail-closed: aborts if row counts deviate. */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const MIGRATION = "infra/migrations/189_candle_lineage_void.sql";
const LEDGER = "189_candle_lineage_void.sql";
const SOURCE_KEY = "ondemand:artifact:96648c09-6468-4270-a6be-0cd3ad49518f";
const RUNS = [25077375, 25077376];
const EXPECTED_ROWS = 106;
const VOID_REASON = "FALSE_PROVENANCE: bound to feature-consumer runs (25077375/76) + re-verification artifact 96648c09, not ingestion lineage; voided per 2026-08-07 policy decision";

(async () => {
  const pool = new Pool(getDbConfig());
  try {
    // 1. Apply 189 schema (additive-only guard)
    const sql = fs.readFileSync(MIGRATION, "utf8");
    if (/TRUNCATE|DROP TABLE|DROP COLUMN|DELETE\s+FROM/i.test(sql)) {
      throw new Error("abort: destructive SQL detected in 189");
    }
    await pool.query(sql);
    await pool.query(
      `insert into public.schema_migrations (version) values ($1) on conflict do nothing`, [LEDGER]
    ).catch(() => {});
    const cols = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='market' and table_name='candle_producer_lineage'
         and column_name in ('voided_at','void_reason')`);
    if (cols.rowCount !== 2) throw new Error("abort: void columns absent after apply");
    console.log("schema: voided_at/void_reason present");

    // 2. Pre-count target rows
    const pre = await pool.query(
      `select count(*)::int n from market.candle_producer_lineage
       where source_key=$1 and producer_run_id = any($2::bigint[]) and voided_at is null`,
      [SOURCE_KEY, RUNS]);
    console.log(`target unvoided rows: ${pre.rows[0].n}`);
    if (pre.rows[0].n === 0) {
      console.log("already voided (idempotent re-run) — nothing to do");
      return;
    }
    if (pre.rows[0].n !== EXPECTED_ROWS) {
      throw new Error(`abort: expected ${EXPECTED_ROWS} target rows, found ${pre.rows[0].n}`);
    }

    // 3. Void (trigger permits only this exact shape of UPDATE)
    const upd = await pool.query(
      `update market.candle_producer_lineage
       set voided_at = now(), void_reason = $3
       where source_key=$1 and producer_run_id = any($2::bigint[]) and voided_at is null`,
      [SOURCE_KEY, RUNS, VOID_REASON]);
    if (upd.rowCount !== EXPECTED_ROWS) {
      throw new Error(`abort: voided ${upd.rowCount}, expected ${EXPECTED_ROWS}`);
    }
    console.log(`voided: ${upd.rowCount}`);

    // 4. Post-state: 0 live rows, 106 voided, total unchanged
    const post = await pool.query(
      `select count(*)::int total,
              count(*) filter (where voided_at is null)::int live,
              count(*) filter (where voided_at is not null)::int voided
       from market.candle_producer_lineage`);
    const s = post.rows[0];
    console.log(`post-state: total=${s.total} live=${s.live} voided=${s.voided}`);
    if (s.total !== EXPECTED_ROWS || s.live !== 0 || s.voided !== EXPECTED_ROWS) {
      throw new Error(`abort: post-state unexpected ${JSON.stringify(s)}`);
    }
  } finally {
    await pool.end();
  }
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
