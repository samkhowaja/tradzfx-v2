/**
 * Diagnose candles_1m data quality: timestamps, duplicates, gaps, future bars.
 * Run: node scripts/diagnose-candles.js [symbol]
 */
const { Pool } = require('pg');

const symbol = process.argv[2] || process.env.SYMBOL || 'XAUUSD';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'tradementor_v2',
  user: 'postgres',
  password: '2k16Dub@i',
});

async function main() {
  console.log('=== Symbol summary ===');
  const { rows: summary } = await pool.query(
    `SELECT symbol,
            COUNT(*) AS rows,
            MIN(ts) AS first_ts,
            MAX(ts) AS last_ts,
            EXTRACT(EPOCH FROM (NOW() - MAX(ts))) / 60.0 AS minutes_behind_now
     FROM candles_1m
     GROUP BY symbol
     ORDER BY symbol`
  );
  console.table(summary);

  console.log(`\n=== Last 10 bars for ${symbol} ===`);
  const { rows: lastBars } = await pool.query(
    `SELECT ts, o, h, l, c, v, broker, digits
     FROM candles_1m
     WHERE symbol = $1
     ORDER BY ts DESC
     LIMIT 10`,
    [symbol]
  );
  console.table(lastBars);

  console.log('\n=== Duplicate (symbol, ts) rows ===');
  const { rows: dups } = await pool.query(
    `SELECT symbol, ts, COUNT(*) AS cnt
     FROM candles_1m
     GROUP BY symbol, ts
     HAVING COUNT(*) > 1
     ORDER BY cnt DESC
     LIMIT 20`
  );
  console.table(dups);
  if (dups.length === 0) console.log('No duplicates found.');

  console.log('\n=== Future bars (ts > NOW()) ===');
  const { rows: future } = await pool.query(
    `SELECT symbol, COUNT(*) AS future_bars, MAX(ts) AS max_future_ts
     FROM candles_1m
     WHERE ts > NOW()
     GROUP BY symbol
     ORDER BY future_bars DESC`
  );
  console.table(future);
  if (future.length === 0) console.log('No future bars found.');

  console.log(`\n=== Gaps > 5 min in last 500 bars for ${symbol} ===`);
  const { rows: gaps } = await pool.query(
    `WITH ordered AS (
       SELECT ts, LAG(ts) OVER (ORDER BY ts) AS prev_ts
       FROM candles_1m
       WHERE symbol = $1
       ORDER BY ts DESC
       LIMIT 500
     )
     SELECT prev_ts, ts,
            EXTRACT(EPOCH FROM (ts - prev_ts)) / 60.0 AS gap_minutes
     FROM ordered
     WHERE prev_ts IS NOT NULL
       AND EXTRACT(EPOCH FROM (ts - prev_ts)) > 5 * 60
     ORDER BY ts DESC
     LIMIT 20`,
    [symbol]
  );
  console.table(gaps);
  if (gaps.length === 0) console.log('No >5 min gaps in last 500 bars.');

  console.log('\n=== Primary key / constraints on candles_1m ===');
  const { rows: pk } = await pool.query(
    `SELECT conname, contype, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conrelid = 'candles_1m'::regclass`
  );
  console.table(pk);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
