/**
 * Market-calendar helpers.
 *
 * FX spot markets trade ~24/5: the week opens Sunday 21:00 UTC (Asia) and closes
 * Friday 21:00 UTC (NY). The 21:00 UTC boundary matches the NY daily bucket used
 * by candles_1d_ny (mig 017). The feature pipeline defaults to ignoring candles
 * that land outside the tradable week so structure, bias, lifecycle and coverage
 * are not computed over stale/wide closed-market bars.
 *
 * Holiday calendar (Christmas/New Year etc.) is intentionally not modelled: the
 * production metals feed (1xTrade) streams through US holidays, so those hours
 * are genuinely tradable and excluding them would hide real gaps. If a future
 * feed closes for holidays, layer a date-keyed calendar behind isTradableInstant
 * without changing call sites.
 */

import type { TimeFrame } from "../types/feature";
import { TF_MS, floorToTf } from "./timeBucket";

/** NY session close / daily boundary, UTC hour. Matches candles_1d_ny. */
export const FX_WEEK_CLOSE_UTC_HOUR = 21;

/** A daily market break, in UTC hours (fractional allowed). [start, end). */
export interface DailyBreak {
  startHourUTC: number;
  endHourUTC: number;
}

/**
 * Per-symbol daily market breaks (UTC). FX majors trade 24/5 (no entry -> no
 * break). XAUUSD (gold) follows the CME/COMEX schedule: Sun 6:00pm ET -> Fri
 * 5:00pm ET, with a daily 60-minute maintenance halt 5:00pm-6:00pm ET. That is
 * 21:00-22:00 UTC in EDT (summer) and 22:00-23:00 UTC in EST (winter). We model
 * it fixed at 21:00-22:00 UTC because (a) our data confirms the break at 21:00 UTC
 * (2 bars in 30 days at 21:00, Apr-Jul/EDT) and (b) the repo anchors the NY day at
 * a FIXED 21:00 UTC (candles_1d_ny) with no DST handling anywhere. Caveat: if the
 * broker follows ET-DST, the break shifts to 22:00 UTC in EST and this (like
 * candles_1d_ny) would need a DST-aware revisit once winter 1m data exists to
 * confirm. Extend per symbol/asset as needed.
 */
export const DAILY_BREAKS_BY_SYMBOL: Record<string, DailyBreak[]> = {
  XAUUSD: [{ startHourUTC: 21, endHourUTC: 22 }],
};

/** Is the bar-open instant inside a configured daily break for the symbol? */
function inDailyBreak(ts: Date, symbol?: string): boolean {
  if (!symbol) return false;
  const breaks = DAILY_BREAKS_BY_SYMBOL[symbol];
  if (!breaks || breaks.length === 0) return false;
  const minutes = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  for (const b of breaks) {
    const s = b.startHourUTC * 60;
    const e = b.endHourUTC * 60;
    if (s < e) {
      if (minutes >= s && minutes < e) return true;
    } else {
      // break crosses midnight
      if (minutes >= s || minutes < e) return true;
    }
  }
  return false;
}

export function isWeekendTimestamp(ts: Date): boolean {
  const day = ts.getUTCDay();
  return day === 0 || day === 6;
}

export function filterWeekdayCandles<T extends { ts: Date }>(candles: T[], symbol?: string): T[] {
  if (process.env.TM_FEATURE_ALLOW_WEEKEND === "1") return candles;
  return candles.filter((c) => isTradableInstant(c.ts, symbol));
}

/**
 * Is a bar-open instant (UTC) inside the FX trading week?
 *   Sat        -> false
 *   Sun        -> hour >= 21 (Asia open)
 *   Fri        -> hour <  21 (before NY close)
 *   Mon-Thu    -> true
 * Bar-open instants for our tfs are minute-zero aligned, so an hour check is exact.
 */
