require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({ host: 'localhost', port: 5432, database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });
const VERSION = 'candle-detector-v3-robust';

function isTradableInstant(ts, symbol) {
  const d = new Date(ts);
  const dow = d.getUTCDay();
  const hour = d.getUTCHours();
  if (dow === 6 || (dow === 0 && hour < 21) || (dow === 5 && hour >= 21)) return false;
  if (symbol === 'XAUUSD' && hour === 21 && d.getUTCMinutes() === 0) return false;
  return true;
}

function unexpectedGap(prevTs, ts, symbol) {
  if (!prevTs || ts - prevTs <= 2 * 60 * 60 * 1000) return false;
  // A gap is suspicious only when its midpoint is tradable. Weekend and
  // configured daily-break closures are expected feed gaps.
  return isTradableInstant(new Date((prevTs.getTime() + ts.getTime()) / 2), symbol);
}

function robustJumpThreshold(symbol, medianReturn, madReturn) {
  const floor = symbol === 'DXY' ? 0.02 : 0.005;
  return Math.max(floor, (medianReturn ?? 0) + 8 * (madReturn ?? 0));
}

function isRobustJump(symbol, absoluteReturn, medianReturn, madReturn) {
  return absoluteReturn != null && absoluteReturn > robustJumpThreshold(symbol, medianReturn, madReturn);
}

