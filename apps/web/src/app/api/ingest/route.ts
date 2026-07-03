/**
 * MT5 Bar Ingestion API
 * Accepts 1m candle batches from MT5 EA and writes to TimescaleDB.
 * Backward-compatible with V1 EA payload format (ts/ms + o/h/l/c/tickVol)
 * and V2 format (time/sec + open/high/low/close/tick_volume).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, timeBucket, roundToMinute, pointsToPips, type TimeFrame } from "@tm/shared";
import { globalDAG } from "@tm/engine";
import { checkAndTriggerAllActive } from "@/lib/pipelineTrigger";
import { emitNinjaTurtleSignals } from "@/lib/robots/ninjaTurtleEmitter";
import { runNinjaTurtleTrailMonitor } from "@/lib/robots/ninjaTurtleTrailMonitor";
import { publish } from "@/lib/analyzeStreamBus";

interface V2Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume: number;
  spread?: number;
}

interface V1Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  tickVol: number;
  spread?: number;
}

interface V2Payload {
  schemaVersion: string;
  symbol: string;
  timeframe: string;
  source: { broker: string; accountType: string; digits: number };
  bars: V2Bar[];
}

interface V1Payload {
  schemaVersion: string;
  symbol: string;
  timeframe: string;
  source: { broker: string; accountType: string; digits: number };
  bars: V1Bar[];
}

type BarPayload = V2Payload | V1Payload;

const JOB_TFS: TimeFrame[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

function isV1Bar(bar: V1Bar | V2Bar): bar is V1Bar {
  return (bar as V1Bar).ts !== undefined;
}

function normalizeBars(bars: BarPayload["bars"]): V2Bar[] {
  if (bars.length === 0) return [];
  if (isV1Bar(bars[0])) {
    return (bars as V1Bar[]).map((b) => ({
      time: b.ts > 1_000_000_000_000 ? Math.floor(b.ts / 1000) : b.ts,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      tick_volume: b.tickVol,
      spread: b.spread,
    }));
  }
  return bars as V2Bar[];
}

export async function POST(request: NextRequest) {
  const EXPECTED_API_KEY =
    process.env.TM_MT5_API_KEY ??
    process.env.MT5_API_KEY ??
    "";
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: BarPayload = await request.json();
    const { symbol, bars } = payload;

    if (!symbol || !Array.isArray(bars) || bars.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const normalizedBars = normalizeBars(bars);
    const pool = getPool();

    // Normalize symbol
    const cleanSymbol = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const broker = payload.source?.broker ?? null;
    const digits =
      typeof payload.source?.digits === "number"
        ? Math.max(0, Math.min(10, Math.round(payload.source.digits)))
        : null;

    // Batch insert to TimescaleDB
    // Normalize timestamps to the nearest minute to prevent duplicate
    // bars when the EA sends the same 1m bar at both xx:59 and xx:00.
    // Store spread in pips (not MT5 points) so gates and UI compare apples to apples.
    const effectiveDigits = digits ?? 5;
    const rows = normalizedBars.map((bar) => {
      const ts = roundToMinute(bar.time * 1000);
      return {
        ts,
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        v: bar.tick_volume,
        spread: typeof bar.spread === "number" ? pointsToPips(bar.spread, effectiveDigits) : null,
      };
    });

    const values = rows
      .map(
        (r) =>
          `('${cleanSymbol}', '${r.ts.toISOString()}', ${r.o}, ${r.h}, ${r.l}, ${r.c}, ${r.v}, ${r.spread === undefined || r.spread === null ? "NULL" : r.spread}, ${broker === null ? "NULL" : `'${broker.replace(/'/g, "''")}'`}, ${digits === null ? "NULL" : digits})`,
      )
      .join(",");

    await pool.query(
      `INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, spread, broker, digits)
       VALUES ${values}
       ON CONFLICT (symbol, ts) DO UPDATE SET
         o = EXCLUDED.o,
         h = EXCLUDED.h,
         l = EXCLUDED.l,
         c = EXCLUDED.c,
         v = EXCLUDED.v,
         spread = EXCLUDED.spread,
         broker = EXCLUDED.broker,
         digits = EXCLUDED.digits`,
    );

    // Run the live pipeline. Feature-job enqueue is disabled by default until a
    // worker is intentionally deployed (set TM_DISABLE_FEATURE_JOBS=false to enable).
    await checkAndTriggerAllActive(cleanSymbol);
    if (process.env.TM_DISABLE_FEATURE_JOBS === "false") {
      await enqueueFeatureJobs(pool, cleanSymbol, rows);
    }

    // Run robot strategies (e.g., Ninja Turtle Scalper) asynchronously only when
    // explicitly enabled. They are off by default in V2.
    if (process.env.NINJA_LIVE_ENABLED === "true") {
      emitNinjaTurtleSignals(pool, cleanSymbol).catch((err) => {
        console.error("[ingest] Ninja Turtle emitter failed:", err.message);
      });

      // Update server-side trailing stops for robot positions.
      runNinjaTurtleTrailMonitor().catch((err) => {
        console.error("[ingest] Ninja Turtle trail monitor failed:", err.message);
      });
    }

    // Notify any active SSE analyzer streams about the new 1m candles.
    const emittedTs = new Set<string>();
    for (const row of rows) {
      const ts = row.ts.toISOString();
      if (emittedTs.has(ts)) continue;
      emittedTs.add(ts);
      publish({
        type: "candle",
        symbol: cleanSymbol,
        tf: "1m",
        candle: { ts, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v },
      });
    }

    return NextResponse.json({
      ok: true,
      accepted: normalizedBars.length,
      symbol: cleanSymbol,
      cagg: { ok: true, errors: [] },
    });
  } catch (err: any) {
    console.error("[ingest] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function enqueueFeatureJobs(
  pool: any,
  symbol: string,
  rows: Array<{ ts: Date; o: number; h: number; l: number; c: number; v: number; spread: number | null }>
): Promise<void> {
  const featureNames = globalDAG.getFeatureNames();
  if (featureNames.length === 0) return;

  const seenBuckets = new Set<string>();
  for (const row of rows) {
    for (const tf of JOB_TFS) {
      const bucket = timeBucket(row.ts, tf);
      const key = `${tf}:${bucket.toISOString()}`;
      if (seenBuckets.has(key)) continue;
      seenBuckets.add(key);

      await pool.query(
        `INSERT INTO feature_jobs (symbol, tf, ts, feature_name, status)
         SELECT $1, $2, $3, unnest($4::text[]), 'pending'
         ON CONFLICT (symbol, tf, ts, feature_name)
         DO UPDATE SET status = 'pending', processed_at = NULL, error_message = NULL`,
        [symbol, tf, bucket.toISOString(), featureNames]
      );
    }
  }
}
