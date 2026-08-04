import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";
import { classifyCandleGap, type CandleGapClass } from "../packages/shared/src/utils/marketCalendar";

type Case = { name: string; symbol: string; broker: string; previous: string; current: string };
const cases: Case[] = [
  { name: "FX weekend", symbol: "EURUSD", broker: "1x Trade Ltd.", previous: "2026-07-31T20:59:00Z", current: "2026-08-02T21:01:00Z" },
  { name: "Sunday pre-open", symbol: "USDJPY", broker: "OANDA Corporation", previous: "2026-08-02T18:00:00Z", current: "2026-08-02T20:00:00Z" },
  { name: "Friday close", symbol: "EURUSD", broker: "1x Trade Ltd.", previous: "2026-07-31T20:59:00Z", current: "2026-08-03T00:01:00Z" },
  { name: "XAUUSD maintenance", symbol: "XAUUSD", broker: "1x Trade Ltd.", previous: "2026-08-03T20:59:00Z", current: "2026-08-03T22:01:00Z" },
  { name: "intra-week break", symbol: "EURUSD", broker: "1x Trade Ltd.", previous: "2026-08-03T10:00:00Z", current: "2026-08-03T10:05:00Z" },
  { name: "one-minute continuity", symbol: "DXY", broker: "1x Trade Ltd.", previous: "2026-08-03T10:00:00Z", current: "2026-08-03T10:01:00Z" },
];

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  try {
    const results = [];
    for (const item of cases) {
      const previous = new Date(item.previous);
      const current = new Date(item.current);
      const tsResult = classifyCandleGap(item.symbol, item.broker, previous, current);
      const dbResult = await pool.query<{ classification: CandleGapClass }>(
        "SELECT market.classify_candle_gap($1, $2, $3::timestamptz, $4::timestamptz) AS classification",
        [item.symbol, item.broker, previous, current]
      );
      const sqlResult = dbResult.rows[0].classification;
      results.push({ ...item, typescript: tsResult, database: sqlResult, match: tsResult === sqlResult });
    }
    const mismatches = results.filter((result) => !result.match);
    console.log(JSON.stringify({ cases: results, passed: mismatches.length === 0, mismatches }, null, 2));
    if (mismatches.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
