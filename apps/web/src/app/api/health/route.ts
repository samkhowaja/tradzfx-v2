/**
 * Public health check for load balancers / PM2 / uptime monitors.
 * Verifies the web server is responding and the database is reachable,
 * and reports per-symbol candle freshness.
 */

import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

const DB_TIMEOUT_MS = 2_000;
const MAX_CANDLE_AGE_MINUTES = 15;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function GET() {
  const pool = getPool();
  let dbOk = false;
  let dbNow: string | null = null;
  let dbError: string | null = null;

  try {
    const { rows } = await withTimeout(
      pool.query("SELECT NOW() as now"),
      DB_TIMEOUT_MS,
      "db_query"
    );
    dbOk = true;
    dbNow = rows[0]?.now?.toISOString() ?? null;
  } catch (err: any) {
    dbError = err.message;
    console.error("[health] DB check failed:", err.message);
  }

  let symbols: { symbol: string; latestCandleAt: string | null; ageMinutes: number | null }[] = [];
  let staleSymbols: string[] = [];

  if (dbOk) {
    try {
      const { rows } = await withTimeout(
        pool.query(
          `SELECT symbol, MAX(ts) as latest_ts
           FROM candles_1m
           GROUP BY symbol
           ORDER BY symbol`
        ),
        DB_TIMEOUT_MS,
        "freshness_query"
      );
      const now = Date.now();
      symbols = rows.map((r: any) => {
        const latest = r.latest_ts ? new Date(r.latest_ts) : null;
        const ageMinutes = latest ? (now - latest.getTime()) / 60_000 : null;
        if (ageMinutes !== null && ageMinutes > MAX_CANDLE_AGE_MINUTES) {
          staleSymbols.push(r.symbol);
        }
        return {
          symbol: r.symbol,
          latestCandleAt: latest?.toISOString() ?? null,
          ageMinutes: ageMinutes !== null ? Math.round(ageMinutes * 10) / 10 : null,
        };
      });
    } catch (err: any) {
      console.error("[health] Freshness check failed:", err.message);
    }
  }

  const overallOk = dbOk && staleSymbols.length === 0;
  const status = overallOk ? 200 : 503;

  return NextResponse.json(
    {
      status: overallOk ? "ok" : "degraded",
      service: "tm-web-v2",
      timestamp: new Date().toISOString(),
      database: {
        connected: dbOk,
        now: dbNow,
        error: dbError,
      },
      freshness: {
        maxAgeMinutes: MAX_CANDLE_AGE_MINUTES,
        symbols,
        staleSymbols,
      },
    },
    { status }
  );
}
