/**
 * P2-B: Data Clock Health Endpoint
 *
 * Reports per-symbol per-feature-table latest timestamps and lag minutes,
 * plus per-feature fresh/stale status. Enables proactive monitoring of
 * feature pipeline stalls before they cause 0-trade days.
 *
 * GET /api/health/data-clock?symbols=XAUUSD,EURUSD
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";

const DB_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_LAG_MINUTES: Record<string, number> = {
  candles_1m: 15,
  features_bias: 30,
  features_direction_state: 30,
  features_htf_bias: 30,
  features_pricing: 30,
  features_atr: 30,
  features_session: 30,
  features_spread: 30,
  features_zone: 60,
  features_ifvg: 60,
  features_order_block: 60,
  features_structure: 60,
  features_sweep: 60,
  features_displacement: 60,
  features_zone_retest: 60,
  features_opening_range: 120,
  features_candle_pattern: 120,
  features_time_of_day_edge: 120,
  features_indicator: 120,
  features_moving_average: 120,
  features_pivot: 120,
  features_liquidity_pools: 120,
  features_correlation: 240,
  features_time_of_day: 240,
};

const DATA_CLOCK_TABLES = [
  "candles_1m",
  "features_bias",
  "features_direction_state",
  "features_htf_bias",
  "features_pricing",
  "features_atr",
  "features_session",
  "features_spread",
  "features_zone",
  "features_ifvg",
  "features_order_block",
  "features_structure",
  "features_sweep",
  "features_displacement",
  "features_zone_retest",
  "features_opening_range",
  "features_candle_pattern",
  "features_time_of_day_edge",
  "features_indicator",
  "features_moving_average",
  "features_pivot",
  "features_liquidity_pools",
  "features_correlation",
  "features_time_of_day",
];

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function GET(req: NextRequest) {
  const pool = getPool();
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");
  const symbols = symbolsParam ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean) : null;

  // Resolve symbols from DB if not specified
  let activeSymbols = symbols;
  if (!activeSymbols || activeSymbols.length === 0) {
    try {
      const { rows } = await withTimeout(
        pool.query("SELECT DISTINCT symbol FROM candles_1m WHERE ts >= NOW() - INTERVAL '24 hours' ORDER BY symbol"),
        DB_TIMEOUT_MS,
        "symbol_list"
      );
      activeSymbols = rows.map((r: any) => r.symbol);
    } catch {
      activeSymbols = [];
    }
  }

  const now = Date.now();
  type TableClock = {
    table: string;
    latestTs: string | null;
    lagMinutes: number | null;
    maxLagMinutes: number;
    status: "fresh" | "stale" | "no_data";
  };

  type SymbolClock = {
    symbol: string;
    status: "healthy" | "stale" | "no_data";
    tables: TableClock[];
  };

  const results: SymbolClock[] = [];

  for (const symbol of activeSymbols) {
    const tables: TableClock[] = [];

    for (const table of DATA_CLOCK_TABLES) {
      try {
        const { rows } = await withTimeout(
          pool.query(
            `SELECT MAX(ts) as latest_ts FROM ${table} WHERE symbol = $1`,
            [symbol]
          ),
          DB_TIMEOUT_MS,
          `${table}/${symbol}`
        );
        const latestTs = rows[0]?.latest_ts ? new Date(rows[0].latest_ts) : null;
        const lagMinutes = latestTs ? (now - latestTs.getTime()) / 60_000 : null;
        const maxLag = DEFAULT_MAX_LAG_MINUTES[table] ?? 60;
        const status: "fresh" | "stale" | "no_data" = !latestTs
          ? "no_data"
          : lagMinutes !== null && lagMinutes > maxLag
            ? "stale"
            : "fresh";

        tables.push({
          table,
          latestTs: latestTs?.toISOString() ?? null,
          lagMinutes: lagMinutes !== null ? Math.round(lagMinutes * 10) / 10 : null,
          maxLagMinutes: maxLag,
          status,
        });
      } catch (err: any) {
        tables.push({
          table,
          latestTs: null,
          lagMinutes: null,
          maxLagMinutes: DEFAULT_MAX_LAG_MINUTES[table] ?? 60,
          status: "no_data",
        });
      }
    }

    const staleCount = tables.filter((t) => t.status === "stale").length;
    const noDataCount = tables.filter((t) => t.status === "no_data").length;
    const overallStatus: "healthy" | "stale" | "no_data" =
      noDataCount === tables.length ? "no_data" : staleCount > 0 ? "stale" : "healthy";

    results.push({
      symbol,
      status: overallStatus,
      tables,
    });
  }

  const unhealthySymbols = results.filter((r) => r.status !== "healthy").map((r) => r.symbol);

  return NextResponse.json({
    status: unhealthySymbols.length === 0 ? "ok" : "degraded",
    service: "tz-data-clock",
    timestamp: new Date().toISOString(),
    summary: {
      totalSymbols: results.length,
      healthy: results.filter((r) => r.status === "healthy").length,
      stale: results.filter((r) => r.status === "stale").length,
      noData: results.filter((r) => r.status === "no_data").length,
      unhealthySymbols,
    },
    symbols: results,
  });
}
