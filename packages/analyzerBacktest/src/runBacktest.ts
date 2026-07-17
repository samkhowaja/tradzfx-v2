import { randomUUID } from "crypto";
import type { Pool, TimeFrame } from "@tm/shared";
import {
  CANDLE_TABLE_BY_TF,
  TF_MS,
  getSessionSpread,
  getSessionSlippage,
  getPairCharacteristics,
  getRegistryPipSize,
} from "@tm/shared";
import { evaluateSetup, type SetupEvaluation } from "@tm/setup-engine";
import { trackOutcome, type Candle, type TrackOutcomeOptions } from "./outcomeTracker";

function isValidSignalGeometry(
  direction: "long" | "short" | "neutral",
  entryZone: { top: number; bottom: number } | null,
  stopLoss: number | null,
  takeProfit: number | null
): boolean {
  if (direction === "neutral" || !entryZone || stopLoss == null || takeProfit == null) return false;
  const entry = (entryZone.top + entryZone.bottom) / 2;
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) return false;
  if (direction === "long") return stopLoss < entry && takeProfit > entry;
  return stopLoss > entry && takeProfit < entry;
}

export interface BacktestOptions {
  symbol: string;
  tf: TimeFrame;
  startTs: Date;
  endTs: Date;
  sampleIntervalMinutes?: number;
  maxForwardBars?: number;
  backtestSpreadPips?: number;
  backtestSlippagePips?: number;
  backtestSessionName?: string;
  activePositionCount?: number;
  recordResults?: boolean;
  /** Optional strategy linkage for per-variant reports. */
  variantId?: string;
  familyId?: string;
  strategyId?: string;
  /** Maximum concurrent setup evaluations. Default 1 to preserve deterministic ordering. */
  concurrency?: number;
  /** Forward-simulation cost model. */
  trackOutcomeOptions?: TrackOutcomeOptions;
  /** Number of initial candles to skip so features can warm up. Defaults to 200. */
  warmupCandles?: number;
  /** If true, include the R-based equity curve in the result trades (stored as a summary note). */
  includeEquityCurve?: boolean;
  /** If true, allow the same setup to produce overlapping trades. Defaults to false. */
  disableTradeDedup?: boolean;
}

export interface BacktestTrade {
  ts: string;
  grade: string;
  direction: string;
  confidence: number;
  entryZone: { top: number; bottom: number } | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  outcome: string;
  outcomeR: number;
  exitPrice: number | null;
  exitTs: string | null;
  barsHeld: number;
  htfState: string | null;
  sessionName: string | null;
  /** Effective entry price after spread/slippage adjustments */
  effectiveEntry: number | null;
  /** Maximum adverse excursion in R */
  maxAdverseR: number;
  /** Maximum favorable excursion in R */
  maxFavorableR: number;
}

export interface BacktestRunResult {
  runId: string;
  symbol: string;
  tf: TimeFrame;
  startTs: Date;
  endTs: Date;
  samplesEvaluated: number;
  trades: BacktestTrade[];
  /** R-based equity curve (cumulative outcomeR) if requested */
  equityCurve?: number[];
}

