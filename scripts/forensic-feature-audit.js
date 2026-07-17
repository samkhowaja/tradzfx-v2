#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: ".env.local" });

const OUT = path.join("docs", "proposals", "feature-forensic-audit-report.md");
const WINDOW_DAYS = Number(process.env.AUDIT_WINDOW_DAYS || 90);
const EVENT_TABLES = new Set([
  "features_pivot",
  "features_structure",
  "features_sweep",
  "features_zone",
  "features_ifvg",
  "features_order_block",
  "features_eq_liquidity",
  "features_liquidity_pools",
  "features_opening_range",
  "features_session_hl",
  "features_zone_retest",
]);

// Symbols that are sparse reference indices (e.g., DXY) or otherwise not
// expected to have full feature coverage across every timeframe.
const SPARSE_SYMBOLS = new Set(["DXY"]);

// Lifecycle tables where historical rows are expected to be marked stale
// because the feature only stays fresh until it is touched/invalidated.
// The PIT backtester uses invalidated_at/mitigated_at with a short lookback,
// so a static is_fresh flag that is stale beyond that lookback is not a bug.
const SKIP_FRESHNESS_STALENESS = new Set([
  "features_ifvg",
  "features_zone",
  "features_order_block",
]);

// Tables that are intentionally not backfilled for coverage checks.
const SKIP_COVERAGE_TABLES = new Set(["features_spread"]);

const CONCEPTS = {
  features_atr: "Volatility via average true range; used to normalize stops, displacement, and noise by symbol/timeframe.",
  features_bias: "Directional market structure bias from swing context; trader shorthand for whether order flow favors longs, shorts, or chop.",
  features_bollinger: "Bollinger band envelope around price; detects stretched/mean-reversion context.",
  features_candle_pattern: "Single/multi-candle pattern labels such as engulfing, pin bar, or rejection shapes.",
  features_correlation: "Cross-market correlation, mainly DXY versus traded FX symbols.",
  features_displacement: "Impulse candle/body expansion; tries to separate real initiative flow from ordinary candles.",
  features_ema_cross: "Legacy EMA crossover state.",
  features_eq_liquidity: "Equal highs/lows liquidity resting near repeated swing prices.",
  features_htf_bias: "Multi-timeframe bias tree projected to execution timeframes.",
  features_ifvg: "Inversion fair value gaps: failed/reclaimed FVG zones used as continuation/reversal context.",
  features_indicator: "Generic named indicators such as RSI/MACD-style values.",
  features_keltner: "Keltner channel volatility envelope.",
  features_liquidity_pools: "Clustered resting liquidity above highs or below lows.",
  features_moving_average: "Consolidated moving average values and slopes.",
  features_opening_range: "Session opening range high/low and breakout state.",
  features_order_block: "Institutional candle/zone proxy around displacement origin.",
  features_pivot: "Confirmed swing highs/lows.",
  features_pricing: "Premium/discount/OTE position inside a dealing range.",
  features_session: "Market session label and timing context.",
  features_session_hl: "Session high/low levels.",
  features_sma_cross: "Legacy SMA crossover state.",
  features_spread: "Bid/ask spread and spread quality gate.",
  features_structure: "Break of structure, market structure shift, and change of character events.",
  features_sweep: "Liquidity sweep events through prior highs/lows.",
  features_time_of_day_edge: "Hour/session historical expectancy profile.",
  features_zone: "Supply/demand/FVG zones with lifecycle freshness.",
  features_zone_retest: "Retest/touch events against previously detected zones.",
};

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 4,
  statement_timeout: 120000,
});

function qident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function pct(n, d) {
  if (!d) return "0.0%";
  return `${((Number(n) / Number(d)) * 100).toFixed(1)}%`;
}

function mdTable(headers, rows) {
  const safe = (v) => String(v ?? "").replace(/\n/g, " ").replace(/\|/g, "\\|");
  return [
    `| ${headers.map(safe).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(safe).join(" | ")} |`),
  ].join("\n");
}

