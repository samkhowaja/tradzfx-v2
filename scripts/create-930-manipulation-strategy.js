/**
 * Create the "9:30 AM Manipulation Fade" strategy family + variant from the
 * Trade with Pat video (https://www.youtube.com/watch?v=aKD4qOKvU5c&t=308s),
 * then run a price-action backtest on 1m candles.
 *
 * Backtest rules (derived from the video transcript):
 *   1. On the 15m chart, use the 9:30-9:45 a.m. New York candle as the opening
 *      range. In UTC (EDT) this is the 15m candle that closes at 13:45.
 *   2. Compute a 96-period ATR on 15m. Look for the first later 15m candle
 *      whose full range is > 100% ATR and that clearly extends beyond the
 *      opening range (liquidity grab / manipulation candle).
 *   3. Fade the manipulation: bearish grab below the range -> long; bullish
 *      grab above the range -> short.
 *   4. On the 1m chart, enter via limit order at the 50% retracement of the
 *      manipulation candle. Stop loss at the manipulation candle extreme.
 *      Take profit at the opposite side of the opening range.
 */

const { Pool } = require("pg");
const { randomUUID } = require("crypto");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const FAMILY_ID = `nine_thirty_manipulation_fade${process.env.FAMILY_SUFFIX || ""}`;
const VARIANT_ID = `${FAMILY_ID}_default`;
const RUN_ID = `930-fade-${Date.now()}`;

const SYMBOLS = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(",").map((s) => s.trim())
  : ["EURUSD"];

const SCREENSHOTS = [
  "/strategies/930-manipulation-fade/01_fib_range.jpg",
  "/strategies/930-manipulation-fade/02_manipulation.jpg",
  "/strategies/930-manipulation-fade/03_limit_order.jpg",
  "/strategies/930-manipulation-fade/04_examples.jpg",
];

const BASE_SPEC = {
  id: FAMILY_ID,
  name: "9:30 AM Manipulation Fade",
  version: "1.0.0",
  description:
    "A high-win-rate 1-minute scalping strategy. " +
    "Step 1: mark the 9:30 a.m. New York opening range on the 15-minute chart using a Fibonacci retracement. " +
    "Step 2: identify a manipulation candle whose size exceeds the 96-period ATR (a liquidity grab beyond the range). " +
    "Step 3: drop to the 1-minute chart and fade the manipulation with a limit order, targeting the opposite side of the opening range.",
  source_video: "https://www.youtube.com/watch?v=aKD4qOKvU5c&t=308s",
  screenshots: SCREENSHOTS,
  documentation: {
    steps: [
      {
        image: SCREENSHOTS[0],
        caption:
          "Step 1 – Mark the 9:30 a.m. New York opening range on the 15m chart with Fibonacci levels.",
      },
      {
        image: SCREENSHOTS[1],
        caption:
          "Step 2 – Identify a manipulation candle whose range exceeds the 96-period ATR.",
      },
      {
        image: SCREENSHOTS[2],
        caption:
          "Step 3 – Drop to the 1m chart and fade the manipulation with a limit order, SL and TP.",
      },
      {
        image: SCREENSHOTS[3],
        caption:
          "Examples across Bitcoin, gold, forex and US30 from the video.",
      },
    ],
  },
  // Runtime placeholder: evaluated by the custom backtester, not the generic compiler.
  signalSource: "indicator",
  setup: [
    {
      id: "disabled_bias_anchor",
      feature: "features_bias",
      tf: "15m",
      predicate: "direction = 'disabled_930_fade'",
      required: true,
      description: "Placeholder anchor (no live signals).",
    },
  ],
  entry: [
    {
      id: "disabled_indicator_trigger",
      feature: "features_indicator",
      tf: "1m",
      predicate: "value > 999999",
      required: true,
      description: "Placeholder trigger (no live signals).",
    },
  ],
  risk: {
    sl: "0.0010",
    tp: "sl * 1.5",
    minRR: 1.5,
    timeoutBars: 0,
  },
  live: {
    mode: "paper",
    lotSize: 0.01,
    riskPerTradePct: 1,
    accountBalance: 10000,
    accountCurrency: "USD",
    signalTtlMinutes: 120,
    maxSpreadPips: 5,
    maxSlippagePoints: 10,
    entryZonePips: 0,
    maxPositionsPerSymbol: 1,
    maxPositionsTotal: 4,
    cooldownMinutes: 0,
  },
  filters: {
    symbols: SYMBOLS,
  },
  gates: [
    { id: "spread_gate", name: "spread", params: { maxSpreadPips: 5 } },
    {
      id: "session_gate",
      name: "session",
      params: { allowed: ["NY"] },
    },
  ],
};

function toUtcDate(ts) {
  return ts.toISOString().slice(0, 10);
}

