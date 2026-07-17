const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradzfx_v2",
  user: "postgres",
  password: "2k16Dub@i",
});

async function main() {
  try {
    const symbols = ['EURUSD','GBPUSD','AUDUSD','NZDUSD','USDCAD','USDCHF','USDJPY','XAUUSD'];
    
    // Check zone unmitigated for ALL symbols
    for (const sym of symbols) {
      for (const tf of ['5m','15m','1m']) {
        const r = await pool.query(`
          SELECT zone_kind, direction, count(*)::int, max(ts) as latest_ts
          FROM features_zone
          WHERE symbol=$1 AND tf=$2 AND ts > NOW() - INTERVAL '24 hours'
            AND mitigated_at IS NULL
            AND invalidated_at IS NULL
          GROUP BY zone_kind, direction ORDER BY zone_kind, direction
        `, [sym, tf]);
        if (r.rows.length > 0) {
          console.log(`ZONE ${sym} ${tf} unmitigated (24h):`, JSON.stringify(r.rows));
        } else {
          // Also check total including mitigated
          const r2 = await pool.query(`
            SELECT count(*)::int as total, 
              (SELECT count(*)::int FROM features_zone WHERE symbol=$1 AND tf=$2 AND ts > NOW() - INTERVAL '24 hours' AND mitigated_at IS NULL AND invalidated_at IS NULL) as unmitigated
            FROM features_zone WHERE symbol=$1 AND tf=$2 AND ts > NOW() - INTERVAL '24 hours'
          `, [sym, tf]);
          if (r2.rows[0].total > 0) {
            console.log(`ZONE ${sym} ${tf} (24h): total=${r2.rows[0].total}, unmitigated=${r2.rows[0].unmitigated}`);
          }
        }
      }
    }

    // Check bias for ALL symbols
    for (const sym of symbols) {
      for (const tf of ['5m','15m','1h']) {
        const r = await pool.query(`
          SELECT direction, count(*)::int, max(ts) as latest_ts
          FROM features_bias
          WHERE symbol=$1 AND tf=$2 AND direction != 'neutral' AND ts > NOW() - INTERVAL '48 hours'
          GROUP BY direction ORDER BY direction
        `, [sym, tf]);
        if (r.rows.length > 0) {
          console.log(`BIAS ${sym} ${tf} non-neutral (48h):`, JSON.stringify(r.rows));
        }
      }
    }

    // Check structure for XAUUSD
    const r3 = await pool.query(`
      SELECT event_type, direction, count(*)::int, max(ts) as latest_ts
      FROM features_structure
      WHERE symbol='XAUUSD' AND tf='5m' AND ts > NOW() - INTERVAL '48 hours'
      GROUP BY event_type, direction ORDER BY event_type, direction
    `);
    console.log("STRUCTURE XAUUSD 5m (48h):", JSON.stringify(r3.rows));

    // Check opening_range for symbols needed by orb strategies
    for (const sym of ['XAUUSD','EURUSD','GBPUSD']) {
      const r4 = await pool.query(`
        SELECT ts, direction, high, low, session
        FROM features_opening_range
        WHERE symbol=$1 AND ts > NOW() - INTERVAL '48 hours'
        ORDER BY ts DESC LIMIT 5
      `, [sym]);
      if (r4.rows.length > 0) {
        console.log(`OPENING_RANGE ${sym} (48h):`, JSON.stringify(r4.rows));
      } else {
        console.log(`OPENING_RANGE ${sym} (48h): NO DATA`);
      }
    }

  } catch (e) {
    console.error("ERROR:", e.message);
  }
  await pool.end();
}

main();
