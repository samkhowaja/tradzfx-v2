#!/usr/bin/env node
/**
 * Read-only forensic audit of raw and canonical candle data consumed by strategies.
 *
 * Usage:
 *   node scripts/audit-market-data-integrity.js [--days=90] [--parity-days=30]
 *     [--dependencies=reports/strategy-data-dependencies-latest.json]
 *     [--out=reports/market-data-integrity-latest.json]
 *     [--markdown=reports/market-data-integrity-latest.md]
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const {
  checkCandleCoverage,
  getPairCharacteristics,
  SPREAD_SANITY_MULTIPLIER,
} = require("../packages/shared/dist/index.js");

const ROOT = path.resolve(__dirname, "..");
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: "read-only-market-data-integrity-audit",
});

function arg(name, fallback) {
  const item = process.argv.find((value) => value.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : fallback;
}
function number(value) { return value == null ? null : Number(value); }
function iso(value) { return value instanceof Date ? value.toISOString() : value; }
function relation(tf) {
  return tf === "1d" ? "market.candles_1d_utc_canonical" : `market.candles_${tf}_canonical`;
}
function interval(tf) {
  return ({ "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour", "4h": "4 hours", "1d": "1 day" })[tf];
}
function origin(tf) {
  return tf === "1d" ? "2000-01-01 00:00:00+00" : "2000-01-01 00:00:00+00";
}
async function query(text, values = []) { return (await pool.query(text, values)).rows; }

function strategySymbols(dependencyPath) {
  const report = JSON.parse(fs.readFileSync(dependencyPath, "utf8"));
  return [...new Set(report.strategies.flatMap((strategy) => strategy.symbols || []))].sort();
}

async function rawSummary(symbols, from, to) {
  return query(`
    SELECT symbol, broker, count(*)::bigint AS rows, min(ts) AS first_ts, max(ts) AS last_ts,
           count(*) FILTER (WHERE ts > now())::bigint AS future_rows,
           count(*) FILTER (WHERE o IS NULL OR h IS NULL OR l IS NULL OR c IS NULL
             OR o <> o OR h <> h OR l <> l OR c <> c)::bigint AS non_finite_or_null,
           count(*) FILTER (WHERE h < l OR o < l OR o > h OR c < l OR c > h)::bigint AS invalid_geometry,
           count(*) FILTER (WHERE v < 0)::bigint AS negative_volume,
           count(*) FILTER (WHERE digits IS NULL OR digits < 0 OR digits > 12)::bigint AS invalid_digits,
           count(*) FILTER (WHERE spread IS NOT NULL AND (spread <> spread OR spread < 0))::bigint AS invalid_spread
      FROM candles_1m
     WHERE symbol = ANY($1) AND ts >= $2 AND ts < $3
     GROUP BY symbol, broker ORDER BY symbol, broker`, [symbols, from, to]);
}

async function duplicates(symbols, from, to) {
  const rows = await query(`
    SELECT symbol,
           count(*) FILTER (WHERE broker_count > 1)::bigint AS cross_broker_timestamps,
           coalesce(sum(row_count - broker_count), 0)::bigint AS duplicate_same_broker_rows,
           max(broker_count)::int AS max_brokers_at_timestamp
      FROM (
        SELECT symbol, ts, count(*) AS row_count, count(DISTINCT broker) AS broker_count
          FROM candles_1m
         WHERE symbol = ANY($1) AND ts >= $2 AND ts < $3
         GROUP BY symbol, ts
      ) x GROUP BY symbol ORDER BY symbol`, [symbols, from, to]);
  return rows;
}

async function canonicalSummary(symbols, from, to) {
  return query(`
    SELECT symbol, count(*)::bigint AS rows, min(ts) AS first_ts, max(ts) AS last_ts,
           count(DISTINCT broker)::int AS broker_count,
           array_agg(DISTINCT broker ORDER BY broker) AS brokers,
           count(*) - count(DISTINCT ts) AS duplicate_timestamps,
           count(*) FILTER (WHERE h < l OR o < l OR o > h OR c < l OR c > h)::bigint AS invalid_geometry
      FROM market.candles_1m_canonical
     WHERE symbol = ANY($1) AND ts >= $2 AND ts < $3
     GROUP BY symbol ORDER BY symbol`, [symbols, from, to]);
}

async function policyAudit(symbols, from, to) {
  return query(`
    SELECT s.symbol,
           count(p.policy_id)::int AS overlapping_policy_pairs,
           count(*) FILTER (WHERE p1.policy_id IS NULL)::int AS symbols_without_policy
      FROM unnest($1::text[]) s(symbol)
      LEFT JOIN raw.symbol_broker_policy p1 ON p1.symbol = s.symbol
        AND p1.effective_from < $3 AND coalesce(p1.effective_to, 'infinity') > $2
      LEFT JOIN raw.symbol_broker_policy p ON p.symbol = p1.symbol AND p.policy_id > p1.policy_id
        AND p.priority = p1.priority
        AND tstzrange(p.effective_from, p.effective_to, '[)') && tstzrange(p1.effective_from, p1.effective_to, '[)')
     GROUP BY s.symbol ORDER BY s.symbol`, [symbols, from, to]);
}

async function qualityAudit(symbols, from, to) {
  return query(`
    SELECT symbol, count(*)::bigint AS flagged_rows,
           count(*) FILTER (WHERE is_suspect)::bigint AS suspect_rows,
           array_agg(DISTINCT reason ORDER BY reason) FILTER (WHERE reason IS NOT NULL) AS reasons,
           min(ts) AS first_ts, max(ts) AS last_ts
      FROM candle_quality
     WHERE symbol = ANY($1) AND ts >= $2 AND ts < $3
     GROUP BY symbol ORDER BY symbol`, [symbols, from, to]);
}

async function spreadAudit(symbols, from, to) {
  const result = [];
  for (const symbol of symbols) {
    const cap = getPairCharacteristics(symbol).baseSpreadPips * SPREAD_SANITY_MULTIPLIER;
    const [row] = await query(`
      SELECT $1::text AS symbol, $4::double precision AS sanity_cap_pips,
             count(*)::bigint AS rows, count(spread)::bigint AS samples,
             count(*) FILTER (WHERE spread IS NULL)::bigint AS nulls,
             count(*) FILTER (WHERE spread = 0)::bigint AS zeros,
             count(*) FILTER (WHERE spread < 0 OR spread <> spread)::bigint AS invalid,
             count(*) FILTER (WHERE spread > $4)::bigint AS over_sanity_cap,
             percentile_cont(ARRAY[0.5,0.9,0.95,0.99]) WITHIN GROUP (ORDER BY spread)
               FILTER (WHERE spread >= 0 AND spread <= $4) AS percentiles_pips,
             max(spread) AS max_pips
        FROM market.candles_1m_canonical
       WHERE symbol = $1 AND ts >= $2 AND ts < $3`, [symbol, from, to, cap]);
    result.push(row);
  }
  return result;
}

async function spreadFeatureParity(symbols, from, to) {
  const result = [];
  for (const symbol of symbols) {
    const cap = getPairCharacteristics(symbol).baseSpreadPips * SPREAD_SANITY_MULTIPLIER;
    const [row] = await query(`
      WITH sampled AS (
        SELECT f.ts, f.spread AS stored_spread, f.samples AS stored_samples,
               expected.spread AS expected_spread, expected.samples AS expected_samples
          FROM features_spread f
          CROSS JOIN LATERAL (
            SELECT avg(x.spread) FILTER (WHERE x.spread >= 0 AND x.spread <= $4)::double precision AS spread,
                   count(*) FILTER (WHERE x.spread >= 0 AND x.spread <= $4)::int AS samples
              FROM (
                SELECT c.spread
                  FROM market.candles_1m_canonical c
                 WHERE c.symbol = f.symbol AND c.ts <= f.ts AND c.spread IS NOT NULL
                 ORDER BY c.ts DESC LIMIT 20
              ) x
          ) expected
         WHERE f.symbol = $1 AND f.tf = '1m' AND f.ts >= $2 AND f.ts < $3
           AND EXISTS (
             SELECT 1 FROM market.candles_1m_canonical anchor
              WHERE anchor.symbol = f.symbol AND anchor.ts = f.ts
           )
      )
      SELECT $1::text AS symbol, count(*)::bigint AS checked_rows,
             count(*) FILTER (WHERE stored_samples IS DISTINCT FROM expected_samples
               OR (stored_spread IS NULL) IS DISTINCT FROM (expected_spread IS NULL)
               OR abs(stored_spread - expected_spread) > 1e-9)::bigint AS mismatches,
             max(abs(stored_spread - expected_spread)) AS max_abs_error,
             (SELECT count(*)::bigint FROM features_spread legacy
               WHERE legacy.symbol = $1 AND legacy.tf = '1m'
                 AND legacy.ts >= $2 AND legacy.ts < $3
                 AND NOT EXISTS (
                   SELECT 1 FROM market.candles_1m_canonical anchor
                    WHERE anchor.symbol = legacy.symbol AND anchor.ts = legacy.ts
                 )) AS non_anchor_rows
        FROM sampled`, [symbol, from, to, cap]);
    result.push(row);
  }
  return result;
}

async function htfParity(symbols, tf, from, to) {
  const table = relation(tf);
  const width = interval(tf);
  const bucketOrigin = origin(tf);
  return query(`
    WITH bounds AS (
      SELECT time_bucket($4::interval, $2::timestamptz, $5::timestamptz) + $4::interval AS from_bucket,
             time_bucket($4::interval, $3::timestamptz - interval '5 minutes', $5::timestamptz) AS to_bucket
    ), expected AS (
      SELECT symbol, time_bucket($4::interval, ts, $5::timestamptz) AS ts,
             first(o, ts) AS o, max(h) AS h, min(l) AS l, last(c, ts) AS c,
             sum(v)::bigint AS v, count(*)::int AS tick_count
        FROM market.candles_1m_canonical, bounds
       WHERE symbol = ANY($1) AND ts >= bounds.from_bucket AND ts < bounds.to_bucket
       GROUP BY symbol, time_bucket($4::interval, ts, $5::timestamptz)
    ), actual AS (
      SELECT symbol, ts, o, h, l, c, v, tick_count FROM ${table}, bounds
       WHERE symbol = ANY($1) AND ts >= bounds.from_bucket AND ts < bounds.to_bucket
    )
    SELECT coalesce(e.symbol, a.symbol) AS symbol,
           count(*) FILTER (WHERE e.ts IS NULL)::bigint AS extra_actual,
           count(*) FILTER (WHERE a.ts IS NULL)::bigint AS missing_actual,
           count(*) FILTER (WHERE e.ts IS NOT NULL AND a.ts IS NOT NULL AND
             (e.o IS DISTINCT FROM a.o OR e.h IS DISTINCT FROM a.h OR e.l IS DISTINCT FROM a.l
              OR e.c IS DISTINCT FROM a.c OR e.v IS DISTINCT FROM a.v
              OR e.tick_count IS DISTINCT FROM a.tick_count))::bigint AS value_mismatches,
           max(e.ts) AS expected_edge, max(a.ts) AS actual_edge
      FROM expected e FULL OUTER JOIN actual a USING (symbol, ts)
     GROUP BY coalesce(e.symbol, a.symbol) ORDER BY 1`, [symbols, from, to, width, bucketOrigin]);
}

async function coverageAudit(symbols, from, to) {
  const rows = [];
  for (const symbol of symbols) {
    for (const tf of ["1m", "5m", "15m", "1h", "4h", "1d"]) {
      const info = await checkCandleCoverage(pool, symbol, tf, from, to);
      rows.push({ ...info, from: iso(info.from), to: iso(info.to) });
    }
  }
  return rows;
}

async function incidentAudit() {
  const xau = await query(`
    SELECT date_trunc('day', ts) AS day, count(*)::int AS rows, min(ts) AS first_ts, max(ts) AS last_ts
      FROM market.candles_1m_canonical
     WHERE symbol = 'XAUUSD' AND ts >= '2026-07-06' AND ts < '2026-07-08'
     GROUP BY 1 ORDER BY 1`);
  const dxy = await query(`
    SELECT broker, count(*)::bigint AS rows, min(ts) AS first_ts, max(ts) AS last_ts
      FROM candles_1m WHERE symbol = 'DXY' GROUP BY broker ORDER BY broker`);
  return { xauJul6To7: xau, dxyHistory: dxy };
}

function findings(report) {
  const rows = [];
  const add = (severity, code, count, detail) => { if (count > 0) rows.push({ severity, code, count, detail }); };
  add("critical", "RAW_INVALID_GEOMETRY", report.raw.reduce((n, x) => n + number(x.invalid_geometry), 0), "Raw OHLC violates candle geometry.");
  add("critical", "CANONICAL_INVALID_GEOMETRY", report.canonical.reduce((n, x) => n + number(x.invalid_geometry), 0), "Strategy-visible canonical OHLC violates geometry.");
  add("critical", "CANONICAL_DUPLICATES", report.canonical.reduce((n, x) => n + number(x.duplicate_timestamps), 0), "Canonical relation emits duplicate symbol/timestamp rows.");
  add("high", "RAW_DUPLICATE_KEYS", report.duplicates.reduce((n, x) => n + number(x.duplicate_same_broker_rows), 0), "Duplicate raw symbol/broker/timestamp rows.");
  add("high", "FUTURE_CANDLES", report.raw.reduce((n, x) => n + number(x.future_rows), 0), "Raw rows lie after database NOW().");
  add("high", "HTF_PARITY", Object.values(report.htfParity).flat().reduce((n, x) => n + number(x.missing_actual) + number(x.extra_actual) + number(x.value_mismatches), 0), "Canonical HTF differs from canonical 1m reconstruction.");
  add("high", "SPREAD_FEATURE_PARITY", report.spreadFeatureParity.reduce((n, x) => n + number(x.mismatches), 0), "Candle-anchored spread feature differs from current producer contract.");
  add("medium", "SPREAD_NON_ANCHOR_ROWS", report.spreadFeatureParity.reduce((n, x) => n + number(x.non_anchor_rows), 0), "Legacy spread rows use scheduler timestamps instead of canonical candle anchors.");
  add("medium", "SPREAD_POLLUTION", report.spread.reduce((n, x) => n + number(x.over_sanity_cap) + number(x.invalid), 0), "Canonical spread samples violate sanity contract.");
  add("medium", "SUSPECT_CANDLES", report.quality.reduce((n, x) => n + number(x.suspect_rows), 0), "Quality side table quarantines candles.");
  add("medium", "COVERAGE_GAPS", report.coverage.filter((x) => x.hasGaps).length, "Strategy-visible symbol/timeframe surfaces contain market-calendar gaps.");
  return rows;
}

function markdown(report) {
  const lines = [
    "# Market Data Integrity Audit", "", `Generated: ${report.generatedAt}`,
    `Window: ${report.window.from} to ${report.window.to}`, "",
    "## Verdict", "", `**${report.verdict}**`, "",
    `- Strategy symbols: ${report.symbols.join(", ")}`,
    `- Findings: ${report.findings.length}`,
    `- Coverage surfaces with gaps: ${report.coverage.filter((x) => x.hasGaps).length}/${report.coverage.length}`, "",
    "## Findings", "", "| Severity | Code | Count | Detail |", "|---|---|---:|---|",
  ];
  if (!report.findings.length) lines.push("| info | CLEAN | 0 | No checked invariant failed. |");
  for (const item of report.findings) lines.push(`| ${item.severity} | ${item.code} | ${item.count} | ${item.detail} |`);
  lines.push("", "## Coverage", "", "| Symbol | TF | Expected | Actual | Ratio | Gaps | Largest gap | Source |", "|---|---|---:|---:|---:|---:|---:|---|");
  for (const x of report.coverage) lines.push(`| ${x.symbol} | ${x.tf} | ${x.expectedRows} | ${x.actualRows} | ${(x.coverageRatio * 100).toFixed(2)}% | ${x.gapCount} | ${x.largestGapMinutes}m | ${x.source} |`);
  lines.push("", "## Spread", "", "| Symbol | Samples | p50/p90/p95/p99 pips | Max | Over cap | Cap |", "|---|---:|---|---:|---:|---:|");
  for (const x of report.spread) lines.push(`| ${x.symbol} | ${x.samples} | ${(x.percentiles_pips || []).map((v) => Number(v).toFixed(3)).join(" / ")} | ${x.max_pips ?? ""} | ${x.over_sanity_cap} | ${x.sanity_cap_pips} |`);
  lines.push("", "## Notes", "", "- Audit executes read-only SQL; no coverage metadata persisted.", "- Coverage uses shared market calendar and canonical candle source.", "- HTF parity reconstructs buckets directly from `market.candles_1m_canonical`.", "- Raw cross-broker timestamps are evidence, not defects by themselves; canonical duplicates are defects.", "");
  return lines.join("\n");
}

async function main() {
  const dependencyPath = path.resolve(ROOT, arg("dependencies", "reports/strategy-data-dependencies-latest.json"));
  const outputJson = path.resolve(ROOT, arg("out", "reports/market-data-integrity-latest.json"));
  const outputMd = path.resolve(ROOT, arg("markdown", "reports/market-data-integrity-latest.md"));
  const days = Number(arg("days", "90"));
  const parityDays = Number(arg("parity-days", "30"));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const parityFrom = new Date(to.getTime() - parityDays * 86400000);
  const symbols = strategySymbols(dependencyPath);

  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15min'");
    await client.query("COMMIT");
  } finally { client.release(); }

  const report = {
    generatedAt: new Date().toISOString(), symbols,
    window: { days, from: from.toISOString(), to: to.toISOString(), parityDays, parityFrom: parityFrom.toISOString() },
    raw: await rawSummary(symbols, from, to),
    duplicates: await duplicates(symbols, from, to),
    canonical: await canonicalSummary(symbols, from, to),
    policies: await policyAudit(symbols, from, to),
    quality: await qualityAudit(symbols, from, to),
    spread: await spreadAudit(symbols, from, to),
    spreadFeatureParity: await spreadFeatureParity(symbols, from, to),
    coverage: await coverageAudit(symbols, from, to),
    htfParity: {}, incidents: await incidentAudit(),
  };
  for (const tf of ["5m", "15m", "1h", "4h", "1d"]) report.htfParity[tf] = await htfParity(symbols, tf, parityFrom, to);
  report.findings = findings(report);
  report.verdict = report.findings.some((x) => x.severity === "critical") ? "FAIL" : report.findings.some((x) => x.severity === "high") ? "DEGRADED" : "PASS_WITH_WARNINGS";
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(outputMd, markdown(report) + "\n");
  console.log(JSON.stringify({ verdict: report.verdict, symbols: symbols.length, findings: report.findings, coverageGaps: report.coverage.filter((x) => x.hasGaps).length }, null, 2));
  console.log(`wrote ${path.relative(ROOT, outputJson)}`);
  console.log(`wrote ${path.relative(ROOT, outputMd)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
