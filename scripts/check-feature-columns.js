require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { getPool } = require("../packages/shared/dist/index.js");

async function main() {
  const pool = getPool();
  const tables = [
    "features_zone_retest",
    "features_structure",
    "features_sweep",
    "features_displacement",
    "features_candle_pattern",
    "features_time_of_day_edge",
  ];
  for (const t of tables) {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
      [t]
    );
    console.log(t + ":\n  " + rows.map((r) => r.column_name).join("\n  "));
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