export function isTradableInstant(ts: Date, symbol?: string): boolean {
  const dow = ts.getUTCDay();
  const h = ts.getUTCHours();
  if (dow === 6) return false; // Saturday
  if (dow === 0 && h < FX_WEEK_CLOSE_UTC_HOUR) return false; // Sunday before Asia open
  if (dow === 5 && h >= FX_WEEK_CLOSE_UTC_HOUR) return false; // Friday at/after NY close
  if (inDailyBreak(ts, symbol)) return false; // per-symbol daily halt (e.g. XAU 21:00 UTC)
  return true;
}

/**
 * Enumerate tradable bar-start buckets in [from, to] inclusive. Audit/coverage
 * only — never call on the engine hot path (it iterates the whole range).
 */
export function tradableBarStarts(tf: TimeFrame, from: Date, to: Date, symbol?: string): Date[] {
  const ms = TF_MS[tf];
  const out: Date[] = [];
  let t = floorToTf(from, tf).getTime();
  const end = to.getTime();
  while (t <= end) {
    const d = new Date(t);
    if (isTradableInstant(d, symbol)) out.push(d);
    t += ms;
  }
  return out;
}

/** Number of tradable bars expected in [from, to] for the FX 24/5 calendar. */
export function expectedTradableBars(tf: TimeFrame, from: Date, to: Date, symbol?: string): number {
  return tradableBarStarts(tf, from, to, symbol).length;
}

/**
 * Elapsed tradable minutes in (from, to]. Closed weekends and configured daily
 * breaks contribute zero, preventing wall-clock freshness false positives.
 */
export function elapsedTradableMinutes(from: Date, to: Date, symbol?: string): number {
  if (to.getTime() <= from.getTime()) return 0;
  let cursor = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const end = to.getTime();
  let minutes = 0;
  while (cursor <= end) {
    if (isTradableInstant(new Date(cursor), symbol)) minutes++;
    cursor += 60_000;
  }
  return minutes;
}

export interface GapInfo {
  hasGaps: boolean;
  gapCount: number;
  largestGapMinutes: number;
}

/**
 * Calendar-aware gap report: count tradable buckets in [from, to] that have no
 * matching row, plus the longest run of consecutive missing tradable bars.
 * Weekend/closed hours are not treated as gaps.
 */
export function gapInfo(
  rows: ReadonlyArray<{ ts: Date }>,
  tf: TimeFrame,
  from: Date,
  to: Date,
  symbol?: string
): GapInfo {
  const tfMinutes = TF_MS[tf] / 60_000;
  const present = new Set(rows.map((r) => (r.ts instanceof Date ? r.ts.getTime() : new Date(r.ts).getTime())));
  const buckets = tradableBarStarts(tf, from, to, symbol);

  let gapCount = 0;
  let run = 0;
  let maxRun = 0;
  for (const b of buckets) {
    if (present.has(b.getTime())) {
      run = 0;
    } else {
      gapCount++;
      run++;
      if (run > maxRun) maxRun = run;
    }
  }
  return { hasGaps: gapCount > 0, gapCount, largestGapMinutes: maxRun * tfMinutes };
}

/**
 * Get the latest tradable candle timestamp for a symbol/timeframe.
 * This is used by freshness checks to compare against tradable time, not raw MAX(ts).
 * Returns null if no tradable candles exist in the window.
 */
export async function getLatestTradableCandle(
  pool: any,
  symbol: string,
  tf: TimeFrame,
  lookbackDays: number = 7
): Promise<Date | null> {
  const table = `candles_${tf}`;
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  
  const { rows } = await pool.query(
    `SELECT MAX(ts) as max_ts FROM ${table} WHERE symbol = $1 AND ts >= $2 AND ts <= $3`,
    [symbol, from, to]
  );
  
  const maxTs = rows[0]?.max_ts;
  if (!maxTs) return null;
  
  // Walk backwards from maxTs to find the first tradable instant
  let candidate = new Date(maxTs);
  for (let i = 0; i < 1000; i++) { // safety limit
    if (isTradableInstant(candidate, symbol)) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() - TF_MS[tf]);
  }
  return null;
}