function inferTimeCol(cols) {
  for (const c of ["bar_time", "ts", "timestamp", "time", "date"]) {
    if (cols.some((x) => x.column_name === c)) return c;
  }
  return null;
}

function criticalColumns(cols, table) {
  const skip = new Set([
    "id", "symbol", "tf", "ts", "bar_time", "timestamp", "time", "date",
    "created_at", "updated_at", "is_fresh", "fresh_until", "invalidated_at",
    "mitigated_at", "first_touched_at", "last_seen_at", "origin_zone_id",
  ]);
  // The moving_average table intentionally mixes per-period value rows and
  // cross rows in one table; cross-specific columns are NULL on value rows.
  if (table === "features_moving_average") {
    skip.add("direction");
    skip.add("fast_value");
    skip.add("slow_value");
  }
  return cols
    .filter((c) => !skip.has(c.column_name))
    .filter((c) => !String(c.data_type).includes("json"))
    .map((c) => c.column_name)
    .slice(0, 14);
}

function tfFromCandleTable(table) {
  const m = table.match(/^candles_(.+)$/);
  if (!m) return null;
  return m[1].replace("_utc", "").replace("_ny", "");
}

async function rows(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function scalar(sql, params = []) {
  const r = await rows(sql, params);
  return r[0];
}

async function tableColumns(table) {
  return rows(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
}

async function main() {
  const generatedAt = (await scalar("SELECT NOW() AS now")).now;
  const featureTables = (await rows(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'features_%'
     ORDER BY table_name`,
  )).map((r) => r.table_name);

  const candleTables = (await rows(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'candles_%'
     ORDER BY table_name`,
  )).map((r) => r.table_name);

  const candleCounts = [];
  for (const table of candleTables) {
    const cols = await tableColumns(table);
    const timeCol = inferTimeCol(cols);
    const hasSymbol = cols.some((c) => c.column_name === "symbol");
    if (!timeCol || !hasSymbol) continue;
    const hasTf = cols.some((c) => c.column_name === "tf");
    const tfExpr = hasTf ? "tf" : `$2::text`;
    const res = await rows(
      `SELECT symbol, ${tfExpr} AS tf, count(*)::bigint AS rows_90d,
              min(${qident(timeCol)}) AS first_ts, max(${qident(timeCol)}) AS last_ts
       FROM ${qident(table)}
       WHERE ${qident(timeCol)} >= NOW() - ($1::text || ' days')::interval
       GROUP BY symbol, ${tfExpr}
       ORDER BY symbol, ${tfExpr}`,
      [WINDOW_DAYS, tfFromCandleTable(table)],
    );
    for (const r of res) candleCounts.push({ table, ...r });
  }

  const byFeature = [];
  const anomalies = [];

  for (const table of featureTables) {
    const cols = await tableColumns(table);
    const colNames = cols.map((c) => c.column_name);
    const timeCol = inferTimeCol(cols);
    const hasSymbol = colNames.includes("symbol");
    const hasTf = colNames.includes("tf");
    const hasFresh = colNames.includes("is_fresh");
    const critical = criticalColumns(cols, table);
    const feature = {
      table,
      cols,
      timeCol,
      hasTf,
      hasFresh,
      critical,
      groups: [],
      nulls: [],
      freshness: [],
      degeneracy: [],
      boundary: [],
      weekendRows: [],
      recentGap: [],
    };

    if (!timeCol || !hasSymbol) {
      anomalies.push({ severity: "HIGH", table, issue: "Cannot audit rows because table lacks symbol or time column.", evidence: `timeCol=${timeCol || "none"}` });
      byFeature.push(feature);
      continue;
    }

    const tfExpr = hasTf ? "tf" : "'n/a'::text";
    feature.groups = await rows(
      `SELECT symbol, ${tfExpr} AS tf, count(*)::bigint AS rows_90d,
              min(${qident(timeCol)}) AS first_ts, max(${qident(timeCol)}) AS last_ts
       FROM ${qident(table)}
       WHERE ${qident(timeCol)} >= NOW() - ($1::text || ' days')::interval
       GROUP BY symbol, ${tfExpr}
       ORDER BY symbol, ${tfExpr}`,
      [WINDOW_DAYS],
    );

    if (hasFresh) {
      feature.freshness = await rows(
        `SELECT symbol, ${tfExpr} AS tf,
                count(*) FILTER (WHERE is_fresh IS TRUE)::bigint AS fresh,
                count(*) FILTER (WHERE is_fresh IS FALSE)::bigint AS stale,
                count(*) FILTER (WHERE is_fresh IS NULL)::bigint AS null_fresh,
                count(*)::bigint AS total
         FROM ${qident(table)}
         WHERE ${qident(timeCol)} >= NOW() - ($1::text || ' days')::interval
         GROUP BY symbol, ${tfExpr}
         ORDER BY symbol, ${tfExpr}`,
        [WINDOW_DAYS],
      );
      for (const r of feature.freshness) {
        if (!SKIP_FRESHNESS_STALENESS.has(table) && Number(r.total) > 0 && Number(r.stale) / Number(r.total) > 0.8) {
          anomalies.push({ severity: "HIGH", table, symbol: r.symbol, tf: r.tf, issue: "`is_fresh=false` dominates >80%.", evidence: `${r.stale}/${r.total} stale (${pct(r.stale, r.total)})` });
        }
      }
    }

    if (critical.length) {
      const selects = critical.map((c) => `count(*) FILTER (WHERE ${qident(c)} IS NULL)::bigint AS ${qident(`null_${c}`)}`).join(",\n");
      feature.nulls = await rows(
        `SELECT symbol, ${tfExpr} AS tf, count(*)::bigint AS total, ${selects}
         FROM ${qident(table)}
         WHERE ${qident(timeCol)} >= NOW() - ($1::text || ' days')::interval
         GROUP BY symbol, ${tfExpr}
         ORDER BY symbol, ${tfExpr}`,
        [WINDOW_DAYS],
      );
      for (const r of feature.nulls) {
        for (const c of critical) {
          // local_agreement is undefined by design for 1m/5m because those TFs
          // have zero local weight in the HTF bias tree.
          if (table === "features_htf_bias" && c === "local_agreement" && ["1m", "5m"].includes(String(r.tf))) {
            continue;
          }
          const n = Number(r[`null_${c}`] || 0);
          if (Number(r.total) >= 10 && n / Number(r.total) > 0.2) {
            anomalies.push({ severity: "MED", table, symbol: r.symbol, tf: r.tf, issue: `Critical column ${c} is >20% NULL.`, evidence: `${n}/${r.total} NULL (${pct(n, r.total)})` });
          }
        }
      }
    }

    const groupTotal = feature.groups.reduce((s, r) => s + Number(r.rows_90d), 0);
    const degCols = groupTotal <= 100000
      ? critical.filter((c) => !["price", "level_price", "high", "low", "open", "close"].includes(c)).slice(0, 4)
      : [];
    if (degCols.length) {
      const selects = degCols.map((c) => `count(DISTINCT ${qident(c)})::bigint AS ${qident(`distinct_${c}`)}`).join(",\n");
      feature.degeneracy = await rows(
        `SELECT symbol, ${tfExpr} AS tf, count(*)::bigint AS total, ${selects}
         FROM ${qident(table)}
         WHERE ${qident(timeCol)} >= NOW() - ($1::text || ' days')::interval
         GROUP BY symbol, ${tfExpr}
         ORDER BY symbol, ${tfExpr}`,
        [WINDOW_DAYS],
      );
      for (const r of feature.degeneracy) {
        for (const c of degCols) {
          if (Number(r.total) > 100 && Number(r[`distinct_${c}`]) <= 1) {
            anomalies.push({ severity: "LOW", table, symbol: r.symbol, tf: r.tf, issue: `Column ${c} is degenerate in 90d.`, evidence: `${r[`distinct_${c}`]} distinct value(s) across ${r.total} rows` });
          }
        }
      }
    }

    feature.boundary = await rows(
      `SELECT symbol, ${tfExpr} AS tf,
              count(*) FILTER (WHERE ${qident(timeCol)} < NOW() - (($1 - 7)::text || ' days')::interval)::bigint AS first_7d,
              count(*) FILTER (WHERE ${qident(timeCol)} >= NOW() - interval '7 days')::bigint AS last_7d,
              max(${qident(timeCol)}) AS last_ts
       FROM ${qident(table)}
       WHERE ${qident(timeCol)} >= NOW() - ($1::text || ' days')::interval
       GROUP BY symbol, ${tfExpr}
       ORDER BY symbol, ${tfExpr}`,
      [WINDOW_DAYS],
    );

    feature.weekendRows = await rows(
      `SELECT symbol, ${tfExpr} AS tf, count(*)::bigint AS weekend_rows
       FROM ${qident(table)}
       WHERE ${qident(timeCol)} >= NOW() - ($1::text || ' days')::interval
         AND EXTRACT(ISODOW FROM ${qident(timeCol)}) IN (6, 7)
       GROUP BY symbol, ${tfExpr}
       HAVING count(*) > 0
       ORDER BY symbol, ${tfExpr}`,
      [WINDOW_DAYS],
    );
    for (const r of feature.weekendRows) {
      anomalies.push({ severity: "LOW", table, symbol: r.symbol, tf: r.tf, issue: "Rows exist on weekend timestamps.", evidence: `${r.weekend_rows} weekend rows in 90d` });
    }

    for (const g of feature.groups) {
      const count = Number(g.rows_90d);
      if (count > 10000 && EVENT_TABLES.has(table)) {
        anomalies.push({ severity: "MED", table, symbol: g.symbol, tf: g.tf, issue: "Event feature fires >10,000 times in 90d; likely noisy.", evidence: `${count} rows` });
      }
      if (count < 5) {
        anomalies.push({ severity: "MED", table, symbol: g.symbol, tf: g.tf, issue: "Feature is too rare in 90d.", evidence: `${count} rows` });
      }
    }

    if (hasTf) {
      for (const c of candleCounts) {
        if (!["1m", "5m", "15m", "1h", "4h", "1d"].includes(String(c.tf))) continue;
        // 1m features are intentionally not backfilled by the canonical pipeline;
        // flagging them as missing creates false-positive HIGH anomalies.
        if (String(c.tf) === "1m") continue;
        const match = feature.groups.find((g) => g.symbol === c.symbol && g.tf === c.tf);
        if (SKIP_COVERAGE_TABLES.has(table) || SPARSE_SYMBOLS.has(c.symbol)) continue;
        if (!match && !["features_correlation", "features_time_of_day_edge"].includes(table)) {
          anomalies.push({ severity: EVENT_TABLES.has(table) ? "LOW" : "HIGH", table, symbol: c.symbol, tf: c.tf, issue: "No feature rows despite candle coverage.", evidence: `${c.table} has ${c.rows_90d} rows` });
        } else if (match && !EVENT_TABLES.has(table)) {
          const ratio = Number(match.rows_90d) / Number(c.rows_90d);
          if (Number(c.rows_90d) > 1000 && ratio < 0.05) {
            anomalies.push({ severity: "HIGH", table, symbol: c.symbol, tf: c.tf, issue: "Dense feature row count is <5% of candle count.", evidence: `${match.rows_90d}/${c.rows_90d} rows (${pct(match.rows_90d, c.rows_90d)})` });
          }
        }
      }
    }

    byFeature.push(feature);
  }

  const keylevelConsistency = featureTables.includes("features_zone")
    ? await rows(
      `WITH d1 AS (
         SELECT *
         FROM (
           SELECT z.*, row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rn
           FROM features_zone z
           WHERE z.tf = '1d' AND z.ts >= NOW() - ($1::text || ' days')::interval
         ) ranked
         WHERE rn <= 100
       )
       SELECT d1.symbol,
              count(*)::bigint AS d1_zones,
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM features_zone z4
                  WHERE z4.symbol = d1.symbol
                    AND z4.tf = '4h'
                    AND z4.direction = d1.direction
                    AND z4.ts BETWEEN d1.ts - interval '1 day' AND d1.ts + interval '1 day'
                    AND ABS((((z4.bottom + z4.top) / 2.0) - ((d1.bottom + d1.top) / 2.0)) / NULLIF(((d1.bottom + d1.top) / 2.0), 0)) < 0.002
                  LIMIT 1
                )
              )::bigint AS matched_4h,
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM features_zone z1h
                  WHERE z1h.symbol = d1.symbol
                    AND z1h.tf = '1h'
                    AND z1h.direction = d1.direction
                    AND z1h.ts BETWEEN d1.ts - interval '1 day' AND d1.ts + interval '1 day'
                    AND ABS((((z1h.bottom + z1h.top) / 2.0) - ((d1.bottom + d1.top) / 2.0)) / NULLIF(((d1.bottom + d1.top) / 2.0), 0)) < 0.002
                  LIMIT 1
                )
              )::bigint AS matched_1h
       FROM d1
       GROUP BY d1.symbol
       ORDER BY d1.symbol`,
      [WINDOW_DAYS],
    )
    : [];

  const tradeCols = await tableColumns("backtest_results").catch(() => []);
  const tradeColNames = tradeCols.map((c) => c.column_name);
  const tradeTimeCol = ["entry_ts", "entry_time", "opened_at", "ts"].find((c) => tradeColNames.includes(c));
  const tradeSymbolCol = ["symbol", "pair"].find((c) => tradeColNames.includes(c));
  const trace = [];
  if (tradeTimeCol && tradeSymbolCol) {
    const trades = await rows(
      `SELECT * FROM backtest_results
       WHERE ${qident(tradeTimeCol)} IS NOT NULL
       ORDER BY ${qident(tradeTimeCol)} DESC
       LIMIT 5`,
    );
    for (const t of trades) {
      const entry = t[tradeTimeCol];
      const symbol = t[tradeSymbolCol];
      const perTable = [];
      for (const f of byFeature) {
        if (!f.timeCol || !f.cols.some((c) => c.column_name === "symbol")) continue;
        const traceTfFilter = f.hasTf && t.tf ? ` AND tf = $3` : "";
        const traceParams = f.hasTf && t.tf ? [symbol, entry, t.tf] : [symbol, entry];
        const featureTotal = f.groups.reduce((s, r) => s + Number(r.rows_90d), 0);
        const exact = await scalar(
          `SELECT count(*)::bigint AS exact_rows,
                  count(*) FILTER (WHERE ${f.hasFresh ? "is_fresh IS TRUE" : "FALSE"})::bigint AS exact_fresh
           FROM ${qident(f.table)}
           WHERE symbol = $1 AND ${qident(f.timeCol)} = $2${traceTfFilter}`,
          traceParams,
        );
        const asof = featureTotal > 200000
          ? { feature_ts: "skipped: large table" }
          : await scalar(
            `SELECT ${qident(f.timeCol)} AS feature_ts ${f.hasFresh ? ", is_fresh" : ""}
             FROM ${qident(f.table)}
             WHERE symbol = $1 AND ${qident(f.timeCol)} <= $2${traceTfFilter}
             ORDER BY ${qident(f.timeCol)} DESC
             LIMIT 1`,
            traceParams,
          );
        const next = featureTotal > 200000
          ? null
          : await scalar(
            `SELECT ${qident(f.timeCol)} AS feature_ts
             FROM ${qident(f.table)}
             WHERE symbol = $1 AND ${qident(f.timeCol)} > $2${traceTfFilter}
             ORDER BY ${qident(f.timeCol)} ASC
             LIMIT 1`,
            traceParams,
          );
        perTable.push({ table: f.table, exactRows: exact?.exact_rows || 0, exactFresh: exact?.exact_fresh || 0, asof, next });
      }
      trace.push({ trade: t, entry, symbol, perTable });
    }
  }

  anomalies.sort((a, b) => {
    const rank = { HIGH: 0, MED: 1, LOW: 2 };
    return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.table.localeCompare(b.table);
  });

  const lines = [];
  lines.push("# Forensic Feature Audit Report");
  lines.push("");
  lines.push(`Generated: ${generatedAt.toISOString ? generatedAt.toISOString() : generatedAt}`);
  lines.push(`Database: ${process.env.TM_DB_NAME || "tradzfx_v2"}`);
  lines.push(`Window: last ${WINDOW_DAYS} days`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  const high = anomalies.filter((a) => a.severity === "HIGH").length;
  const med = anomalies.filter((a) => a.severity === "MED").length;
  const low = anomalies.filter((a) => a.severity === "LOW").length;
  lines.push(`Audited ${featureTables.length} feature tables against ${candleCounts.length} candle symbol/timeframe baselines. Found ${high} HIGH, ${med} MED, and ${low} LOW anomalies.`);
  lines.push("");
  for (const a of anomalies.slice(0, 5)) {
    lines.push(`- **${a.severity}** ${a.table}${a.symbol ? ` ${a.symbol}/${a.tf}` : ""}: ${a.issue} Evidence: ${a.evidence}`);
  }
  lines.push("");
  lines.push("## Feature Inventory");
  lines.push("");
  lines.push(mdTable(["Feature table", "Trader meaning", "Time col", "TF col", "Freshness", "Critical columns"], byFeature.map((f) => [
    f.table,
    CONCEPTS[f.table] || "Derived market feature.",
    f.timeCol || "none",
    f.hasTf ? "yes" : "no",
    f.hasFresh ? "yes" : "no",
    f.critical.join(", "),
  ])));
  lines.push("");
  lines.push("## Candle Baseline");
  lines.push("");
  lines.push(mdTable(["Candle table", "Symbol", "TF", "Rows 90d", "First", "Last"], candleCounts.map((r) => [
    r.table, r.symbol, r.tf, r.rows_90d, r.first_ts?.toISOString?.() || r.first_ts, r.last_ts?.toISOString?.() || r.last_ts,
  ])));
  lines.push("");
  lines.push("## Per-Feature Scorecard");
  lines.push("");
  lines.push(mdTable(["Feature", "Symbols/TFs populated", "Rows 90d", "Fresh", "Stale", "Max null rate", "Score"], byFeature.map((f) => {
    const total = f.groups.reduce((s, r) => s + Number(r.rows_90d), 0);
    const fresh = f.freshness.reduce((s, r) => s + Number(r.fresh), 0);
    const stale = f.freshness.reduce((s, r) => s + Number(r.stale), 0);
    let maxNull = 0;
    for (const r of f.nulls) {
      for (const c of f.critical) maxNull = Math.max(maxNull, Number(r[`null_${c}`] || 0) / Math.max(1, Number(r.total)));
    }
    const highCount = anomalies.filter((a) => a.table === f.table && a.severity === "HIGH").length;
    const medCount = anomalies.filter((a) => a.table === f.table && a.severity === "MED").length;
    const score = highCount ? "FAIL" : medCount ? "WATCH" : "PASS";
    const groups = f.groups.map((g) => `${g.symbol}/${g.tf}`).join(", ");
    return [f.table, groups || "none", total, fresh || "n/a", stale || "n/a", pct(maxNull, 1), score];
  })));
  lines.push("");
  lines.push("## Row Presence by Feature");
  for (const f of byFeature) {
    lines.push("");
    lines.push(`### ${f.table}`);
    if (!f.groups.length) {
      lines.push("No rows in the audit window.");
    } else {
      lines.push(mdTable(["Symbol", "TF", "Rows 90d", "First", "Last"], f.groups.map((r) => [
        r.symbol, r.tf, r.rows_90d, r.first_ts?.toISOString?.() || r.first_ts, r.last_ts?.toISOString?.() || r.last_ts,
      ])));
    }
    if (f.hasFresh && f.freshness.length) {
      lines.push("");
      lines.push(mdTable(["Symbol", "TF", "Fresh", "Stale", "Null freshness", "Stale %"], f.freshness.map((r) => [
        r.symbol, r.tf, r.fresh, r.stale, r.null_fresh, pct(r.stale, r.total),
      ])));
    }
  }
  lines.push("");
  lines.push("## Multi-Timeframe Consistency");
  lines.push("");
  if (keylevelConsistency.length) {
    lines.push("Using `features_zone` as the key-level analogue: a 1d zone is considered matched when a 4h/1h zone has the same symbol, direction, midpoint within 0.2%, and timestamp within +/- 1 day.");
    lines.push("");
    lines.push(mdTable(["Symbol", "1d zones", "Matched 4h", "Matched 1h", "4h match %", "1h match %"], keylevelConsistency.map((r) => [
      r.symbol, r.d1_zones, r.matched_4h, r.matched_1h, pct(r.matched_4h, r.d1_zones), pct(r.matched_1h, r.d1_zones),
    ])));
  } else {
    lines.push("No `features_zone` 1d rows were available for the cross-timeframe key-level check.");
  }
  lines.push("");
  lines.push("## Backtest Traceability Sample");
  lines.push("");
  if (!trace.length) {
    lines.push("Could not trace trades: no recognizable recent rows/entry timestamp in `backtest_results`.");
  } else {
    for (const t of trace) {
      lines.push(`### Trade ${t.symbol} @ ${t.entry?.toISOString?.() || t.entry}`);
      const populated = t.perTable.filter((r) => Number(r.exactRows) > 0 || r.asof);
      lines.push(mdTable(["Feature", "Exact rows", "Exact fresh", "Latest <= entry", "Fresh", "Next > entry"], populated.map((r) => [
        r.table,
        r.exactRows,
        r.exactFresh,
        r.asof?.feature_ts?.toISOString?.() || r.asof?.feature_ts || "",
        r.asof?.is_fresh ?? "",
        r.next?.feature_ts?.toISOString?.() || r.next?.feature_ts || "",
      ])));
      lines.push("");
    }
  }
  lines.push("## Anomaly Log");
  lines.push("");
  lines.push(mdTable(["Severity", "Feature", "Symbol", "TF", "Issue", "Evidence"], anomalies.map((a) => [
    a.severity, a.table, a.symbol || "", a.tf || "", a.issue, a.evidence,
  ])));
  lines.push("");
  lines.push("## Remediation Recommendations");
  lines.push("");
  lines.push("1. Rebuild or backfill HIGH-failing dense features before trusting PIT results; these are expected to exist near candle density and missing rows create silent filter bias.");
  lines.push("2. For stale lifecycle features, refresh lifecycle state and verify `is_fresh`, `mitigated_at`, `invalidated_at`, and touch counters with PIT-time lookups.");
  lines.push("3. For >20% NULL critical columns, fix the feature writer first, then delete/recompute affected symbol/timeframe windows.");
  lines.push("4. For event features firing >10,000 times, tighten detection thresholds by symbol volatility/pip size rather than using one global price threshold.");
  lines.push("5. Treat exact-timestamp backtest traces as suspicious unless the strategy compiler intentionally performs lateral `<= entry_ts` lookups; exact equality is too strict for sparse HTF/event features.");

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${lines.join("\n")}\n`);
  console.log(OUT);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await pool.end().catch(() => {});
});
