// Read-only: eligibility-aligned XAUUSD blocker worksheet.
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
    const { rows } = await client.query(
      `SELECT e.symbol, e.broker, e.timeframe, e.ts AS event_time,
              e.state AS eligibility_state,
              q.id AS quarantine_id, q.flags, q.severity,
              q.detector_version, q.detector_params, q.notes,
              p.priority AS policy_priority, p.policy_id,
              CASE WHEN e.ts >= '2026-07-19T00:00:00Z' THEN 'PIT_SLICE'
                   WHEN e.ts >= '2026-07-18T00:00:00Z' THEN 'WARMUP_CONTEXT'
                   ELSE 'OUTSIDE_TARGET' END AS scope
         FROM market.candle_eligibility e
         JOIN raw.symbol_broker_policy p
           ON p.symbol = e.symbol
          AND p.broker_id = e.broker
          AND p.effective_from <= e.ts
          AND (p.effective_to IS NULL OR e.ts < p.effective_to)
         JOIN candle_quarantine q
           ON q.symbol = e.symbol
          AND q.broker = e.broker
          AND q.timeframe = e.timeframe
          AND q.event_time = e.ts
          AND q.superseded_at IS NULL
          AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
        WHERE e.symbol = 'XAUUSD'
          AND e.timeframe = '1m'
          AND e.ts >= $1 AND e.ts <= $2
          AND e.state <> 'CLEAN'
          AND NOT EXISTS (
            SELECT 1 FROM raw.symbol_broker_policy cp
             WHERE cp.symbol = e.symbol
               AND cp.effective_from <= e.ts
               AND (cp.effective_to IS NULL OR e.ts < cp.effective_to)
               AND cp.priority < p.priority
          )
        ORDER BY e.ts, q.id`, [FROM, TO]);

    const worksheet = [];
    for (const row of rows) {
      const context = await client.query(
        `SELECT broker, ts, o, h, l, c, spread
           FROM candles_1m
          WHERE symbol = $1
            AND ts BETWEEN $2::timestamptz - interval '3 minutes'
                        AND $2::timestamptz + interval '3 minutes'
          ORDER BY ts, broker`, [row.symbol, row.event_time]);
      worksheet.push({
        ...row,
        event_time: new Date(row.event_time).toISOString(),
        detector_params: row.detector_params,
        context: context.rows.map((item) => ({
          ...item,
          ts: new Date(item.ts).toISOString(),
        })),
        provisional_evidence: ["E3_GAP_OR_SESSION_EVENT", "E5_INSUFFICIENT_EVIDENCE"],
        provisional_decision: "UNDECIDED",
      });
    }
    console.log(JSON.stringify({ from: FROM, to: TO, count: worksheet.length, worksheet }, null, 2));
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error("FATAL:", error.message); process.exit(1); });
