require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { loadStrategyFromDB, compileStrategy } = require("../packages/strategies/dist/index.js");
const { getPool } = require("../packages/shared/dist/index.js");

async function main() {
  const pool = getPool();
  const spec = await loadStrategyFromDB(pool, "doyle_sd");
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { sql } = compileStrategy(spec, { mode: "pit", from, to, symbol: "XAUUSD" });

  // Write SQL to file with positions marked every 500 chars
  let out = "";
  for (let i = 0; i < sql.length; i += 500) {
    out += `\n--- pos ${i} ---\n${sql.slice(i, i + 500)}`;
  }
  require("fs").writeFileSync("pit-sql-debug.sql", out);
  console.log("Wrote pit-sql-debug.sql");

  try {
    const { rows } = await pool.query(sql);
    console.log("Query OK, rows:", rows.length);
    console.log(rows.slice(0, 3));
  } catch (e) {
    console.error("Query failed:", e.message);
    console.error("Position:", e.position);
    if (e.position) {
      const start = Math.max(0, e.position - 100);
      console.error("Context:", sql.slice(start, e.position + 50));
    }
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
