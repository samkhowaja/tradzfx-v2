// Read-only: candle_quarantine schema + rows for BLOCKED XAUUSD window.
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

    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='candle_quarantine' ORDER BY ordinal_position`
    );
    console.log("candle_quarantine columns: " + cols.map((c) => c.column_name).join(", "));

    // Only rows matching policy-relevant 17 BLOCKED ts (distinct days)
    const { rows: quar } = await client.query(
      `SELECT *
       FROM candle_quarantine q
       WHERE q.symbol='XAUUSD' AND q.timeframe='1m'
         AND q.event_time >= '2026-07-01T00:00:00Z' AND q.event_time <= '2026-07-23T00:00:00Z'
       ORDER BY q.event_time
       LIMIT 60`
    );
    console.log(`\nquarantine rows in window (first 60): ${quar.length}`);
    for (const r of quar) {
      const ts = r.event_time instanceof Date ? r.event_time.toISOString() : r.event_time;
      console.log("  " + ts + " " + JSON.stringify(r).slice(0, 300));
    }

    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
