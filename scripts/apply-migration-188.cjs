#!/usr/bin/env node
/** One-shot: apply infra/migrations/188_candle_request_channel.sql directly.
 *  Additive-only migration; bypasses the runner so frozen-unsafe 187 is untouched. */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

(async () => {
  const sql = fs.readFileSync("infra/migrations/188_candle_request_channel.sql", "utf8");
  const pool = new Pool(getDbConfig());
  try {
    await pool.query(sql);
    const t = await pool.query(
      "select table_name from information_schema.tables where table_schema='market' and table_name like 'candle_%' order by 1");
    console.log("tables:", t.rows.map(r => r.table_name).join(", "));
    await pool.query(
      `insert into market.schema_migrations (filename) values ('188_candle_request_channel.sql') on conflict do nothing`
    ).catch(() => {});
  } finally {
    await pool.end();
  }
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
