import type { Candle, ZoneOutput } from "@tm/shared";
import type { FvgSimulationSetup } from "./fvgSimulator";

interface QueryablePool {
  query<T = Record<string, unknown>>(text: string, values: unknown[]): Promise<{ rows: T[] }>;
}

const TABLE_BY_TF: Record<string, string> = {
  "1m": "candles_1m",
  "5m": "candles_5m",
  "15m": "candles_15m",
  "1h": "candles_1h",
  "4h": "candles_4h",
  "1d": "candles_1d_utc",
};

const DURATION_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export interface FvgLoaderOptions {
  preBars?: number;
  postBars?: number;
  toleranceMs?: number;
  maxZones?: number;
}

export interface LoadedFvgSetup extends FvgSimulationSetup {
  session: "asia" | "london" | "ny";
}

function toCandle(row: Record<string, unknown>): Candle {
  return { symbol: String(row.symbol), ts: new Date(String(row.ts)), o: Number(row.o), h: Number(row.h), l: Number(row.l), c: Number(row.c), v: row.v == null ? undefined : Number(row.v), tickCount: row.tick_count == null ? undefined : Number(row.tick_count) };
}

function sessionFor(ts: Date): LoadedFvgSetup["session"] {
  const hour = ts.getUTCHours();
  if (hour >= 7 && hour < 13) return "london";
  if (hour >= 13 && hour < 21) return "ny";
  return "asia";
}

export async function loadFvgSetups(pool: QueryablePool, symbol: string, tf: string, startDate: string, endDate: string, options: FvgLoaderOptions = {}): Promise<LoadedFvgSetup[]> {
  const table = TABLE_BY_TF[tf];
  const duration = DURATION_MS[tf];
  if (!table || !duration) throw new Error(`Unsupported FVG loader timeframe: ${tf}`);
  const preBars = options.preBars ?? 30;
  const postBars = options.postBars ?? 100;
  const toleranceMs = options.toleranceMs ?? 1_000;
  const zones = await pool.query(`SELECT symbol, tf, ts, zone_kind, direction, top, bottom, tapped, quality_score FROM features_zone WHERE zone_kind = 'fvg' AND symbol = $1 AND tf = $2 AND ts >= $3::timestamptz AND ts < $4::timestamptz ORDER BY ts`, [symbol, tf, startDate, endDate]);
  const setups: LoadedFvgSetup[] = [];
  for (const row of (zones.rows as Record<string, unknown>[]).slice(0, options.maxZones)) {
    const formationTs = new Date(String(row.ts));
    const from = new Date(formationTs.getTime() - (preBars + 3) * duration);
    const to = new Date(formationTs.getTime() + (postBars + 1) * duration);
    const candlesResult = await pool.query<Record<string, unknown>>(`SELECT symbol, ts, o, h, l, c, v, tick_count FROM ${table} WHERE symbol = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts`, [symbol, from, to]);
    const candles = candlesResult.rows.map(toCandle);
    const formationIndex = candles.findIndex((candle) => Math.abs(candle.ts.getTime() - formationTs.getTime()) <= toleranceMs);
    if (formationIndex < 2 || formationIndex + 1 >= candles.length) continue;
    const formationCandles = candles.slice(formationIndex - 2, formationIndex + 1) as [Candle, Candle, Candle];
    const preFormationCandles = candles.slice(Math.max(0, formationIndex - preBars), formationIndex - 2);
    const candlesAfterFormation = candles.slice(formationIndex + 1, formationIndex + 1 + postBars);
    if (preFormationCandles.length < 14 || candlesAfterFormation.length === 0) continue;
    const direction = row.direction === "bearish" ? "bearish" : row.direction === "bullish" ? "bullish" : undefined;
    if (!direction) continue;
    const zone: ZoneOutput["zones"][number] = { zoneKind: "fvg", direction, top: Number(row.top), bottom: Number(row.bottom), tapped: Boolean(row.tapped), ts: formationTs };
    setups.push({ zone, formationCandles, preFormationCandles, candlesAfterFormation, qualityScore: Number(row.quality_score ?? 0), session: sessionFor(formationTs) });
  }
  return setups;
}
