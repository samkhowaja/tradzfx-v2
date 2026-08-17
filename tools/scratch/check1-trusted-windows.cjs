// Read-only: list market.trusted_windows for XAUUSD.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local") });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD || "",
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(
      `SELECT *
       FROM market.trusted_windows
       WHERE symbol = 'XAUUSD'
       ORDER BY 1`
    );
    console.log(`XAUUSD trusted_windows: ${rows.length}`);
    for (const r of rows) {
      console.log("  " + JSON.stringify(r));
    }
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
