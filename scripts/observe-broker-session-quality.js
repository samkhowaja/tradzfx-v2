#!/usr/bin/env node
/**
 * Read-only quality observation for broker session-lease promotion.
 *
 * Usage:
 *   node scripts/observe-broker-session-quality.js [SYMBOL|ALL] [completedUtcDays=7] [--json]
 *
 * Acceptance is intentionally strict: a broker is promotion-ready only when it
 * meets the symbol policy coverage and lag thresholds on every observed,
 * completed UTC day. This script never creates policies or leases.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const symbol = (positional[0] || "ALL").toUpperCase();
  const days = Number.parseInt(positional[1] || "7", 10);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("completedUtcDays must be an integer from 1 to 90");
  }
  if (symbol !== "ALL" && !/^[A-Z0-9._-]+$/.test(symbol)) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
  return { symbol, days, json: argv.includes("--json") };
}

const QUALITY_SQL = `
WITH bounds AS (
  SELECT date_trunc('day', NOW()) - ($2::int * INTERVAL '3 days') AS from_ts,
         date_trunc('day', NOW()) AS to_ts
),
symbols AS (
  SELECT DISTINCT p.symbol
  FROM raw.symbol_broker_policy p, bounds b
  WHERE ($1::text = 'ALL' OR p.symbol = $1)
    AND p.effective_from < b.to_ts
    AND (p.effective_to IS NULL OR p.effective_to > b.from_ts)
),
thresholds AS (
  SELECT DISTINCT ON (p.symbol)
         p.symbol, p.min_coverage_ratio, p.max_lag_seconds,
         p.broker_id AS configured_broker_id
  FROM raw.symbol_broker_policy p
  JOIN symbols s ON s.symbol = p.symbol
  CROSS JOIN bounds b
  WHERE p.effective_from < b.to_ts
    AND (p.effective_to IS NULL OR p.effective_to > b.from_ts)
  ORDER BY p.symbol, p.priority, p.effective_from DESC
),
calendar_days AS (
  SELECT s.symbol, gs AS session_start, gs + INTERVAL '1 day' AS session_end
  FROM symbols s
  CROSS JOIN bounds b
  CROSS JOIN LATERAL generate_series(b.from_ts, b.to_ts - INTERVAL '1 day', INTERVAL '1 day') gs
),
observed_ranked AS (
  SELECT d.symbol, d.session_start, d.session_end,
         COUNT(DISTINCT c.ts)::int AS observed_minutes,
         MAX(c.ts) AS observation_edge
  FROM calendar_days d
  LEFT JOIN candles_1m c
    ON c.symbol = d.symbol
   AND c.ts >= d.session_start
   AND c.ts < d.session_end
   AND EXISTS (SELECT 1 FROM raw.brokers rb WHERE rb.broker_id = c.broker AND rb.enabled)
  GROUP BY d.symbol, d.session_start, d.session_end
),
observed AS (
  SELECT symbol, session_start, session_end, observed_minutes, observation_edge
  FROM (
    SELECT r.*,
           COUNT(*) FILTER (WHERE r.observed_minutes > 0) OVER (
             PARTITION BY r.symbol ORDER BY r.session_start DESC
           ) AS observed_rank
    FROM observed_ranked r
  ) ranked
  WHERE observed_minutes > 0
    AND observed_rank <= $2::int
),
candidates AS (
  SELECT d.symbol, d.session_start, rb.broker_id,
         COUNT(DISTINCT c.ts)::int AS candidate_minutes,
         MAX(c.ts) AS source_max_ts,
         EXISTS (
           SELECT 1 FROM raw.symbol_broker_policy p
           WHERE p.symbol = d.symbol
             AND p.broker_id = rb.broker_id
             AND p.effective_from < d.session_end
             AND (p.effective_to IS NULL OR p.effective_to > d.session_start)
         ) AS policy_eligible
  FROM observed d
  CROSS JOIN raw.brokers rb
  LEFT JOIN candles_1m c
    ON c.symbol = d.symbol
   AND c.broker = rb.broker_id
   AND c.ts >= d.session_start
   AND c.ts < d.session_end
  WHERE rb.enabled
    AND rb.source_type IN ('broker', 'synthetic')
  GROUP BY d.symbol, d.session_start, d.session_end, rb.broker_id
),
scored AS (
  SELECT c.symbol, c.session_start, c.broker_id, c.policy_eligible,
         t.configured_broker_id, o.observed_minutes, c.candidate_minutes,
         c.source_max_ts,
         CASE WHEN o.observed_minutes > 0
              THEN c.candidate_minutes::double precision / o.observed_minutes END AS coverage_ratio,
         CASE WHEN c.source_max_ts IS NOT NULL AND o.observation_edge IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (o.observation_edge - c.source_max_ts))::int) END AS lag_seconds,
         t.min_coverage_ratio, t.max_lag_seconds
  FROM candidates c
  JOIN observed o USING (symbol, session_start)
  JOIN thresholds t USING (symbol)
),
summary AS (
  SELECT symbol, broker_id, configured_broker_id,
         BOOL_OR(policy_eligible) AS policy_eligible,
         COUNT(*) FILTER (WHERE observed_minutes > 0)::int AS observed_days,
         COUNT(*) FILTER (
           WHERE observed_minutes > 0
             AND candidate_minutes > 0
             AND coverage_ratio >= min_coverage_ratio
             AND lag_seconds <= max_lag_seconds
         )::int AS qualified_days,
         MIN(coverage_ratio) FILTER (WHERE observed_minutes > 0) AS min_coverage_ratio_observed,
         AVG(coverage_ratio) FILTER (WHERE observed_minutes > 0) AS avg_coverage_ratio,
         MAX(lag_seconds) FILTER (WHERE observed_minutes > 0) AS max_lag_seconds_observed,
         MIN(min_coverage_ratio) AS required_coverage_ratio,
         MAX(max_lag_seconds) AS allowed_lag_seconds,
         ARRAY_AGG(session_start::date ORDER BY session_start) FILTER (
           WHERE observed_minutes > 0
             AND NOT (
               candidate_minutes > 0
               AND coverage_ratio >= min_coverage_ratio
               AND lag_seconds <= max_lag_seconds
             )
         ) AS failed_sessions
  FROM scored
  GROUP BY symbol, broker_id, configured_broker_id
)
SELECT *,
       policy_eligible
       AND observed_days = $2::int
       AND qualified_days = $2::int AS promotion_ready
FROM summary
WHERE observed_days > 0
  AND (broker_id = configured_broker_id OR avg_coverage_ratio > 0)
ORDER BY symbol, promotion_ready DESC, qualified_days DESC,
         avg_coverage_ratio DESC NULLS LAST, max_lag_seconds_observed,
         broker_id;
`;

function percent(value) {
  return value == null ? "n/a" : `${(Number(value) * 100).toFixed(2)}%`;
}

function utcDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await pool.query(QUALITY_SQL, [options.symbol, options.days]);

  if (result.rows.length === 0) {
    throw new Error(`No completed-session observations found for ${options.symbol}`);
  }

  if (options.json) {
    console.log(JSON.stringify({ completedUtcDays: options.days, rows: result.rows }, null, 2));
    return;
  }

  console.log(`Broker session quality: ${options.symbol}, ${options.days} completed UTC day(s)`);
  for (const row of result.rows) {
    const role = row.broker_id === row.configured_broker_id
      ? "configured"
      : row.policy_eligible ? "policy" : "source-only";
    const verdict = row.promotion_ready ? "READY" : "NOT_READY";
    const failed = row.failed_sessions?.length
      ? row.failed_sessions.map(utcDate).join(",")
      : "none";
    console.log(
      `${row.symbol.padEnd(10)} ${row.broker_id.padEnd(20)} ${role.padEnd(11)} ${verdict.padEnd(9)} ` +
      `days=${row.qualified_days}/${row.observed_days} coverage[min/avg]=${percent(row.min_coverage_ratio_observed)}/${percent(row.avg_coverage_ratio)} ` +
      `lag[max]=${row.max_lag_seconds_observed ?? "n/a"}s thresholds=${percent(row.required_coverage_ratio)}/${row.allowed_lag_seconds}s failed=${failed}`
    );
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { parseArgs, QUALITY_SQL };
