const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();

  // Update strat 1
  await c.query(`
    UPDATE strategy_families
    SET base_spec = jsonb_set(
      base_spec,
      '{setup}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'id' = 'htf_zone_fresh' THEN
              jsonb_set(jsonb_set(item, '{predicate}', '"zone_kind IN (''demand'', ''supply'') AND fill_pct < 0.8"'), '{lookbackBars}', '240')
            ELSE item
          END
        )
        FROM jsonb_array_elements(base_spec->'setup') AS item
      )
    )
    WHERE id = 'gold_scalp_1_ob_ifvg'
  `);
  console.log('Updated strat 1 base_spec');

  // Update strat 2
  await c.query(`
    UPDATE strategy_families
    SET base_spec = jsonb_set(
      base_spec,
      '{setup}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'id' = 'htf_demand_zone' THEN
              jsonb_set(jsonb_set(item, '{predicate}', '"zone_kind = ''demand'' AND fill_pct < 0.8"'), '{lookbackBars}', '240')
            ELSE item
          END
        )
        FROM jsonb_array_elements(base_spec->'setup') AS item
      )
    )
    WHERE id = 'gold_scalp_2_breaker_block'
  `);
  console.log('Updated strat 2 base_spec');

  // Update strat 3
  await c.query(`
    UPDATE strategy_families
    SET base_spec = jsonb_set(
      base_spec,
      '{setup}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'id' = 'htf_fvg_zone' THEN
              jsonb_set(jsonb_set(item, '{predicate}', '"zone_kind = ''fvg'' AND fill_pct < 0.8"'), '{lookbackBars}', '240')
            ELSE item
          END
        )
        FROM jsonb_array_elements(base_spec->'setup') AS item
      )
    )
    WHERE id = 'gold_scalp_3_choch_fvg'
  `);
  console.log('Updated strat 3 base_spec');

  // Verify
  const r = await c.query(`SELECT id, base_spec#>>'{setup}' as setup FROM strategy_families WHERE id LIKE 'gold\\_scalp%'`);
  r.rows.forEach(x => {
    console.log('\n' + x.id);
    const s = JSON.parse(x.setup || '[]');
    s.forEach(cc => console.log(' ', cc.id, '->', 'fill_pct' in (cc.predicate || '') ? 'predicate=' + cc.predicate : cc.predicate, 'lookbackBars=' + cc.lookbackBars));
  });

  await c.end();
})();
