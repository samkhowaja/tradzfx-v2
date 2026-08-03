#!/usr/bin/env node
"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const { Pool } = require("pg");

function evaluateHealth(snapshot, options = {}) {
  const maxClockLagMinutes = options.maxClockLagMinutes ?? 30;
  const maxRunningMinutes = options.maxRunningMinutes ?? 20;
  const failures = [];
  if (!snapshot.latestPassed) failures.push("no_passed_run");
  if (snapshot.stuckRunning > 0) failures.push(`stuck_running:${snapshot.stuckRunning}`);
  if (snapshot.failuresAfterPass > 0) failures.push(`failures_after_pass:${snapshot.failuresAfterPass}`);
  if (snapshot.clockRegressions > 0) failures.push(`clock_regressions:${snapshot.clockRegressions}`);
  if (snapshot.failedInvariants > 0) failures.push(`failed_invariants:${snapshot.failedInvariants}`);
  if (snapshot.latestPassed && snapshot.canonicalClock) {
    const lagMinutes = (new Date(snapshot.canonicalClock).getTime() - new Date(snapshot.latestPassed).getTime()) / 60000;
    if (lagMinutes > maxClockLagMinutes) failures.push(`data_clock_lag_minutes:${lagMinutes.toFixed(1)}`);
  }
  return { passed: failures.length === 0, maxClockLagMinutes, maxRunningMinutes, failures };
}

async function readSnapshot(pool, maxRunningMinutes) {
  const { rows } = await pool.query(
    `WITH selected_plan AS (
       SELECT plan_hash FROM progressive_plan_registry
       WHERE strategy_id='xauusd_liquidity_confirmed_bos_shadow_v2'
       ORDER BY registered_at DESC LIMIT 1
     ), canonical AS (
       SELECT MAX(c.ts) data_clock
       FROM market.candles_15m_canonical c
       CROSS JOIN (SELECT MAX(ts) max_ts FROM market.candles_1m_canonical WHERE symbol='XAUUSD') edge
       WHERE c.symbol='XAUUSD' AND c.tick_count>0 AND c.ts + interval '14 minutes' <= edge.max_ts
     ), runs AS (
       SELECT r.*,LAG(r.data_clock) OVER (ORDER BY r.run_id) previous_clock
       FROM progressive_shadow_canary_run r JOIN selected_plan p USING(plan_hash)
       WHERE r.symbol='XAUUSD'
     ), latest_pass AS (
       SELECT MAX(data_clock) data_clock,MAX(finished_at) finished_at FROM runs WHERE status='passed'
     )
     SELECT
       (SELECT data_clock FROM canonical) canonical_clock,
       (SELECT data_clock FROM latest_pass) latest_passed,
       (SELECT COUNT(*) FROM runs WHERE status='running' AND started_at < now()-($1::text||' minutes')::interval)::int stuck_running,
       (SELECT COUNT(*) FROM runs WHERE status='failed' AND started_at > COALESCE((SELECT finished_at FROM latest_pass),'-infinity'))::int failures_after_pass,
       (SELECT COUNT(*) FROM runs WHERE previous_clock IS NOT NULL AND data_clock < previous_clock)::int clock_regressions,
       (SELECT COUNT(*) FROM runs WHERE status='passed' AND COALESCE((invariant_json->>'passed')::boolean,false)=false)::int failed_invariants`,
    [maxRunningMinutes],
  );
  if (!rows[0]) throw new Error("Progressive shadow canary health snapshot unavailable");
  return {
    canonicalClock: rows[0].canonical_clock,
    latestPassed: rows[0].latest_passed,
    stuckRunning: Number(rows[0].stuck_running),
    failuresAfterPass: Number(rows[0].failures_after_pass),
    clockRegressions: Number(rows[0].clock_regressions),
    failedInvariants: Number(rows[0].failed_invariants),
  };
}

async function main() {
  const maxClockLagMinutes = Number(process.env.TM_PROGRESSIVE_DAG_HEALTH_MAX_CLOCK_LAG_MIN || 30);
  const maxRunningMinutes = Number(process.env.TM_PROGRESSIVE_DAG_HEALTH_MAX_RUNNING_MIN || 20);
  if (!Number.isFinite(maxClockLagMinutes) || maxClockLagMinutes < 15) throw new Error("Invalid canary clock-lag threshold");
  if (!Number.isFinite(maxRunningMinutes) || maxRunningMinutes < 15) throw new Error("Invalid canary running threshold");
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD, application_name: "tradzfx-progressive-canary-health", max: 1,
  });
  try {
    const snapshot = await readSnapshot(pool, maxRunningMinutes);
    const health = evaluateHealth(snapshot, { maxClockLagMinutes, maxRunningMinutes });
    console.log(JSON.stringify({ snapshot, health }));
    if (!health.passed) process.exitCode = 1;
  } finally { await pool.end(); }
}

module.exports = { evaluateHealth, readSnapshot };
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
