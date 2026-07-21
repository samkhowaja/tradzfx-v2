// Diagnostic: count SMC/ICT setup-formation stages per pair (90d).
// Replicates the progressive spec predicates with TTL windows to find where
// the chain collapses. A "setup" = full chain reaching fvg_retrace.
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT,
  database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD,
});

const DAYS = parseInt(process.argv[2] || "90", 10);
const PAIRS = ["AUDUSD","EURUSD","GBPUSD","NZDUSD","USDCAD","USDCHF","USDJPY","USDSEK","XAUUSD"];
const FROM = new Date(Date.now() - DAYS * 86400000);
const TO = new Date();

// Stage counts: how many rows of each feature exist in window (raw density)
// + how many bias anchors have each downstream feature within TTL.
async function q(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function main() {
  console.log(`SMC/ICT setup-formation diagnostic — ${DAYS}d window (${FROM.toISOString().slice(0,10)} → ${TO.toISOString().slice(0,10)})`);
  console.log("Chain: htf_direction(1h bias) → value_location(15m pricing) → liquidity_sweep(5m) → displacement(5m) → fvg_retrace(1m zone)\n");

  const header = ["PAIR","bias1h","pricing15m","sweep5m","disp5m","zone1m_fvg","RAW_SETUPS","<100?"];
  console.log(header.map(h=>h.padEnd(13)).join(""));

  for (const sym of PAIRS) {
    const S = sym.toUpperCase();
    // Raw feature density in window
    const dens = await q(`
      SELECT
        (SELECT COUNT(*) FROM features_bias WHERE symbol=$1 AND tf='1h' AND ts BETWEEN $2 AND $3) AS bias1h,
        (SELECT COUNT(*) FROM features_pricing WHERE symbol=$1 AND tf='15m' AND ts BETWEEN $2 AND $3) AS pricing15m,
        (SELECT COUNT(*) FROM features_sweep WHERE symbol=$1 AND tf='5m' AND ts BETWEEN $2 AND $3) AS sweep5m,
        (SELECT COUNT(*) FROM features_displacement WHERE symbol=$1 AND tf='5m' AND ts BETWEEN $2 AND $3) AS disp5m,
        (SELECT COUNT(*) FROM features_zone WHERE symbol=$1 AND tf='1m' AND zone_kind='fvg' AND ts BETWEEN $2 AND $3) AS zone1m
    `, [S, FROM, TO]);
    const d = dens[0];

    // Full chain count: for each 1h bias anchor (direction IN bull/bear), count
    // downstream features within TTL that satisfy the predicates.
    // htf_direction: bias 1h direction bullish/bearish
    // value_location: pricing 15m within 120m, position matches bias direction
    // liquidity_sweep: sweep 5m within 120m, direction = bias direction
    // displacement: displacement 5m within 30m, grade MEDIUM/HIGH, direction = bias
    // fvg_retrace: zone 1m fvg within 240 bars (~4h), direction = bias, fill_pct<0.8
    const chain = await q(`
      WITH bias AS (
        SELECT ts, direction FROM features_bias
        WHERE symbol=$1 AND tf='1h' AND ts BETWEEN $2 AND $3
          AND direction IN ('bullish','bearish')
      ),
      priced AS (
        SELECT b.ts, b.direction,
          EXISTS (SELECT 1 FROM features_pricing p
            WHERE p.symbol=$1 AND p.tf='15m' AND p.ts BETWEEN b.ts - INTERVAL '120 minutes' AND b.ts
              AND ((b.direction='bullish' AND p.position IN ('discount','deep_discount','equilibrium'))
                OR (b.direction='bearish' AND p.position IN ('premium','deep_premium','equilibrium')))) AS vloc
        FROM bias b
      ),
      swept AS (
        SELECT p.ts, p.direction, p.vloc,
          EXISTS (SELECT 1 FROM features_sweep s
            WHERE s.symbol=$1 AND s.tf='5m' AND s.ts BETWEEN p.ts - INTERVAL '120 minutes' AND p.ts
              AND s.direction = p.direction) AS swept
        FROM priced p
      ),
      disp AS (
        SELECT s.ts, s.direction, s.vloc, s.swept,
          EXISTS (SELECT 1 FROM features_displacement dd
            WHERE dd.symbol=$1 AND dd.tf='5m' AND dd.ts BETWEEN s.ts - INTERVAL '30 minutes' AND s.ts
              AND dd.direction = s.direction AND dd.grade IN ('MEDIUM','HIGH')) AS disp
        FROM swept s
      ),
      fvg AS (
        SELECT dd.ts, dd.direction, dd.vloc, dd.swept, dd.disp,
          EXISTS (SELECT 1 FROM features_zone z
            WHERE z.symbol=$1 AND z.tf='1m' AND z.ts BETWEEN dd.ts - INTERVAL '240 minutes' AND dd.ts
              AND z.zone_kind='fvg' AND z.direction = dd.direction AND z.fill_pct < 0.8) AS fvg
        FROM disp dd
      )
      SELECT
        COUNT(*) AS bias_n,
        COUNT(*) FILTER (WHERE vloc) AS vloc_n,
        COUNT(*) FILTER (WHERE vloc AND swept) AS swept_n,
        COUNT(*) FILTER (WHERE vloc AND swept AND disp) AS disp_n,
        COUNT(*) FILTER (WHERE vloc AND swept AND disp AND fvg) AS fvg_n
      FROM fvg
    `, [S, FROM, TO]);
    const c = chain[0];

    const raw = parseInt(c.fvg_n, 10);
    const flag = raw < 100 ? "YES(<100)" : "ok";
    console.log([
      S.padEnd(13),
      String(d.bias1h).padEnd(13),
      String(d.pricing15m).padEnd(13),
      String(d.sweep5m).padEnd(13),
      String(d.disp5m).padEnd(13),
      String(d.zone1m).padEnd(13),
      String(raw).padEnd(13),
      flag,
    ].join(""));
    console.log(`   chain collapse: bias=${c.bias_n} → vloc=${c.vloc_n} → swept=${c.swept_n} → disp=${c.disp_n} → fvg=${c.fvg_n}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
