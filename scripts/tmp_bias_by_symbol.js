const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

(async () => {
  const r = await pool.query(`
    SELECT 
      f.id family,
      o.symbol,
      o.side,
      COUNT(*) total,
      SUM(CASE WHEN o.outcome_r>0 THEN 1 ELSE 0 END) wins,
      SUM(o.outcome_r) net_r
    FROM orders o
    JOIN strategy_variants v ON v.id=o.variant_id
    JOIN strategy_families f ON f.id=v.family_id
    WHERE o.status='closed'
    GROUP BY f.id, o.symbol, o.side
    ORDER BY f.id, o.symbol, o.side
  `);
  for (const row of r.rows) {
    if (row.total < 3) continue;
    console.log(
      row.family,
      row.symbol,
      row.side,
      "total",
      row.total,
      "wins",
      row.wins,
      "net",
      Number(row.net_r).toFixed(2)
    );
  }
  await pool.end();
})();
