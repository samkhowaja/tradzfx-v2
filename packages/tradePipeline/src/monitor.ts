/**
 * Pipeline & signal monitoring.
 *
 * Shared check functions for ops alerting, dashboard, and the alerts API.
 * Every function returns a structured result rather than calling notify(),
 * so callers can decide action (log / API response / Telegram).
 */

import type { Queryable } from "@tm/shared";

/* ───────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────── */

export interface AlertEntry {
  severity: "warning" | "critical";
  category: "pipeline" | "signal" | "risk" | "backtest";
  symbol?: string;
  variantId?: string;
  message: string;
  detail?: Record<string, unknown>;
  ts: string;
}

export interface PipelineHealthResult {
  ok: boolean;
  alerts: AlertEntry[];
  stats: {
    activeVariants: number;
    stalePipelines: number;
    totalOrders24h: number;
    rejectionRate24h: number;
    consecutiveLosses: number;
    drawdownR7d: number;
    zeroSignalSymbols: string[];
  };
}

/* ───────────────────────────────────────────
 * Check: stale pipelines (>30 min no run)
 * ─────────────────────────────────────────── */

export async function checkStalePipelines(
  db: Queryable
): Promise<AlertEntry[]> {
  const { rows } = await db.query(`
    SELECT symbol, variant_id, minutes_since_run, status
    FROM pipeline_health
    WHERE status IN ('stale', 'warning')
    ORDER BY minutes_since_run DESC
  `);
  return rows.map((r: any) => ({
    severity: r.status === "stale" ? "critical" : "warning",
    category: "pipeline" as const,
    symbol: r.symbol,
    variantId: r.variant_id,
    message: `Pipeline ${r.status} (${Math.round(r.minutes_since_run)}min since last run)`,
    detail: { minutesSinceRun: r.minutes_since_run },
    ts: new Date().toISOString(),
  }));
}

/* ───────────────────────────────────────────
 * Check: signal rejection spike (>50% in 24h)
 * ─────────────────────────────────────────── */

export async function checkRejectionSpike(
  db: Queryable
): Promise<AlertEntry[]> {
  const { rows } = await db.query(`
    WITH recent AS (
      SELECT
        symbol,
        strategy_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE reason IS NOT NULL) AS rejected
      FROM live_signal_rejection
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY symbol, strategy_id
    )
    SELECT symbol, strategy_id, total, rejected,
      ROUND(rejected::numeric / NULLIF(total, 0), 3) AS reject_rate
    FROM recent
    WHERE total >= 5 AND rejected::numeric / NULLIF(total, 0) > 0.5
    ORDER BY reject_rate DESC
  `);
  return rows.map((r: any) => ({
    severity: "warning",
    category: "signal" as const,
    symbol: r.symbol,
    variantId: r.strategy_id,
    message: `Signal rejection spike: ${r.rejected}/${r.total} (${(r.reject_rate * 100).toFixed(0)}%) in 24h`,
    detail: { total: r.total, rejected: r.rejected, rejectRate: r.reject_rate },
    ts: new Date().toISOString(),
  }));
}

/* ───────────────────────────────────────────
 * Check: consecutive losses (3+ in a row)
 * ─────────────────────────────────────────── */

