const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2' });

async function main() {
  // How many structure BOS bullish 1h events across the full range?
  const structBiasCheck = await pool.query(`
    SELECT date_trunc('day', b.ts) as day,
      count(*) as total_bias,
      sum(CASE WHEN s.ts IS NOT NULL THEN 1 ELSE 0 END) as with_struct,
      sum(CASE WHEN s.ts IS NOT NULL AND z.ts IS NOT NULL THEN 1 ELSE 0 END) as with_struct_zone,
      sum(CASE WHEN s.ts IS NOT NULL AND z.ts IS NOT NULL AND i.ts IS NOT NULL THEN 1 ELSE 0 END) as full_setup_with_ifvg
    FROM features_bias b
    CROSS JOIN LATERAL (
      SELECT ts FROM features_structure
      WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '8 hours'
        AND event_type = 'bos' AND direction = 'bullish'
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, event_type, direction, strength DESC NULLS LAST, ts DESC
      LIMIT 1
    ) s
    LEFT JOIN LATERAL (
      SELECT ts FROM features_zone
      WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '10 days'
        AND zone_kind = 'fvg' AND fill_pct < 0.8
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC
      LIMIT 1
    ) z ON true
    LEFT JOIN LATERAL (
      SELECT ts FROM features_ifvg
      WHERE symbol = b.symbol AND tf = '15m'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '1 days'
        AND direction = 'bullish'
        AND (mitigated_at IS NULL OR mitigated_at > b.ts)
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, direction, strength_score DESC NULLS LAST, ts DESC
      LIMIT 1
    ) i ON true
    WHERE b.tf = '1h' AND b.symbol = 'XAUUSD' AND b.direction = 'bullish'
      AND b.ts >= '2026-06-13' AND b.ts <= '2026-07-13'
      AND (EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 420 AND 660
        OR EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 780 AND 990)
    GROUP BY 1 ORDER BY 1
  `);
  
  console.log('=== Daily breakdown (full compiler conditions) ===');
  structBiasCheck.rows.forEach(r => {
    console.log(`  ${r.day.toISOString().slice(0,10)}: bias=${r.total_bias} with_struct=${r.with_struct} with_struct_zone=${r.with_struct_zone} full_setup_ifvg=${r.full_setup_with_ifvg}`);
  });

  // Total
  const totalRow = structBiasCheck.rows.reduce((a, r) => ({
    total_bias: a.total_bias + Number(r.total_bias),
    with_struct: a.with_struct + Number(r.with_struct),
    with_struct_zone: a.with_struct_zone + Number(r.with_struct_zone),
    full_setup_with_ifvg: a.full_setup_with_ifvg + Number(r.full_setup_with_ifvg),
  }), { total_bias: 0, with_struct: 0, with_struct_zone: 0, full_setup_with_ifvg: 0 });
  
  console.log(`\n=== Totals ===`);
  console.log(`  bias: ${totalRow.total_bias}`);
  console.log(`  +structure: ${totalRow.with_struct} (${(totalRow.with_struct/totalRow.total_bias*100).toFixed(1)}%)`);
  console.log(`  +zone: ${totalRow.with_struct_zone} (${(totalRow.with_struct_zone/totalRow.total_bias*100).toFixed(1)}%)`);
  console.log(`  +ifvg: ${totalRow.full_setup_with_ifvg} (${(totalRow.full_setup_with_ifvg/totalRow.total_bias*100).toFixed(1)}%)`);

  // Key question: are there any bias rows with structure+zone AFTER July 3?
  const lateSetupCheck = await pool.query(`
    SELECT b.ts as bias_ts
    FROM features_bias b
    CROSS JOIN LATERAL (
      SELECT ts FROM features_structure
      WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '8 hours'
        AND event_type = 'bos' AND direction = 'bullish'
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, event_type, direction, strength DESC NULLS LAST, ts DESC LIMIT 1
    ) s ON true
    CROSS JOIN LATERAL (
      SELECT ts FROM features_zone
      WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '10 days'
        AND zone_kind = 'fvg' AND fill_pct < 0.8
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC LIMIT 1
    ) z ON true
    WHERE b.tf = '1h' AND b.symbol = 'XAUUSD' AND b.direction = 'bullish'
      AND b.ts >= '2026-07-03' AND b.ts <= '2026-07-13'
      AND (EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 420 AND 660
        OR EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 780 AND 990)
    ORDER BY b.ts
  `);
  console.log(`\n=== Setup matches after July 3: ${lateSetupCheck.rows.length} ===`);
  if (lateSetupCheck.rows.length > 0) {
    lateSetupCheck.rows.forEach(r => console.log(`  bias=${r.bias_ts.toISOString()}`));
  }

  // Alternative: try with wider structure lookback 96h
  console.log('\n=== Wider structure lookback test ===');
  const wideCheck = await pool.query(`
    SELECT date_trunc('day', b.ts) as day, count(*) as cnt
    FROM features_bias b
    CROSS JOIN LATERAL (
      SELECT ts FROM features_structure
      WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '96 hours'
        AND event_type = 'bos' AND direction = 'bullish'
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, event_type, direction, strength DESC NULLS LAST, ts DESC LIMIT 1
    ) s ON true
    CROSS JOIN LATERAL (
      SELECT ts FROM features_zone
      WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '10 days'
        AND zone_kind = 'fvg' AND fill_pct < 0.8
        AND (invalidated_at IS NULL OR invalidated_at > b.ts)
      ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC LIMIT 1
    ) z ON true
    WHERE b.tf = '1h' AND b.symbol = 'XAUUSD' AND b.direction = 'bullish'
      AND b.ts >= '2026-06-13' AND b.ts <= '2026-07-13'
      AND (EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 420 AND 660
        OR EXTRACT(HOUR FROM b.ts) * 60 + EXTRACT(MINUTE FROM b.ts) BETWEEN 780 AND 990)
    GROUP BY 1 ORDER BY 1
  `);
  console.log('Setup w/ 96h structure lookback:');
  wideCheck.rows.forEach(r => console.log(`  ${r.day.toISOString().slice(0,10)}: ${r.cnt}`));

  // What about setting entry lookbackBars to cover POST-setup time?
  // Actually, the logic requires iFVG before or at setup ts.
  // Let's check: does any setup HAVE an iFVG before it, even if we ignore temporal constraint?
  console.log('\n=== How many total iFVG bullish exist ===');
  const ifvgCounts = await pool.query(`
    SELECT date_trunc('day', ts) as day, count(*) as cnt
    FROM features_ifvg
    WHERE symbol='XAUUSD' AND tf='15m' AND direction='bullish'
      AND ts >= '2026-06-13' AND ts <= '2026-07-13'
    GROUP BY 1 ORDER BY 1
  `);
  ifvgCounts.rows.forEach(r => console.log(`  ${r.day.toISOString().slice(0,10)}: ${r.cnt}`));
  
  await pool.end();
}

main().catch(console.error);
