#!/usr/bin/env node
/** Read-only daily observation report for progressive DAG-v2 shadow canary. */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports", "progressive-shadow-canary");

function summarizeRuns(rows) {
  const passed = rows.filter((row) => row.status === "passed");
  const failed = rows.filter((row) => row.status === "failed");
  const running = rows.filter((row) => row.status === "running");
  return {
    runs: rows.length, passed: passed.length, failed: failed.length, running: running.length,
    passRate: rows.length ? passed.length / rows.length : null,
    rowsRead: rows.reduce((sum, row) => sum + Number(row.rows_read || 0), 0),
    eventsInserted: rows.reduce((sum, row) => sum + Number(row.events_inserted || 0), 0),
    eventsApplied: rows.reduce((sum, row) => sum + Number(row.events_applied || 0), 0),
    eventsIgnored: rows.reduce((sum, row) => sum + Number(row.events_ignored || 0), 0),
    maxPassCount: rows.reduce((max, row) => Math.max(max, Number(row.pass_count || 0)), 0),
  };
}

function readiness(summary, lifecycle) {
  const checks = {
    runs_present: summary.runs > 0,
    all_runs_passed: summary.runs > 0 && summary.failed === 0 && summary.running === 0,
    transition_parity: Number(lifecycle.transitions) === Number(lifecycle.revisions),
    inbox_clear: Number(lifecycle.pending) === 0 && Number(lifecycle.errors) === 0 && Number(lifecycle.claims) === 0,
    exclusive_unique: Number(lifecycle.exclusive_duplicates) === 0,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { status: failed.length ? "NOT_READY" : "OBSERVING", promotionAutomatic: false, checks, failed };
}

async function generateReport(pool, date) {
  const plan = await pool.query(
    `SELECT plan_hash,strategy_id,strategy_version FROM progressive_plan_registry
     WHERE strategy_id='xauusd_liquidity_confirmed_bos_shadow_v2'
     ORDER BY registered_at DESC LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error("Confirmed-BOS progressive shadow plan is not registered");
  const planHash = plan.rows[0].plan_hash;
  const [runs, statuses, lifecycle] = await Promise.all([
    pool.query(
      `SELECT * FROM progressive_shadow_canary_run
       WHERE plan_hash=$1 AND data_clock::date=$2::date ORDER BY data_clock,run_id`,
      [planHash, date],
    ),
    pool.query(
      `SELECT status,COUNT(*)::int count FROM progressive_setup_instance
       WHERE plan_hash=$1 GROUP BY status ORDER BY status`,
      [planHash],
    ),
    pool.query(
      `SELECT
       (SELECT COUNT(*) FROM progressive_setup_transition t JOIN progressive_setup_instance i USING(setup_instance_id) WHERE i.plan_hash=$1)::int transitions,
       (SELECT COALESCE(SUM(revision),0) FROM progressive_setup_instance WHERE plan_hash=$1)::int revisions,
       (SELECT COUNT(*) FROM progressive_setup_event_inbox WHERE plan_hash=$1 AND processing_status='pending')::int pending,
       (SELECT COUNT(*) FROM progressive_setup_event_inbox WHERE plan_hash=$1 AND processing_status='error')::int errors,
       (SELECT COUNT(*) FROM progressive_setup_event_inbox WHERE plan_hash=$1 AND claim_token IS NOT NULL)::int claims,
       (SELECT COUNT(*) FROM (SELECT n.source_feature,n.source_symbol,n.source_tf,n.source_ts,n.source_key FROM progressive_setup_node n JOIN progressive_setup_instance i USING(setup_instance_id) WHERE i.plan_hash=$1 AND n.consumption_policy='exclusive_setup' AND n.status='satisfied' GROUP BY 1,2,3,4,5 HAVING COUNT(*)>1) d)::int exclusive_duplicates`,
      [planHash],
    ),
  ]);
  const summary = summarizeRuns(runs.rows);
  const payload = {
    generatedAt: new Date().toISOString(), date, plan: plan.rows[0], summary,
    lifecycle: lifecycle.rows[0], instanceStatuses: statuses.rows,
    readiness: readiness(summary, lifecycle.rows[0]), runs: runs.rows,
  };
  return payload;
}

async function main() {
  const date = (process.argv.find((value) => value.startsWith("--date=")) || `--date=${new Date().toISOString().slice(0, 10)}`).slice(7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD");
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD, application_name: "tradzfx-progressive-canary-report", max: 1,
  });
  try {
    const payload = await generateReport(pool, date);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `${date}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    fs.writeFileSync(path.join(REPORT_DIR, `${date}.md`), `# Progressive shadow canary — ${date}\n\n- Runs: ${payload.summary.runs}\n- Passed/failed/running: ${payload.summary.passed}/${payload.summary.failed}/${payload.summary.running}\n- Events inserted/applied/ignored: ${payload.summary.eventsInserted}/${payload.summary.eventsApplied}/${payload.summary.eventsIgnored}\n- Max passes: ${payload.summary.maxPassCount}\n- Lifecycle transitions/revisions: ${payload.lifecycle.transitions}/${payload.lifecycle.revisions}\n- Inbox pending/errors/claims: ${payload.lifecycle.pending}/${payload.lifecycle.errors}/${payload.lifecycle.claims}\n- Exclusive duplicates: ${payload.lifecycle.exclusive_duplicates}\n- Status: ${payload.readiness.status}\n- Automatic promotion: no\n`);
    console.log(JSON.stringify({ report: path.join(REPORT_DIR, `${date}.json`), readiness: payload.readiness }));
  } finally { await pool.end(); }
}

module.exports = { generateReport, readiness, summarizeRuns };
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
