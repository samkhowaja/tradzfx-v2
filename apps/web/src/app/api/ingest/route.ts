/**
 * MT5 Bar Ingestion API
 * Accepts 1m candle batches from MT5 EA and writes to TimescaleDB.
 * Backward-compatible with V1 EA payload format (ts/ms + o/h/l/c/tickVol)
 * and V2 format (time/sec + open/high/low/close/tick_volume).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getFeaturePipelineSymbol,
  getPool,
  timeBucket,
  roundToMinute,
  pointsToPips,
  getRegistryPipSize,
} from "@tm/shared";
import { resolveFeatureProfileRuns } from "@tm/engine";
import { checkAndTriggerAllActive } from "@/lib/pipelineTrigger";
import { emitNinjaTurtleSignals } from "@/lib/robots/ninjaTurtleEmitter";
import { runNinjaTurtleTrailMonitor } from "@/lib/robots/ninjaTurtleTrailMonitor";
import { publish } from "@/lib/analyzeStreamBus";
import { validateMt5ApiKey } from "@/lib/mt5Auth";

interface V2Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume: number;
  spread?: number;
}

function normalizeBrokerName(broker: string | undefined): string {
  return broker?.trim() === "MT5" ? "1x Trade Ltd." : broker?.trim() || "default";
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

function isValidCandle(bar: V2Bar): { valid: true } | { valid: false; reason: string } {
  if (!Number.isFinite(bar.time) || bar.time <= 0) {
    return { valid: false, reason: "Invalid candle timestamp" };
  }
  const fields = [bar.open, bar.high, bar.low, bar.close, bar.tick_volume];
  if (fields.some((v) => !Number.isFinite(v))) {
    return { valid: false, reason: "Non-finite OHLCV value" };
  }
  if (bar.open < 0 || bar.high < 0 || bar.low < 0 || bar.close < 0 || bar.tick_volume < 0) {
    return { valid: false, reason: "Negative OHLCV value" };
  }
  if (bar.high < bar.low) {
    return { valid: false, reason: "High < low" };
  }
  if (bar.high < bar.open || bar.high < bar.close) {
    return { valid: false, reason: "High below open or close" };
  }
  if (bar.low > bar.open || bar.low > bar.close) {
    return { valid: false, reason: "Low above open or close" };
  }
  if (typeof bar.spread === "number" && (!Number.isFinite(bar.spread) || bar.spread < 0)) {
    return { valid: false, reason: "Invalid spread" };
  }
  return { valid: true };
}

// P0-A1 (V3 BUG-3.2): magnitude prefilter. A single 1m candle cannot legitimately
// span > 1000 pips on a liquid major; such a bar is a bad tick. We QUARANTINE (flag
// in candle_quality) rather than drop, to preserve PIT — downstream ATR winsorizes.
const MAX_1M_RANGE_PIPS = 1000;
function suspectRangeReason(symbol: string, bar: V2Bar): string | null {
  const pipSize = getRegistryPipSize(symbol);
  if (!(pipSize > 0)) return null;
  const rangePips = (bar.high - bar.low) / pipSize;
  if (Number.isFinite(rangePips) && rangePips > MAX_1M_RANGE_PIPS) {
    return `1m range ${rangePips.toFixed(1)}p > ${MAX_1M_RANGE_PIPS}p cap`;
  }
  return null;
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
  if (!(await validateMt5ApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: BarPayload = await request.json();
    const { symbol, bars } = payload;

    if (!symbol || !Array.isArray(bars) || bars.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const normalizedBars = normalizeBars(bars);

    // Reject corrupt bars before they reach the DB or downstream pipelines.
    for (let i = 0; i < normalizedBars.length; i++) {
      const check = isValidCandle(normalizedBars[i]);
      if (!check.valid) {
        return NextResponse.json(
          { error: "Invalid candle data", index: i, reason: check.reason },
          { status: 400 }
        );
      }
    }

    const pool = getPool();

    // P0-A1: flag magnitude-suspect candles (best-effort; never block ingest).
    for (const bar of normalizedBars) {
      const reason = suspectRangeReason(symbol, bar);
      if (reason) {
        const ts = new Date(bar.time * 1000);
        pool
          .query(
            `INSERT INTO candle_quality(symbol, ts, is_suspect, reason)
             VALUES ($1, $2, true, $3)
             ON CONFLICT (symbol, ts) DO UPDATE SET is_suspect = true, reason = EXCLUDED.reason`,
            [symbol, ts, reason]
          )
          .catch(() => {});
      }
    }

    // Normalize symbol
    const cleanSymbol = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const broker = normalizeBrokerName(payload.source?.broker);
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

    // Parameterized batch insert via UNNEST — no string interpolation.
    // Each array is a column: symbol, ts, o, h, l, c, v, spread, broker, digits.
    const n = rows.length;
    const symbols: string[] = Array.from({ length: n }, () => cleanSymbol);
    const timestamps: string[] = rows.map((r) => r.ts.toISOString());
    const opens: number[] = rows.map((r) => r.o);
    const highs: number[] = rows.map((r) => r.h);
    const lows: number[] = rows.map((r) => r.l);
    const closes: number[] = rows.map((r) => r.c);
    const volumes: number[] = rows.map((r) => r.v);
    const spreads: (number | null)[] = rows.map((r) =>
      r.spread === undefined || r.spread === null ? null : r.spread
    );
    const brokers: string[] = Array.from({ length: n }, () => broker);
    const digitsArr: (number | null)[] = Array.from({ length: n }, () => digits);

    await pool.query(
      `INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, spread, broker, digits)
       SELECT * FROM UNNEST($1::text[], $2::timestamptz[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[], $8::numeric[], $9::text[], $10::int[])
       ON CONFLICT (symbol, broker, ts) DO UPDATE SET
         o = EXCLUDED.o,
         h = EXCLUDED.h,
         l = EXCLUDED.l,
         c = EXCLUDED.c,
         v = EXCLUDED.v,
         spread = EXCLUDED.spread,
         broker = EXCLUDED.broker,
         digits = EXCLUDED.digits`,
      [symbols, timestamps, opens, highs, lows, closes, volumes, spreads, brokers, digitsArr]
    );

    // Positive eligibility is required. Absence of quarantine evidence is not
    // validation; new or replayed raw rows stay pending until a worker promotes
    // them to CLEAN.
    await pool.query(
      `INSERT INTO market.candle_eligibility (symbol, broker, timeframe, ts, state)
       SELECT symbol, broker, timeframe, ts, 'PERSISTED'
       FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamptz[])
         AS input(symbol, broker, timeframe, ts)
       ON CONFLICT (symbol, broker, timeframe, ts) DO NOTHING`,
      [symbols, brokers, Array.from({ length: n }, () => "1m"), timestamps]
    );

    // Do not trigger features/setups while newly ingested bars overlap a
    // blocking quarantine decision for this symbol/broker. Raw storage stays
    // intact; downstream use fails closed.
    const quarantineCheck = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM market.candle_eligibility e
        WHERE e.symbol = $1 AND e.broker = $2 AND e.timeframe = '1m'
          AND e.ts >= $3::timestamptz AND e.ts <= $4::timestamptz
          AND e.state <> 'CLEAN'`,
      [cleanSymbol, broker, rows[0].ts, rows[rows.length - 1].ts]
    );
    const downstreamBlocked = quarantineCheck.rows[0].count > 0;

    // Run the live pipeline. Feature-job enqueue is disabled by default until a
    // worker is intentionally deployed (set TM_DISABLE_FEATURE_JOBS=false to enable).
    // Post-commit: a failure here must NOT turn the already-persisted write into
    // a 500 (the EA would retry and duplicate-load). Report it on the 200 instead.
    let triggerError: string | null = null;
    try {
      if (!downstreamBlocked && process.env.TM_DISABLE_FEATURE_JOBS !== "true") {
        await checkAndTriggerAllActive(cleanSymbol);
      }
      if (!downstreamBlocked && process.env.TM_DISABLE_FEATURE_JOBS === "false") {
        await enqueueFeatureJobs(pool, cleanSymbol, rows);
      }
    } catch (err: any) {
      triggerError = err?.message ?? String(err);
      console.error("[ingest] pipeline trigger failed (bars already committed):", triggerError);
    }
    if (downstreamBlocked) triggerError = "downstream blocked by candle quarantine";

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
      barsAccepted: normalizedBars.length,
      symbol: cleanSymbol,
      cagg: { ok: true, errors: [] },
      ...(triggerError ? { triggerError } : {}),
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
  const universe = await getFeaturePipelineSymbol(pool, symbol);
  if (!universe?.enabled) return;

  const runs = resolveFeatureProfileRuns(
    universe.requiredFeatureProfile,
    universe.profileVersion,
    universe.requiredTimeframes
  );
  const seenBuckets = new Set<string>();
  for (const row of rows) {
    for (const { tf, features } of runs) {
      const bucket = timeBucket(row.ts, tf);
      const key = `${tf}:${bucket.toISOString()}`;
      if (seenBuckets.has(key)) continue;
      seenBuckets.add(key);

      await pool.query(
        `INSERT INTO feature_jobs (symbol, tf, ts, feature_name, status)
         SELECT $1, $2, $3, unnest($4::text[]), 'pending'
         ON CONFLICT (symbol, tf, ts, feature_name)
         DO UPDATE SET status = 'pending', processed_at = NULL, error_message = NULL`,
        [symbol, tf, bucket.toISOString(), features]
      );
    }
  }
}
