require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { Pool } = require("pg");

const specsDir = path.join(__dirname, "..", "packages", "strategies", "src", "specs");
const specs = fs.readdirSync(specsDir)
  .filter((name) => name.endsWith(".yaml"))
  .map((name) => {
    const spec = yaml.load(fs.readFileSync(path.join(specsDir, name), "utf8"));
    const conditions = [...(spec.setup || []), ...(spec.entry || [])];
    return {
      file: name,
      id: spec.id,
      familyId: spec.familyId || spec.id,
      name: spec.name || spec.id,
      version: spec.version || null,
      active: spec.active === true,
      experimental: spec.experimental === true,
      symbols: spec.filters?.symbols || [],
      sessions: spec.filters?.sessions || [],
      windows: spec.filters?.timeWindows || [],
      signalSource: spec.signalSource || "zone",
      setupFamily: spec.setupFamily || null,
      timeframes: [...new Set(conditions.map((c) => c.tf).filter(Boolean))],
      sl: spec.risk?.sl || null,
      tp: spec.risk?.tp || null,
      minRR: spec.risk?.minRR ?? null,
    };
  })
  .sort((a, b) => a.familyId.localeCompare(b.familyId) || a.id.localeCompare(b.id));

async function main() {
  const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  let runs = [];
  let aggregates = [];
  try {
    const runResult = await pool.query(`
      SELECT id, variant_id, family_id, strategy_id, symbol, tf,
             start_ts, end_ts, sample_count, generated_at
      FROM backtest_runs
      ORDER BY generated_at DESC
    `);
    runs = runResult.rows;
    const aggregateResult = await pool.query(`
      SELECT
        COALESCE(variant_id, strategy_id, '<unlinked>') AS variant_id,
        family_id,
        source,
        COUNT(*)::int AS rows,
        COUNT(DISTINCT run_id)::int AS runs,
        MIN(ts) AS first_trade_ts,
        MAX(ts) AS last_trade_ts,
        COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
        COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
        COUNT(*) FILTER (WHERE outcome = 'timeout')::int AS timeouts,
        COUNT(*) FILTER (WHERE outcome = 'invalid')::int AS invalid,
        COUNT(*) FILTER (WHERE COALESCE(heat_dropped, false) = false)::int AS not_heat_dropped,
        COALESCE(SUM(outcome_r) FILTER (WHERE COALESCE(heat_dropped, false) = false), 0)::float8 AS net_r,
        COALESCE(AVG(outcome_r) FILTER (WHERE outcome = 'win' AND COALESCE(heat_dropped, false) = false), 0)::float8 AS avg_win_r,
        COALESCE(AVG(outcome_r) FILTER (WHERE outcome = 'loss' AND COALESCE(heat_dropped, false) = false), 0)::float8 AS avg_loss_r
      FROM backtest_results
      GROUP BY COALESCE(variant_id, strategy_id, '<unlinked>'), family_id, source
      ORDER BY variant_id, source
    `);
    aggregates = aggregateResult.rows;
  } finally {
    await pool.end();
  }
  const output = JSON.stringify({ generatedAt: new Date().toISOString(), specs, runs, aggregates }, null, 2);
  const outputPath = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), output, "utf8");
  } else {
    console.log(output);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
