/**
 * Generic MT5 M1 CSV vs DB candles_1m verifier.
 * Usage: node scripts/verify-mt5-csv.js <path-to-csv> [offset-hours=3]
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const CSV_PATH = process.argv[2];
const OFFSET_HOURS = Number(process.argv[3] ?? 3);

if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
  console.error("Usage: node scripts/verify-mt5-csv.js <csv-path> [offset-hours]");
  process.exit(1);
}

function inferSymbol(fileName) {
  const base = path.basename(fileName, ".csv");
  const m = base.match(/^([A-Z]{3,6}USD|[A-Z]{6}|DXY|XAUUSD)/i);
  return m ? m[1].toUpperCase() : null;
}

const SYMBOL = inferSymbol(CSV_PATH);
if (!SYMBOL) {
  console.error("Could not infer symbol from filename:", CSV_PATH);
  process.exit(1);
}

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

function readCsvText(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le", 2);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE — manual swap to LE
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString("utf16le");
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf8", 3);
  }
  return buf.toString("utf8");
}

async function main() {
  const raw = readCsvText(CSV_PATH);
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  const csvRows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
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

  if (csvRows.length === 0) {
    console.log("No CSV rows parsed.");
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
  for (const r of dbRows) dbMap.set(r.ts.toISOString(), r);

  let exact = 0;
  let mismatch = 0;
  let missing = 0;
  const mismatchDays = new Map();
  let firstMismatch = null;
  let lastMismatch = null;

  for (const csv of csvRows) {
    const db = dbMap.get(csv.ts.toISOString());
    if (!db) {
      missing++;
      continue;
    }
    const match =
      csv.o === db.o && csv.h === db.h && csv.l === db.l && csv.c === db.c;
    if (match) {
      exact++;
    } else {
      mismatch++;
      if (!firstMismatch) firstMismatch = csv.ts;
      lastMismatch = csv.ts;
      const day = csv.ts.toISOString().slice(0, 10);
      if (!mismatchDays.has(day)) mismatchDays.set(day, 0);
      mismatchDays.set(day, mismatchDays.get(day) + 1);
    }
  }

  console.log(`Symbol: ${SYMBOL}`);
  console.log(`CSV rows parsed:     ${csvRows.length}`);
  console.log(`DB rows in range:    ${dbRows.length}`);
  console.log(`Exact OHLC matches:  ${exact} (${(exact / csvRows.length * 100).toFixed(2)}%)`);
  console.log(`Mismatched OHLC:     ${mismatch} (${(mismatch / csvRows.length * 100).toFixed(2)}%)`);
  console.log(`Missing in DB:       ${missing} (${(missing / csvRows.length * 100).toFixed(2)}%)`);
  if (firstMismatch) {
    console.log(`First mismatch:      ${firstMismatch.toISOString()}`);
    console.log(`Last mismatch:       ${lastMismatch.toISOString()}`);
    console.log("Mismatch days:", [...mismatchDays.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,n])=>`${d}(${n})`).join(", "));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
