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

// Simulate data-clock logic for XAUUSD
const tables = ['candles_1m','features_bias','features_direction_state','features_htf_bias',
  'features_pricing','features_atr','features_session','features_spread',
  'features_zone','features_ifvg','features_order_block','features_structure',
  'features_sweep','features_displacement','features_zone_retest','features_opening_range',
  'features_candle_pattern','features_time_of_day_edge','features_indicator',
  'features_moving_average','features_pivot','features_liquidity_pools',
  'features_correlation','features_time_of_day'];

const now = Date.now();
for (const table of tables) {
  const r = await pool.query(`SELECT MAX(ts) as latest_ts FROM ${table} WHERE symbol='XAUUSD'`);
  const latest = r.rows[0]?.latest_ts;
  const lag = latest ? (now - new Date(latest).getTime())/60000 : null;
  const status = !latest ? 'NO_DATA' : lag > 60 ? 'STALE' : 'FRESH';
  console.log(`${status} ${table.padEnd(32)} latest=${latest?.toISOString().slice(0,19) || 'N/A'} lag=${lag !== null ? Math.round(lag)+'m' : 'N/A'}`);
}
await pool.end();
