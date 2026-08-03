/**
 * Read-only causal FVG structure diagnostics.
 * No DB writes, schema changes, strategy changes, or live behavior.
 *
 * Usage:
 * node scripts/analyze-fvg-structure-diagnostics.js --symbols=XAUUSD,EURUSD --tfs=5m,15m,1h --days=90 --output=reports/fvg-structure-diagnostics
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function arg(name, fallback) {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const symbols = arg("symbols", "XAUUSD,EURUSD,GBPUSD").split(",").map((s) => s.trim()).filter(Boolean);
const tfs = arg("tfs", "5m,15m,1h").split(",").map((s) => s.trim()).filter(Boolean);
const days = Number(arg("days", "90"));
const outputDir = path.resolve(process.cwd(), arg("output", "reports/fvg-structure-diagnostics"));
const tfMap = {
  "1m": { external: "15m", internal: "5m" },
  "5m": { external: "1h", internal: "15m" },
  "15m": { external: "1h", internal: "1h" },
  "1h": { external: "4h", internal: "1h" },
  "4h": { external: "1d", internal: "4h" },
};
const candleTable = {
  "1m": "candles_1m",
  "5m": "candles_5m",
  "15m": "candles_15m",
  "1h": "candles_1h",
  "4h": "candles_4h",
};

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

function classify(row) {
  const direction = row.fvg_direction;
  const external = row.external_direction;
  const internalEvent = row.internal_event_type;
  const internalDirection = row.internal_event_direction;
  const externalEvent = row.external_event_type;
  const externalSweep = row.external_sweep_ts != null;
  const internalSweep = row.internal_sweep_ts != null;

  let biasCategory = "no_bias_data";
  if (external != null) {
    if (external === "neutral") biasCategory = "neutral";
    else if (external === direction && internalDirection === direction) biasCategory = "strong_alignment";
    else if (external === direction && internalDirection && internalDirection !== direction) biasCategory = "htf_aligned_itf_pullback";
    else if (external !== direction) biasCategory = "conflict";
    else biasCategory = "neutral";
  }

  let structuralCategory = "insufficient_context";
  if (external == null) structuralCategory = "insufficient_context";
  else if (external === "neutral" || (!externalEvent && !internalEvent)) structuralCategory = "range_candidate";
  else if (external !== direction && externalSweep && internalDirection === direction && (internalEvent === "bos" || internalEvent === "choch" || internalEvent === "mss")) structuralCategory = "reversal_candidate";
  else if (external === direction && internalEvent === "choch" && internalDirection !== direction && !externalSweep) structuralCategory = "pullback_candidate";
  else if (external === direction && (!internalEvent || internalDirection === direction) && !internalSweep) structuralCategory = "trend_continuation_candidate";
  else structuralCategory = "insufficient_context";

  return { biasCategory, structuralCategory };
}

function eventAvailableAtSql(alias) {
  return `CASE ${alias}.tf
    WHEN '1m' THEN ${alias}.ts + INTERVAL '3 minutes'
    WHEN '5m' THEN ${alias}.ts + INTERVAL '25 minutes'
    WHEN '15m' THEN ${alias}.ts + INTERVAL '120 minutes'
    WHEN '1h' THEN ${alias}.ts + INTERVAL '10 hours'
    WHEN '4h' THEN ${alias}.ts + INTERVAL '60 hours'
    WHEN '1d' THEN ${alias}.ts + INTERVAL '20 days'
    ELSE ${alias}.ts
  END`;
}

function summarizeBy(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field] ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].map(([key, group]) => {
    const touched = group.filter((r) => r.first_touch_at != null).length;
    const mitigated = group.filter((r) => r.mitigated_at != null).length;
    const invalidated = group.filter((r) => r.invalidated_at != null).length;
    const terminal = group.filter((r) => r.mitigated_at != null || r.invalidated_at != null).length;
    const medianMinutes = (column) => {
      const values = group
        .filter((r) => r[column] != null)
        .map((r) => (new Date(r[column]).getTime() - new Date(r.fvg_ts).getTime()) / 60000)
        .sort((a, b) => a - b);
      if (!values.length) return null;
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    };
    const normalized = (column) => {
      const values = group
        .filter((r) => r[column] != null && Number(r.top) > Number(r.bottom))
        .map((r) => Number(r[column]) / (Number(r.top) - Number(r.bottom)))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (!values.length) return null;
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    };
    const normalizedByAtr = (column) => {
      const values = group.filter((r) => r[column] != null && r.atr_value != null)
        .map((r) => Number(r[column]) / Number(r.atr_value))
        .filter(Number.isFinite).sort((a, b) => a - b);
      if (!values.length) return null;
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    };
    return [key, {
      count: group.length,
      touched,
      mitigated,
      invalidated,
      untouched: group.length - touched,
      touchRate: group.length ? touched / group.length : null,
      mitigationRate: terminal ? mitigated / terminal : null,
      invalidationRate: terminal ? invalidated / terminal : null,
      outcome: {
        mitigatedOnly: group.filter((r) => r.mitigated_at != null && r.invalidated_at == null).length,
        invalidatedOnly: group.filter((r) => r.mitigated_at == null && r.invalidated_at != null).length,
        both: group.filter((r) => r.mitigated_at != null && r.invalidated_at != null).length,
        neither: group.filter((r) => r.mitigated_at == null && r.invalidated_at == null).length,
      },
      medianMinutesToTouch: medianMinutes("first_touch_at"),
      medianMinutesToMitigation: medianMinutes("mitigated_at"),
      medianMinutesToInvalidation: medianMinutes("invalidated_at"),
      medianFvgWidths: normalized("max_favorable") === null ? null : {
        favorableExcursion: normalized("max_favorable"),
        adverseExcursion: normalized("max_adverse"),
      },
      medianAtrNormalized: {
        favorableExcursion: normalizedByAtr("max_favorable"),
        adverseExcursion: normalizedByAtr("max_adverse"),
      },
    }];
  }));
}

function outcomeLabel(row) {
  if (row.mitigated_at != null && row.invalidated_at != null) return "both";
  if (row.mitigated_at != null) return "mitigated_only";
  if (row.invalidated_at != null) return "invalidated_only";
  return "neither";
}

async function run(symbol, tf) {
  const mapping = tfMap[tf];
  if (!mapping) throw new Error(`Unsupported diagnostic timeframe: ${tf}`);
  const from = new Date(Date.now() - days * 86400000);
  const sql = `
    SELECT
      z.symbol,
      z.tf AS fvg_tf,
      z.ts AS fvg_ts,
      z.ts AS fvg_id_ts,
      z.direction AS fvg_direction,
      z.top,
      z.bottom,
      z.gap_atr_ratio,
      z.middle_body_ratio,
      z.first_touch_at,
      z.mitigated_at,
      z.invalidated_at,
      z.fill_pct,
      atr.effective_value AS atr_value,
      excursion.max_favorable,
      excursion.max_adverse,
      excursion.future_candle_count,
      excursion.future_last_ts,
      ext.direction AS external_direction,
      ext.ts AS external_direction_ts,
      ext.event_type AS external_event_type,
      ext.direction AS external_event_direction,
      ext.ts AS external_event_ts,
      ext.available_ts AS external_event_available_ts,
      es.ts AS external_sweep_ts,
      ins.event_type AS internal_event_type,
      ins.direction AS internal_event_direction,
      ins.ts AS internal_event_ts,
      ins.available_ts AS internal_event_available_ts,
      isw.ts AS internal_sweep_ts
    FROM features_zone z
    LEFT JOIN LATERAL (
      SELECT direction, ts
      FROM features_direction_state
      WHERE symbol = z.symbol AND tf = $2 AND ts <= z.ts
      ORDER BY ts DESC LIMIT 1
    ) ext_state ON true
    LEFT JOIN LATERAL (
      SELECT event_type, direction, ts, tf,
        ${eventAvailableAtSql("s")} AS available_ts
      FROM features_structure s
      WHERE symbol = z.symbol AND tf = $2
        AND ${eventAvailableAtSql("s")} <= z.ts
      ORDER BY available_ts DESC LIMIT 1
    ) ext ON true
    LEFT JOIN LATERAL (
      SELECT ts
      FROM features_sweep
      WHERE symbol = z.symbol AND tf = $2 AND ts <= z.ts
      ORDER BY ts DESC LIMIT 1
    ) es ON true
    LEFT JOIN LATERAL (
      SELECT event_type, direction, ts, tf,
        ${eventAvailableAtSql("s")} AS available_ts
      FROM features_structure s
      WHERE symbol = z.symbol AND tf = $3
        AND ${eventAvailableAtSql("s")} <= z.ts
      ORDER BY available_ts DESC LIMIT 1
    ) ins ON true
    LEFT JOIN LATERAL (
      SELECT ts
      FROM features_sweep
      WHERE symbol = z.symbol AND tf = $3 AND ts <= z.ts
      ORDER BY ts DESC LIMIT 1
    ) isw ON true
    LEFT JOIN LATERAL (
      SELECT effective_value
      FROM features_atr
      WHERE symbol = z.symbol AND tf = z.tf AND ts <= z.ts
        AND period = 14 AND is_valid = true
      ORDER BY ts DESC LIMIT 1
    ) atr ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(c.ts) AS future_candle_count,
        MAX(c.ts) AS future_last_ts,
        CASE WHEN z.direction = 'bullish'
          THEN MAX(c.h) - ((z.top + z.bottom) / 2.0)
          ELSE ((z.top + z.bottom) / 2.0) - MIN(c.l)
        END AS max_favorable,
        CASE WHEN z.direction = 'bullish'
          THEN ((z.top + z.bottom) / 2.0) - MIN(c.l)
          ELSE MAX(c.h) - ((z.top + z.bottom) / 2.0)
        END AS max_adverse
      FROM ${candleTable[tf]} c
      WHERE c.symbol = z.symbol
        AND c.ts > z.ts
        AND c.ts <= z.ts + ($6::text)::interval
      
    ) excursion ON true
    WHERE z.symbol = $1 AND z.tf = $4 AND z.zone_kind = 'fvg' AND z.ts >= $5
    ORDER BY z.ts, z.direction, z.top, z.bottom;
  `;
  // ext_state is joined separately so direction_state remains canonical.
  const corrected = sql.replace("ext.direction AS external_direction", "ext_state.direction AS external_direction").replace("ext.ts AS external_direction_ts", "ext_state.ts AS external_direction_ts");
  const horizon = tf === "5m" ? "24 hours" : tf === "15m" ? "3 days" : "14 days";
  const result = await pool.query(corrected, [symbol, mapping.external, mapping.internal, tf, from, horizon]);
  const rows = result.rows.map((row) => {
    const labels = classify(row);
    const horizonMs = (tf === "5m" ? 24 * 60 : tf === "15m" ? 3 * 24 * 60 : 14 * 24 * 60) * 60000;
    const expectedEnd = new Date(new Date(row.fvg_ts).getTime() + horizonMs);
    const censored = row.future_last_ts == null || new Date(row.future_last_ts) < expectedEnd;
    return {
      fvg_id: `${row.symbol}:${row.fvg_tf}:${new Date(row.fvg_ts).toISOString()}:${row.fvg_direction}:${row.top}:${row.bottom}`,
      ...row,
      ...labels,
      horizon_censored: censored,
      temporal_violations: ["external_direction_ts", "external_event_available_ts", "external_sweep_ts", "internal_event_available_ts", "internal_sweep_ts"]
        .filter((key) => row[key] && new Date(row[key]).getTime() > new Date(row.fvg_ts).getTime()),
    };
  });
  const validation = {
    rows: rows.length,
    futureJoinRows: rows.filter((r) => r.temporal_violations.length).length,
    duplicateIds: rows.length - new Set(rows.map((r) => r.fvg_id)).size,
    categoryTotal: rows.reduce((n, r) => n + (r.structuralCategory ? 1 : 0), 0),
    noBiasData: rows.filter((r) => r.biasCategory === "no_bias_data").length,
    neutral: rows.filter((r) => r.biasCategory === "neutral").length,
    mssRows: rows.filter((r) => r.external_event_type === "mss" || r.internal_event_type === "mss").length,
  };
  const outcomes = {
    horizon: {
      complete: rows.filter((row) => !row.horizon_censored).length,
      censored: rows.filter((row) => row.horizon_censored).length,
    },
    byDirection: summarizeBy(rows, "fvg_direction"),
    byBiasCategory: summarizeBy(rows, "biasCategory"),
    byStructuralCategory: summarizeBy(rows, "structuralCategory"),
    byExclusiveOutcome: summarizeBy(rows.map((row) => ({ ...row, exclusiveOutcome: outcomeLabel(row) })), "exclusiveOutcome"),
    completeOnly: {
      byDirection: summarizeBy(rows.filter((row) => !row.horizon_censored), "fvg_direction"),
      byBiasCategory: summarizeBy(rows.filter((row) => !row.horizon_censored), "biasCategory"),
      byStructuralCategory: summarizeBy(rows.filter((row) => !row.horizon_censored), "structuralCategory"),
      byExclusiveOutcome: summarizeBy(rows.filter((row) => !row.horizon_censored).map((row) => ({ ...row, exclusiveOutcome: outcomeLabel(row) })), "exclusiveOutcome"),
    },
  };
  return { symbol, tf, externalTf: mapping.external, internalTf: mapping.internal, validation, outcomes, rows };
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  for (const symbol of symbols) for (const tf of tfs) {
    const result = await run(symbol, tf);
    results.push(result);
    console.log(`[fvg-structure] ${symbol} ${tf}: ${result.rows.length} rows, future=${result.validation.futureJoinRows}, duplicates=${result.validation.duplicateIds}`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    symbols,
    tfs,
    days,
    fixedTfMap: tfMap,
    source: "persisted features_zone plus causal lateral joins",
    readOnly: true,
    pivotWarning: "features_pivot center timestamps are not used; pivot confirmation offset remains a separate audit requirement",
    mssWarning: "MSS joins use conservative pivot confirmation offsets; confirmation_ts remains separately audited",
    results,
  };
  fs.writeFileSync(path.join(outputDir, "fvg-structure-diagnostics.json"), JSON.stringify(report, null, 2));
  await pool.end();
})().catch(async (error) => {
  console.error(error.stack || error);
  await pool.end();
  process.exitCode = 1;
});