async function main() {
  const write = process.argv.includes('--write');
  const details = process.argv.includes('--details');
  const compare = process.argv.includes('--compare');
  const symbolArg = process.argv.find(arg => arg.startsWith('--symbol='))?.split('=')[1] || null;
  const daysArg = Number(process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1] || 0);
  const filters = [];
  const params = [];
  if (symbolArg) {
    params.push(symbolArg);
    filters.push(`symbol = $${params.length}`);
  }
  if (daysArg > 0) filters.push(`ts >= now() - ($${params.push(daysArg)} * interval '1 day')`);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      WITH x AS (
         SELECT symbol, broker, ts, o, h, l, c, spread,
           lag(c) OVER (PARTITION BY symbol, raw.effective_broker_identity(broker) ORDER BY ts) prev_c,
           lag(ts) OVER (PARTITION BY symbol, raw.effective_broker_identity(broker) ORDER BY ts) prev_ts
        FROM candles_1m
      ), returns_base AS (
          SELECT x.*, abs(c-prev_c) / NULLIF(abs(prev_c),0) AS abs_return
          FROM x
      ), baselines AS (
        SELECT symbol, raw.effective_broker_identity(broker) AS effective_broker,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY abs_return) AS median_return
        FROM returns_base
        WHERE abs_return IS NOT NULL
        GROUP BY symbol, raw.effective_broker_identity(broker)
      ), deviations AS (
        SELECT r.symbol, r.broker,
               percentile_cont(0.5) WITHIN GROUP
                 (ORDER BY abs(r.abs_return - b.median_return)) AS mad_return
        FROM returns_base r
        JOIN baselines b ON b.symbol = r.symbol
          AND b.effective_broker = raw.effective_broker_identity(r.broker)
        WHERE r.abs_return IS NOT NULL
        GROUP BY r.symbol, r.broker
      ), returns AS (
        SELECT r.*, b.median_return, d.mad_return
        FROM returns_base r
        LEFT JOIN baselines b ON b.symbol = r.symbol
          AND b.effective_broker = raw.effective_broker_identity(r.broker)
        LEFT JOIN deviations d
          ON d.symbol = r.symbol AND d.broker = r.broker
      ), evidence AS (
        SELECT *, ARRAY_REMOVE(ARRAY[
          CASE WHEN h < l OR h < GREATEST(o,c) OR l > LEAST(o,c) THEN 'INVALID_OHLC' END,
          CASE WHEN spread < 0 THEN 'IMPOSSIBLE_SPREAD' END,
          CASE WHEN prev_c IS NOT NULL
                 AND abs(c-prev_c) / NULLIF(abs(prev_c),0) > GREATEST(
                   CASE WHEN symbol = 'DXY' THEN 0.02 ELSE 0.005 END,
                   COALESCE(median_return + 8 * mad_return, 0)
                 )
               THEN 'LARGE_JUMP_ROBUST' END,
              CASE WHEN prev_ts IS NOT NULL AND ts-prev_ts > interval '2 hours'
                AND EXTRACT(DOW FROM (prev_ts + (ts-prev_ts)/2)) NOT IN (0,6)
                AND NOT (EXTRACT(DOW FROM (prev_ts + (ts-prev_ts)/2)) = 5
                 AND EXTRACT(HOUR FROM (prev_ts + (ts-prev_ts)/2)) >= 21)
                AND NOT (symbol = 'XAUUSD'
                         AND EXTRACT(HOUR FROM (prev_ts + (ts-prev_ts)/2)) >= 21
                         AND EXTRACT(HOUR FROM (prev_ts + (ts-prev_ts)/2)) < 22)
               THEN 'UNEXPECTED_GAP' END
        ], NULL) flags
        FROM returns
      )
            SELECT symbol, broker, ts, o, h, l, c, prev_c, prev_ts,
              abs_return, median_return, mad_return,
              GREATEST(CASE WHEN symbol = 'DXY' THEN 0.02 ELSE 0.005 END,
             COALESCE(median_return + 8 * mad_return, 0)) AS jump_threshold,
              flags,
             CASE WHEN 'INVALID_OHLC' = ANY(flags) THEN 'CRITICAL'
                  WHEN 'LARGE_JUMP_ROBUST' = ANY(flags) THEN 'HIGH'
                  ELSE 'MEDIUM' END severity
      FROM evidence
      WHERE cardinality(flags) > 0
      ${where ? `AND ${where.slice(6).replace(/\bts\b/g, 'evidence.ts').replace(/\bsymbol\b/g, 'evidence.symbol')}` : ''}
      ORDER BY symbol, broker, ts
    `, params);
    const counts = {};
    const byFlag = {};
    for (const r of rows) {
      const key = `${r.symbol}|${r.broker}`;
      counts[key] = (counts[key] || 0) + 1;
      for (const flag of r.flags) byFlag[flag] = (byFlag[flag] || 0) + 1;
      if (write) await client.query(`
        INSERT INTO candle_quarantine
          (symbol, broker, timeframe, event_time, raw_source_key, flags, severity, detector_version, detector_params)
        VALUES ($1,$2,'1m',$3,$4,$5,$6,$7,$8)
        ON CONFLICT (symbol, broker, timeframe, event_time, detector_version) DO UPDATE
          SET flags=EXCLUDED.flags, severity=EXCLUDED.severity, detector_params=EXCLUDED.detector_params
      `, [r.symbol, r.broker, r.ts, `${r.symbol}|${r.broker}|${r.ts.toISOString()}`, r.flags, r.severity, VERSION,
          { relativeFloor: r.symbol === 'DXY' ? 0.02 : 0.005, madMultiplier: 8, lookbackBars: 60 }]);
    }
    const result = { detectorVersion: VERSION, write, total: rows.length, bySource: counts, byFlag };
    if (details) result.findings = rows;
    if (compare) {
      const keys = rows.map(r => [r.symbol, r.broker, r.ts]);
      const legacy = keys.length === 0 ? { rows: [] } : await client.query(`
        SELECT symbol, broker, event_time, detector_version, flags
        FROM candle_quarantine
        WHERE detector_version LIKE 'candle-detector-v2%'
          AND (symbol, broker, event_time) IN (${keys.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',')})
      `, keys.flat());
      const legacyKeys = new Set(legacy.rows.map(r => `${r.symbol}|${r.broker}|${new Date(r.event_time).toISOString()}`));
      result.comparison = {
        v3Findings: rows.length,
        overlapWithV2: rows.filter(r => legacyKeys.has(`${r.symbol}|${r.broker}|${new Date(r.ts).toISOString()}`)).length,
        v3Only: rows.filter(r => !legacyKeys.has(`${r.symbol}|${r.broker}|${new Date(r.ts).toISOString()}`)).length,
        v2EvidenceAtV3Timestamps: legacy.rows.length,
      };
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { client.release(); await pool.end(); }
}
if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { isTradableInstant, unexpectedGap, robustJumpThreshold, isRobustJump };
