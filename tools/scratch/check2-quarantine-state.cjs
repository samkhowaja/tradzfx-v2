// Read-only: decision/supersede state distribution of quarantine rows at BLOCKED ts.
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

    // distribution by detector_version x decision x superseded
    const { rows: dist } = await client.query(
      `SELECT detector_version, decision,
              (superseded_at IS NOT NULL) AS superseded,
              (approved_at IS NOT NULL) AS approved,
              COUNT(*)::int AS n
       FROM candle_quarantine
       WHERE symbol='XAUUSD' AND timeframe='1m'
         AND event_time >= '2026-07-01T00:00:00Z' AND event_time <= '2026-07-23T00:00:00Z'
       GROUP BY 1,2,3,4 ORDER BY 1,2,3`
    );
    console.log("quarantine distribution (detector x decision x superseded x approved):");
    for (const r of dist) {
      console.log(`  ${r.detector_version} decision=${r.decision} superseded=${r.superseded} approved=${r.approved} n=${r.n}`);
    }

    // which rows actually block eligibility: unsuperseded AND (approved_at IS NULL OR decision <> 'KEEP')
    const { rows: blocking } = await client.query(
      `SELECT detector_version, COUNT(*)::int AS n
       FROM candle_quarantine
       WHERE symbol='XAUUSD' AND timeframe='1m'
         AND event_time >= '2026-07-01T00:00:00Z' AND event_time <= '2026-07-23T00:00:00Z'
         AND superseded_at IS NULL
         AND (approved_at IS NULL OR decision <> 'KEEP')
       GROUP BY 1 ORDER BY 1`
    );
    console.log("\nblocking rows (unsuperseded, non-KEEP):");
    for (const r of blocking) console.log(`  ${r.detector_version}: ${r.n}`);

    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
