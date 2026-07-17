const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

function buildInputHash(candles) {
  return crypto.createHash('sha256')
    .update(
      candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|")
    )
    .digest('hex') + ":q1";
}

/**
 * Batch upsert ATR rows using unnest() for high performance.
 * Processes all rows for one symbol/tf/period in a single SQL statement.
 */
async function batchUpsertAtr(client, symbol, tf, period, rows) {
  if (rows.length === 0) return 0;

  // Deduplicate by (ts) within the batch — keep the last row for each ts.
  // ON CONFLICT cannot handle duplicate keys within a single INSERT.
  const deduped = new Map();
  for (const r of rows) {
    deduped.set(r.ts.getTime(), r);
  }
  const unique = [...deduped.values()];

  // Build arrays for unnest
  const tss = unique.map(r => r.ts);
  // For zero ATR (zero-range candles): use tiny sentinel to satisfy NOT NULL + CHECK(value > 0),
  // but mark is_valid=false so downstream consumers ignore the row.
  const SENTINEL = 1e-10;
  const values = unique.map(r => r.atr > 0 ? r.atr : SENTINEL);
  const effectiveValues = unique.map(r => r.atr > 0 ? r.atr : SENTINEL);
  const isValids = unique.map(r => r.atr > 0);
  const inputHashes = unique.map(r => r.inputHash);
  const qualityReasons = unique.map(r => r.atr > 0 ? null : 'zero_range_candle');

  const result = await client.query(`
    INSERT INTO features_atr (symbol, tf, ts, period, value, effective_value, is_valid, input_hash, quality_reason)
    SELECT $1::text, $2::text, unnest($3::timestamptz[]), $4::int,
           unnest($5::double precision[]), unnest($6::double precision[]),
           unnest($7::boolean[]), unnest($8::text[]), unnest($9::text[])
    ON CONFLICT (symbol, tf, ts, period) DO UPDATE SET
      value = EXCLUDED.value,
      effective_value = EXCLUDED.effective_value,
      is_valid = EXCLUDED.is_valid,
      input_hash = EXCLUDED.input_hash,
      quality_reason = EXCLUDED.quality_reason
  `, [symbol, tf, tss, period, values, effectiveValues, isValids, inputHashes, qualityReasons]);

  return result.rowCount;
}

async function run() {
  const client = await pool.connect();
  try {
    const symbols = ['AUDUSD', 'EURUSD', 'GBPUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'USDSEK', 'XAUUSD'];
    const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
    const periods = [5, 14, 20];
    const BATCH_SIZE = 5000; // rows per batch to avoid excessive memory / statement size

    for (const symbol of symbols) {
      for (const tf of timeframes) {
        const t0 = Date.now();
        console.log(`Repairing ${symbol} ${tf} ATR...`);

        // Get candles for this symbol/timeframe
        const table = tf === '1d' ? 'candles_1d_utc' : `candles_${tf}`;
        const { rows: candles } = await client.query(`
          SELECT ts, o, h, l, c
          FROM ${table}
          WHERE symbol = $1
          ORDER BY ts ASC
        `, [symbol]);

        if (candles.length === 0) {
          console.log(`  No candles for ${symbol} ${tf}`);
          continue;
        }
        console.log(`  Loaded ${candles.length} candles`);

        for (const period of periods) {
          // Compute ATR for each candle (sliding window)
          const rows = [];
          for (let i = period; i < candles.length; i++) {
            const window = candles.slice(i - period, i + 1);
            let sumTR = 0;
            for (let j = 1; j < window.length; j++) {
              const curr = window[j];
              const prev = window[j - 1];
              const tr1 = curr.h - curr.l;
              const tr2 = Math.abs(curr.h - prev.c);
              const tr3 = Math.abs(curr.l - prev.c);
              sumTR += Math.max(tr1, tr2, tr3);
            }
            const atr = sumTR / period;
            const inputHash = buildInputHash(window);
            rows.push({ ts: window[window.length - 1].ts, atr, inputHash });
          }

          console.log(`  Computed ${rows.length} ATR-${period} rows, upserting in batches of ${BATCH_SIZE}...`);

          // Batch upsert
          let totalUpserted = 0;
          for (let b = 0; b < rows.length; b += BATCH_SIZE) {
            const batch = rows.slice(b, b + BATCH_SIZE);
            const n = await batchUpsertAtr(client, symbol, tf, period, batch);
            totalUpserted += n;
            if ((b / BATCH_SIZE) % 10 === 0) {
              console.log(`    Batch ${Math.floor(b / BATCH_SIZE) + 1}: ${n} rows (${totalUpserted} total so far)`);
            }
          }
          console.log(`  ATR-${period}: ${totalUpserted} rows upserted`);
        }

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  Completed ${symbol} ${tf} in ${elapsed}s`);
      }
    }

    console.log('ATR backfill complete!');
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}
run();