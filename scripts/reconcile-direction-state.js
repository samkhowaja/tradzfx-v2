/**
 * Read-only reconcile of features_direction_state from ALREADY-computed
 * features_bias + features_htf_bias rows. Does NOT recompute any dependency
 * (avoids the skipCache closure footgun). Uses the engine's pure
 * reconcileDirection so output is identical to the live feature.
 *
 *   node scripts/reconcile-direction-state.js [symbol=XAUUSD] [tf=1h]
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const { reconcileDirection } = require("../apps/engine/dist/index.js");

if (typeof reconcileDirection !== "function") {
  console.error("reconcileDirection not exported from apps/engine/dist/index.js");
  process.exit(1);
}

const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
const tf = process.argv[3] || "1h";
const BATCH = 500;
const ENGINE_VER = "reconcile-readonly-1.0.0";

(async () => {
  const c = new Client({
    host: "localhost", port: 5432, database: "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  await c.connect();

  const clk = (await c.query(`SELECT MAX(ts) AS max FROM market.candles_1m_canonical WHERE symbol=$1`, [symbol])).rows[0].max;
  const start = new Date(new Date(clk).getTime() - 90 * 86400000);

  // Read-only proof: capture bias/htf counts before (we only SELECT them).
  const before = (await c.query(
    `SELECT
      (SELECT COUNT(*)::int FROM features_bias WHERE symbol=$1 AND tf=$2) b,
      (SELECT COUNT(*)::int FROM features_htf_bias WHERE symbol=$1 AND tf=$2) h,
      (SELECT COUNT(*)::int FROM features_direction_state WHERE symbol=$1 AND tf=$2) d`,
    [symbol, tf]
  )).rows[0];

  const { rows } = await c.query(
    `SELECT b.ts,
            b.direction AS b_direction, b.regime AS b_regime, b.confidence AS b_confidence,
            h.direction AS h_direction, h.state AS h_state, h.confidence AS h_confidence
     FROM features_bias b
     JOIN features_htf_bias h ON h.symbol=b.symbol AND h.tf=b.tf AND h.ts=b.ts
     WHERE b.symbol=$1 AND b.tf=$2 AND b.ts >= $3 AND b.ts <= $4
     ORDER BY b.ts ASC`,
    [symbol, tf, start, clk]
  );

  let inserted = 0, agree = 0, agreeTrending = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const vals = [], ph = [];
    let p = 1;
    for (const r of chunk) {
      const out = reconcileDirection(
        { direction: r.b_direction, regime: r.b_regime, confidence: Number(r.b_confidence) || 0 },
        { direction: r.h_direction, state: r.h_state, confidence: Number(r.h_confidence) || 0 }
      );
      if (out.agreement) agree++;
      if (out.agreement && out.regime === "trending") agreeTrending++;
      ph.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      vals.push(symbol, tf, r.ts, out.direction, out.regime, out.agreement,
        out.biasDirection, out.htfDirection, out.htfState, out.confidence, out.reason, ENGINE_VER, "");
    }
    const res = await c.query(
      `INSERT INTO features_direction_state
         (symbol, tf, ts, direction, regime, agreement, bias_direction, htf_direction, htf_state, confidence, reason, engine_ver, input_hash)
       VALUES ${ph.join(",")}
       ON CONFLICT (symbol, tf, ts) DO UPDATE SET
         direction=EXCLUDED.direction, regime=EXCLUDED.regime, agreement=EXCLUDED.agreement,
         bias_direction=EXCLUDED.bias_direction, htf_direction=EXCLUDED.htf_direction,
         htf_state=EXCLUDED.htf_state, confidence=EXCLUDED.confidence, reason=EXCLUDED.reason,
         engine_ver=EXCLUDED.engine_ver`,
      vals
    );
    inserted += res.rowCount || 0;
  }

  const after = (await c.query(
    `SELECT
      (SELECT COUNT(*)::int FROM features_bias WHERE symbol=$1 AND tf=$2) b,
      (SELECT COUNT(*)::int FROM features_htf_bias WHERE symbol=$1 AND tf=$2) h,
      (SELECT COUNT(*)::int FROM features_direction_state WHERE symbol=$1 AND tf=$2) d,
      (SELECT COUNT(*)::int FROM features_direction_state WHERE symbol=$1 AND tf=$2 AND agreement) d_agree`,
    [symbol, tf]
  )).rows[0];

  console.log(JSON.stringify({
    symbol, tf, window: [start.toISOString(), new Date(clk).toISOString()],
    joined: rows.length, upserted: inserted, agree, agreeTrending,
    before, after,
    readOnlyOK: before.b === after.b && before.h === after.h,
  }, null, 0));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
