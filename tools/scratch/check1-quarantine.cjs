// Read-only: which candle_eligibility rows are non-CLEAN for XAUUSD 1m in window.
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

const FROM = "2026-07-01T00:00:00Z";
const TO = "2026-07-23T00:00:00Z";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows: byState } = await client.query(
      `SELECT state, COUNT(*)::int AS n
       FROM market.candle_eligibility
       WHERE symbol='XAUUSD' AND timeframe='1m' AND ts >= $1 AND ts <= $2
       GROUP BY state ORDER BY n DESC`,
      [FROM, TO]
    );
    console.log("eligibility by state:");
    for (const r of byState) console.log(`  ${r.state}: ${r.n}`);

    const { rows: bad } = await client.query(
      `SELECT e.ts, e.state, e.broker
       FROM market.candle_eligibility e
       JOIN raw.symbol_broker_policy p
         ON p.symbol = e.symbol AND p.broker_id = e.broker
        AND p.effective_from <= e.ts
        AND (p.effective_to IS NULL OR e.ts < p.effective_to)
       WHERE e.symbol='XAUUSD' AND e.timeframe='1m' AND e.ts >= $1 AND e.ts <= $2
         AND e.state <> 'CLEAN'
         AND NOT EXISTS (
           SELECT 1 FROM raw.symbol_broker_policy cp
           WHERE cp.symbol = e.symbol AND cp.effective_from <= e.ts
             AND (cp.effective_to IS NULL OR e.ts < cp.effective_to)
             AND cp.priority < p.priority
         )
       ORDER BY e.ts`,
      [FROM, TO]
    );
    console.log(`non-CLEAN rows (policy-filtered): ${bad.length}`);
    const byDay = {};
    for (const r of bad) {
      const ts = r.ts instanceof Date ? r.ts.toISOString() : r.ts;
      const day = ts.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
      if (bad.length <= 40) console.log(`  ${ts} state=${r.state} broker=${r.broker}`);
    }
    console.log("by day:");
    for (const [d, n] of Object.entries(byDay).sort()) console.log(`  ${d}: ${n}`);
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
