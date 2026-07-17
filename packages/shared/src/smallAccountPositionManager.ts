/**
 * Small-account position manager.
 *
 * Inspired by the V1 signal gate:
 *   - One position per symbol at a time (no stacking/martingale).
 *   - Hard cap on total concurrent positions (default 1 for tiny accounts).
 *   - Daily loss limit.
 *   - Cooldown after a close on the same symbol.
 *   - Consecutive-loss circuit breaker.
 *
 * This is intentionally conservative. For a small account the goal is to
 * survive variance, not maximize throughput.
 */

import { getPool, type Queryable } from "./utils/db";

export interface SmallAccountPositionConfig {
  enabled: boolean;
  /** Max open/pending orders for a single symbol (default 1) */
  maxPositionsPerSymbol: number;
  /** Max open/pending orders across all symbols (default 1) */
  maxPositionsTotal: number;
  /** Minutes to wait before re-entering the same symbol after a close (default 30) */
  cooldownMinutes: number;
  /** Daily loss limit as % of starting balance. 0 = disabled (default 5) */
  maxDailyLossPct: number;
  /** Hard USD daily loss cap (overrides maxDailyLossPct when set). 0 = disabled. */
  maxDailyLossUsd: number;
  /** Starting/account balance for daily-loss calculation. 0 = auto (latest terminal balance) */
  accountBalance: number;
  /** Halt new entries after N consecutive losing closes (default 3) */
  maxConsecutiveLosses: number;
  /** Optional terminal scoping for daily-loss calculation */
  terminalKeyId?: string;
  /** Account currency for P&L normalization (optional) */
  accountCurrency?: string;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadSmallAccountConfig(terminalKeyId?: string): SmallAccountPositionConfig {
  return {
    enabled: process.env.SMALL_ACCOUNT_POSITION_MANAGER !== "false",
    maxPositionsPerSymbol: envNumber("SMALL_ACCOUNT_MAX_PER_SYMBOL", 1),
    maxPositionsTotal: envNumber("SMALL_ACCOUNT_MAX_TOTAL", 1),
    cooldownMinutes: envNumber("SMALL_ACCOUNT_COOLDOWN_MINUTES", 30),
    maxDailyLossPct: envNumber("SMALL_ACCOUNT_MAX_DAILY_LOSS_PCT", 5),
    maxDailyLossUsd: envNumber("SMALL_ACCOUNT_MAX_DAILY_LOSS_USD", 0),
    accountBalance: envNumber("SMALL_ACCOUNT_BALANCE", 0),
    maxConsecutiveLosses: envNumber("SMALL_ACCOUNT_MAX_CONSECUTIVE_LOSSES", 3),
    terminalKeyId,
    accountCurrency: process.env.SMALL_ACCOUNT_CURRENCY ?? "USD",
  };
}

export interface GateResult {
  ok: boolean;
  reason?: string;
}

const ACTIVE_STATUSES = ["pending", "sent", "acked"];

async function countActiveOrders(
  db: Queryable,
  symbol?: string
): Promise<number> {
  const sql = symbol
    ? `SELECT count(*)::int AS cnt FROM orders WHERE symbol = $1 AND status = ANY($2) AND created_at >= NOW() - INTERVAL '24 hours'`
    : `SELECT count(*)::int AS cnt FROM orders WHERE status = ANY($1) AND created_at >= NOW() - INTERVAL '24 hours'`;
  const params = symbol ? [symbol, ACTIVE_STATUSES] : [ACTIVE_STATUSES];
  const { rows } = await db.query(sql, params);
  return rows[0]?.cnt ?? 0;
}

async function getDailyRealizedPnl(
  db: Queryable,
  terminalKeyId?: string
): Promise<number> {
  const params: (string | string[])[] = [];
  let sql = `SELECT COALESCE(SUM(realized_pnl), 0)::double precision AS total
     FROM orders
     WHERE status = 'closed'
       AND closed_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;

  if (terminalKeyId) {
    params.push(terminalKeyId);
    sql += ` AND terminal_key_id = $${params.length}`;
  }

  const { rows } = await db.query(sql, params);
  return rows[0]?.total ?? 0;
}

async function getLastCloseTimestamp(
  db: Queryable,
  symbol: string
): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT EXTRACT(EPOCH FROM closed_at) * 1000 AS ts
     FROM orders
     WHERE symbol = $1 AND status = 'closed'
     ORDER BY closed_at DESC
     LIMIT 1`,
    [symbol]
  );
  const ts = rows[0]?.ts;
  return ts ? Number(ts) : null;
}

