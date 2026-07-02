/**
 * Create the "4-Hour Opening Range Fade" strategy family + variant from the
 * YouTube video analysis, then run a simple price-action backtest on 5m candles.
 */

const { Pool } = require("pg");
const { randomUUID } = require("crypto");
const path = require("path");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const FAMILY_ID = `four_hour_opening_range_fade${process.env.FAMILY_SUFFIX || ""}`;
const VARIANT_ID = `${FAMILY_ID}_default`;
const RUN_ID = `4h-fade-${Date.now()}`;

const SYMBOLS = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(",").map((s) => s.trim())
  : ["EURUSD"];

const SCREENSHOTS = [
  "/strategies/4hour-range-fade/01_range_marked.jpg",
  "/strategies/4hour-range-fade/02_breakout_wait.jpg",
  "/strategies/4hour-range-fade/03_entry_sl_tp.jpg",
  "/strategies/4hour-range-fade/04_video_examples.jpg",
];

const BASE_SPEC = {
  id: FAMILY_ID,
  name: "4-Hour Opening Range Fade",
  version: "1.0.0",
  description:
    "A simple, rule-based scalping strategy using only the first 4-hour candle of the day. " +
    "Step 1: mark the high/low range of the first 4-hour candle on a 5-minute chart. " +
    "Step 2: wait for a 5-minute candle to close outside the range (breakout), then wait for price " +
    "to re-enter and close back inside the range. " +
    "Step 3: enter in the opposite direction of the breakout (fade). " +
    "Stop loss is placed at the exact extreme of the breakout candle; take-profit is 2R.",
  source_video: "https://www.youtube.com/watch?v=O5eC5lY7ZXY&t=531s",
  screenshots: SCREENSHOTS,
  documentation: {
    steps: [
      {
        image: SCREENSHOTS[0],
        caption:
          "Step 1 – Mark the high/low of the first 4-hour candle of the trading day.",
      },
      {
        image: SCREENSHOTS[1],
        caption:
          "Step 2 – Wait for a 5m candle to CLOSE outside the range (not just a wick).",
      },
      {
        image: SCREENSHOTS[2],
        caption:
          "Step 3 – Wait for price to re-enter and close back inside, then fade the breakout.",
      },
      {
        image: SCREENSHOTS[3],
        caption: "Video examples across gold, crypto and forex pairs.",
      },
    ],
  },
  // Runtime placeholder: the strategy is evaluated by the custom 4h-range backtester
  // rather than the generic SQL compiler. These conditions keep the live compiler from
  // crashing while never producing a real signal.
  signalSource: "indicator",
  setup: [
    {
      id: "disabled_bias_anchor",
      feature: "features_bias",
      tf: "15m",
      predicate: "direction = 'disabled_4h_range_fade'",
      required: true,
      description: "Placeholder anchor (no live signals).",
    },
  ],
  entry: [
    {
      id: "disabled_indicator_trigger",
      feature: "features_indicator",
      tf: "5m",
      predicate: "value > 999999",
      required: true,
      description: "Placeholder trigger (no live signals).",
    },
  ],
  risk: {
    sl: "0.0010",
    tp: "sl * 2",
    minRR: 2,
    timeoutBars: 0,
  },
  live: {
    mode: "paper",
    lotSize: 0.01,
    riskPerTradePct: 1,
    accountBalance: 10000,
    accountCurrency: "USD",
    signalTtlMinutes: 240,
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
      params: { allowed: ["LONDON", "OVERLAP", "NY"] },
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

const BIAS_FILTER = process.env.BIAS_FILTER || null; // 'aligned' | 'against' | null

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
    const { rows } = await pool.query(
      `SELECT ts, o as open, h as high, l as low, c as close
       FROM candles_5m
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts`,
      [symbol, startTs, endTs]
    );

    if (rows.length === 0) {
      console.log(`[backtest] No 5m data for ${symbol}`);
      continue;
    }

    const biasRows = await loadBias(startTs, endTs);

    // Group by UTC day
    const byDay = new Map();
    for (const r of rows) {
      const d = toUtcDate(r.ts);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(r);
    }

    for (const [day, dayBars] of byDay) {
      // First 4-hour candle = first 48 bars of the day
      const rangeBars = dayBars.slice(0, 48);
      const postBars = dayBars.slice(48);
      if (rangeBars.length < 48 || postBars.length === 0) continue;

      const rangeHigh = Math.max(...rangeBars.map((b) => parseFloat(b.high)));
      const rangeLow = Math.min(...rangeBars.map((b) => parseFloat(b.low)));

      let state = "waiting_breakout";
      let breakoutDirection = null;
      let breakoutExtreme = null;

      for (let i = 0; i < postBars.length; i++) {
        const bar = postBars[i];
        const close = parseFloat(bar.close);
        const high = parseFloat(bar.high);
        const low = parseFloat(bar.low);

        if (state === "waiting_breakout") {
          if (close > rangeHigh) {
            state = "waiting_reentry";
            breakoutDirection = "up";
            breakoutExtreme = high;
          } else if (close < rangeLow) {
            state = "waiting_reentry";
            breakoutDirection = "down";
            breakoutExtreme = low;
          }
          continue;
        }

        if (state === "waiting_reentry") {
          // Track the true extreme of the breakout move while we wait for re-entry.
          if (breakoutDirection === "up") {
            breakoutExtreme = Math.max(breakoutExtreme, high);
          } else {
            breakoutExtreme = Math.min(breakoutExtreme, low);
          }

          const reentryUp = breakoutDirection === "up" && close <= rangeHigh;
          const reentryDown = breakoutDirection === "down" && close >= rangeLow;

          if (reentryUp || reentryDown) {
            const entryPrice = roundPrice(symbol, close);
            const sl = roundPrice(symbol, breakoutExtreme);
            const risk = Math.abs(entryPrice - sl);
            if (risk === 0) continue;

            const direction = breakoutDirection === "up" ? "short" : "long";

            if (!passesBias(direction, getBias(biasRows, symbol, bar.ts))) {
              state = "waiting_breakout";
              breakoutDirection = null;
              breakoutExtreme = null;
              continue;
            }

            const tp =
              direction === "short"
                ? roundPrice(symbol, entryPrice - 2 * risk)
                : roundPrice(symbol, entryPrice + 2 * risk);

            // Forward-scan for exit
            let outcome = null;
            let outcomeR = 0;
            let exitPrice = null;
            let exitTs = null;
            let barsHeld = 0;

            for (let j = i + 1; j < postBars.length; j++) {
              const fb = postBars[j];
              const fHigh = parseFloat(fb.high);
              const fLow = parseFloat(fb.low);
              barsHeld = j - i;

              if (direction === "short") {
                if (fHigh >= sl) {
                  outcome = "loss";
                  outcomeR = -1;
                  exitPrice = sl;
                  exitTs = fb.ts;
                  break;
                }
                if (fLow <= tp) {
                  outcome = "win";
                  outcomeR = 2;
                  exitPrice = tp;
                  exitTs = fb.ts;
                  break;
                }
              } else {
                if (fLow <= sl) {
                  outcome = "loss";
                  outcomeR = -1;
                  exitPrice = sl;
                  exitTs = fb.ts;
                  break;
                }
                if (fHigh >= tp) {
                  outcome = "win";
                  outcomeR = 2;
                  exitPrice = tp;
                  exitTs = fb.ts;
                  break;
                }
              }
            }

            // If no hit by end of day, close at last bar
            if (!outcome) {
              const last = postBars[postBars.length - 1];
              exitPrice = roundPrice(symbol, parseFloat(last.close));
              exitTs = last.ts;
              barsHeld = postBars.length - i - 1;
              outcomeR =
                direction === "short"
                  ? (entryPrice - exitPrice) / risk
                  : (exitPrice - entryPrice) / risk;
              outcome = outcomeR >= 0 ? "win" : "loss";
            }

            results.push({
              run_id: RUN_ID,
              symbol,
              tf: "5m",
              ts: bar.ts,
              grade: "A",
              direction,
              confidence: 100,
              entry_price: entryPrice,
              entry_zone: JSON.stringify({
                top: rangeHigh,
                bottom: rangeLow,
                breakoutDirection,
              }),
              stop_loss: sl,
              take_profit: tp,
              risk_reward: 2,
              outcome,
              outcome_r: Number(outcomeR.toFixed(2)),
              exit_price: exitPrice,
              exit_ts: exitTs,
              bars_held: barsHeld,
              htf_state: "4h_range_fade",
              session_name: "UTC_0_4",
            });

            // Only one trade per day
            break;
          }
        }
      }
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
  ];

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

  // Avoid duplicates if the script is re-run.
  await pool.query(
    `DELETE FROM orders WHERE variant_id = $1`,
    [VARIANT_ID]
  );

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
    entry_type: "market",
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
  // Insert family + variant
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
      "Default variant seeded from YouTube video analysis",
      JSON.stringify({}),
      BASE_SPEC.filters.symbols,
      ["5m"],
      true,
    ]
  );

  console.log(`[seed] Family '${FAMILY_ID}' + variant '${VARIANT_ID}' created`);

  // Backtest over available 5m history (last 90 days, capped by data)
  const endTs = new Date();
  const startTs = new Date(endTs.getTime() - 90 * 24 * 60 * 60 * 1000);

  const results = await runBacktest(BASE_SPEC.filters.symbols, startTs, endTs);
  await insertResults(results);

  const wins = results.filter((r) => r.outcome === "win").length;
  const losses = results.filter((r) => r.outcome === "loss").length;
  const netR = results.reduce((s, r) => s + r.outcome_r, 0);

  await insertOrders(results);

  await pool.query(
    `INSERT INTO backtest_runs (id, symbol, tf, start_ts, end_ts, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       sample_count = EXCLUDED.sample_count`,
    [RUN_ID, "EURUSD", "5m", startTs, endTs, results.length]
  );

  console.log(`[backtest] Run ${RUN_ID}: ${results.length} trades`);
  console.log(`[backtest] Wins: ${wins}, Losses: ${losses}, Net R: ${netR.toFixed(2)}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
