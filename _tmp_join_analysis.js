require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({
  host: 'localhost', port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres', password: process.env.TM_DB_PASSWORD, max: 1,
});
(async () => {
  // Count push_pull by direction
  const { rows: pp } = await p.query(
    "SELECT direction, count(*)::int FROM features_push_pull WHERE symbol='XAUUSD' AND tf='1h' AND ts >= '2026-04-22' AND ts <= '2026-07-21' GROUP BY direction"
  );
  console.log('push_pull by direction:', pp);

  // Count candle_pattern by type/direction
  const { rows: cp } = await p.query(
    "SELECT direction, pattern_name, count(*)::int FROM features_candle_pattern WHERE symbol='XAUUSD' AND tf='1h' AND ts >= '2026-04-22' AND ts <= '2026-07-21' AND pattern_name IN ('pin_bar','engulfing_bull','engulfing_bear','hammer','hanging_man') GROUP BY direction, pattern_name ORDER BY count DESC LIMIT 20"
  );
  console.log('candle_pattern by type/direction:', cp);

  // Join push_pull + candle_pattern same bar
  const { rows: jn } = await p.query(`
    SELECT pp.direction, pp.pattern_name as pp_pattern, cp.pattern_name as cp_pattern, pp.ts
    FROM features_push_pull pp
    JOIN features_candle_pattern cp ON cp.symbol=pp.symbol AND cp.tf=pp.tf AND cp.ts=pp.ts
    WHERE pp.symbol='XAUUSD' AND pp.tf='1h'
      AND pp.ts >= '2026-04-22' AND pp.ts <= '2026-07-21'
      AND cp.pattern_name IN ('pin_bar','engulfing_bull','engulfing_bear','hammer','hanging_man')
      AND cp.direction = pp.direction
    ORDER BY pp.ts DESC
  `);
  console.log('push_pull + candle_pattern same bar (same direction):', jn.length);
  if (jn.length > 0) console.table(jn.slice(0, 10));

  // Also check bias direction overlap
  const { rows: bias } = await p.query(
    "SELECT direction, count(*)::int FROM features_bias WHERE symbol='XAUUSD' AND tf='1d' AND ts >= '2026-04-22' AND ts <= '2026-07-21' AND direction != 'neutral' GROUP BY direction"
  );
  console.log('daily bias (non-neutral) by direction:', bias);

  await p.end();
})();