export async function runBacktest(pool: Pool, options: BacktestOptions): Promise<BacktestRunResult> {
  const {
    symbol,
    tf,
    startTs,
    endTs,
    sampleIntervalMinutes = Math.max(1, TF_MS[tf] / 60_000),
    maxForwardBars = 2000,
    backtestSpreadPips,
    backtestSlippagePips,
    backtestSessionName,
    activePositionCount = 0,
    recordResults = true,
    variantId,
    familyId,
    strategyId,
    concurrency = 1,
    trackOutcomeOptions,
    warmupCandles = 200,
    includeEquityCurve = false,
    disableTradeDedup = false,
  } = options;

  const runId = `${symbol}-${tf}-${startTs.toISOString()}-${endTs.toISOString()}-${randomUUID().slice(0, 8)}`;
  const table = CANDLE_TABLE_BY_TF[tf];
  if (!table) throw new Error(`Unsupported timeframe: ${tf}`);

  // Build sample timestamps. Use the requested TF's candle close times so the
  // evaluator sees a complete bar for every sample.
  const intervalMs = sampleIntervalMinutes * 60_000;
  const { rows: candleRows } = await pool.query(
    `SELECT ts FROM ${table}
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, startTs, endTs]
  );

  const sampleTimes: Date[] = [];
  let lastBucket = 0;
  for (const row of candleRows) {
    const t = new Date(row.ts).getTime();
    if (sampleTimes.length === 0 || t - lastBucket >= intervalMs) {
      sampleTimes.push(new Date(row.ts));
      lastBucket = t;
    }
  }

  if (sampleTimes.length > 0 && warmupCandles > 0) {
    const skipped = Math.min(warmupCandles, sampleTimes.length);
    sampleTimes.splice(0, skipped);
    console.log(`[runBacktest] skipped ${skipped} warmup candles for ${symbol} ${tf}`);
  }

  // Pre-fetch all 1m candles once for the entire forward window. This avoids
  // the N+1 query pattern of fetching forward candles per sample.
  const all1mCandles = await fetch1mCandles(pool, symbol, startTs, endTs, maxForwardBars);

  // Pre-fetch HTF states, session names, and ATR5 for all sample times in bulk.
  const [htfStateByTs, sessionNameByTs, atr5ByTs] = await Promise.all([
    fetchHtfStatesBulk(pool, symbol, tf, sampleTimes),
    backtestSessionName
      ? Promise.resolve(new Map(sampleTimes.map((ts) => [ts.toISOString(), backtestSessionName])))
      : fetchSessionNamesBulk(pool, symbol, sampleTimes),
    fetchAtr5Bulk(pool, symbol, tf, sampleTimes),
  ]);

  let trades: BacktestTrade[] = [];

  // Evaluate setups. For concurrency > 1 we preserve chronological ordering by
  // collecting results and sorting by sample index before simulating outcomes.
  if (concurrency <= 1) {
    for (const asOf of sampleTimes) {
      const trade = await evaluateAndTrack(
        pool,
        asOf,
        symbol,
        tf,
        activePositionCount,
        backtestSpreadPips,
        backtestSlippagePips,
        backtestSessionName,
        all1mCandles,
        htfStateByTs,
        sessionNameByTs,
        atr5ByTs,
        maxForwardBars,
        trackOutcomeOptions
      );
      if (trade) trades.push(trade);
    }
  } else {
    const semaphore = new Semaphore(concurrency);
    const results = await Promise.all(
      sampleTimes.map((asOf, index) =>
        semaphore.run(async () =>
          evaluateAndTrack(
            pool,
            asOf,
            symbol,
            tf,
            activePositionCount,
            backtestSpreadPips,
            backtestSlippagePips,
            backtestSessionName,
            all1mCandles,
            htfStateByTs,
            sessionNameByTs,
            atr5ByTs,
            maxForwardBars,
            trackOutcomeOptions,
            index
          )
        )
      )
    );
    for (const trade of results) {
      if (trade) trades.push(trade);
    }
  }

  // Sort chronologically to ensure report metrics and equity curve are correct.
  trades.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Suppress duplicate trades produced when the same setup remains valid across
  // consecutive candles. A new trade is only allowed once the previous identical
  // trade has exited (or the backtest window ends).
  if (!disableTradeDedup) {
    trades = dedupeTrades(trades, endTs);
  }

  let equityCurve: number[] | undefined;
  if (includeEquityCurve) {
    let sum = 0;
    equityCurve = trades.map((t) => {
      sum += t.outcomeR;
      return sum;
    });
  }

  if (recordResults) {
    await persistResults(pool, runId, symbol, tf, startTs, endTs, trades, variantId, familyId, strategyId);
  }

  return {
    runId,
    symbol,
    tf,
    startTs,
    endTs,
    samplesEvaluated: sampleTimes.length,
    trades,
    equityCurve,
  };
}

async function evaluateAndTrack(
  pool: Pool,
  asOf: Date,
  symbol: string,
  tf: TimeFrame,
  activePositionCount: number,
  backtestSpreadPips: number | undefined,
  backtestSlippagePips: number | undefined,
  backtestSessionName: string | undefined,
  all1mCandles: Candle[],
  htfStateByTs: Map<string, string | null>,
  sessionNameByTs: Map<string, string | null>,
  atr5ByTs: Map<string, number | null>,
  maxForwardBars: number,
  trackOutcomeOptions: TrackOutcomeOptions | undefined,
  _index?: number
): Promise<BacktestTrade | null> {
  const setup = await evaluateSetup(pool, {
    symbol,
    tf,
    asOf,
    backtest: {
      activePositionCount,
      spreadPips: backtestSpreadPips,
      sessionName: backtestSessionName,
    },
  });

  // Skip blocked grades and setups without a tradeable plan.
  if (setup.grade === "BLOCK" || !setup.entryZone || setup.stopLoss == null || setup.takeProfit == null) {
    return null;
  }

  // Reject signals whose SL/TP ordering disagrees with the trade direction.
  // This keeps the analyzer from producing nonsensical or negative-R outcomes.
  if (!isValidSignalGeometry(setup.direction, setup.entryZone, setup.stopLoss, setup.takeProfit)) {
    return null;
  }

  // Slice forward candles from the pre-fetched cache.
  const futureCandles = sliceFutureCandles(all1mCandles, asOf, maxForwardBars);

  const tsKey = asOf.toISOString();
  const sessionName = sessionNameByTs.get(tsKey) ?? null;

  // Apply realistic per-symbol/session cost defaults when the caller does not
  // explicitly provide spread/slippage. This prevents zero-cost fills that
  // inflate backtest performance.
  const effectiveSpread =
    trackOutcomeOptions?.spreadPips ??
    backtestSpreadPips ??
    getSessionSpread(symbol, sessionName || "DEFAULT");

  const pipSize = getRegistryPipSize(symbol);
  const atr5Value = atr5ByTs.get(tsKey);
  const atr5Pips = atr5Value != null && pipSize > 0 ? atr5Value / pipSize : undefined;
  const effectiveSlippage =
    trackOutcomeOptions?.slippagePips ??
    backtestSlippagePips ??
    getSessionSlippage(symbol, atr5Pips);

  const commissionPips = trackOutcomeOptions?.commissionPips ?? getPairCharacteristics(symbol).commissionPipsPerLot;

  const outcomeOptions: TrackOutcomeOptions = {
    ...trackOutcomeOptions,
    spreadPips: effectiveSpread,
    slippagePips: effectiveSlippage,
    commissionPips,
  };

  const tracked = trackOutcome(
    setup.direction,
    setup.entryZone,
    setup.stopLoss,
    setup.takeProfit,
    futureCandles,
    outcomeOptions
  );

  const htfState = htfStateByTs.get(tsKey) ?? null;

  return {
    ts: setup.timestamp,
    grade: setup.grade,
    direction: setup.direction,
    confidence: setup.confidence,
    entryZone: setup.entryZone,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    riskReward: setup.riskReward,
    outcome: tracked.outcome,
    outcomeR: tracked.outcomeR,
    exitPrice: tracked.exitPrice,
    exitTs: tracked.exitTs,
    barsHeld: tracked.barsHeld,
    htfState,
    sessionName,
    effectiveEntry: tracked.effectiveEntry,
    maxAdverseR: tracked.maxAdverseR,
    maxFavorableR: tracked.maxFavorableR,
  };
}

async function fetch1mCandles(
  pool: Pool,
  symbol: string,
  startTs: Date,
  endTs: Date,
  maxForwardBars: number
): Promise<Candle[]> {
  // Do not fetch beyond the stated backtest end date. Trades that cannot
  // resolve by endTs are reported as timeout/no-result, not as wins/losses.
  const forwardEnd = endTs;
  const { rows } = await pool.query(
    `SELECT ts, o, h, l, c, v FROM market.candles_1m_canonical
     WHERE symbol = $1 AND ts > $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, startTs, forwardEnd]
  );
  return rows.map((r: any) => ({
    ts: r.ts.toISOString(),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: Number(r.v ?? 0),
  }));
}

