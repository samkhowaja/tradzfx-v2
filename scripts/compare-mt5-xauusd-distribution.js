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

function fmtDay(ts) {
  return ts.toISOString().slice(0, 10);
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

  const dayStats = new Map();
  let totalMismatch = 0;
  let sumAbsDiffC = 0;
  const diffBuckets = {};

  for (const csv of csvRows) {
    const db = dbMap.get(csv.ts.toISOString());
    if (!db) continue;
    const day = fmtDay(csv.ts);
    if (!dayStats.has(day)) dayStats.set(day, { csv: 0, exact: 0, mismatch: 0, missing: 0, sumDiffC: 0 });
    const s = dayStats.get(day);
    s.csv++;
    const match = csv.o === db.o && csv.h === db.h && csv.l === db.l && csv.c === db.c;
    if (match) {
      s.exact++;
    } else {
      s.mismatch++;
      const diffC = csv.c - db.c;
      s.sumDiffC += diffC;
      totalMismatch++;
      sumAbsDiffC += Math.abs(diffC);
      const bucket = Math.round(Math.abs(diffC));
      diffBuckets[bucket] = (diffBuckets[bucket] || 0) + 1;
    }
  }

  console.log("Mismatch diff (abs close) buckets:");
  const bucketsSorted = Object.entries(diffBuckets).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [k, v] of bucketsSorted.slice(0, 20)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log("\nDaily mismatch summary (days with mismatch):");
  const days = [...dayStats.entries()]
    .filter(([d, s]) => s.mismatch > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [day, s] of days.slice(0, 20)) {
    console.log(`${day}: csv=${s.csv} exact=${s.exact} mismatch=${s.mismatch} avgDiffC=${(s.sumDiffC / s.mismatch).toFixed(2)}`);
  }
  console.log("Days with mismatch:", days.length);
  console.log("Average |diffC| on mismatches:", (sumAbsDiffC / totalMismatch).toFixed(2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
