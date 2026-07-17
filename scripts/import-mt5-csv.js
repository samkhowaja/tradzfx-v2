/**
 * Import/overwrite MT5 M1 CSV into candles_1m.
 * Usage: node scripts/import-mt5-csv.js <csv-path> [offset-hours=3]
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const CSV_PATH = process.argv[2];
const OFFSET_HOURS = Number(process.argv[3] ?? 3);

if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
  console.error("Usage: node scripts/import-mt5-csv.js <csv-path> [offset-hours]");
  process.exit(1);
}

function inferSymbol(fileName) {
  const base = path.basename(fileName, ".csv");
  const m = base.match(/^([A-Z]{3,6}USD|DXY|[A-Z]{6})/i);
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
  const local = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));  return new Date(local.getTime() - OFFSET_HOURS * 60 * 60 * 1000);
}

function countDecimals(value) {
  const s = value.toString();
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

function readCsvText(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le", 2);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
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

  const rows = [];
  let maxDecimals = 0;
  let lineNum = 0;
  let minTs = null;
  let maxTs = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    lineNum++;
    if (lineNum === 1) continue;
    if (line.length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 9) continue;
    const ts = parseCsvDate(parts[0].trim(), parts[1].trim());
    const o = Number(parts[2]);
    const h = Number(parts[3]);
    const l = Number(parts[4]);
    const c = Number(parts[5]);
    const tickVol = Number(parts[6]);
    // MT5 CSV <SPREAD> is in points; convert to pips like every other writer
    // (digits=4 -> pip = 1 point, otherwise pip = 10 points).
    const spreadPoints = Number(parts[8]);

    rows.push({ symbol: SYMBOL, ts, o, h, l, c, v: tickVol, spreadPoints });
    maxDecimals = Math.max(maxDecimals, countDecimals(c));
    if (!minTs || ts < minTs) minTs = ts;
    if (!maxTs || ts > maxTs) maxTs = ts;
  }

  if (rows.length === 0) {
    console.log("No rows to import.");
    await pool.end();
    return;
  }

  console.log(`Parsed ${rows.length} rows for ${SYMBOL} from ${minTs.toISOString()} to ${maxTs.toISOString()}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const broker = "MT5";
    const delRes = await client.query(
      "DELETE FROM candles_1m WHERE symbol = $1 AND broker = $2 AND ts >= $3 AND ts <= $4",
      [SYMBOL, broker, minTs, maxTs]
    );
    console.log(`Deleted ${delRes.rowCount} existing ${broker} rows in overlap range.`);

    const digits = maxDecimals;
    const pointsToPips = (points) => {
      if (!Number.isFinite(points)) return null;
      return digits === 4 ? points : points / 10;
    };
    const BATCH = 1000;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let pi = 1;
      for (const r of batch) {
        values.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
        params.push(r.symbol, r.ts, r.o, r.h, r.l, r.c, r.v, broker, digits, pointsToPips(r.spreadPoints));
      }
      const sql =
        `INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, broker, digits, spread) VALUES ${values.join(", ")}
         ON CONFLICT (symbol, broker, ts) DO UPDATE SET
           o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c,
           v = EXCLUDED.v, digits = EXCLUDED.digits, spread = EXCLUDED.spread`;
      await client.query(sql, params);
      inserted += batch.length;
      if (inserted % 10000 === 0) console.log(`Inserted ${inserted} rows...`);
    }

    await client.query("COMMIT");
    console.log(`Done. Inserted ${inserted} rows (digits=${digits}).`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
