require("dotenv").config({ path: require("path").resolve(__dirname, ".env.local") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ host: "localhost", database: "tradzfx_v2", user: "postgres", password: process.env.TM_DB_PASSWORD });
  const r = await p.query(
    `SELECT COUNT(*)::int as n, MIN(ts) as min_ts, MAX(ts) as max_ts
     FROM features_bias WHERE symbol='XAUUSD' AND tf='15m'
     AND ts>='2026-07-13' AND ts<='2026-07-20'`
  );
  console.log(r.rows[0]);
  // Also check what semanticType FEATURE_REGISTRY assigns to bias
  const reg = require("./packages/strategies/dist/index.js").FEATURE_REGISTRY;
  console.log("features_bias reg:", reg?.features_bias?.semanticType ?? "NOT FOUND");
  console.log("features_pricing reg:", reg?.features_pricing?.semanticType ?? "NOT FOUND");
  console.log("features_atr reg:", reg?.features_atr?.semanticType ?? "NOT FOUND");
  console.log("features_session reg:", reg?.features_session?.semanticType ?? "NOT FOUND");
  console.log("features_opening_range reg:", reg?.features_opening_range?.semanticType ?? "NOT FOUND");
  await p.end();
})();
