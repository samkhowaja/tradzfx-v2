const {Client} = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();
  const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='strategy_families' ORDER BY ordinal_position");
  r.rows.forEach(x => console.log(x.column_name));
  await c.end();
})();
