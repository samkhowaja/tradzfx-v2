#!/usr/bin/env node
/**
 * P2-C: Compile-Time Temporal Alignment Gate
 *
 * For each condition in a spec, queries actual consecutive-row gaps and
 * compares to condition's lookback window. Warns/fails when gaps exceed
 * safe thresholds — catches silent starvation before it causes 0-trade days.
 *
 * Usage:
 *   node scripts/check-temporal-alignment.js <variantId> [--all-specs]
 *   node scripts/check-temporal-alignment.js gold_scalp_3_choch_fvg
 *   node scripts/check-temporal-alignment.js --all-specs              # all seeded specs
 *
 * Flags:
 *   --all-specs     Check every spec in strategy_specs table
 *   --fail-on-warn  Exit non-zero even on warnings (for CI)
 *   --symbol=SYM    Override symbol (default XAUUSD)
 *   --days=N        Lookback days for gap analysis (default 90)
 *
 * Exit codes:
 *   0 = all conditions pass
 *   1 = warnings (gaps > lookback × 1.5 but < lookback × 3)
 *   2 = failures (median gap > lookback window)
 *   3 = query/processing error
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  statement_timeout: 60000,
  max: 3,
});

// ── helpers ──────────────────────────────────────────────────────────────────

const TF_MINUTES = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };

const SESSION_RANGES = [
  { label: "ASIA", start: 0, end: 6 },
  { label: "LONDON", start: 7, end: 11 },
  { label: "OVERLAP", start: 12, end: 15 },
  { label: "NY", start: 16, end: 20 },
];

function getSessionWindows(spec) {
  const filters = spec.filters || {};
  if (filters.sessions && filters.sessions.length > 0) {
    return SESSION_RANGES.filter((s) => filters.sessions.includes(s.label));
  }
  return SESSION_RANGES;
}

function maxSessionGapMinutes(spec) {
  const windows = getSessionWindows(spec);
  if (windows.length === 0) return 0;
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].start - sorted[i].end;
    if (gap > maxGap) maxGap = gap;
  }
  // wrap-around: last session to first next day
  const wrapGap = 24 + sorted[0].start - sorted[sorted.length - 1].end;
  if (wrapGap > maxGap) maxGap = wrapGap;
  return maxGap * 60; // hours → minutes
}

// Mirror of sessionGapPaddingMinutes() in packages/strategies/src/sqlBuilder.ts
// (P3-C). The compiler pads each condition's lookback by this amount so sparse
// events just before an overnight/weekend closure stay visible at signal time.
// The seed gate must apply the SAME padding or it will false-FAIL specs that
// only pass because of P3-C padding.
const WEEKEND_GAP_PADDING_MINUTES = 2940; // Fri 21:00 → Sun 21:00 UTC
function sessionGapPaddingMinutes(spec) {
  const filters = spec.filters || {};
  const raw = filters.sessions && filters.sessions.length > 0
    ? filters.sessions
    : (filters.session ? [filters.session] : []);
  if (raw.length === 0) return WEEKEND_GAP_PADDING_MINUTES;
  const windows = SESSION_RANGES.filter((s) => raw.includes(s.label));
  if (windows.length === 0) return WEEKEND_GAP_PADDING_MINUTES;
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].start - sorted[i].end;
    if (gap > maxGap) maxGap = gap;
  }
  const wrapGap = 24 + sorted[0].start - sorted[sorted.length - 1].end;
  if (wrapGap > maxGap) maxGap = wrapGap;
  const tradesWeekend = raw.includes("NY") && !raw.includes("ASIA");
  return maxGap * 60 + (tradesWeekend ? WEEKEND_GAP_PADDING_MINUTES : 0);
}

async function loadSpec(specId) {
  const { rows } = await pool.query(
    `SELECT id, name, spec_json FROM strategy_specs WHERE id = $1 OR name = $1 LIMIT 1`,
    [specId]
  );
  if (rows.length === 0) throw new Error(`Spec not found: ${specId}`);
  const spec = typeof rows[0].spec_json === "string" ? JSON.parse(rows[0].spec_json) : rows[0].spec_json;
  return { id: rows[0].id, name: rows[0].name, spec };
}

async function loadAllSpecs() {
  const { rows } = await pool.query(
    `SELECT id, name, spec_json FROM strategy_specs ORDER BY name`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    spec: typeof r.spec_json === "string" ? JSON.parse(r.spec_json) : r.spec_json,
  }));
}

// ── condition analysis ───────────────────────────────────────────────────────

function extractConditions(spec) {
  const conditions = [];
  for (const stage of ["setup", "entry"]) {
    const stageConditions = spec[stage] || [];
    for (let i = 0; i < stageConditions.length; i++) {
      const c = stageConditions[i];
      conditions.push({
        id: c.id || `${stage}_${i}`,
        stage,
        index: i,
        feature: c.feature,
        tf: c.tf,
        lookbackBars: c.lookbackBars || null,
        direction: c.direction,
        event_type: c.event_type,
        zone_kind: c.zone_kind,
        session: c.session,
      });
    }
  }
  return conditions;
}

function getFeatureTable(featureName) {
  // Specs use full table names (features_bias) or short names (bias).
  // Handle both: if already starts with "features_", use as-is.
  if (featureName.startsWith("features_")) return featureName;

  // Map feature alias → table name (from registry conventions)
  const map = {
    bias: "features_bias",
    htf_bias: "features_htf_bias",
    direction_state: "features_direction_state",
    zone: "features_zone",
    ifvg: "features_ifvg",
    order_block: "features_order_block",
    structure: "features_structure",
    sweep: "features_sweep",
    displacement: "features_displacement",
    pricing: "features_pricing",
    atr: "features_atr",
    session: "features_session",
    spread: "features_spread",
    zone_retest: "features_zone_retest",
    opening_range: "features_opening_range",
    candle_pattern: "features_candle_pattern",
    pivot: "features_pivot",
    liquidity_pools: "features_liquidity_pools",
    indicator: "features_indicator",
    moving_average: "features_moving_average",
    time_of_day_edge: "features_time_of_day_edge",
    time_of_day: "features_time_of_day",
    correlation: "features_correlation",
  };
  return map[featureName] || `features_${featureName}`;
}

async function analyzeCondition(cond, spec, symbol, lookbackDays) {
  const table = getFeatureTable(cond.feature);
  const tf = cond.tf;
  const lookbackBars = cond.lookbackBars || 96; // fallback
  const lookbackMinutes = lookbackBars * (TF_MINUTES[tf] || 60) + sessionGapPaddingMinutes(spec);
  const sessionGapMinutes = maxSessionGapMinutes(spec);

  const startDate = new Date(Date.now() - lookbackDays * 86400000).toISOString();

  // Build WHERE clause
  const filters = [`symbol = '${symbol}'`, `tf = '${tf}'`, `ts >= '${startDate}'`];
  if (cond.direction && table !== "features_structure") {
    filters.push(`direction = '${cond.direction}'`);
  }
  if (cond.event_type && table === "features_structure") {
    filters.push(`event_type = '${cond.event_type}'`);
  }
  if (cond.event_type && table === "features_sweep") {
    filters.push(`sweep_type = '${cond.event_type}'`);
  }

  const query = `SELECT ts, EXTRACT(EPOCH FROM LEAD(ts) OVER (ORDER BY ts) - ts) / 60 AS gap_minutes
    FROM ${table} WHERE ${filters.join(" AND ")} ORDER BY ts`;

  let rows;
  try {
    ({ rows } = await pool.query(query));
  } catch (err) {
    return {
      conditionId: cond.id,
      stage: cond.stage,
      table,
      tf,
      lookbackMinutes,
      sessionGapMinutes,
      totalRows: null,
      error: err.message,
      verdict: "ERROR",
    };
  }

  if (rows.length < 2) {
    return {
      conditionId: cond.id,
      stage: cond.stage,
      table,
      tf,
      lookbackMinutes,
      sessionGapMinutes,
      totalRows: rows.length,
      minGapMinutes: null,
      maxGapMinutes: null,
      medianGapMinutes: null,
      sessionGapExceeded: null,
      lookbackExceeded: null,
      verdict: rows.length === 0 ? "NO_DATA" : "INSUFFICIENT",
    };
  }

  const gaps = rows
    .filter((r) => r.gap_minutes !== null)
    .map((r) => Number(r.gap_minutes))
    .filter((g) => !Number.isNaN(g) && Number.isFinite(g));
  if (gaps.length === 0) {
    return {
      conditionId: cond.id,
      stage: cond.stage,
      table,
      tf,
      lookbackMinutes,
      sessionGapMinutes,
      totalRows: rows.length,
      minGapMinutes: 0,
      maxGapMinutes: 0,
      medianGapMinutes: 0,
      sessionGapExceeded: false,
      lookbackExceeded: false,
      verdict: "OK",
    };
  }

  gaps.sort((a, b) => a - b);
  const minGap = gaps[0];
  const maxGap = gaps[gaps.length - 1];
  const medianGap = gaps.length % 2 === 1
    ? gaps[Math.floor(gaps.length / 2)]
    : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;

  const sessionGapExceeded = sessionGapMinutes > 0 && medianGap > sessionGapMinutes;
  const lookbackExceeded = medianGap > lookbackMinutes;

  let verdict = "OK";
  if (lookbackExceeded) {
    verdict = "FAIL";
  } else if (sessionGapExceeded) {
    verdict = "WARN";
  }

  return {
    conditionId: cond.id,
    stage: cond.stage,
    table,
    tf,
    lookbackMinutes,
    sessionGapMinutes,
    totalRows: rows.length,
    minGapMinutes: Math.round(minGap * 10) / 10,
    maxGapMinutes: Math.round(maxGap * 10) / 10,
    medianGapMinutes: Math.round(medianGap * 10) / 10,
    sessionGapExceeded,
    lookbackExceeded,
    verdict,
  };
}

// ── report ───────────────────────────────────────────────────────────────────

function printReport(results, spec, failOnWarn) {
  const lines = [];
  const feature = spec.id || spec.name || "unknown";

  lines.push(`\n══════════════════════════════════════════════════════════`);
  lines.push(`  Temporal Alignment Gate: ${feature}`);
  lines.push(`  Sessions: ${getSessionWindows(spec).map(s => s.label).join(", ") || "none"}`);
  lines.push(`══════════════════════════════════════════════════════════\n`);

  let ok = 0,
    warn = 0,
    fail = 0,
    error = 0,
    noData = 0;

  for (const r of results) {
    const icon = r.verdict === "OK" ? "✓" : r.verdict === "WARN" ? "⚠" : r.verdict === "FAIL" ? "✗" : r.verdict === "NO_DATA" ? "∅" : "!";
    lines.push(`  ${icon} ${r.stage}.${r.conditionId} @ ${r.tf} [${r.table}]`);

    if (r.error) {
      lines.push(`      ERROR: ${r.error}`);
      error++;
    } else if (r.verdict === "NO_DATA") {
      lines.push(`      No rows found in lookback window`);
      noData++;
    } else if (r.verdict === "INSUFFICIENT") {
      lines.push(`      Only ${r.totalRows} row(s) — need ≥2 for gap analysis`);
      ok++;
    } else {
      lines.push(`      rows=${r.totalRows} medianGap=${r.medianGapMinutes}m maxGap=${r.maxGapMinutes}m lookback=${r.lookbackMinutes}m sessionGap=${r.sessionGapMinutes}m`);
      if (r.verdict === "FAIL") {
        lines.push(`      ✗ FAIL: median gap (${r.medianGapMinutes}m) > lookback window (${r.lookbackMinutes}m) — conditions likely starve`);
        fail++;
      } else if (r.verdict === "WARN") {
        lines.push(`      ⚠ WARN: median gap (${r.medianGapMinutes}m) > session gap (${r.sessionGapMinutes}m) — overnight/weekend events may be missed`);
        warn++;
      } else {
        ok++;
      }
    }
    lines.push("");
  }

  // Summary
  lines.push(`  ─────────────────────────────────────────────`);
  lines.push(`  Total: ${results.length}  OK: ${ok}  WARN: ${warn}  FAIL: ${fail}  ERROR: ${error}  NO_DATA: ${noData}`);
  lines.push(`\n`);

  console.log(lines.join("\n"));

  if (fail > 0) return 2;
  if (warn > 0 && failOnWarn) return 1;
  if (error > 0) return 3;
  if (warn > 0) return 1;
  return 0;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const allSpecs = args.includes("--all-specs");
  const failOnWarn = args.includes("--fail-on-warn");
  const symbolArg = args.find((a) => a.startsWith("--symbol="));
  const symbol = symbolArg ? symbolArg.slice(9) : "XAUUSD";
  const daysArg = args.find((a) => a.startsWith("--days="));
  const lookbackDays = daysArg ? parseInt(daysArg.slice(7), 10) : 90;
  const specId = args.find((a) => !a.startsWith("--"));

  let specs;

  if (allSpecs) {
    specs = await loadAllSpecs();
  } else if (specId) {
    const spec = await loadSpec(specId);
    specs = [spec];
  } else {
    console.error("Usage: node scripts/check-temporal-alignment.js <variantId> [--all-specs] [--symbol=SYM] [--days=N] [--fail-on-warn]");
    process.exit(1);
  }

  let worstExit = 0;

  for (const spec of specs) {
    const conditions = extractConditions(spec.spec);
    if (conditions.length === 0) {
      console.log(`No conditions in spec "${spec.name}", skipping`);
      continue;
    }

    const results = [];
    for (const cond of conditions) {
      const result = await analyzeCondition(cond, spec.spec, symbol, lookbackDays);
      results.push(result);
    }

    const exitCode = printReport(results, spec.spec, failOnWarn);
    if (exitCode > worstExit) worstExit = exitCode;
  }

  await pool.end();
  process.exit(worstExit);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(3);
});
