#!/usr/bin/env node
const fs = require('node:fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: '.env.local' });
const CANDLE_TABLES = {
  '1m': 'market.candles_1m_canonical', '5m': 'market.candles_5m_canonical',
  '15m': 'market.candles_15m_canonical', '1h': 'market.candles_1h_canonical',
  '4h': 'market.candles_4h_canonical', '1d': 'market.candles_1d_utc_canonical',
};
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const healthPath = arg('--health', 'temp/health-matrix.json');
const outputPath = arg('--output', 'temp/geometry-matrix.json');
const config = { host: process.env.TM_DB_HOST || 'localhost', port: Number(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres', password: process.env.TM_DB_PASSWORD };

async function exists(client, relation) {
  const parts = relation.split('.'); const schema = parts.length === 2 ? parts[0] : 'public'; const table = parts.length === 2 ? parts[1] : parts[0];
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`${schema}.${table}`]); return rows[0].exists;
}
async function main() {
  const health = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
  const cells = health.cells.filter((cell) => cell.healthVerdict === 'READY_FOR_CANDLE_ONLY');
  const client = new Client(config); await client.connect();
  try {
    const outcomesExist = await exists(client, 'zone_outcomes');
    const reportCells = [];
    for (const cell of cells) {
      const table = CANDLE_TABLES[cell.tf];
      const candle = await client.query(`SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*)::int AS rows FROM ${table} WHERE symbol=$1`, [cell.symbol]);
      const c = candle.rows[0];
      const zones = await client.query(`SELECT COUNT(*)::int AS count, MIN(ts) AS first_ts, MAX(ts) AS last_ts, AVG(top-bottom) FILTER (WHERE top IS NOT NULL AND bottom IS NOT NULL) AS avg_height, percentile_cont(0.5) WITHIN GROUP (ORDER BY top-bottom) FILTER (WHERE top IS NOT NULL AND bottom IS NOT NULL) AS median_height, percentile_cont(0.9) WITHIN GROUP (ORDER BY top-bottom) FILTER (WHERE top IS NOT NULL AND bottom IS NOT NULL) AS p90_height, COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM ts) < 8)::int AS asia, COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM ts) >= 8 AND EXTRACT(HOUR FROM ts) < 16)::int AS london, COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM ts) >= 16)::int AS ny FROM features_zone WHERE symbol=$1 AND tf=$2 AND zone_kind='fvg'`, [cell.symbol, cell.tf]);
      const z = zones.rows[0];
      const days = c.first_ts && c.last_ts ? Math.max(1, (new Date(c.last_ts)-new Date(c.first_ts))/86400000) : 0;
      let outcomes = { available: outcomesExist, rows: null, fillRate: null, violationRate: null };
      if (outcomesExist) {
        const o = await client.query(`SELECT COUNT(*)::int AS rows, AVG(CASE WHEN outcome IN ('mitigated','reversal') THEN 1.0 ELSE 0 END) AS fill_rate, AVG(CASE WHEN outcome='invalidated' THEN 1.0 ELSE 0 END) AS violation_rate FROM zone_outcomes WHERE symbol=$1 AND tf=$2`, [cell.symbol, cell.tf]); outcomes = { available: true, rows: o.rows[0].rows, fillRate: o.rows[0].fill_rate, violationRate: o.rows[0].violation_rate };
      }
      reportCells.push({ symbol: cell.symbol, tf: cell.tf, candleRows: c.rows, period: { firstTs: c.first_ts, lastTs: c.last_ts, days }, fvgCount: Number(z.count), fvgPerDay: days ? Number(z.count)/days : null, geometry: { avgZoneHeight: z.avg_height, medianZoneHeight: z.median_height, p90ZoneHeight: z.p90_height }, outcomes, sessionDistribution: { asia: z.asia, london: z.london, ny: z.ny }, notes: 'Gap/ATR and spread/risk require candle-aligned ATR and spread joins; not inferred from zone height.' });
    }
    const report = { generatedAt: new Date().toISOString(), sourceHealth: healthPath, cells: reportCells };
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2)+'\n'); console.log(JSON.stringify({ output: outputPath, cells: reportCells.length, outcomesTable: outcomesExist }, null, 2));
  } finally { await client.end(); }
}
main().catch((error) => { console.error('[geometry-matrix] Fatal:', error.message); process.exitCode=1; });
