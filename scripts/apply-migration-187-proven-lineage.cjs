#!/usr/bin/env node
/** Apply migration 187 (schema only, additive) + insert ONLY proven lineage rows.
 *
 *  Provenance evidence: on-demand request fefc1b2b-87cc-4f53-98e3-871e25b8df5d
 *  artifact 96648c09-6468-4270-a6be-0cd3ad49518f, payload_sha256
 *  91d76e20ae8ef5703cbf2b40cc2c513397f4a597f1d3a4b93e1f8b5117f6a982
 *  (terminal 296743 @ 1xTrade-Server, verdict MATCH, 53 bars).
 *
 *  Fail-closed: every reference (trusted windows trusted, runs done+zero-reject,
 *  artifact payload hash, canonical membership) is asserted before insert.
 *  Unproven bars are NOT inserted -> cardinality gate keeps blocking them.
 *  Idempotent via ON CONFLICT DO NOTHING.
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

const MIGRATION = "infra/migrations/187_candle_producer_lineage.sql";
const LEDGER = "187_candle_producer_lineage.sql";

const ARTIFACT_ID = "96648c09-6468-4270-a6be-0cd3ad49518f";
const ARTIFACT_SHA = "91d76e20ae8ef5703cbf2b40cc2c513397f4a597f1d3a4b93e1f8b5117f6a982";
const SOURCE_KEY = `ondemand:artifact:${ARTIFACT_ID}`;
const SYMBOL = "XAUUSD";
const EXPECTED_WINDOWS = [46, 64, 74, 94, 117];
const EXPECTED_RUNS = [25077375, 25077376];
const MANIFEST_PATH = "reports/backfill-runs/2026-08-06T23-34-27-732Z.json";
const MANIFEST_HASH = crypto.createHash("sha256").update(fs.readFileSync(MANIFEST_PATH)).digest("hex");

(async () => {
  const pool = new Pool(getDbConfig());
  try {
    // 1. Apply 187 schema (additive-only: CREATE TABLE/INDEX/TRIGGER/FUNCTION, no destructive SQL)
    const sql = fs.readFileSync(MIGRATION, "utf8");
    if (/TRUNCATE|DROP TABLE|DROP COLUMN|ALTER TABLE .* DROP/i.test(sql)) {
      throw new Error("abort: destructive SQL detected in 187");
    }
    await pool.query(sql);
    await pool.query(
      `insert into public.schema_migrations (version) values ($1) on conflict do nothing`, [LEDGER]
    ).catch(() => {});
    const rel = await pool.query(`select to_regclass('market.candle_producer_lineage') r`);
    if (!rel.rows[0].r) throw new Error("abort: lineage table absent after apply");
    console.log("schema: market.candle_producer_lineage present");

    // 2. Assert trusted windows are exactly the certified set, all trusted
    const win = await pool.query(
      `select window_id, window_start, window_end, status from market.trusted_windows
       where window_id = any($1::bigint[])`, [EXPECTED_WINDOWS]);
    if (win.rowCount !== EXPECTED_WINDOWS.length) throw new Error(`abort: trusted windows found=${win.rowCount}`);
    for (const w of win.rows) if (w.status !== "trusted") throw new Error(`abort: window ${w.window_id} status=${w.status}`);

    // 3. Assert producer runs done, XAUUSD 1m (rejections live in quality_json per runner.ts)
    const runs = await pool.query(
      `select run_id, symbol, tf, status, quality_json from feature_producer_runs
       where run_id = any($1::bigint[])`, [EXPECTED_RUNS]);
    if (runs.rowCount !== EXPECTED_RUNS.length) throw new Error(`abort: producer runs found=${runs.rowCount}`);
    for (const r of runs.rows) {
      if (r.symbol !== SYMBOL || r.tf !== "1m" || r.status !== "done")
        throw new Error(`abort: bad run ${r.run_id} ${JSON.stringify(r)}`);
      const rejected = Number(r.quality_json?.rows_rejected || 0);
      if (rejected !== 0) throw new Error(`abort: run ${r.run_id} rows_rejected=${rejected}`);
    }

    // 4. Load artifact payload, verify hash
    const art = await pool.query(
      `select payload, payload_sha256, symbol, timeframe from market.candle_source_artifacts
       where artifact_id=$1`, [ARTIFACT_ID]);
    if (art.rowCount !== 1) throw new Error("abort: artifact missing");
    if (art.rows[0].payload_sha256 !== ARTIFACT_SHA) throw new Error("abort: artifact sha mismatch");
    // payload is a bare jsonb array of bars: [{ts(epoch sec UTC),o,h,l,c,tickVol,spread}, ...]
    const payload = art.rows[0].payload;
    const bars = Array.isArray(payload) ? payload : (payload.bars || []);
    if (!bars.length) throw new Error("abort: artifact has no bars");
    console.log(`artifact: ${bars.length} bars, sha verified`);

    // 5. For each bar: assert canonical membership, map to trusted window, insert lineage
    let inserted = 0, skippedExisting = 0;
    const winRows = win.rows.map(w => ({
      id: Number(w.window_id),
      start: new Date(w.window_start).getTime(),
      end: new Date(w.window_end).getTime(),
    }));
    for (const b of bars) {
      const tsMs = String(b.ts).length > 10 ? Number(b.ts) : Number(b.ts) * 1000;
      const canon = await pool.query(
        `select symbol, broker, effective_broker_identity, policy_id
         from market.candles_1m_canonical where symbol=$1 and ts=$2`,
        [SYMBOL, new Date(tsMs)]);
      if (canon.rowCount !== 1) throw new Error(`abort: bar ts=${new Date(tsMs).toISOString()} not in canonical (${canon.rowCount})`);
      const c = canon.rows[0];
      const w = winRows.find(w => tsMs >= w.start && tsMs < w.end);
      if (!w) throw new Error(`abort: bar ts=${new Date(tsMs).toISOString()} outside all trusted windows`);
      // one row per producer run that certified this window set (both runs cover the window set)
      for (const runId of EXPECTED_RUNS) {
        const ins = await pool.query(
          `insert into market.candle_producer_lineage
             (symbol, broker, candle_ts, source_key, producer_run_id, manifest_name,
              manifest_sha256, trusted_window_id, effective_broker_identity, policy_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict do nothing`,
          [c.symbol, c.broker, new Date(tsMs), SOURCE_KEY, runId, MANIFEST_PATH,
           MANIFEST_HASH, w.id, c.effective_broker_identity, c.policy_id]);
        if (ins.rowCount === 1) inserted++; else skippedExisting++;
      }
    }
    console.log(`lineage: inserted=${inserted} existing=${skippedExisting} (bars=${bars.length} x runs=${EXPECTED_RUNS.length})`);

    const cnt = await pool.query(`select count(*)::int n from market.candle_producer_lineage`);
    console.log(`total lineage rows now: ${cnt.rows[0].n}`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