function sliceFutureCandles(candles: Candle[], after: Date, limit: number): Candle[] {
  const afterMs = after.getTime();
  const startIdx = candles.findIndex((c) => new Date(c.ts).getTime() > afterMs);
  if (startIdx < 0) return [];
  return candles.slice(startIdx, startIdx + limit);
}

async function fetchHtfStatesBulk(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  sampleTimes: Date[]
): Promise<Map<string, string | null>> {
  if (sampleTimes.length === 0) return new Map();
  const { rows } = await pool.query(
    `WITH samples AS (
       SELECT unnest($3::timestamptz[]) AS ts
     )
     SELECT s.ts AS sample_ts, (
       SELECT state
         FROM features_htf_bias
        WHERE symbol = $1 AND tf = $2 AND ts <= s.ts
        ORDER BY ts DESC LIMIT 1
     ) AS state
     FROM samples s`,
    [symbol, tf, sampleTimes]
  );
  const map = new Map<string, string | null>();
  for (const row of rows) {
    map.set(new Date(row.sample_ts).toISOString(), row.state ?? null);
  }
  return map;
}

async function fetchSessionNamesBulk(
  pool: Pool,
  symbol: string,
  sampleTimes: Date[]
): Promise<Map<string, string | null>> {
  if (sampleTimes.length === 0) return new Map();
  const { rows } = await pool.query(
    `WITH samples AS (
       SELECT unnest($2::timestamptz[]) AS ts
     )
     SELECT s.ts AS sample_ts, (
       SELECT session
         FROM features_session
        WHERE symbol = $1 AND ts <= s.ts
        ORDER BY ts DESC LIMIT 1
     ) AS session
     FROM samples s`,
    [symbol, sampleTimes]
  );
  const map = new Map<string, string | null>();
  for (const row of rows) {
    map.set(new Date(row.sample_ts).toISOString(), row.session ?? null);
  }
  return map;
}

