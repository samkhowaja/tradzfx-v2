const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const TIMEFRAMES = [
  { name: "5m", table: "candles_5m", minutes: 5 },
  { name: "15m", table: "candles_15m", minutes: 15 },
  { name: "1h", table: "candles_1h", minutes: 60 },
  { name: "4h", table: "candles_4h", minutes: 240 },
  { name: "1d_utc", table: "candles_1d_utc", minutes: 1440 },
  { name: "1d_ny", table: "candles_1d_ny", minutes: 1440, ny: true },
];

function labelForTF(ts, tf) {
  if (tf.ny) {
    // NY day ends/labels at 21:00 UTC (17:00 ET). Subtract 21h to find the calendar day, then add 21h back.
    const shifted = new Date(ts.getTime() - 21 * 60 * 60 * 1000);
    const d = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 21, 0, 0, 0));
    return d;
  }
  if (tf.minutes === 1440) {
    return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate(), 0, 0, 0, 0));
  }
  if (tf.minutes === 240) {
    return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate(), Math.floor(ts.getUTCHours() / 4) * 4, 0, 0, 0));
  }
  if (tf.minutes === 60) {
    return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate(), ts.getUTCHours(), 0, 0, 0));
  }
  // 5m / 15m
  const ms = tf.minutes * 60 * 1000;
  return new Date(Math.floor(ts.getTime() / ms) * ms);
}

function fmt(ts) {
  return ts.toISOString();
}

async function getSymbols() {
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function verifySymbol(symbol) {
  console.log(`\n=== ${symbol} ===`);
  const { rows: m1Rows } = await pool.query(
    "SELECT ts, o, h, l, c, v FROM candles_1m WHERE symbol = $1 ORDER BY ts",
    [symbol]
  );

  for (const tf of TIMEFRAMES) {
    const buckets = new Map(); // key ISO -> {ts,o,h,l,c,v,count}
    for (const r of m1Rows) {
      const label = labelForTF(r.ts, tf);
      const key = label.toISOString();
      let b = buckets.get(key);
      if (!b) {
        b = { ts: label, o: r.o, h: r.h, l: r.l, c: r.c, v: Number(r.v ?? 0), count: 1 };
        buckets.set(key, b);
      } else {
        if (r.h > b.h) b.h = r.h;
        if (r.l < b.l) b.l = r.l;
        b.c = r.c;
        b.v += Number(r.v ?? 0);
        b.count++;
      }
    }

    const { rows: existing } = await pool.query(`SELECT ts, o, h, l, c, v, tick_count FROM ${tf.table} WHERE symbol = $1 ORDER BY ts`, [symbol]);
    const existingMap = new Map();
    for (const r of existing) existingMap.set(r.ts.toISOString(), r);

    let exact = 0;
    let mismatch = 0;
    let missing = 0;
    let extra = 0;
    let firstMismatch = null;
    const sampleMismatches = [];

    for (const [key, b] of buckets) {
      const e = existingMap.get(key);
      if (!e) {
        missing++;
        continue;
      }
      const match =
        b.o === e.o &&
        b.h === e.h &&
        b.l === e.l &&
        b.c === e.c &&
        b.v === Number(e.v) &&
        b.count === Number(e.tick_count ?? e.count);
      if (match) {
        exact++;
      } else {
        mismatch++;
        if (!firstMismatch) firstMismatch = key;
        if (sampleMismatches.length < 2) sampleMismatches.push({ key, expected: b, actual: e });
      }
    }

    for (const [key] of existingMap) {
      if (!buckets.has(key)) {
        extra++;
      }
    }

    const total = buckets.size;
    console.log(
      `${tf.name.padEnd(6)} expected=${total} exact=${exact} mismatch=${mismatch} missing=${missing} extra=${extra}` +
        (total ? ` (${(exact / total * 100).toFixed(1)}% exact)` : "")
    );
    if (firstMismatch) {
      console.log(`       first mismatch: ${firstMismatch}`);
      for (const s of sampleMismatches) {
        console.log(`       e.g. ${s.key} 1m->o=${s.expected.o} h=${s.expected.h} l=${s.expected.l} c=${s.expected.c} v=${s.expected.v} tc=${s.expected.count}`);
        console.log(`            db->o=${s.actual.o} h=${s.actual.h} l=${s.actual.l} c=${s.actual.c} v=${s.actual.v} tc=${s.actual.tick_count}`);
      }
    }
  }
}

async function main() {
  const symbols = await getSymbols();
  for (const symbol of symbols) {
    await verifySymbol(symbol);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
