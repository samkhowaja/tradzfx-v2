import { randomUUID } from "crypto";
import type { Pool, TimeFrame } from "@tm/shared";
import { CANDLE_TABLE_BY_TF, TF_MS } from "@tm/shared";
import { evaluateSetup, type SetupEvaluation } from "@tm/setup-engine";
import { trackOutcome, type Candle } from "./outcomeTracker";

export interface BacktestOptions {
  symbol: string;
  tf: TimeFrame;
  startTs: Date;
  endTs: Date;
  sampleIntervalMinutes?: number;
  maxForwardBars?: number;
  backtestSpreadPips?: number;
  backtestSessionName?: string;
  activePositionCount?: number;
  recordResults?: boolean;
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
}

export interface BacktestRunResult {
  runId: string;
  symbol: string;
  tf: TimeFrame;
  startTs: Date;
  endTs: Date;
  samplesEvaluated: number;
  trades: BacktestTrade[];
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
    backtestSessionName,
    activePositionCount = 0,
    recordResults = true,
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

  const trades: BacktestTrade[] = [];

  for (const asOf of sampleTimes) {
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
      continue;
    }

    const futureCandles = await fetch1mCandles(pool, symbol, asOf, maxForwardBars);
    const tracked = trackOutcome(
      setup.direction,
      setup.entryZone,
      setup.stopLoss,
      setup.takeProfit,
      futureCandles
    );

    const htfState = await fetchHtfState(pool, symbol, tf, asOf);
    const sessionName = backtestSessionName ?? (await fetchSessionName(pool, symbol, asOf));

    trades.push({
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
    });
  }

  if (recordResults) {
    await persistResults(pool, runId, symbol, tf, startTs, endTs, trades);
  }

  return {
    runId,
    symbol,
    tf,
    startTs,
    endTs,
    samplesEvaluated: sampleTimes.length,
    trades,
  };
}

async function fetch1mCandles(pool: Pool, symbol: string, after: Date, limit: number): Promise<Candle[]> {
  const { rows } = await pool.query(
    `SELECT ts, o, h, l, c, v FROM candles_1m
     WHERE symbol = $1 AND ts > $2
     ORDER BY ts
     LIMIT $3`,
    [symbol, after, limit]
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

async function fetchHtfState(pool: Pool, symbol: string, tf: TimeFrame, asOf: Date): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT state FROM features_htf_bias
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    return rows[0]?.state ?? null;
  } catch {
    return null;
  }
}

async function fetchSessionName(pool: Pool, symbol: string, asOf: Date): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT session FROM features_session
       WHERE symbol = $1 AND ts <= $2
       ORDER BY ts DESC LIMIT 1`,
      [symbol, asOf]
    );
    return rows[0]?.session ?? null;
  } catch {
    return null;
  }
}

async function persistResults(
  pool: Pool,
  runId: string,
  symbol: string,
  tf: TimeFrame,
  startTs: Date,
  endTs: Date,
  trades: BacktestTrade[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO backtest_runs (id, symbol, tf, start_ts, end_ts, sample_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET sample_count = EXCLUDED.sample_count`,
      [runId, symbol, tf, startTs, endTs, trades.length]
    );

    for (const t of trades) {
      await client.query(
        `INSERT INTO backtest_results (
          run_id, symbol, tf, ts, grade, direction, confidence,
          entry_zone, stop_loss, take_profit, risk_reward,
          outcome, outcome_r, exit_price, exit_ts, bars_held, htf_state, session_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT DO NOTHING`,
        [
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
        ]
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
