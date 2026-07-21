const { Pool } = require("pg");
const fs = require("fs");
const envFile = ".env.local";
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});
(async () => {
  const ids = [
    "smc_ict_liquidity_fvg_allpairs_v1",
    "smc_ict_liquidity_ifvg_allpairs_v1",
    "smc_ict_liquidity_ob_allpairs_v1",
  ];
  const { rowCount } = await pool.query(
    "UPDATE strategy_variants SET is_active = false WHERE id = ANY($1)",
    [ids]
  );
  console.log(`deactivated ${rowCount} variants`);
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