async function getLatestTerminalBalance(
  db: Queryable,
  terminalKeyId?: string
): Promise<number | null> {
  let sql = `SELECT balance FROM mt5_terminals
     WHERE balance IS NOT NULL`;
  const params: string[] = [];

  if (terminalKeyId) {
    params.push(terminalKeyId);
    sql += ` AND id = $${params.length}`;
  }

  sql += ` ORDER BY last_seen_at DESC LIMIT 1`;

  const { rows } = await db.query(sql, params);
  const bal = rows[0]?.balance;
  return typeof bal === "number" ? bal : null;
}

async function getConsecutiveLosses(
  db: Queryable,
  terminalKeyId?: string
): Promise<number> {
  let sql = `SELECT outcome, realized_pnl
     FROM orders
     WHERE status = 'closed'`;
  const params: string[] = [];

  if (terminalKeyId) {
    params.push(terminalKeyId);
    sql += ` AND terminal_key_id = $${params.length}`;
  }

  sql += ` ORDER BY closed_at DESC LIMIT 50`;

  const { rows } = await db.query(sql, params);

  let streak = 0;
  for (const r of rows) {
    const isLoss =
      r.outcome === "SL_HIT" ||
      r.outcome === "loss" ||
      r.outcome === "stop_loss" ||
      (typeof r.realized_pnl === "number" && Number(r.realized_pnl) < 0);
    if (isLoss) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Check whether a new position may be opened for the given symbol under
 * small-account rules. Returns { ok: true } or { ok: false, reason }.
 */
export async function checkSmallAccountGate(
  db: Queryable,
  symbol: string,
  config?: Partial<SmallAccountPositionConfig>
): Promise<GateResult> {
  const cfg = { ...loadSmallAccountConfig(config?.terminalKeyId), ...config };
  if (!cfg.enabled) return { ok: true };

  // 1. One position per symbol.
  const symbolActive = await countActiveOrders(db, symbol);
  if (symbolActive >= cfg.maxPositionsPerSymbol) {
    return {
      ok: false,
      reason: `small_account: max positions for ${symbol} reached (${symbolActive}/${cfg.maxPositionsPerSymbol})`,
    };
  }

  // 2. Total concurrent cap.
  const totalActive = await countActiveOrders(db);
  if (totalActive >= cfg.maxPositionsTotal) {
    return {
      ok: false,
      reason: `small_account: max total positions reached (${totalActive}/${cfg.maxPositionsTotal})`,
    };
  }

  // 3. Daily loss limit (hard USD cap takes precedence over %-based).
  const dailyLossUsd = cfg.maxDailyLossUsd > 0 ? cfg.maxDailyLossUsd : 0;
  if (dailyLossUsd > 0 || cfg.maxDailyLossPct > 0) {
    const balance =
      cfg.accountBalance > 0
        ? cfg.accountBalance
        : (await getLatestTerminalBalance(db, cfg.terminalKeyId)) ?? 0;
    if (dailyLossUsd > 0 || balance > 0) {
      const dailyPnl = await getDailyRealizedPnl(db, cfg.terminalKeyId);
      const limit = dailyLossUsd > 0
        ? dailyLossUsd
        : balance * (cfg.maxDailyLossPct / 100);
      if (dailyPnl <= -limit) {
        return {
          ok: false,
          reason: `small_account: daily loss limit reached (${dailyPnl.toFixed(2)} ${cfg.accountCurrency} <= -${limit.toFixed(2)} ${cfg.accountCurrency})`,
        };
      }
    }
  }

  // 4. Cooldown on the same symbol.
  if (cfg.cooldownMinutes > 0) {
    const lastCloseMs = await getLastCloseTimestamp(db, symbol);
    if (lastCloseMs) {
      const elapsedMin = (Date.now() - lastCloseMs) / 60_000;
      if (elapsedMin < cfg.cooldownMinutes) {
        return {
          ok: false,
          reason: `small_account: cooldown active on ${symbol} (${Math.ceil(cfg.cooldownMinutes - elapsedMin)}min remaining)`,
        };
      }
    }
  }

  // 5. Consecutive-loss circuit breaker.
  if (cfg.maxConsecutiveLosses > 0) {
    const streak = await getConsecutiveLosses(db, cfg.terminalKeyId);
    if (streak >= cfg.maxConsecutiveLosses) {
      return {
        ok: false,
        reason: `small_account: circuit breaker after ${streak} consecutive losses`,
      };
    }
  }

  return { ok: true };
}
