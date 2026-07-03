/**
 * Public health check for load balancers / PM2 / uptime monitors.
 * Verifies the web server is responding and the database is reachable,
 * and reports per-symbol candle freshness, feature freshness, and last ingest.
 */

import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

const DB_TIMEOUT_MS = 2_000;
const MAX_CANDLE_AGE_MINUTES = 15;
const MAX_FEATURE_AGE_MINUTES = 15;

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

  type SymbolHealth = {
    symbol: string;
    latestCandleAt: string | null;
    candleAgeMinutes: number | null;
    latestFeatureAt: string | null;
    featureAgeMinutes: number | null;
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
      const now = Date.now();
      symbols = rows.map((r: any) => {
        const latestCandle = r.latest_candle_ts ? new Date(r.latest_candle_ts) : null;
        const latestFeature = r.latest_feature_at ? new Date(r.latest_feature_at) : null;
        const candleAge = latestCandle ? (now - latestCandle.getTime()) / 60_000 : null;
        const featureAge = latestFeature ? (now - latestFeature.getTime()) / 60_000 : null;
        if (candleAge !== null && candleAge > MAX_CANDLE_AGE_MINUTES) {
          staleCandles.push(r.symbol);
        }
        if (featureAge !== null && featureAge > MAX_FEATURE_AGE_MINUTES) {
          staleFeatures.push(r.symbol);
        }
        return {
          symbol: r.symbol,
          latestCandleAt: latestCandle?.toISOString() ?? null,
          candleAgeMinutes: candleAge !== null ? Math.round(candleAge * 10) / 10 : null,
          latestFeatureAt: latestFeature?.toISOString() ?? null,
          featureAgeMinutes: featureAge !== null ? Math.round(featureAge * 10) / 10 : null,
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

  const overallOk = dbOk && staleCandles.length === 0 && staleFeatures.length === 0;
  const status = overallOk ? 200 : 503;

  return NextResponse.json(
    {
      status: overallOk ? "ok" : "degraded",
      service: "tz-web-v2",
      timestamp: new Date().toISOString(),
      database: {
        connected: dbOk,
        now: dbNow,
        error: dbError,
      },
      ingest: {
        lastIngestAt,
      },
      freshness: {
        maxCandleAgeMinutes: MAX_CANDLE_AGE_MINUTES,
        maxFeatureAgeMinutes: MAX_FEATURE_AGE_MINUTES,
        symbols,
        staleCandles,
        staleFeatures,
      },
    },
    { status }
  );
}
