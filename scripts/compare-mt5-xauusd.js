/**
 * Compare MT5-exported XAUUSD M1 CSV with the database candles_1m table.
 */

const fs = require("fs");
const readline = require("readline");
const { Pool } = require("pg");

const CSV_PATH = "C:/Users/Salman/Desktop/XAUUSD_M1_202603191633_202607010924.csv";
const SYMBOL = "XAUUSD";
const OFFSET_HOURS = 3; // CSV timestamps appear to be UTC+3

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

function parseCsvDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split(".").map(Number);
  const [hh, mm, ss] = timeStr.split(":").map(Number);
  const local = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  // Convert broker local time to UTC
  return new Date(local.getTime() - OFFSET_HOURS * 60 * 60 * 1000);
}

async function main() {
  const fileStream = fs.createReadStream(CSV_PATH);
  const rl = readline.createInterface({ input: fileStream });

  const csvRows = [];
  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // header
    const parts = line.split("\t");
    if (parts.length < 6) continue;
    const ts = parseCsvDate(parts[0].trim(), parts[1].trim());
    csvRows.push({
      ts,
      o: Number(parts[2]),
      h: Number(parts[3]),
      l: Number(parts[4]),
      c: Number(parts[5]),
    });
  }

  if (csvRows.length === 0) {
    console.log("No CSV rows parsed");
    await pool.end();
    return;
  }

  const minTs = csvRows[0].ts;
  const maxTs = csvRows[csvRows.length - 1].ts;

  const { rows: dbRows } = await pool.query(
    `SELECT ts, o, h, l, c FROM candles_1m
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [SYMBOL, minTs, maxTs]
  );

  const dbMap = new Map();
  for (const r of dbRows) {
    dbMap.set(r.ts.toISOString(), r);
  }

  let exact = 0;
  let mismatch = 0;
  let missingInDb = 0;
  const firstMismatches = [];

  for (const csv of csvRows) {
    const key = csv.ts.toISOString();
    const db = dbMap.get(key);
    if (!db) {
      missingInDb++;
      continue;
    }
    const match =
      Number(csv.o) === Number(db.o) &&
      Number(csv.h) === Number(db.h) &&
      Number(csv.l) === Number(db.l) &&
      Number(csv.c) === Number(db.c);
    if (match) {
      exact++;
    } else {
      mismatch++;
      if (firstMismatches.length < 5) {
        firstMismatches.push({
          csvTs: csv.ts.toISOString(),
          csv: { o: csv.o, h: csv.h, l: csv.l, c: csv.c },
          db: { o: db.o, h: db.h, l: db.l, c: db.c },
        });
      }
    }
  }

  console.log(`CSV rows parsed:     ${csvRows.length}`);
  console.log(`DB rows in range:    ${dbRows.length}`);
  console.log(`Exact OHLC matches:  ${exact}`);
  console.log(`Mismatched OHLC:     ${mismatch}`);
  console.log(`Missing in DB:       ${missingInDb}`);
  console.log(`Match rate:          ${((exact / csvRows.length) * 100).toFixed(2)}%`);

  if (firstMismatches.length > 0) {
    console.log("\nFirst mismatches:");
    for (const m of firstMismatches) {
      console.log(m.csvTs);
      console.log("  CSV:", m.csv);
      console.log("  DB: ", m.db);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