async function fetchAtr5Bulk(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  sampleTimes: Date[]
): Promise<Map<string, number | null>> {
  if (sampleTimes.length === 0) return new Map();
  const { rows } = await pool.query(
    `WITH samples AS (
       SELECT unnest($3::timestamptz[]) AS ts
     )
     SELECT s.ts AS sample_ts, (
       SELECT value
         FROM features_atr
        WHERE symbol = $1 AND tf = $2 AND period = 5 AND ts <= s.ts
        ORDER BY ts DESC LIMIT 1
     ) AS value
     FROM samples s`,
    [symbol, tf, sampleTimes]
  );
  const map = new Map<string, number | null>();
  for (const row of rows) {
    map.set(new Date(row.sample_ts).toISOString(), row.value != null ? Number(row.value) : null);
  }
  return map;
}

async function persistResults(
  pool: Pool,
  runId: string,
  symbol: string,
  tf: TimeFrame,
  startTs: Date,
  endTs: Date,
  trades: BacktestTrade[],
  variantId?: string,
  familyId?: string,
  strategyId?: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO backtest_runs (id, symbol, tf, start_ts, end_ts, sample_count, variant_id, family_id, strategy_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         sample_count = EXCLUDED.sample_count,
         variant_id = EXCLUDED.variant_id,
         family_id = EXCLUDED.family_id,
         strategy_id = EXCLUDED.strategy_id`,
      [runId, symbol, tf, startTs, endTs, trades.length, variantId ?? null, familyId ?? null, strategyId ?? null]
    );

    if (trades.length > 0) {
      const columns = [
        "run_id", "symbol", "tf", "ts", "grade", "direction", "confidence",
        "entry_zone", "stop_loss", "take_profit", "risk_reward",
        "outcome", "outcome_r", "exit_price", "exit_ts", "bars_held",
        "htf_state", "session_name", "effective_entry", "max_adverse_r", "max_favorable_r",
        "variant_id", "family_id", "strategy_id", "source"
      ];
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;
      for (const t of trades) {
        placeholders.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );
        values.push(
          runId,
          symbol,
          tf,
          t.ts,
          t.grade,
          t.direction,
          t.confidence,
          t.entryZone ? JSON.stringify(t.entryZone) : null,
          t.stopLoss,
          t.takeProfit,
          t.riskReward,
          t.outcome,
          t.outcomeR,
          t.exitPrice,
          t.exitTs,
          t.barsHeld,
          t.htfState,
          t.sessionName,
          t.effectiveEntry,
          t.maxAdverseR,
          t.maxFavorableR,
          variantId ?? null,
          familyId ?? null,
          strategyId ?? null,
          "analyzer"
        );
      }
      await client.query(
        `INSERT INTO backtest_results (
          ${columns.join(", ")}
        ) VALUES ${placeholders.join(",")}
        ON CONFLICT DO NOTHING`,
        values
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function setupFingerprint(trade: BacktestTrade): string {
  if (!trade.entryZone || trade.stopLoss == null || trade.takeProfit == null) {
    return `${trade.ts}|${trade.direction}`;
  }
  return [
    trade.direction,
    trade.entryZone.top,
    trade.entryZone.bottom,
    trade.stopLoss,
    trade.takeProfit,
  ].join("|");
}

function dedupeTrades(trades: BacktestTrade[], windowEndTs: Date): BacktestTrade[] {
  const activeUntil = new Map<string, Date>();
  const out: BacktestTrade[] = [];
  for (const trade of trades) {
    const fp = setupFingerprint(trade);
    const asOf = new Date(trade.ts);
    const prevUntil = activeUntil.get(fp);
    if (prevUntil && asOf.getTime() <= prevUntil.getTime()) {
      continue;
    }
    out.push(trade);
    const exit = trade.exitTs ? new Date(trade.exitTs) : null;
    activeUntil.set(fp, exit ?? windowEndTs);
  }
  return out;
}

class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
