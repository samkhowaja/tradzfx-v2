const { collectCapabilityMatrix } = require("./feature-capability.js");
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

// Surfaces required by the new SMC/ICT family.
const SURFACES = [
  ["features_bias", "1h"],
  ["features_pricing", "15m"],
  ["features_sweep", "5m"],
  ["features_displacement", "5m"],
  ["features_ifvg", "1m"],
  ["features_zone", "1m"],
  ["features_order_block", "1m"],
];
const SYMBOLS = [
  "AUDUSD", "EURUSD", "GBPUSD", "NZDUSD",
  "USDCAD", "USDCHF", "USDJPY", "USDSEK", "XAUUSD",
];

(async () => {
  const matrix = await collectCapabilityMatrix(pool, {
    symbols: SYMBOLS,
    tfs: ["1m", "5m", "15m", "1h"],
    days: 90,
  });
  const blocking = new Set([
    "MISSING_TABLE", "CONTRACT_MISMATCH", "EMPTY_DENSE",
    "BLOCKED_LIFECYCLE", "STALE_STATE", "PRODUCER_STALE",
  ]);
  const problems = [];
  for (const [feature, tf] of SURFACES) {
    for (const symbol of SYMBOLS) {
      const row = matrix.rows.find(
        (r) => r.feature === feature && r.tf === tf && r.symbol === symbol
      );
      const verdict = row ? row.verdict : "MISSING_ROW";
      if (blocking.has(verdict)) {
        problems.push(
          `${symbol} ${feature}@${tf} -> ${verdict} (rows90d=${row?.rows90d}, latest=${row?.latestTs})`
        );
      }
    }
  }
  console.log(`Probed ${SURFACES.length * SYMBOLS.length} surfaces.`);
  if (problems.length === 0) {
    console.log("ALL READY for new SMC family.");
  } else {
    console.log(`BLOCKING (${problems.length}):`);
    problems.forEach((p) => console.log("  " + p));
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
