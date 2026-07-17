const { Client } = require('pg');
const conn = process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2';
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();
  for (const tbl of ['features_sweep', 'features_structure']) {
    const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${tbl}'`);
    console.log(`\n${tbl}:`);
    console.log(r.rows.map(x => `  ${x.column_name} (${x.data_type})`).join('\n'));
  }
  await c.end();
})();
