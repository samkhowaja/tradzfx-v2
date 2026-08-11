#!/usr/bin/env node
/** Read-only ingestion/run lineage report. Never changes certification state. */
require("dotenv").config({ path: ".env.local", override: true });
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

function parseArgs(argv) {
  const out = { timeframe: "1m", includeSynthetic: false };
  for (const arg of argv) {
    if (arg === "--include-synthetic") out.includeSynthetic = true;
    else if (arg.startsWith("--")) {
      const i = arg.indexOf("=");
      if (i < 0) throw new Error(`Expected --name=value, got ${arg}`);
      out[arg.slice(2, i).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = arg.slice(i + 1);
    }
  }
  if (!out.symbol) throw new Error("Usage: node scripts/report-candle-ingestion-lineage.cjs --symbol=XAUUSD --from=2026-08-01T00:00:00Z --to=2026-08-07T00:00:00Z");
  if (!out.from || !out.to) throw new Error("--from and --to are required");
  if (Number.isNaN(Date.parse(out.from)) || Number.isNaN(Date.parse(out.to))) throw new Error("--from/--to must be ISO timestamps");
  if (out.timeframe !== "1m") throw new Error("Only --timeframe=1m is supported: ingestion ledger is 1m");
  return out;
}

const n = (value) => Number(value || 0);
const iso = (value) => value == null ? null : new Date(value).toISOString();

async function buildReport(client, p) {
  const args = [p.symbol.toUpperCase(), p.from, p.to];
  const filters = ["c.symbol = $1", "c.ts >= $2", "c.ts < $3"];
  if (!p.includeSynthetic) filters.push("c.symbol <> 'TESTSYNTH' AND c.broker <> 'TESTSYNTH'");
  if (p.runId) { args.push(p.runId); filters.push(`l.ingestion_run_id = $${args.length}`); }

  const candles = await client.query(`
    WITH scoped AS (
      SELECT c.symbol, c.ts, c.broker,
             CASE WHEN c.symbol = 'TESTSYNTH' OR c.broker = 'TESTSYNTH' THEN 'TEST_EVIDENCE_ONLY'
                  WHEN l.ingestion_run_id IS NULL THEN 'UNPROVEN_NO_RUN'
                  ELSE 'INGESTION_RUN_BOUND' END AS provenance,
             (l.ingestion_run_id IS NOT NULL) AS has_run_evidence,
             l.ingestion_run_id, l.source_key,
             COALESCE(l.binding_count, 0)::int AS live_binding_count,
             e.state AS eligibility_state
        FROM candles_1m c
        LEFT JOIN LATERAL (
          SELECT ingestion_run_id, source_key, count(*) OVER () AS binding_count
            FROM market.candle_producer_lineage
           WHERE symbol=c.symbol AND broker=c.broker AND candle_ts=c.ts
             AND voided_at IS NULL AND ingestion_run_id IS NOT NULL
           ORDER BY lineage_id DESC LIMIT 1
        ) l ON true
        LEFT JOIN LATERAL (
          SELECT ce.state
            FROM market.candle_eligibility ce
           WHERE ce.symbol=c.symbol AND ce.broker=c.broker
             AND ce.timeframe='1m' AND ce.ts=c.ts
           ORDER BY ce.updated_at DESC NULLS LAST
           LIMIT 1
        ) e ON true
      WHERE ${filters.join(" AND ")}
    ) SELECT * FROM scoped ORDER BY ts`, [p.symbol.toUpperCase(), p.from, p.to]);

  const runParams = [p.symbol.toUpperCase(), p.from, p.to];
  const runFilters = [
    "r.symbol = $1", "r.timeframe = $4",
    "r.batch_end_ts > $2", "r.batch_start_ts < $3",
  ];
  runParams.push(p.timeframe);
  if (p.runId) { runParams.push(p.runId); runFilters.push(`r.run_id = $${runParams.length}`); }
  if (p.engineVerFilter) { runParams.push(`%${p.engineVerFilter}%`); runFilters.push(`r.engine_ver ILIKE $${runParams.length}`); }
  const runs = await client.query(`
    SELECT r.*,
      COALESCE(x.bound_candle_count,0)::int AS bound_candle_count,
      x.bound_ts_min, x.bound_ts_max,
      COALESCE(x.quarantine_candle_count,0)::int AS quarantine_candle_count,
      COALESCE(x.non_clean_count,0)::int AS non_clean_count,
      COALESCE(x.eligibility_states,'{}'::jsonb) AS eligibility_states
    FROM market.candle_ingestion_runs r
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE l.voided_at IS NULL)::int AS bound_candle_count,
             min(l.candle_ts) FILTER (WHERE l.voided_at IS NULL) AS bound_ts_min,
             max(l.candle_ts) FILTER (WHERE l.voided_at IS NULL) AS bound_ts_max,
             count(*) FILTER (WHERE e.state IS NOT NULL)::int AS quarantine_candle_count,
             count(*) FILTER (WHERE e.state IS NOT NULL AND e.state <> 'CLEAN')::int AS non_clean_count,
             COALESCE(jsonb_object_agg(e.state, e.n) FILTER (WHERE e.state IS NOT NULL), '{}'::jsonb) AS eligibility_states
        FROM market.candle_producer_lineage l
        LEFT JOIN LATERAL (
          SELECT ce.state, count(*)::int AS n
            FROM market.candle_eligibility ce
           WHERE ce.symbol=l.symbol AND ce.broker=l.broker
             AND ce.timeframe='1m' AND ce.ts=l.candle_ts
           GROUP BY ce.state
        ) e ON true
       WHERE l.ingestion_run_id=r.run_id AND l.symbol=r.symbol
         AND l.candle_ts >= $2 AND l.candle_ts < $3
         AND l.voided_at IS NULL
    ) x ON true
    WHERE ${runFilters.join(" AND ")}
    ORDER BY r.started_at, r.run_id`, runParams);

  const summary = {
    total_candles: candles.rows.length,
    proven_candles: candles.rows.filter((x) => x.provenance === "INGESTION_RUN_BOUND").length,
    unproven_no_run_candles: candles.rows.filter((x) => x.provenance === "UNPROVEN_NO_RUN").length,
    testsynth_evidence_candles: candles.rows.filter((x) => x.provenance === "TEST_EVIDENCE_ONLY").length,
    total_runs: runs.rowCount,
    ambiguous_bindings: candles.rows.filter((x) => x.live_binding_count > 1).length,
  };
  const reportRuns = runs.rows.map((r) => {
    const rejected = n(r.rows_rejected);
    const partial = ["partial", "failed"].includes(r.status) || (r.rows_seen != null && r.rows_inserted != null && r.rows_seen !== r.rows_inserted);
    const blockers = n(r.non_clean_count);
    return {
      ingestion_run_id: String(r.run_id), symbol: r.symbol, timeframe: r.timeframe, broker: r.broker,
      source_system: r.source_system, status: r.status, engine_ver: r.engine_ver,
      terminal_login: r.terminal_login == null ? null : String(r.terminal_login), terminal_server: r.terminal_server,
      artifact: { id: r.artifact_id, sha256: r.artifact_sha256 }, spool_file: r.spool_file,
      rows_seen: r.rows_seen, rows_inserted: r.rows_inserted, rows_rejected: rejected,
      started_at: iso(r.started_at), completed_at: iso(r.completed_at),
      flags: { is_partial_run: partial, has_rejections: rejected > 0, has_quarantine_hits: n(r.quarantine_candle_count) > 0, has_canonical_blockers: blockers > 0 },
      coverage: { bound_candle_count: n(r.bound_candle_count), bound_ts_min: iso(r.bound_ts_min), bound_ts_max: iso(r.bound_ts_max), coverage_gap_count: null },
      quarantine: { quarantine_candle_count: n(r.quarantine_candle_count), non_clean_count: blockers, eligibility_states: r.eligibility_states },
      blockers: { canonical_blocker_count: blockers, blockers_missing_run: null, blockers_unknown: null, blockers_exclude: null, blockers_replaced_pending: null },
    };
  });
  const reportCandles = candles.rows.map((c) => ({
    ts: iso(c.ts), symbol: c.symbol, broker: c.broker,
    has_run_evidence: c.has_run_evidence,
    ingestion_run_id: c.ingestion_run_id == null ? null : String(c.ingestion_run_id),
    provenance: c.provenance,
    eligibility_state: c.eligibility_state || "UNKNOWN",
    quarantine_state: "UNKNOWN",
    canonical_state: "PRESENT",
    calendar_state: "NOT_EVALUATED",
    ambiguous_binding: c.live_binding_count > 1,
  }));
  return { report_version: "ingestion-run-lineage-v1-readonly", generated_at: new Date().toISOString(), filters: { symbol: p.symbol.toUpperCase(), timeframe: p.timeframe, from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString(), include_synthetic: p.includeSynthetic, engine_ver_filter: p.engineVerFilter || null, run_id: p.runId || null }, summary, notes: { historical_unproven: summary.unproven_no_run_candles > 0, synthetic_evidence_present: summary.testsynth_evidence_candles > 0, synthetic_warning: summary.testsynth_evidence_candles > 0 ? "TEST_EVIDENCE_ONLY: never valid for certification" : null, quarantine_source: "market.candle_eligibility; no candle_quarantine table exists", calendar_state: "NOT_EVALUATED by this DB-only report; certification layer must apply market calendar", certification_state_changed: false }, candles: reportCandles, runs: reportRuns };
}

(async () => {
  const params = parseArgs(process.argv.slice(2));
  const pool = new Pool(getDbConfig());
  const client = await pool.connect();
  try { console.log(JSON.stringify(await buildReport(client, params), null, 2)); }
  finally { client.release(); await pool.end(); }
})().catch((err) => { console.error(`REPORT_FAILED: ${err.message}`); process.exit(1); });