export async function checkConsecutiveLosses(
  db: Queryable
): Promise<AlertEntry[]> {
  const { rows } = await db.query(`
    WITH ordered AS (
      SELECT symbol, strategy_id, outcome, outcome_r, closed_at,
        ROW_NUMBER() OVER (PARTITION BY symbol, strategy_id ORDER BY closed_at DESC) AS rn
      FROM orders
      WHERE status = 'closed'
        AND closed_at >= NOW() - INTERVAL '30 days'
    ),
    streaks AS (
      SELECT symbol, strategy_id, outcome, outcome_r, rn,
        rn - ROW_NUMBER() OVER (
          PARTITION BY symbol, strategy_id, outcome
          ORDER BY rn
        ) AS grp
      FROM ordered
      WHERE outcome = 'SL_HIT' OR outcome = 'BE'
    )
    SELECT symbol, strategy_id,
      COUNT(*) AS streak_len,
      ROUND(SUM(COALESCE(outcome_r, 0))::numeric, 2) AS streak_r
    FROM streaks
    GROUP BY symbol, strategy_id, grp
    HAVING COUNT(*) >= 3
    ORDER BY streak_len DESC
    LIMIT 10
  `);
  return rows.map((r: any) => ({
    severity: r.streak_len >= 5 ? "critical" : "warning",
    category: "risk" as const,
    symbol: r.symbol,
    variantId: r.strategy_id,
    message: `${r.streak_len}x consecutive loss streak (${r.streak_r}R total)`,
    detail: { streakLen: r.streak_len, streakR: r.streak_r },
    ts: new Date().toISOString(),
  }));
}

/* ───────────────────────────────────────────
 * Check: drawdown alert (cumulative -5R+ in 7d)
 * ─────────────────────────────────────────── */

export async function checkDrawdown(
  db: Queryable
): Promise<AlertEntry[]> {
  const { rows } = await db.query(`
    SELECT symbol, strategy_id,
      ROUND(SUM(COALESCE(outcome_r, 0))::numeric, 2) AS net_r_7d,
      COUNT(*) AS trades,
      COUNT(*) FILTER (WHERE outcome = 'TP_HIT') AS wins,
      COUNT(*) FILTER (WHERE outcome = 'SL_HIT') AS losses
    FROM orders
    WHERE status = 'closed'
      AND closed_at >= NOW() - INTERVAL '7 days'
    GROUP BY symbol, strategy_id
    HAVING SUM(COALESCE(outcome_r, 0)) < -5
    ORDER BY net_r_7d ASC
  `);
  return rows.map((r: any) => ({
    severity: r.net_r_7d < -10 ? "critical" : "warning",
    category: "risk" as const,
    symbol: r.symbol,
    variantId: r.strategy_id,
    message: `Drawdown ${r.net_r_7d}R in 7d (${r.wins}W/${r.losses}L)`,
    detail: { netR7d: r.net_r_7d, trades: r.trades, wins: r.wins, losses: r.losses },
    ts: new Date().toISOString(),
  }));
}

/* ───────────────────────────────────────────
 * Check: zero-signal symbols (active variant,
 * no signals in last 6h but data flowing)
 * ─────────────────────────────────────────── */

export async function checkZeroSignals(
  db: Queryable
): Promise<AlertEntry[]> {
  const { rows } = await db.query(`
    SELECT sv.symbol, sv.variant_id
    FROM (
      SELECT id AS variant_id, UNNEST(symbols) AS symbol
      FROM strategy_variants
      WHERE is_active = true
    ) sv
    JOIN strategy_families sf ON sf.id = sv.variant_id AND sf.is_archived = false
    WHERE NOT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.symbol = sv.symbol
        AND o.strategy_id = sv.variant_id
        AND o.created_at >= NOW() - INTERVAL '6 hours'
    )
    AND EXISTS (
      SELECT 1 FROM market.candles_1m_canonical c
      WHERE c.symbol = sv.symbol
        AND c.ts >= NOW() - INTERVAL '1 hour'
    )
  `);
  return rows.map((r: any) => ({
    severity: "warning",
    category: "signal" as const,
    symbol: r.symbol,
    variantId: r.variant_id,
    message: `Zero signals in last 6h (data flowing, pipeline may be stuck)`,
    ts: new Date().toISOString(),
  }));
}

/* ───────────────────────────────────────────
 * Check: backtest staleness (no run in 7d)
 * ─────────────────────────────────────────── */

