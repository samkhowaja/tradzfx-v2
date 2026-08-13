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

/**
 * Date-keyed Sunday metals session overrides (Option C, decided 2026-08-13).
 *
 * The base calendar is strictly FX 24/5: Sunday < 21:00 UTC is closed. The
 * 1xTrade metals feed, however, streams XAUUSD on SOME Sundays from ~00:00 UTC
 * (4 of the 12 Sundays surveyed 2026-05-24..2026-08-09 ran 00:00->23:59; the
 * other 8 only resumed ~22:0x). No static rule is truthful: a blanket open
 * manufactures false gaps on non-streaming Sundays; a blanket close labels
 * real streamed bars as canonical leaks. So each empirically verified Sunday
 * session is recorded here, keyed by UTC date, and `isTradableInstant` treats
 * registered instants as tradable for that symbol on that date only.
 *
 * Fail-closed: a Sunday with NO registry entry stays closed — bars present
 * then are flagged as anomalies (potential leaks) until someone surveys the
 * raw feed and registers (or rejects) the session. A registered session makes
 * the whole window tradable for certification, so real holes inside it (e.g.
 * 2026-07-19 01:59->22:04) surface as genuine missing bars, not calendar
 * artifacts.
 *
 * Evidence pattern mirrors STRUCTURAL_BROKER_HOLES: raw feed survey + audit.
 */
export const SUNDAY_SESSION_BY_SYMBOL_DATE: Record<string, Record<string, { session: { startHourUTC: number; endHourUTC: number }[]; evidence: string }>> = {
  XAUUSD: {
    "2026-07-12": { session: [{ startHourUTC: 0, endHourUTC: 21 }], evidence: "raw 1m survey 2026-08-13: 1254 bars 00:00-20:53 UTC, broker 1x Trade Ltd." },
    "2026-07-19": { session: [{ startHourUTC: 0, endHourUTC: 2 }], evidence: "raw 1m survey 2026-08-13: 119 bars 00:00-01:58 UTC then gap to 22:05 reopen; intra-session hole 01:59-22:04 stays fail-closed (real missing bars)" },
    "2026-07-26": { session: [{ startHourUTC: 0, endHourUTC: 21 }], evidence: "raw 1m survey 2026-08-13: 1255 bars 00:00-20:54 UTC, broker 1x Trade Ltd." },
    "2026-08-02": { session: [{ startHourUTC: 0, endHourUTC: 21 }], evidence: "raw 1m survey 2026-08-13: 1253 bars 00:00-20:52 UTC, broker 1x Trade Ltd." },
    "2026-08-09": { session: [{ startHourUTC: 0, endHourUTC: 21 }], evidence: "raw 1m survey 2026-08-13: 1255 bars 00:00-20:54 UTC, broker 1x Trade Ltd." },
  },
};

/** Is the bar-open instant inside a registered Sunday session override? */
function inSundaySession(ts: Date, symbol?: string): boolean {
  if (!symbol) return false;
  const byDate = SUNDAY_SESSION_BY_SYMBOL_DATE[symbol];
  if (!byDate) return false;
  if (ts.getUTCDay() !== 0) return false;
  const dateKey = ts.toISOString().slice(0, 10);
  const entry = byDate[dateKey];
  if (!entry) return false;
  const minutes = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  return entry.session.some(({ startHourUTC, endHourUTC }) => {
    const s = startHourUTC * 60;
    const e = endHourUTC * 60;
    return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
  });
}

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
  if (inSundaySession(ts, symbol)) return true; // date-keyed metals override (before weekend check)
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

/**
 * Certification-only policy (NOT used by isTradableInstant): the XAUUSD broker
 * feed (1x Trade Ltd.) empirically halts before the modeled 21:00 UTC break and
 * resumes after 22:00 UTC. Verified 2026-08-07 over 2026-07-12..2026-08-06:
 * last pre-break bar drifts between 20:50 and 20:59 UTC; first post-break bar is
 * 22:05 UTC. These minutes are absent in RAW candles (broker never sent them),
 * so they are modeled as non-trading for CERTIFICATION gap semantics only. The
 * tradable filter keeps 20:50-20:59 tradable so real bars are never dropped.
 */
export const BREAK_EDGE_POLICY_BY_SYMBOL: Record<string, { preBreakHaltFromMinUTC: number; postBreakResumeMinUTC: number }> = {
  XAUUSD: { preBreakHaltFromMinUTC: 20 * 60 + 50, postBreakResumeMinUTC: 22 * 60 + 5 },
};

/** Is a bar-open instant inside the modeled break-edge halt/resume window? */
export function inBreakEdgeWindow(ts: Date, symbol?: string): boolean {
  if (!symbol) return false;
  const pol = BREAK_EDGE_POLICY_BY_SYMBOL[symbol];
  if (!pol) return false;
  const mins = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  return (mins >= pol.preBreakHaltFromMinUTC && mins < 21 * 60) ||
         (mins >= 22 * 60 && mins < pol.postBreakResumeMinUTC);
}

