/**
 * MT5 Bar Ingestion API
 * Accepts 1m candle batches from MT5 EA and writes to TimescaleDB.
 * Backward-compatible with V1 EA payload format (ts/ms + o/h/l/c/tickVol)
 * and V2 format (time/sec + open/high/low/close/tick_volume).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { checkAndTriggerAllActive } from "@/lib/pipelineTrigger";
import { emitNinjaTurtleSignals } from "@/lib/robots/ninjaTurtleEmitter";
import { runNinjaTurtleTrailMonitor } from "@/lib/robots/ninjaTurtleTrailMonitor";

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
    "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";
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
    const rows = normalizedBars.map((bar) => {
      const ts = new Date(Math.round(bar.time / 60) * 60000);
      return {
        ts,
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        v: bar.tick_volume,
        spread: bar.spread,
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

    // Refresh the continuous aggregates for the buckets touched by this
    // batch. This handles late/out-of-order bars and keeps the HTF tables
    // consistent without relying solely on the background refresh policies.
    const minTs = rows.reduce((m, r) => (r.ts < m ? r.ts : m), rows[0].ts);
    const maxTs = rows.reduce((m, r) => (r.ts > m ? r.ts : m), rows[0].ts);
    const caggConfigs: { name: string; widthMs: number }[] = [
      { name: "candles_5m", widthMs: 5 * 60 * 1000 },
      { name: "candles_15m", widthMs: 15 * 60 * 1000 },
      { name: "candles_1h", widthMs: 60 * 60 * 1000 },
      { name: "candles_4h", widthMs: 4 * 60 * 60 * 1000 },
      { name: "candles_1d_utc", widthMs: 24 * 60 * 60 * 1000 },
      { name: "candles_1d_ny", widthMs: 24 * 60 * 60 * 1000 },
    ];
    for (const cfg of caggConfigs) {
      const windowStart = new Date(minTs.getTime() - cfg.widthMs);
      const windowEnd = new Date(maxTs.getTime() + cfg.widthMs);
      pool
        .query(
          "CALL refresh_continuous_aggregate($1, $2::timestamptz, $3::timestamptz)",
          [cfg.name, windowStart.toISOString(), windowEnd.toISOString()],
        )
        .catch((err) => {
          console.error(
            `[ingest] Cagg refresh failed for ${cfg.name}:`,
            err.message,
          );
        });
    }

    // Trigger live pipeline asynchronously (non-blocking)
    // Only runs when a 15m boundary is crossed.
    // Iterates all active live deployments (falls back to waqar_v2_15m if none).
    checkAndTriggerAllActive(cleanSymbol).catch((err) => {
      console.error("[ingest] Pipeline trigger failed:", err.message);
    });

    // Run robot strategies (e.g., Ninja Turtle Scalper) asynchronously.
    emitNinjaTurtleSignals(pool, cleanSymbol).catch((err) => {
      console.error("[ingest] Ninja Turtle emitter failed:", err.message);
    });

    // Update server-side trailing stops for robot positions.
    runNinjaTurtleTrailMonitor().catch((err) => {
      console.error("[ingest] Ninja Turtle trail monitor failed:", err.message);
    });

    return NextResponse.json({
      ok: true,
      accepted: normalizedBars.length,
      symbol: cleanSymbol,
    });
  } catch (err: any) {
    console.error("[ingest] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
