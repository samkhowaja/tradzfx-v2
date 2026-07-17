const {Client} = require('pg');
const conn = process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2';

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();
  const names = [
    'Gold Scalp 1 \u2014 HTF Order Block + iFVG Entry',
    'Gold Scalp 2 \u2014 Supply/Demand + Breaker Block',
    'Gold Scalp 3 \u2014 HTF CHoCH + FVG + iFVG',
  ];
  for (const name of names) {
    const r = await c.query(`SELECT name, jsonb_array_length(base_spec->'entry') as ec, base_spec->'entry' as ej FROM strategy_families WHERE name=$1`, [name]);
    if (!r.rows.length) { console.log(`\n=== ${name}: NOT FOUND ===`); continue; }
    const row = r.rows[0];
    console.log(`\n=== ${row.name} ===`);
    console.log(`  entry count: ${row.ec}`);
    if (row.ej) {
      for (const [i, e] of row.ej.entries()) {
        console.log(`  [${i}] id=${e.id} feature=${e.feature} tf=${e.tf} required=${e.required} pred="${e.predicate}" lookbackBars=${e.lookbackBars ?? 'default'} weight=${e.weight}`);
      }
    }
  }
  await c.end();
})();