/**
 * Documented genuine feed outages: real trading-hours gaps, absent in raw and
 * canonical, verified against broker feed. These are PERMANENT hard blockers for
 * time-bucket certification until replaced with provenance-complete evidence or
 * reclassified as a structural hole. Never auto-waive.
 * (Empty as of 2026-08-07: the Jul 29 entry was reclassified STRUCTURAL_BROKER_HOLE.)
 */
export const KNOWN_FEED_OUTAGES: { symbol: string; startUTC: string; endExclusiveUTC: string; reason: string; verified: string }[] = [];

export function inKnownFeedOutage(ts: Date, symbol?: string): boolean {
  if (!symbol) return false;
  const t = ts.getTime();
  return KNOWN_FEED_OUTAGES.some(o =>
    o.symbol === symbol && t >= new Date(o.startUTC).getTime() && t < new Date(o.endExclusiveUTC).getTime());
}

/**
 * STRUCTURAL_BROKER_HOLE: intervals the broker itself proves do not exist.
 * Requires three agreeing evidence classes: live feed absence, historical
 * re-export absence, and on-demand terminal CopyRates absence (request
 * artifact). These bars never existed at the broker — NOT pipeline loss.
 *
 * Policy (decided 2026-08-07): structural holes are immutable, excluded from
 * canonical fill attempts, do not count as pipeline loss, do not trigger
 * quarantine escalation, and are EXPECTED-INCOMPLETE for bucket certification
 * (documented, non-blocking) when the provenance reference is complete.
 * KNOWN_FEED_OUTAGES stays for true operational outages pending evidence.
 */
export const STRUCTURAL_BROKER_HOLES: { symbol: string; startUTC: string; endExclusiveUTC: string; reason: string; provenanceArtifact: string; verified: string }[] = [
  {
    symbol: "XAUUSD",
    startUTC: "2026-07-29T12:00:00Z",
    endExclusiveUTC: "2026-07-29T12:08:00Z",
    reason: "8-minute broker-proven absence in active trading hours: live feed never delivered the bars; MT5 historical re-export lacks them; on-demand terminal CopyRates (LINEAGE-06 request channel) confirms 11:59 → 12:08 jump. Bars never existed at 1xTrade-Server.",
    provenanceArtifact: "request fefc1b2b-87cc-4f53-98e3-871e25b8df5d / artifact 96648c09-6468-4270-a6be-0cd3ad49518f (sha256 91d76e20ae8ef5703cbf2b40cc2c513397f4a597f1d3a4b93e1f8b5117f6a982), terminal 1xTrade-Server login 296743, retrieved 2026-08-07T06:35:04Z, verdict MATCH 53 bars 0 mismatches",
    verified: "2026-08-07 reports/candle-request-fefc1b2b-87cc-4f53-98e3-871e25b8df5d.json",
  },
  {
    symbol: "XAUUSD",
    startUTC: "2026-07-19T01:59:00Z",
    endExclusiveUTC: "2026-07-19T02:00:00Z",
    reason: "1-minute absence inside the registered Sunday session [00:00,02:00): raw and canonical both end at 01:58 and resume 22:05; the only missing bar inside the session window (generate_series diff 2026-08-13). Broker-side absence, not pipeline loss.",
    provenanceArtifact: "PENDING: evidence class 3 (on-demand terminal CopyRates) not yet obtained - ingestion closed, no market.candle_requests row covers this window. Classes 1+2 confirmed via raw survey (temp/_hole_20260719.cjs, _session_missing.cjs). Until class 3 lands this hole stays BLOCKING (expected-incomplete treatment requires complete provenance).",
    verified: "PENDING - 2026-08-13 docs/sunday-session-registry-and-0159-hole-2026-08-13.md",
  },
];

export function inStructuralBrokerHole(ts: Date, symbol?: string): boolean {
  if (!symbol) return false;
  const t = ts.getTime();
  return STRUCTURAL_BROKER_HOLES.some(o =>
    o.symbol === symbol && t >= new Date(o.startUTC).getTime() && t < new Date(o.endExclusiveUTC).getTime());
}

export interface GapInfo {
  hasGaps: boolean;
  gapCount: number;
  largestGapMinutes: number;
}

export type CandleGapClass = "NONE" | "EXPECTED_WEEKEND" | "EXPECTED_DAILY_BREAK" | "UNEXPECTED";

/** Classify continuity gap using same midpoint policy as canonical DB classifier. */
export function classifyCandleGap(
  symbol: string,
  _brokerIdentity: string | null,
  previousTs: Date | null,
  currentTs: Date | null
): CandleGapClass {
  if (!previousTs || !currentTs || currentTs.getTime() <= previousTs.getTime()) return "NONE";
  if (currentTs.getTime() - previousTs.getTime() <= 60_000) return "NONE";
  const midpoint = new Date((previousTs.getTime() + currentTs.getTime()) / 2);
  const dow = midpoint.getUTCDay();
  const hour = midpoint.getUTCHours();
  if (dow === 6 || (dow === 0 && hour < 21) || (dow === 5 && hour >= 21)) return "EXPECTED_WEEKEND";
  if (symbol.toUpperCase() === "XAUUSD" && hour === 21) return "EXPECTED_DAILY_BREAK";
  return "UNEXPECTED";
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
