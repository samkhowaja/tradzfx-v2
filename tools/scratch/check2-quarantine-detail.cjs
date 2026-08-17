// Read-only: why are the 17 XAUUSD 1m candles BLOCKED? (quarantine rows vs structural)
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

    // The 17 BLOCKED eligibility rows in window
    const { rows: blocked } = await client.query(
      `SELECT ts, broker, validator_version, evidence_fingerprint, error_message,
              validation_completed_at
       FROM market.candle_eligibility
       WHERE symbol='XAUUSD' AND timeframe='1m'
         AND ts >= '2026-07-01T00:00:00Z' AND ts <= '2026-07-23T00:00:00Z'
         AND state = 'BLOCKED'
       ORDER BY ts`
    );
    console.log(`BLOCKED rows: ${blocked.length}`);
    for (const r of blocked) {
      const ts = r.ts instanceof Date ? r.ts.toISOString() : r.ts;
      console.log(`  ${ts} fp=${r.evidence_fingerprint} err=${r.error_message ?? "null"}`);
    }

    // Quarantine rows matching those ts
    const { rows: quar } = await client.query(
      `SELECT q.event_time, q.broker, q.decision, q.reason, q.detector, q.superseded_at, q.approved_at
       FROM candle_quarantine q
       WHERE q.symbol='XAUUSD' AND q.timeframe='1m'
         AND q.event_time >= '2026-07-01T00:00:00Z' AND q.event_time <= '2026-07-23T00:00:00Z'
       ORDER BY q.event_time`
    );
    console.log(`\ncandle_quarantine rows in window: ${quar.length}`);
    for (const r of quar) {
      const ts = r.event_time instanceof Date ? r.event_time.toISOString() : r.event_time;
      console.log(`  ${ts} decision=${r.decision} reason=${r.reason} detector=${r.detector} superseded=${r.superseded_at ? "Y" : "N"} approved=${r.approved_at ? "Y" : "N"}`);
    }

    // OHLC of the blocked candles themselves
    const { rows: ohlc } = await client.query(
      `SELECT c.ts, c.broker, c.o, c.h, c.l, c.c, c.spread
       FROM candles_1m c
       WHERE c.symbol='XAUUSD'
         AND c.ts IN (SELECT ts FROM market.candle_eligibility
                      WHERE symbol='XAUUSD' AND timeframe='1m'
                        AND ts >= '2026-07-01T00:00:00Z' AND ts <= '2026-07-23T00:00:00Z'
                        AND state='BLOCKED')
       ORDER BY c.ts`
    );
    console.log(`\nraw candles at BLOCKED ts: ${ohlc.length}`);
    for (const r of ohlc) {
      const ts = r.ts instanceof Date ? r.ts.toISOString() : r.ts;
      console.log(`  ${ts} broker=${r.broker} o=${r.o} h=${r.h} l=${r.l} c=${r.c} spread=${r.spread}`);
    }

    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
