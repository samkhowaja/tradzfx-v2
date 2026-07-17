require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});
(async () => {
  // Check order_block columns
  const r = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='features_order_block'");
  console.log("order_block columns:", r.rows.map(x=>x.column_name).join(", "));
  
  const r2 = await pool.query("SELECT DISTINCT ob_kind,degree FROM features_order_block WHERE symbol='XAUUSD' LIMIT 20");
  console.log("ob_kind,degree samples:", JSON.stringify(r2.rows));
  
  const r3 = await pool.query("SELECT ob_kind,COUNT(*)::int as n FROM features_order_block WHERE symbol='XAUUSD' GROUP BY ob_kind ORDER BY n DESC");
  console.log("ob_kind counts:", JSON.stringify(r3.rows));
  
  const r4 = await pool.query("SELECT degree,COUNT(*)::int as n FROM features_order_block WHERE symbol='XAUUSD' GROUP BY degree ORDER BY n DESC");
  console.log("degree counts:", JSON.stringify(r4.rows));
  
  const r5 = await pool.query("SELECT DISTINCT event_type,direction FROM features_structure WHERE symbol='XAUUSD' AND tf='15m'");
  console.log("structure@15m event_type/direction:", JSON.stringify(r5.rows));
  
  const r6 = await pool.query("SELECT DISTINCT direction FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m'");
  console.log("ifvg@5m direction:", JSON.stringify(r6.rows));
  
  const r7 = await pool.query("SELECT fill_pct,COUNT(*)::int as n FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m' GROUP BY fill_pct ORDER BY n DESC LIMIT 10");
  console.log("ifvg fill_pct:", JSON.stringify(r7.rows));
  
  // Check bias direction
  const r8 = await pool.query("SELECT DISTINCT direction,COUNT(*)::int as n FROM features_bias WHERE symbol='XAUUSD' AND tf='15m' AND ts > now()-interval'2 days' GROUP BY direction");
  console.log("bias@15m recent:", JSON.stringify(r8.rows));

  // Check zone kinds in 15m
  const r9 = await pool.query("SELECT DISTINCT zone_kind,COUNT(*)::int as n FROM features_zone WHERE symbol='XAUUSD' AND tf='15m' AND ts > now()-interval'30 days' GROUP BY zone_kind ORDER BY n DESC");
  console.log("zone@15m kinds (30d):", JSON.stringify(r9.rows));
  
  await pool.end();
})();
