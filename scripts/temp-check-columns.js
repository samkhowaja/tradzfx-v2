const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
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
