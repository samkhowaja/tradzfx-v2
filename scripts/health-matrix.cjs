#!/usr/bin/env node
const fs = require('node:fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: '.env.local' });

const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const CANDLE_TABLES = {
  '1m': 'market.candles_1m_canonical',
  '5m': 'market.candles_5m_canonical',
  '15m': 'market.candles_15m_canonical',
  '1h': 'market.candles_1h_canonical',
  '4h': 'market.candles_4h_canonical',
  '1d': 'market.candles_1d_utc_canonical',
};
const FEATURE_TABLES = [
  'features_zone', 'features_atr', 'features_pivot', 'features_structure',
  'features_sweep', 'features_displacement', 'features_order_block',
  'features_bias', 'features_direction_state', 'features_opening_range',
  'features_zone_retest', 'features_ifvg', 'features_pricing',
  'features_moving_average', 'features_candle_pattern', 'features_push_pull',
  'features_liquidity_event_v2', 'features_session', 'features_spread',
];
const CONTAMINATED_FEATURES = new Set([
  'features_pivot', 'features_structure', 'features_sweep', 'features_bias',
  'features_direction_state', 'features_zone_retest', 'features_ifvg',
  'features_order_block', 'features_pricing', 'features_push_pull',
  'features_liquidity_event_v2',
]);
const STALE_HOURS = Number(process.env.HEALTH_MATRIX_STALE_HOURS || 48);

function dbConfig() {
  return {
    host: process.env.TM_DB_HOST || 'localhost',
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: process.env.TM_DB_USER || 'postgres',
    password: process.env.TM_DB_PASSWORD,
  };
}

async function relationExists(client, relation) {
  const parts = relation.split('.');
  const schema = parts.length === 2 ? parts[0] : 'public';
  const table = parts.length === 2 ? parts[1] : parts[0];
  const { rows } = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`${schema}.${table}`],
  );
  return rows[0].exists;
}

async function stats(client, relation, symbol, tf, whereExtra = '', candleRelation = false) {
  const timeframeFilter = candleRelation ? '' : ' AND tf = $2';
  const params = candleRelation ? [symbol] : [symbol, tf];
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
       FROM ${relation}
      WHERE symbol = $1 ${timeframeFilter} ${whereExtra}`,
    params,
  );
  return rows[0];
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  const client = new Client(dbConfig());
  await client.connect();
  try {
    const symbolsResult = await client.query(`SELECT DISTINCT symbol FROM ${CANDLE_TABLES['1m']} ORDER BY symbol`);
    const symbols = symbolsResult.rows.map((row) => row.symbol).filter(Boolean);
    const cells = [];

    for (const symbol of symbols) {
      for (const tf of TFS) {
        const candleTable = CANDLE_TABLES[tf];
        const candleExists = await relationExists(client, candleTable);
        const cell = {
          symbol, tf, candleTable, candleCount: 0, firstTs: null, lastTs: null,
          latestAgeHours: null, features: {}, missingTables: [], causalStatus: 'CONTAMINATED_STRUCTURE',
          healthVerdict: 'NO_DATA', notes: 'Read-only health check; no repair or seeding performed.',
        };
        if (!candleExists) {
          cell.missingTables.push(candleTable);
          cells.push(cell);
          continue;
        }
        const candle = await stats(client, candleTable, symbol, tf, '', true);
        cell.candleCount = candle.rows;
        cell.firstTs = candle.first_ts;
        cell.lastTs = candle.last_ts;
        cell.latestAgeHours = candle.last_ts ? (Date.now() - new Date(candle.last_ts).getTime()) / 3600000 : null;
        if (!candle.rows) {
          cells.push(cell);
          continue;
        }
        for (const feature of FEATURE_TABLES) {
          const exists = await relationExists(client, feature);
          if (!exists) {
            cell.missingTables.push(feature);
            cell.features[feature] = { rows: 0, latestAgeHours: null, status: 'MISSING_TABLE', causalStatus: CONTAMINATED_FEATURES.has(feature) ? 'CONTAMINATED' : 'UNKNOWN' };
            continue;
          }
          const featureStats = await stats(client, feature, symbol, tf);
          const age = featureStats.last_ts ? (Date.now() - new Date(featureStats.last_ts).getTime()) / 3600000 : null;
          cell.features[feature] = { rows: featureStats.rows, firstTs: featureStats.first_ts, lastTs: featureStats.last_ts, latestAgeHours: age, status: featureStats.rows && age !== null && age <= STALE_HOURS ? 'READY' : featureStats.rows ? 'STALE' : 'EMPTY', causalStatus: CONTAMINATED_FEATURES.has(feature) ? 'CONTAMINATED' : 'UNKNOWN' };
        }
        const zone = cell.features.features_zone;
        if (!zone || zone.status === 'MISSING_TABLE' || zone.status === 'EMPTY') cell.healthVerdict = 'MISSING_REQUIRED_FEATURE';
        else if (cell.latestAgeHours === null || cell.latestAgeHours > STALE_HOURS) cell.healthVerdict = 'STALE_DATA';
        else cell.healthVerdict = 'READY_FOR_CANDLE_ONLY';
        cell.notes += ' Stored FVG zones may inherit features_zone causal contamination.';
        cells.push(cell);
      }
    }
    const report = { generatedAt: new Date().toISOString(), staleHours: STALE_HOURS, symbols, timeframes: TFS, cells };
    const serialized = JSON.stringify(report, null, 2);
    if (output) fs.writeFileSync(output, serialized + '\n');
    console.log(serialized);
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error('[health-matrix] Fatal:', error.message); process.exitCode = 1; });
