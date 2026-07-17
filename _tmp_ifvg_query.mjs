import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
dotenv.config({ path: 'c:/tradzfx-v2/.env.local' });
const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
  max: 1
});
const r = await pool.query(
  `SELECT date_trunc('day',ts)::date d,tf,count(*) n
   FROM features_ifvg WHERE symbol='XAUUSD' AND ts>='2026-06-01'
   GROUP BY 1,2 ORDER BY 1,2`
);
for (const row of r.rows) {
  console.log(row.d.toISOString().slice(0,10), row.tf, row.n);
}
console.log('\n--TOTAL:', r.rows.reduce((a,x) => a + Number(x.n), 0));
await pool.end();
