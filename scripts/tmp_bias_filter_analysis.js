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
      o.outcome_r,
      o.created_at ts,
      (SELECT direction FROM features_bias b 
       WHERE b.symbol = o.symbol AND b.tf = '15m' AND b.ts <= o.created_at
       ORDER BY b.ts DESC LIMIT 1) bias
    FROM orders o
    JOIN strategy_variants v ON v.id = o.variant_id
    JOIN strategy_families f ON f.id = v.family_id
    WHERE o.status = 'closed'
  `);

  const grouped = {};
  for (const row of r.rows) {
    if (!row.bias) continue;
    const aligned =
      (row.side === "buy" && row.bias === "bullish") ||
      (row.side === "sell" && row.bias === "bearish");
    const key = `${row.family}|${aligned ? "aligned" : "against"}`;
    if (!grouped[key]) grouped[key] = { total: 0, wins: 0, net: 0 };
    grouped[key].total++;
    grouped[key].net += parseFloat(row.outcome_r);
    if (parseFloat(row.outcome_r) > 0) grouped[key].wins++;
  }

  for (const [k, v] of Object.entries(grouped).sort()) {
    console.log(
      k,
      "total",
      v.total,
      "wins",
      v.wins,
      "net",
      v.net.toFixed(2),
      "win%",
      ((v.wins / v.total) * 100).toFixed(1)
    );
  }
  await pool.end();
})();
