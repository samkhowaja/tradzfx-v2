const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();

  // Update gold_scalp_1_ob_ifvg: relax fill_pct to <0.8, add lookbackBars=240
  await c.query(`
    UPDATE strategy_variants
    SET overrides = jsonb_set(
      jsonb_set(
        COALESCE(overrides, '{}'::jsonb),
        '{setup}',
        (
          SELECT jsonb_agg(
            CASE
              WHEN item->>'id' = 'htf_zone_fresh' THEN
                item || '{"predicate": "zone_kind IN (''demand'', ''supply'') AND fill_pct < 0.8", "lookbackBars": 240}'::jsonb
              ELSE item
            END
          )
          FROM jsonb_array_elements(
            COALESCE(overrides, '{}'::jsonb)->'setup',
            COALESCE(
              (SELECT base_spec->'setup' FROM strategy_families WHERE id = 'gold_scalp_1_ob_ifvg'),
              '[]'::jsonb
            )
          ) AS item
        )
      ),
      '{setup}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'id' = 'htf_zone_fresh' THEN
              item || '{"predicate": "zone_kind IN (''demand'', ''supply'') AND fill_pct < 0.8", "lookbackBars": 240}'::jsonb
            ELSE item
          END
        )
        FROM jsonb_array_elements(
          COALESCE(
            (SELECT base_spec->'setup' FROM strategy_families WHERE id = 'gold_scalp_1_ob_ifvg'),
            '[]'::jsonb
          )
        ) AS item
      )
    )
    WHERE id = 'gold_scalp_1_ob_ifvg'
  `);

  // Also update the base_spec in strategy_families
  await c.query(`
    UPDATE strategy_families
    SET base_spec = jsonb_set(
      jsonb_set(
        base_spec,
        '{setup}',
        (
          SELECT jsonb_agg(
            CASE
              WHEN item->>'id' = 'htf_zone_fresh' THEN
                item || '{"predicate": "zone_kind IN (''demand'', ''supply'') AND fill_pct < 0.8", "lookbackBars": 240}'::jsonb
              ELSE item
            END
          )
          FROM jsonb_array_elements(base_spec->'setup') AS item
        )
      ),
      '{setup}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'id' = 'htf_zone_fresh' THEN
              item || '{"predicate": "zone_kind IN (''demand'', ''supply'') AND fill_pct < 0.8", "lookbackBars": 240}'::jsonb
            ELSE item
          END
        )
        FROM jsonb_array_elements(base_spec->'setup') AS item
      )
    )
    WHERE id = 'gold_scalp_1_ob_ifvg'
  `);

  console.log('Updated gold_scalp_1_ob_ifvg in DB');

  // Verify
  const r = await c.query(`
    SELECT base_spec->'setup' as setup FROM strategy_families WHERE id = 'gold_scalp_1_ob_ifvg'
  `);
  const setup = r.rows[0]?.setup;
  if (setup) {
    const zoneCond = setup.find(s => s.id === 'htf_zone_fresh');
    console.log('Zone condition:', JSON.stringify(zoneCond));
  }

  await c.end();
})();
