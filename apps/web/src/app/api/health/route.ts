/**
 * Public health check for load balancers / PM2 / uptime monitors.
 * Verifies the web server is responding and the database is reachable,
 * and reports per-symbol candle freshness, feature freshness, and last ingest.
 */

import { NextResponse } from "next/server";
import {
  getPool,
  getPoolStats,
  summarizeReadiness,
  type ReadinessStatus,
  type ReadinessVerdict,
} from "@tm/shared";
import { evaluateHealthFreshness } from "@/lib/healthReadiness";

const DB_TIMEOUT_MS = 2_000;

type DbSessionCount = {
  applicationName: string;
  state: string;
  sessions: number;
};

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
  let dbSessions: DbSessionCount[] = [];
  let dbSessionsError: string | null = null;

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

  if (dbOk) {
    try {
      const { rows } = await withTimeout(
        pool.query(
          `SELECT COALESCE(NULLIF(application_name, ''), '(empty)') AS application_name,
                  COALESCE(state, 'unknown') AS state,
                  COUNT(*)::int AS sessions
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND backend_type = 'client backend'
            GROUP BY 1, 2
            ORDER BY 1, 2`
        ),
        DB_TIMEOUT_MS,
        "db_sessions_query"
      );
      dbSessions = rows.map((row: any) => ({
        applicationName: row.application_name,
        state: row.state,
        sessions: Number(row.sessions),
      }));
    } catch (err: any) {
      dbSessionsError = err.message;
      console.error("[health] DB session telemetry failed:", err.message);
    }
  }

  type SymbolHealth = {
    symbol: string;
    latestCandleAt: string | null;
    candleAgeMinutes: number | null;
    latestFeatureAt: string | null;
    featureAgeMinutes: number | null;
    readinessStatus: ReadinessStatus;
    candleVerdict: ReadinessVerdict;
    featureVerdict: ReadinessVerdict;
  };

  let symbols: SymbolHealth[] = [];
  const staleCandles: string[] = [];
  const staleFeatures: string[] = [];
  let lastIngestAt: string | null = null;

  if (dbOk) {
    try {
      const { rows } = await withTimeout(
        pool.query(
          `SELECT
             c.symbol,
             MAX(c.ts) as latest_candle_ts,
             MAX(fj.processed_at) as latest_feature_at
           FROM candles_1m c
           LEFT JOIN feature_jobs fj
             ON fj.symbol = c.symbol
             AND fj.status = 'done'
             AND fj.processed_at >= NOW() - INTERVAL '24 hours'
           WHERE c.ts >= NOW() - INTERVAL '24 hours'
           GROUP BY c.symbol
           ORDER BY c.symbol`
        ),
        DB_TIMEOUT_MS,
        "freshness_query"
      );
      const now = new Date();
      symbols = rows.map((r: any) => {
        const latestCandle = r.latest_candle_ts ? new Date(r.latest_candle_ts) : null;
        const latestFeature = r.latest_feature_at ? new Date(r.latest_feature_at) : null;
        const readiness = evaluateHealthFreshness({
          symbol: r.symbol,
          latestCandle,
          latestFeature,
        }, now);
        if (readiness.candleVerdict !== "READY") staleCandles.push(r.symbol);
        if (readiness.featureVerdict !== "READY") staleFeatures.push(r.symbol);
        return {
          symbol: r.symbol,
          latestCandleAt: latestCandle?.toISOString() ?? null,
          candleAgeMinutes: readiness.candleAgeMinutes,
          latestFeatureAt: latestFeature?.toISOString() ?? null,
          featureAgeMinutes: readiness.featureAgeMinutes,
          readinessStatus: readiness.status,
          candleVerdict: readiness.candleVerdict,
          featureVerdict: readiness.featureVerdict,
        };
      });
    } catch (err: any) {
      console.error("[health] Freshness check failed:", err.message);
    }

    try {
      const { rows } = await withTimeout(
        pool.query(
          `SELECT MAX(ts) as last_ingest_ts FROM candles_1m WHERE ts >= NOW() - INTERVAL '24 hours'`
        ),
        DB_TIMEOUT_MS,
        "last_ingest_query"
      );
      lastIngestAt = rows[0]?.last_ingest_ts
        ? new Date(rows[0].last_ingest_ts).toISOString()
        : null;
    } catch (err: any) {
      console.error("[health] Last ingest check failed:", err.message);
    }
  }

  const readiness = summarizeReadiness(symbols.flatMap((symbol) => [
    symbol.candleVerdict,
    symbol.featureVerdict,
  ]));
  const status = dbOk ? 200 : 503;

  return NextResponse.json(
    {
      status: dbOk ? (readiness.status === "READY" ? "ok" : "degraded") : "unavailable",
      service: "tz-web-v2",
      timestamp: new Date().toISOString(),
      database: {
        connected: dbOk,
        now: dbNow,
        error: dbError,
        pool: getPoolStats(),
        sessions: dbSessions,
        sessionsError: dbSessionsError,
      },
      ingest: {
        lastIngestAt,
      },
      freshness: {
        readiness,
        symbols,
        staleCandles,
        staleFeatures,
      },
    },
    { status }
  );
}