function decimalPlaces(symbol) {
  if (symbol === "XAUUSD") return 2;
  if (symbol.includes("JPY")) return 3;
  return 5;
}

function roundPrice(symbol, price) {
  return Number(price.toFixed(decimalPlaces(symbol)));
}

const BIAS_FILTER = process.env.BIAS_FILTER || null;

async function loadBias(startTs, endTs) {
  const { rows } = await pool.query(
    `SELECT symbol, ts, direction FROM features_bias WHERE tf = '15m' AND ts >= $1 AND ts <= $2`,
    [startTs, endTs]
  );
  return rows;
}

function getBias(biasRows, symbol, ts) {
  let best = null;
  for (const r of biasRows) {
    if (r.symbol !== symbol) continue;
    if (r.ts.getTime() > ts.getTime()) continue;
    if (!best || r.ts.getTime() > best.ts.getTime()) best = r;
  }
  return best ? best.direction : null;
}

function passesBias(direction, bias) {
  if (!BIAS_FILTER || !bias) return true;
  const aligned =
    (direction === "long" && bias === "bullish") ||
    (direction === "short" && bias === "bearish");
  if (BIAS_FILTER === "aligned") return aligned;
  if (BIAS_FILTER === "against") return !aligned;
  return true;
}

async function runBacktest(symbols, startTs, endTs) {
  const results = [];

  for (const symbol of symbols) {
    // Load 15m candles for the opening range / manipulation logic.
    const { rows: m15Rows } = await pool.query(
      `SELECT ts, o as open, h as high, l as low, c as close
       FROM market.candles_15m_canonical
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts`,
      [symbol, startTs, endTs]
    );

    if (m15Rows.length === 0) {
      console.log(`[backtest] No 15m data for ${symbol}`);
      continue;
    }

    const biasRows = await loadBias(startTs, endTs);

    // Load 1m candles for entry/exit execution.
    const { rows: m1Rows } = await pool.query(
      `SELECT ts, o as open, h as high, l as low, c as close
       FROM market.candles_1m_canonical
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts`,
      [symbol, startTs, endTs]
    );

    if (m1Rows.length === 0) {
      console.log(`[backtest] No 1m data for ${symbol}`);
      continue;
    }

    // Index 1m bars by date for quick per-day slicing.
    const m1ByDay = new Map();
    for (const r of m1Rows) {
      const d = toUtcDate(r.ts);
      if (!m1ByDay.has(d)) m1ByDay.set(d, []);
      m1ByDay.get(d).push(r);
    }

    // Group 15m bars by UTC date.
    const m15ByDay = new Map();
    for (const r of m15Rows) {
      const d = toUtcDate(r.ts);
      if (!m15ByDay.has(d)) m15ByDay.set(d, []);
      m15ByDay.get(d).push(r);
    }

    // 9:30-9:45 a.m. EDT in UTC is 13:30-13:45; our 15m timestamps are open times,
    // so the opening candle is the one with ts = 13:30:00.
    const OPENING_TS_SUFFIX = "T13:30:00.000Z";

    for (const [day, dayM15] of m15ByDay) {
      const opening = dayM15.find(
        (b) => b.ts.toISOString() === `${day}${OPENING_TS_SUFFIX}`
      );
      if (!opening) continue;

      const openingHigh = parseFloat(opening.high);
      const openingLow = parseFloat(opening.low);
      const openingIdx = dayM15.indexOf(opening);
      const postM15 = dayM15.slice(openingIdx + 1);
      if (postM15.length === 0) continue;

      // Session end: close any open trade at 21:00 UTC (5 p.m. EDT).
      const sessionEndTs = new Date(`${day}T21:00:00.000Z`);

      // Find the first manipulation candle.
      let manipulation = null;
      let manipulationIdx = -1;
      for (let i = 0; i < postM15.length; i++) {
        const bar = postM15[i];
        const barTs = bar.ts.getTime();
        if (barTs > sessionEndTs.getTime()) break;

        const high = parseFloat(bar.high);
        const low = parseFloat(bar.low);
        const open = parseFloat(bar.open);
        const close = parseFloat(bar.close);
        const range = high - low;
        if (range === 0) continue;

        // 96-period ATR on 15m (full range). Use the index in the full m15 array.
        const fullIdx = openingIdx + 1 + i;
        const startIdx = Math.max(0, fullIdx - 96);
        const prior = m15Rows.slice(startIdx, fullIdx);
        if (prior.length === 0) continue;
        const atr =
          prior.reduce((s, b) => s + (parseFloat(b.high) - parseFloat(b.low)), 0) /
          prior.length;
        if (atr === 0) continue;

        const bearish = close < open;
        const bullish = close > open;
        const extendsBelow = low < openingLow;
        const extendsAbove = high > openingHigh;
        // A liquidity grab should wick beyond the range but close back inside it.
        const closesBackInside =
          (bearish && close > openingLow) || (bullish && close < openingHigh);

        if (
          range > atr &&
          closesBackInside &&
          ((bearish && extendsBelow) || (bullish && extendsAbove))
        ) {
          manipulation = {
            ...bar,
            high,
            low,
            open,
            close,
            direction: bearish ? "bearish" : "bullish",
            atr,
          };
          manipulationIdx = i;
          break;
        }
      }

      if (!manipulation) continue;

      const tradeDirection = manipulation.direction === "bearish" ? "long" : "short";

      if (!passesBias(tradeDirection, getBias(biasRows, symbol, manipulation.ts))) continue;

      // Enter at the manipulation candle close (price has already rejected back into the range).
      const entryPrice = roundPrice(symbol, manipulation.close);
      // Stop at the opening range extreme, treating the manipulation wick as the buffer.
      const sl =
        tradeDirection === "long"
          ? roundPrice(symbol, openingLow)
          : roundPrice(symbol, openingHigh);
      const risk = Math.abs(entryPrice - sl);
      if (risk === 0) continue;
      // Target the 61.8% Fibonacci level of the opening range.
      const rangeSize = openingHigh - openingLow;
      const tp =
        tradeDirection === "long"
          ? roundPrice(symbol, openingLow + 0.618 * rangeSize)
          : roundPrice(symbol, openingHigh - 0.618 * rangeSize);

      // Use 1m bars from after the manipulation candle close up to session end.
      const dayM1 = m1ByDay.get(day) || [];
      const execM1 = dayM1.filter(
        (b) =>
          b.ts.getTime() > manipulation.ts.getTime() &&
          b.ts.getTime() <= sessionEndTs.getTime()
      );

      let triggered = false;
      let entryTs = null;
      let outcome = null;
      let outcomeR = 0;
      let exitPrice = null;
      let exitTs = null;
      let barsHeld = 0;

      for (let i = 0; i < execM1.length; i++) {
        const bar = execM1[i];
        const high = parseFloat(bar.high);
        const low = parseFloat(bar.low);

        if (!triggered) {
          const hitsLong = tradeDirection === "long" && low <= entryPrice;
          const hitsShort = tradeDirection === "short" && high >= entryPrice;
          if (hitsLong || hitsShort) {
            triggered = true;
            entryTs = bar.ts;
          } else {
            continue;
          }
        }

        barsHeld = i;

        if (tradeDirection === "long") {
          if (low <= sl) {
            outcome = "loss";
            outcomeR = -1;
            exitPrice = sl;
            exitTs = bar.ts;
            break;
          }
          if (high >= tp) {
            outcome = "win";
            outcomeR = (tp - entryPrice) / risk;
            exitPrice = tp;
            exitTs = bar.ts;
            break;
          }
        } else {
          if (high >= sl) {
            outcome = "loss";
            outcomeR = -1;
            exitPrice = sl;
            exitTs = bar.ts;
            break;
          }
          if (low <= tp) {
            outcome = "win";
            outcomeR = (entryPrice - tp) / risk;
            exitPrice = tp;
            exitTs = bar.ts;
            break;
          }
        }
      }

      if (!triggered) continue;

      if (!outcome) {
        // Time-based exit at session end.
        const last = execM1[execM1.length - 1];
        exitPrice = roundPrice(symbol, parseFloat(last.close));
        exitTs = last.ts;
        outcomeR =
          tradeDirection === "long"
            ? (exitPrice - entryPrice) / risk
            : (entryPrice - exitPrice) / risk;
        outcome = outcomeR >= 0 ? "win" : "loss";
      }

      results.push({
        run_id: RUN_ID,
        symbol,
        tf: "1m",
        ts: entryTs,
        grade: "A",
        direction: tradeDirection,
        confidence: 100,
        entry_price: entryPrice,
        entry_zone: JSON.stringify({
          openingHigh,
          openingLow,
          manipulationHigh: manipulation.high,
          manipulationLow: manipulation.low,
          manipulationDirection: manipulation.direction,
          atr: manipulation.atr,
        }),
        stop_loss: sl,
        take_profit: tp,
        risk_reward: Number(
          (Math.abs(tp - entryPrice) / risk).toFixed(2)
        ),
        outcome,
        outcome_r: Number(outcomeR.toFixed(2)),
        exit_price: exitPrice,
        exit_ts: exitTs,
        bars_held: barsHeld,
        htf_state: "930_manipulation_fade",
        session_name: "NY_930",
      });
    }
  }

  return results;
}

