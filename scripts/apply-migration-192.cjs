require("dotenv").config({ path: ".env.local", override: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const pool = new Pool(getDbConfig());
(async () => {
  const version = "192_lineage_ingestion_nullable";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT 1 FROM public.schema_migrations WHERE version=$1", [version]);
    if (exists.rowCount === 0) {
      const sql = fs.readFileSync(path.join(__dirname, "..", "infra", "migrations", "192_lineage_ingestion_nullable.sql"), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations(version) VALUES($1)", [version]);
      console.log(`applied: ${version}`);
    } else console.log(`already applied: ${version}`);
    const cols = await client.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='market' AND table_name='candle_producer_lineage' AND column_name IN ('manifest_name','manifest_sha256','trusted_window_id','effective_broker_identity','policy_id') ORDER BY column_name`);
    console.log("nullable:", JSON.stringify(cols.rows));
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); console.error("FAIL", e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
