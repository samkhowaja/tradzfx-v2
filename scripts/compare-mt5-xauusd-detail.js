const fs = require("fs");
const readline = require("readline");
const { Pool } = require("pg");

const CSV_PATH = "C:/Users/Salman/Desktop/XAUUSD_M1_202603191633_202607010924.csv";
const SYMBOL = "XAUUSD";
const OFFSET_HOURS = 3;

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
  return new Date(local.getTime() - OFFSET_HOURS * 60 * 60 * 1000);
}

async function main() {
  const fileStream = fs.createReadStream(CSV_PATH);
  const rl = readline.createInterface({ input: fileStream });

  const csvRows = [];
  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue;
    const parts = line.split("\t");
    if (parts.length < 6) continue;
    csvRows.push({
      ts: parseCsvDate(parts[0].trim(), parts[1].trim()),
      o: Number(parts[2]),
      h: Number(parts[3]),
      l: Number(parts[4]),
      c: Number(parts[5]),
    });
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
  for (const r of dbRows) dbMap.set(r.ts.toISOString(), r);

  let exact = 0;
  let mismatch = 0;
  let missing = 0;
  let sumDiffC = 0;
  let firstMismatch = null;
  let lastMismatch = null;
  let exactBeforeMay25 = 0;
  let totalBeforeMay25 = 0;

  const may25 = new Date("2026-05-25T00:00:00Z");

  for (const csv of csvRows) {
    const db = dbMap.get(csv.ts.toISOString());
    const before = csv.ts < may25;
    if (before) totalBeforeMay25++;
    if (!db) {
      missing++;
      continue;
    }
    const match =
      csv.o === db.o && csv.h === db.h && csv.l === db.l && csv.c === db.c;
    if (match) {
      exact++;
      if (before) exactBeforeMay25++;
    } else {
      mismatch++;
      if (!firstMismatch) firstMismatch = csv.ts;
      lastMismatch = csv.ts;
      sumDiffC += csv.c - db.c;
    }
  }

  console.log("CSV rows:", csvRows.length);
  console.log("DB rows in range:", dbRows.length);
  console.log("Exact:", exact, `(${(exact / csvRows.length * 100).toFixed(2)}%)`);
  console.log("Mismatch:", mismatch);
  console.log("Missing in DB:", missing);
  console.log("Exact before 2026-05-25:", exactBeforeMay25, "/", totalBeforeMay25);
  console.log("First mismatch:", firstMismatch?.toISOString());
  console.log("Last mismatch:", lastMismatch?.toISOString());
  console.log("Avg CSV - DB close diff on mismatches:", (sumDiffC / mismatch).toFixed(2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