async function insertResults(results) {
  if (results.length === 0) return;

  const columns = [
    "run_id",
    "symbol",
    "tf",
    "ts",
    "grade",
    "direction",
    "confidence",
    "entry_zone",
    "stop_loss",
    "take_profit",
    "risk_reward",
    "outcome",
    "outcome_r",
    "exit_price",
    "exit_ts",
    "bars_held",
    "htf_state",
    "session_name",
    "variant_id", "family_id", "strategy_id",
  ];
  for (const r of results) {
    r.variant_id = VARIANT_ID;
    r.family_id = FAMILY_ID;
    r.strategy_id = VARIANT_ID;
  }

  const placeholders = results
    .map(
      (_, i) =>
        `(${columns
          .map((_, c) => `$${i * columns.length + c + 1}`)
          .join(", ")})`
    )
    .join(", ");

  const values = results.flatMap((r) => columns.map((c) => r[c]));

  await pool.query(
    `INSERT INTO backtest_results (${columns.join(", ")}) VALUES ${placeholders}`,
    values
  );
}

async function insertOrders(results) {
  if (results.length === 0) return;

  await pool.query(`DELETE FROM orders WHERE variant_id = $1`, [VARIANT_ID]);

  const columns = [
    "id",
    "symbol",
    "strategy_id",
    "variant_id",
    "family_id",
    "side",
    "entry_type",
    "entry_price",
    "stop_loss",
    "take_profit",
    "status",
    "fill_price",
    "close_price",
    "outcome",
    "outcome_r",
    "risk_reward",
    "created_at",
    "filled_at",
    "closed_at",
    "trade_mode",
  ];

  const rows = results.map((r) => ({
    id: randomUUID(),
    symbol: r.symbol,
    strategy_id: VARIANT_ID,
    variant_id: VARIANT_ID,
    family_id: FAMILY_ID,
    side: r.direction === "long" ? "buy" : "sell",
    entry_type: "limit",
    entry_price: r.entry_price,
    stop_loss: r.stop_loss,
    take_profit: r.take_profit,
    status: "closed",
    fill_price: r.entry_price,
    close_price: r.exit_price,
    outcome: r.outcome,
    outcome_r: r.outcome_r,
    risk_reward: r.risk_reward,
    created_at: r.ts,
    filled_at: r.ts,
    closed_at: r.exit_ts,
    trade_mode: "paper",
  }));

  const placeholders = rows
    .map(
      (_, i) =>
        `(${columns
          .map((_, c) => `$${i * columns.length + c + 1}`)
          .join(", ")})`
    )
    .join(", ");

  const values = rows.flatMap((row) => columns.map((c) => row[c]));

  await pool.query(
    `INSERT INTO orders (${columns.join(", ")}) VALUES ${placeholders}`,
    values
  );
}

