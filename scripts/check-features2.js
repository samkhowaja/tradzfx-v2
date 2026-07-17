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
  const r1 = await pool.query("SELECT direction,count(*)::int as n FROM features_bias WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 GROUP BY direction ORDER BY n DESC", ["XAUUSD","15m","2026-06-13","2026-07-13"]);
  console.log("bias@15m 30d:", JSON.stringify(r1.rows));

  const r2 = await pool.query("SELECT count(*)::int as n FROM features_bias WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4", ["XAUUSD","15m","2026-06-13","2026-07-13"]);
  console.log("total bias@15m:", r2.rows[0].n);

  const r3 = await pool.query("SELECT is_fresh,count(*)::int as n FROM features_order_block WHERE symbol=$1 AND tf=$2 AND ts>=$3 GROUP BY is_fresh", ["XAUUSD","15m","2026-06-13"]);
  console.log("ob@15m is_fresh:", JSON.stringify(r3.rows));

  const r4 = await pool.query("SELECT count(*)::int as n FROM features_order_block WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4", ["XAUUSD","15m","2026-06-13","2026-07-13"]);
  console.log("ob total in window:", r4.rows[0].n);

  const r5 = await pool.query("SELECT count(*)::int as n FROM features_ifvg WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 AND fill_pct>=0.3 AND is_fresh=true", ["XAUUSD","5m","2026-06-13","2026-07-13"]);
  console.log("ifvg@5m fresh fill>=0.3:", r5.rows[0].n);

  const r6 = await pool.query("SELECT count(*)::int as n FROM features_ifvg WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4", ["XAUUSD","5m","2026-06-13","2026-07-13"]);
  console.log("ifvg total:", r6.rows[0].n);

  // Check zone is_fresh in window
  const r7 = await pool.query("SELECT is_fresh,count(*)::int as n FROM features_zone WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 GROUP BY is_fresh", ["XAUUSD","15m","2026-06-13","2026-07-13"]);
  console.log("zone@15m is_fresh:", JSON.stringify(r7.rows));

  // zone fill_pct distribution
  const r8 = await pool.query("SELECT fill_pct,count(*)::int as n FROM features_zone WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 AND fill_pct IS NOT NULL AND is_fresh=true GROUP BY fill_pct ORDER BY n DESC LIMIT 10", ["XAUUSD","15m","2026-06-13","2026-07-13"]);
  console.log("zone@15m fresh fill_pct:", JSON.stringify(r8.rows));

  // Check order_block ob_kind = bias direction join condition feasibility
  const r9 = await pool.query("SELECT ob_kind,count(*)::int as n FROM features_order_block WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 AND is_fresh=true GROUP BY ob_kind", ["XAUUSD","15m","2026-06-13","2026-07-13"]);
  console.log("ob@15m fresh ob_kind:", JSON.stringify(r9.rows));

  await pool.end();
})();
