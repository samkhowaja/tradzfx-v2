/**
 * Audit volatility-gate ATR ceilings across the strategy catalog.
 *
 * Flags specs whose `maxAtr5Pips` is implausible for the spec's symbol set
 * (e.g. a 3-pip ceiling on XAUUSD, where 90d ATR5 median ≈ 47 pips and the
 * floor ≈ 9 pips -> blocks 100% of bars). This is the durable guardrail for
 * the unit defect fixed for smart_risk_ob_ifvg_1m (reports/...V2 §11.2).
 *
 * Classification per spec:
 *   INSANE   - maxAtr5Pips <= the symbol's observed p05 ATR5 (blocks >=95% of bars)
 *   TIGHT    - maxAtr5Pips between p05 and median (aggressive low-vol filter)
 *   OK       - maxAtr5Pips between median and p95 (sane high-vol cap)
 *   LOOSE    - maxAtr5Pips > p95 (cap rarely binds)
 *   N/A      - no volatility gate / no ATR data / no symbols
 *
 * Usage: node scripts/audit-volatility-gates.js [--days 90]
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { Pool } = require("pg");

const DAYS = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 90;

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");

function listSpecs(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => path.join(dir, f));
}

function pipSize(symbol) {
  // Minimal map for classification; authoritative source is getRegistryPipSize.
  if (/XAU|XAG|GOLD|SILVER/i.test(symbol)) return 0.1;
  if (/US30|NAS|SPX|US500|GER|UK100/i.test(symbol)) return 1;
  return 0.0001; // fx majors/minors
}

async function atrStats(symbol) {
  const { rows } = await pool.query(
    `SELECT
       percentile_cont(0.05) WITHIN GROUP (ORDER BY value) AS p05,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY value) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95,
       count(*) AS n
     FROM features_atr
     WHERE symbol = $1 AND tf = '5m' AND period = 5
       AND value IS NOT NULL
       AND ts > now() - ($2 || ' days')::interval`,
    [symbol, String(DAYS)]
  );
  const r = rows[0];
  if (!r || Number(r.n) === 0) return null;
  const ps = pipSize(symbol);
  return {
    n: Number(r.n),
    p05: Number(r.p05) / ps,
    p50: Number(r.p50) / ps,
    p95: Number(r.p95) / ps,
  };
}

function classify(maxAtr5Pips, stats) {
  if (!stats) return "N/A";
  if (maxAtr5Pips <= stats.p05) return "INSANE";
  if (maxAtr5Pips < stats.p50) return "TIGHT";
  if (maxAtr5Pips <= stats.p95) return "OK";
  return "LOOSE";
}

(async () => {
  const files = listSpecs(SPECS_DIR);
  const statsCache = new Map();
  const rows = [];

  for (const file of files) {
    const spec = YAML.parse(fs.readFileSync(file, "utf8"));
    const vol = (spec.gates || []).find((g) => g.name === "volatility");
    const maxAtr5Pips = vol?.params?.maxAtr5Pips;
    const symbols = spec.filters?.symbols || [];
    const primarySymbol = symbols[0] || spec.symbol || null;

    let cls = "N/A";
    let stats = null;
    if (maxAtr5Pips !== undefined && primarySymbol) {
      if (!statsCache.has(primarySymbol)) statsCache.set(primarySymbol, await atrStats(primarySymbol));
      stats = statsCache.get(primarySymbol);
      cls = classify(Number(maxAtr5Pips), stats);
    }

    rows.push({
      id: spec.id || path.basename(file),
      symbol: primarySymbol || "-",
      maxAtr5Pips: maxAtr5Pips ?? "-",
      p05: stats ? stats.p05.toFixed(1) : "-",
      p50: stats ? stats.p50.toFixed(1) : "-",
      p95: stats ? stats.p95.toFixed(1) : "-",
      class: cls,
    });
  }

  rows.sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id));

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`Volatility-gate ATR5 ceiling audit (${DAYS}d, period=5, tf=5m). Units: pips.\n`);
  console.log(
    `${pad("spec", 48)} ${pad("sym", 8)} ${pad("maxPips", 8)} ${pad("p05", 8)} ${pad("p50", 8)} ${pad("p95", 8)} CLASS`
  );
  for (const r of rows) {
    if (r.maxAtr5Pips === "-") continue;
    console.log(
      `${pad(r.id, 48)} ${pad(r.symbol, 8)} ${pad(r.maxAtr5Pips, 8)} ${pad(r.p05, 8)} ${pad(r.p50, 8)} ${pad(r.p95, 8)} ${r.class}`
    );
  }

  const insane = rows.filter((r) => r.class === "INSANE");
  console.log(`\n${insane.length} INSANE spec(s) (ceiling blocks >=95% of bars):`);
  insane.forEach((r) => console.log(`  - ${r.id} (${r.symbol}) maxAtr5Pips=${r.maxAtr5Pips} <= p05=${r.p05}`));

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
