#!/usr/bin/env node
/** One-shot: delete a candle_requests row by id (stale-pending cleanup only). */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
(async () => {
  const id = process.argv[2];
  if (!id) throw new Error("usage: node scripts/clear-request-row.cjs <request_id>");
  const p = new Pool(getDbConfig());
  try {
    const r = await p.query("delete from market.candle_requests where request_id=$1", [id]);
    console.log(`deleted ${r.rowCount} row(s) for ${id}`);
  } finally { await p.end(); }
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
