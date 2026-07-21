"use strict";
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
async function main() {
  const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 300000 }));
  try {
    await pool.query("BEGIN READ ONLY");
    // Check what's running
    const r = await pool.query(`
      SELECT pid, now() - query_start AS runtime, state, substring(query, 1, 120) AS query_preview
      FROM pg_stat_activity
      WHERE state != 'idle' AND application_name != 'psql' AND pid != pg_backend_pid()
      ORDER BY query_start DESC
    `);
    console.log("Active queries:", JSON.stringify(r.rows, null, 2));
    if (r.rows.length === 0) console.log("No active queries (other than us)");
    await pool.query("ROLLBACK");
  } catch(e) { console.error("ERROR:", e.message); process.exit(1); }
  finally { await pool.end(); }
}
main();
