/**
 * Backfill candles_1m from MT5-exported 1m CSV files.
 *
 * The MT5 script Export1mHistoryForVerification.mq5 writes files like:
 *   <SYMBOL>_M1_<from>_<to>.csv
 * with a tab-delimited MT5-standard header:
 *   <DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>
 *
 * Usage:
 *   export TM_DB_PASSWORD=...
 *   node backfill-candles-from-mt5-csv.js <csv-directory> [--tz-offset-minutes=180] [--broker=MT5]
 *     [--insert-missing-only] [--symbols=AUDUSD,EURUSD] [--filename-contains=20260717172600]
 *
 * Example (MT5 terminal timestamps are UTC+3):
 *   node backfill-candles-from-mt5-csv.js "C:\\Users\\Salman\\Desktop" --tz-offset-minutes=180
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const BATCH_SIZE = 5000;

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD || process.env.PGPASSWORD,
  max: 2,
});

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    dir: null,
    tzOffsetMinutes: 0,
    broker: "MT5",
    insertMissingOnly: false,
    symbols: null,
    filenameContains: null,
  };
  for (const a of argv) {
    if (a.startsWith("--tz-offset-minutes=")) {
      out.tzOffsetMinutes = parseInt(a.slice("--tz-offset-minutes=".length), 10);
    } else if (a.startsWith("--broker=")) {
      out.broker = a.slice("--broker=".length);
    } else if (a === "--insert-missing-only") {
      out.insertMissingOnly = true;
    } else if (a.startsWith("--symbols=")) {
      out.symbols = new Set(
        a.slice("--symbols=".length).split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
      );
    } else if (a.startsWith("--filename-contains=")) {
      out.filenameContains = a.slice("--filename-contains=".length);
    } else if (!a.startsWith("--") && !out.dir) {
      out.dir = a;
    }
  }
  return out;
}

function parseDateTime(dateStr, timeStr, offsetMinutes) {
  // dateStr: yyyy.mm.dd, timeStr: hh:mi:ss
  const [y, m, d] = dateStr.split(".").map(Number);
  const [H, M, S] = timeStr.split(":").map(Number);
  const localMs = Date.UTC(y, m - 1, d, H, M, S);
  return new Date(localMs - offsetMinutes * 60000);
}

function countDecimals(value) {
  const s = String(value);
  const idx = s.indexOf(".");
  return idx < 0 ? 0 : s.length - idx - 1;
}

function inferDigits(o, h, l, c) {
  return Math.max(countDecimals(o), countDecimals(h), countDecimals(l), countDecimals(c));
}

function validateCandle(r) {
  if (!Number.isFinite(r.o) || !Number.isFinite(r.h) || !Number.isFinite(r.l) || !Number.isFinite(r.c)) {
    return { valid: false, reason: "non-finite OHLC" };
  }
  if (r.o < 0 || r.h < 0 || r.l < 0 || r.c < 0 || r.v < 0) {
    return { valid: false, reason: "negative OHLCV" };
  }
  if (r.h < r.l) {
    return { valid: false, reason: "high < low" };
  }
  if (r.h < r.o || r.h < r.c) {
    return { valid: false, reason: "high below open or close" };
  }
  if (r.l > r.o || r.l > r.c) {
    return { valid: false, reason: "low above open or close" };
  }
  return { valid: true };
}

function spreadPointsToPips(spreadPoints, digits) {
  // MT5's <SPREAD> column is in points. Convert to pips:
  //   4-digit symbols: 1 point = 1 pip
  //   all others:      10 points = 1 pip (5-digit FX, 3-digit JPY, 2-digit XAU, etc.)
  if (!Number.isFinite(spreadPoints) || spreadPoints <= 0) return 0;
  if (digits === 4) return spreadPoints;
  return spreadPoints / 10;
}

// P0-A1 / SK-65: magnitude prefilter, parity with the live ingest path
// (apps/web/src/app/api/ingest/route.ts > suspectRangeReason). A 1m candle on a
// liquid major cannot legitimately span > 1000 pips; such a bar is a bad tick.
// We FLAG it in candle_quality (keep the candle for PIT; ATR winsorizes
// downstream) rather than drop it. Geometry corruption is still rejected
// outright by validateCandle above.
const MAX_1M_RANGE_PIPS = 1000;

function pipSizeFromDigits(digits) {
  if (!Number.isFinite(digits) || digits < 0) return null;
  const pointSize = Math.pow(10, -digits);
  return digits === 4 ? pointSize : 10 * pointSize;
}

function suspectRangeReason(candidate) {
  const pipSize = pipSizeFromDigits(candidate.digits);
  if (!(pipSize > 0)) return null;
  const rangePips = (candidate.h - candidate.l) / pipSize;
  if (Number.isFinite(rangePips) && rangePips > MAX_1M_RANGE_PIPS) {
    return `1m range ${rangePips.toFixed(1)}p > ${MAX_1M_RANGE_PIPS}p cap (backfill)`;
  }
  return null;
}

function findCsvFiles(dir, { symbols = null, filenameContains = null } = {}) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".csv") && f.includes("_M1_"))
    .filter((f) => !filenameContains || f.includes(filenameContains))
    .filter((f) => !symbols || symbols.has(parseSymbolFromFilename(f)))
    .map((f) => ({ file: path.join(dir, f), name: f }));
}

function parseSymbolFromFilename(name) {
  const idx = name.indexOf("_M1_");
  return idx > 0 ? name.slice(0, idx).toUpperCase() : null;
}

async function importFile(filePath, symbol, offsetMinutes, broker, { insertMissingOnly = false } = {}) {
  console.log(`[backfill-candles] Importing ${symbol} from ${path.basename(filePath)} (tz offset ${offsetMinutes}m)`);
  const raw = fs.readFileSync(filePath);
  let content;
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    content = raw.toString("utf16le").replace(/^\uFEFF/, "");
  } else {
    content = raw.toString("utf8").replace(/^\uFEFF/, "");
  }
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);

  if (lines.length === 0) {
    console.log(`[backfill-candles] Empty file: ${filePath}`);
    return 0;
  }

  const header = lines[0].split("\t").map((h) => h.replace(/[<>]/g, "").toUpperCase());
  const colIndex = {
    date: header.indexOf("DATE"),
    time: header.indexOf("TIME"),
    open: header.indexOf("OPEN"),
    high: header.indexOf("HIGH"),
    low: header.indexOf("LOW"),
    close: header.indexOf("CLOSE"),
    tickvol: header.indexOf("TICKVOL"),
    vol: header.indexOf("VOL"),
    spread: header.indexOf("SPREAD"),
  };

  if (colIndex.date < 0 || colIndex.time < 0 || colIndex.open < 0) {
    throw new Error(`Unexpected header in ${filePath}: ${lines[0]}`);
  }

  const rows = [];
  const suspects = [];
  let rejected = 0;
  let lastRejectReason = null;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("\t");
    if (parts.length < 6) continue;
    const ts = parseDateTime(parts[colIndex.date], parts[colIndex.time], offsetMinutes);
    const o = parseFloat(parts[colIndex.open]);
    const h = parseFloat(parts[colIndex.high]);
    const l = parseFloat(parts[colIndex.low]);
    const c = parseFloat(parts[colIndex.close]);
    const v = colIndex.vol >= 0 ? parseInt(parts[colIndex.vol], 10) || 0 : parseInt(parts[colIndex.tickvol], 10) || 0;
    const spreadPoints = colIndex.spread >= 0 ? parseInt(parts[colIndex.spread], 10) || 0 : 0;
    const digits = inferDigits(parts[colIndex.open], parts[colIndex.high], parts[colIndex.low], parts[colIndex.close]);
    const spread = spreadPointsToPips(spreadPoints, digits);
    const candidate = { ts, o, h, l, c, v, spread, digits };
    const validation = validateCandle(candidate);
    if (!validation.valid) {
      rejected++;
      lastRejectReason = validation.reason;
      continue;
    }
    rows.push(candidate);
    const sReason = suspectRangeReason(candidate);
    if (sReason) suspects.push({ ts: candidate.ts, reason: sReason });
  }

  if (rejected > 0) {
    console.warn(`[backfill-candles] ${symbol}: rejected ${rejected} invalid rows (last reason: ${lastRejectReason})`);
  }

  if (rows.length === 0) {
    console.log(`[backfill-candles] No valid data rows in ${filePath}`);
    return 0;
  }

  let inserted = 0;
  const client = await pool.connect();
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;
      for (const r of batch) {
        placeholders.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
        );
        values.push(symbol, r.ts, r.o, r.h, r.l, r.c, r.v, broker, r.digits, r.spread);
      }
      const conflictAction = insertMissingOnly
        ? "DO NOTHING"
        : `DO UPDATE SET
          o = EXCLUDED.o,
          h = EXCLUDED.h,
          l = EXCLUDED.l,
          c = EXCLUDED.c,
          v = EXCLUDED.v,
          broker = EXCLUDED.broker,
          digits = EXCLUDED.digits,
          spread = EXCLUDED.spread`;
      const sql = `
        INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, broker, digits, spread)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (symbol, broker, ts) ${conflictAction}
      `;
      const { rowCount } = await client.query(sql, values);
      inserted += rowCount ?? 0;
      if ((i + batch.length) % (BATCH_SIZE * 2) === 0 || i + batch.length >= rows.length) {
        console.log(
          `  ${symbol} ${i + batch.length}/${rows.length} rows (${inserted} ${insertMissingOnly ? "inserted" : "upserted"})`
        );
      }
    }
    // SK-65: flag magnitude-suspect 1m bars in candle_quality (keep the candle
    // for PIT; downstream ATR winsorizes). Best-effort: never fail the import
    // over the side table. Mirrors the live ingest path.
    if (suspects.length > 0) {
      try {
        for (let i = 0; i < suspects.length; i += BATCH_SIZE) {
          const sb = suspects.slice(i, i + BATCH_SIZE);
          const sValues = [];
          const sPh = [];
          let sIdx = 1;
          for (const s of sb) {
            sPh.push(`($${sIdx++}, $${sIdx++}, true, $${sIdx++})`);
            sValues.push(symbol, s.ts, s.reason);
          }
          await client.query(
            `INSERT INTO candle_quality (symbol, ts, is_suspect, reason)
             VALUES ${sPh.join(", ")}
             ON CONFLICT (symbol, ts) DO UPDATE SET is_suspect = true, reason = EXCLUDED.reason`,
            sValues
          );
        }
        console.warn(
          `[backfill-candles] ${symbol}: flagged ${suspects.length} magnitude-suspect bar(s) in candle_quality`
        );
      } catch (qErr) {
        console.warn(
          `[backfill-candles] ${symbol}: candle_quality flagging failed (best-effort): ${qErr.message}`
        );
      }
    }
  } finally {
    client.release();
  }

  console.log(`[backfill-candles] ${symbol} done | ${inserted} rows ${insertMissingOnly ? "inserted" : "upserted"}`);
  return inserted;
}

async function main() {
  const args = parseArgs();
  if (!args.dir) {
    console.error("Usage: node backfill-candles-from-mt5-csv.js <csv-directory> [--tz-offset-minutes=N] [--broker=NAME] [--insert-missing-only] [--symbols=A,B] [--filename-contains=TEXT]");
    process.exit(1);
  }

  const dir = path.resolve(args.dir);
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const files = findCsvFiles(dir, args);
  if (files.length === 0) {
    console.error(`No matching *_M1_*.csv files found in ${dir}`);
    process.exit(1);
  }

  console.log(`[backfill-candles] Found ${files.length} CSV file(s) in ${dir}`);
  console.log(`[backfill-candles] TZ offset: ${args.tzOffsetMinutes} minutes (CSV local → UTC)`);
  console.log(`[backfill-candles] Conflict mode: ${args.insertMissingOnly ? "insert missing only" : "update existing"}`);

  let total = 0;
  for (const { file, name } of files) {
    const symbol = parseSymbolFromFilename(name);
    if (!symbol) {
      console.warn(`Skipping unrecognized filename: ${name}`);
      continue;
    }
    total += await importFile(file, symbol, args.tzOffsetMinutes, args.broker, args);
  }

  console.log(`[backfill-candles] Total ${args.insertMissingOnly ? "inserted" : "upserted"}: ${total} rows`);
  await pool.end();
}

module.exports = {
  parseArgs,
  findCsvFiles,
  validateCandle,
  pipSizeFromDigits,
  suspectRangeReason,
  MAX_1M_RANGE_PIPS,
};

if (require.main === module) {
  main().catch((e) => {
    console.error("[backfill-candles] Fatal:", e);
    pool.end();
    process.exit(1);
  });
}
