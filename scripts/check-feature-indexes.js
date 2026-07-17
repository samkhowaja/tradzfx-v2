require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { getPool } = require("../packages/shared/dist/index.js");

async function main() {
  const pool = getPool();
  const tables = [
    "features_zone",
    "features_pricing",
    "features_atr",
    "features_structure",
    "features_zone_retest",
  ];
  for (const t of tables) {
    const { rows } = await pool.query(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1",
      [t]
    );
    console.log(t + ":");
    rows.forEach((r) => console.log("  " + r.indexname));
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
