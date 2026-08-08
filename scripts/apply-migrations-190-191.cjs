#!/usr/bin/env node
/** Apply migrations 190 (ingestion run ledger + reverification evidence) and
 *  191 (lineage ingestion FK). Additive-only; bypasses runner. */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const MIGS = [
  { file: "infra/migrations/190_candle_ingestion_runs.sql", version: "190_candle_ingestion_runs" },
  { file: "infra/migrations/191_lineage_ingestion_fk.sql", version: "191_lineage_ingestion_fk" },
];

(async () => {
  const pool = new Pool(getDbConfig());
  try {
    for (const m of MIGS) {
      const sql = fs.readFileSync(m.file, "utf8");
      if (/TRUNCATE|DROP TABLE|DROP COLUMN|DELETE\s+FROM/i.test(sql)) {
        throw new Error(`abort: destructive SQL in ${m.file}`);
      }
      await pool.query(sql);
      await pool.query(
        `insert into public.schema_migrations (version) values ($1) on conflict do nothing`, [m.version]
      );
      console.log(`applied: ${m.version}`);
    }
    const t = await pool.query(
      `select table_name from information_schema.tables
       where table_schema='market' and table_name in ('candle_ingestion_runs','candle_reverification_evidence') order by 1`);
    console.log("tables: " + t.rows.map(r => r.table_name).join(", "));
    const c = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='market' and table_name='candle_producer_lineage'
         and column_name in ('ingestion_run_id','raw_candle_id') order by 1`);
    console.log("lineage cols: " + c.rows.map(r => r.column_name).join(", "));
    if (t.rowCount !== 2 || c.rowCount !== 2) throw new Error("abort: schema incomplete");
  } finally {
    await pool.end();
  }
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
