const {Client} = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();

  // Replicate EXACT compiler entry SQL for strat 3
  // Only required entry: ifvg_reversal (features_ifvg, 15m, bullish)
  const sql = `
    WITH bias_candidates AS (
      SELECT symbol, ts, direction
      FROM features_bias
      WHERE tf = '1h' AND symbol = 'XAUUSD'
        AND ts >= '2026-06-13T00:00:00Z'::timestamptz
        AND ts <= '2026-07-13T00:00:00Z'::timestamptz
    ),
    setup_candidates AS (
      SELECT b.symbol, b.ts, b.direction as bias_direction
      FROM bias_candidates b
      WHERE (b.direction = 'bullish')
        AND EXISTS (SELECT 1 FROM features_structure WHERE symbol = b.symbol AND tf = '1h'
          AND ts <= b.ts AND ts >= b.ts - interval '10 days'
          AND event_type = 'bos' AND direction = 'bullish')
        AND EXISTS (SELECT 1 FROM features_zone WHERE symbol = b.symbol AND tf = '1h'
          AND ts <= b.ts AND ts >= b.ts - interval '240 hours'
          AND zone_kind = 'fvg' AND (fill_pct IS NULL OR fill_pct < 0.8)
          AND (mitigated_at IS NULL OR mitigated_at > b.ts)
          AND (invalidated_at IS NULL OR invalidated_at > b.ts))
    ),
    entry_candidates AS (
      SELECT DISTINCT ON (s.symbol, s.ts) s.symbol, s.ts, s.bias_direction
      FROM setup_candidates s
      , LATERAL (
          SELECT DISTINCT ON (symbol, direction) *
          FROM features_ifvg
          WHERE symbol = s.symbol AND tf = '15m'
            AND ts <= s.ts AND ts >= s.ts - interval '24 hours'
            AND direction = 'bullish'
            AND (invalidated_at IS NULL OR invalidated_at > s.ts)
            AND mitigated_at IS NULL
          ORDER BY symbol, direction, strength_score DESC NULLS LAST, ts DESC
        ) AS pit_ltf_ifvg_reversal
      WHERE (TRUE)
    )
    SELECT count(*) as cnt FROM entry_candidates
  `;
  const result = await c.query(sql);
  console.log('entry_candidates count:', result.rows[0].cnt);
  
  // Check setup only
  const r2 = await c.query(`
    SELECT count(*) as cnt FROM (
      SELECT b.ts FROM features_bias b
      WHERE b.tf='1h' AND b.symbol='XAUUSD' AND b.direction='bullish'
        AND b.ts >= '2026-06-13T00:00:00Z'::timestamptz
        AND b.ts <= '2026-07-13T00:00:00Z'::timestamptz
        AND EXISTS (SELECT 1 FROM features_structure st WHERE st.symbol=b.symbol AND st.tf='1h'
          AND st.ts<=b.ts AND st.ts>=b.ts-interval '10 days'
          AND st.event_type='bos' AND st.direction='bullish')
        AND EXISTS (SELECT 1 FROM features_zone z WHERE z.symbol=b.symbol AND z.tf='1h'
          AND z.ts<=b.ts AND z.ts>=b.ts-interval '240 hours'
          AND z.zone_kind='fvg' AND (z.fill_pct IS NULL OR z.fill_pct<0.8)
          AND (z.mitigated_at IS NULL OR z.mitigated_at>b.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at>b.ts))
    ) sub
  `);
  console.log('setup_candidates count:', r2.rows[0].cnt);

  // Check bias only
  const r3 = await c.query(`SELECT count(*) as cnt FROM features_bias WHERE tf='1h' AND symbol='XAUUSD' AND direction='bullish' AND ts>='2026-06-13' AND ts<='2026-07-13'`);
  console.log('bias_candidates count:', r3.rows[0].cnt);

  await c.end();
})();
