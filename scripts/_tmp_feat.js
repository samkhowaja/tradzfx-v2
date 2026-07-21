require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  const q = `SELECT COUNT(*) AS n FROM features_bias WHERE tf='1h' AND symbol='EURUSD' AND ts >= '2026-04-21T21:51:00.000Z'::timestamptz AND ts <= '2026-07-20T21:51:00.000Z'::timestamptz`;
  const r = await p.query(q);
  console.log("features_bias@1h EURUSD rows:", r.rows[0].n);
  const q2 = `SELECT COUNT(*) AS n FROM features_pricing WHERE tf='15m' AND symbol='EURUSD' AND ts >= '2026-04-21T21:51:00.000Z'::timestamptz`;
  const r2 = await p.query(q2);
  console.log("features_pricing@15m EURUSD rows:", r2.rows[0].n);
  const q3 = `SELECT COUNT(*) AS n FROM features_sweep WHERE tf='5m' AND symbol='EURUSD'`;
  const r3 = await p.query(q3);
  console.log("features_sweep@5m EURUSD rows:", r3.rows[0].n);
  const q4 = `SELECT COUNT(*) AS n FROM features_displacement WHERE tf='5m' AND symbol='EURUSD'`;
  const r4 = await p.query(q4);
  console.log("features_displacement@5m EURUSD rows:", r4.rows[0].n);
  const q5 = `SELECT COUNT(*) AS n FROM features_zone WHERE tf='1m' AND symbol='EURUSD' AND zone_kind='fvg'`;
  const r5 = await p.query(q5);
  console.log("features_zone@1m fvg EURUSD rows:", r5.rows[0].n);
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