async function main() {
  await pool.query(
    `INSERT INTO strategy_families (id, name, description, category, base_spec, is_archived, updated_at)
     VALUES ($1, $2, $3, $4, $5, false, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       base_spec = EXCLUDED.base_spec,
       updated_at = NOW()`,
    [
      FAMILY_ID,
      BASE_SPEC.name,
      BASE_SPEC.description,
      "price_action",
      JSON.stringify(BASE_SPEC),
    ]
  );

  await pool.query(
    `INSERT INTO strategy_variants (id, family_id, name, description, overrides, symbols, timeframes, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       family_id = EXCLUDED.family_id,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       overrides = EXCLUDED.overrides,
       symbols = EXCLUDED.symbols,
       timeframes = EXCLUDED.timeframes,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    [
      VARIANT_ID,
      FAMILY_ID,
      `${BASE_SPEC.name} (default)`,
      "Default variant seeded from Trade with Pat video analysis",
      JSON.stringify({}),
      BASE_SPEC.filters.symbols,
      ["1m"],
      true,
    ]
  );

  console.log(`[seed] Family '${FAMILY_ID}' + variant '${VARIANT_ID}' created`);

  const endTs = new Date();
  const startTs = new Date(endTs.getTime() - 90 * 24 * 60 * 60 * 1000);

  const results = await runBacktest(BASE_SPEC.filters.symbols, startTs, endTs);
  await insertResults(results);
  await insertOrders(results);

  const wins = results.filter((r) => r.outcome === "win").length;
  const losses = results.filter((r) => r.outcome === "loss").length;
  const netR = results.reduce((s, r) => s + r.outcome_r, 0);

  await pool.query(
    `INSERT INTO backtest_runs (id, symbol, tf, start_ts, end_ts, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       sample_count = EXCLUDED.sample_count`,
    [RUN_ID, "EURUSD", "1m", startTs, endTs, results.length]
  );

  console.log(`[backtest] Run ${RUN_ID}: ${results.length} trades`);
  console.log(`[backtest] Wins: ${wins}, Losses: ${losses}, Net R: ${netR.toFixed(2)}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
