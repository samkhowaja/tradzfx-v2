require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const { rows } = await pool.query(`
    SELECT q.symbol, q.broker, q.event_time, q.flags,
           c.o, c.h, c.l, c.c, c.spread,
           COUNT(a.*)::int AS alternate_count,
           ARRAY_AGG(DISTINCT a.broker) FILTER (WHERE a.broker IS NOT NULL) AS alternate_brokers
      FROM candle_quarantine q
      JOIN candles_1m c
        ON c.symbol = q.symbol AND c.broker = q.broker AND c.ts = q.event_time
      LEFT JOIN candles_1m a
        ON a.symbol = q.symbol AND a.ts = q.event_time AND a.broker <> q.broker
     WHERE q.superseded_at IS NULL
       AND EXISTS (
         SELECT 1
           FROM raw.symbol_broker_policy p
          WHERE p.symbol = q.symbol
            AND p.broker_id = q.broker
            AND p.effective_from <= q.event_time
            AND (p.effective_to IS NULL OR q.event_time < p.effective_to)
            AND p.priority = (
              SELECT MIN(p2.priority)
                FROM raw.symbol_broker_policy p2
               WHERE p2.symbol = q.symbol
                 AND p2.effective_from <= q.event_time
                 AND (p2.effective_to IS NULL OR q.event_time < p2.effective_to)
            )
       )
     GROUP BY q.symbol, q.broker, q.event_time, q.flags,
              c.o, c.h, c.l, c.c, c.spread
     ORDER BY q.symbol, q.event_time
  `);

  const summary = rows.reduce((out, row) => {
    const key = row.alternate_count > 0 ? 'hasAlternate' : 'noAlternate';
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
  console.log(JSON.stringify({ total: rows.length, summary }, null, 2));
  console.table(rows);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