export async function checkBacktestStaleness(
  db: Queryable
): Promise<AlertEntry[]> {
  const { rows } = await db.query(`
    WITH latest_backtest AS (
      SELECT DISTINCT ON (variant_id, symbol, tf)
        variant_id, symbol, tf, end_ts
      FROM backtest_runs
      ORDER BY variant_id, symbol, tf, end_ts DESC
    )
    SELECT
      sv.id AS variant_id,
      sv.name AS variant_name,
      s.symbol
    FROM strategy_variants sv
    CROSS JOIN LATERAL UNNEST(sv.symbols) AS s(symbol)
    LEFT JOIN latest_backtest lb
      ON lb.variant_id = sv.id AND lb.symbol = s.symbol
    WHERE sv.is_active = true
      AND (lb.end_ts IS NULL OR lb.end_ts < NOW() - INTERVAL '7 days')
    ORDER BY sv.name, s.symbol
  `);
  return rows.map((r: any) => ({
    severity: "warning",
    category: "backtest" as const,
    symbol: r.symbol,
    variantId: r.variant_id,
    message: `No backtest run in 7d+ for ${r.variant_name ?? r.variant_id} / ${r.symbol}`,
    ts: new Date().toISOString(),
  }));
}

/* ───────────────────────────────────────────
 * Aggregate: run all checks
 * ─────────────────────────────────────────── */

export async function runAllChecks(db: Queryable): Promise<PipelineHealthResult> {
  const results = await Promise.all([
    checkStalePipelines(db),
    checkRejectionSpike(db),
    checkConsecutiveLosses(db),
    checkDrawdown(db),
    checkZeroSignals(db),
    checkBacktestStaleness(db),
  ]);

  const alerts = results.flat();

  // Aggregate stats
  const { rows: [stats] } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM strategy_variants WHERE is_active = true)::int AS active_variants,
      (SELECT COUNT(*) FROM pipeline_health WHERE status = 'stale')::int AS stale_count,
      (SELECT COUNT(*) FROM orders WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS orders_24h,
      COALESCE((
        SELECT ROUND(
          COUNT(*) FILTER (WHERE reason IS NOT NULL)::numeric /
          NULLIF(COUNT(*), 0), 3
        )
        FROM live_signal_rejection
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      ), 0) AS rejection_rate_24h,
      COALESCE((
        SELECT MAX(streak_len) FROM (
          SELECT COUNT(*) AS streak_len
          FROM (
            SELECT outcome, ROW_NUMBER() OVER (ORDER BY closed_at DESC) AS rn,
              ROW_NUMBER() OVER (ORDER BY closed_at DESC) -
                ROW_NUMBER() OVER (PARTITION BY outcome ORDER BY closed_at DESC) AS grp
            FROM orders
            WHERE status = 'closed' AND closed_at >= NOW() - INTERVAL '30 days'
          ) sub
          WHERE outcome = 'SL_HIT' OR outcome = 'BE'
          GROUP BY grp
        ) streaks
      ), 0) AS max_consecutive_losses,
      COALESCE((
        SELECT ROUND(SUM(COALESCE(outcome_r, 0))::numeric, 2)
        FROM orders
        WHERE status = 'closed' AND closed_at >= NOW() - INTERVAL '7 days'
      ), 0) AS net_r_7d
  `);

  return {
    ok: alerts.length === 0,
    alerts,
    stats: {
      activeVariants: Number(stats?.active_variants ?? 0),
      stalePipelines: Number(stats?.stale_count ?? 0),
      totalOrders24h: Number(stats?.orders_24h ?? 0),
      rejectionRate24h: Number(stats?.rejection_rate_24h ?? 0),
      consecutiveLosses: Number(stats?.max_consecutive_losses ?? 0),
      drawdownR7d: Number(stats?.net_r_7d ?? 0),
      zeroSignalSymbols: alerts
        .filter((a) => a.category === "signal" && a.message.includes("Zero signals"))
        .map((a) => a.symbol!)
        .filter(Boolean),
    },
  };
}
