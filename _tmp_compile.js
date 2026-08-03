require("dotenv").config({ path: ".env.local" });
const { loadStrategyFromDB, compileStrategy } = require("./packages/strategies/dist/index.js");
const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost", port: 5432, database: "tradzfx_v2",
  user: "postgres", password: process.env.TM_DB_PASSWORD
});

async function main() {
  const spec = await loadStrategyFromDB(pool, "cct_rectangle_xau_v1");
  console.log("=== Loaded spec ===");
  console.log("signalSource:", spec.signalSource);
  console.log("steps:", JSON.stringify(spec.steps?.map((x,i) => ({idx: i, id: x.id, table: x.table, ttlDirection: x.ttlDirection, ttlMinutes: x.ttlMinutes, filter: x.filter?.field}))));
  console.log("entry:", JSON.stringify(spec.entry?.map((x,i) => ({idx: i, id: x.id, feature: x.feature, tf: x.tf, ttlDirection: x.ttlDirection, ttlMinutes: x.ttlMinutes, filter: x.filter?.field}))));
  
  const compiled = compileStrategy(spec, {
    symbol: "XAUUSD",
    from: new Date("2026-04-25"),
    to: new Date("2026-07-24"),
    signalTf: "1m",
    mode: "pit",
    warmupBars: 0,
    trustStoredLifecycle: true,
  });
  
  console.log("\n=== Compiled SQL ===");
  if (compiled.sql) {
    // Show only the first 3000 chars
    console.log(compiled.sql.substring(0, 3000));
    console.log("\n... [truncated] ...\n");
  }
  console.log("params:", JSON.stringify(compiled.params));
  
  // Count the SQL output
  const { rows: count } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM (${compiled.sql}) sub`,
    compiled.params
  );
  console.log("\n=== Compiled SQL row count:", count[0].cnt, "===");
  
  // Show first 10 rows
  const { rows: sample } = await pool.query(
    `${compiled.sql} LIMIT 10`,
    compiled.params
  );
  console.log("\n=== First 10 compiled rows ===");
  if (sample.length > 0) {
    console.log("Columns:", Object.keys(sample[0]).join(", "));
    for (const r of sample) {
      console.log(JSON.stringify(r, (k,v) => v instanceof Date ? v.toISOString() : v, 0));
    }
  } else {
    console.log("No rows returned");
  }
  
  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
