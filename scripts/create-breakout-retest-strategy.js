/**
 * Create the "Breakout-Retest Continuation" strategy family + variant from the
 * supplied chart image, then run a simple price-action backtest on 5m candles.
 *
 * Backtest rules (derived from the image):
 *   1. Establish an opening range from the first 1 hour of the day (12 x 5m bars).
 *   2. Wait for price to break out and close beyond the range (long on high
 *      breakout, short on low breakout).
 *   3. Wait for a retest: price must close back inside the range near the
 *      broken level.
 *   4. Enter in the breakout direction at the retest close. Stop loss at the
 *      opposite side of the range. Take profit at 2× the risk.
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

const FAMILY_ID = `breakout_retest_continuation${process.env.FAMILY_SUFFIX || ""}`;
const VARIANT_ID = `${FAMILY_ID}_default`;
const RUN_ID = `bo-retest-${Date.now()}`;

const SYMBOLS = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(",").map((s) => s.trim())
  : ["EURUSD"];

const SCREENSHOTS = [
  "/strategies/breakout-retest/01_range.jpg",
  "/strategies/breakout-retest/02_breakout.jpg",
  "/strategies/breakout-retest/03_retest.jpg",
  "/strategies/breakout-retest/04_entry.jpg",
];

const BASE_SPEC = {
  id: FAMILY_ID,
  name: "Breakout-Retest Continuation",
  version: "1.0.0",
  description:
    "A support/resistance breakout strategy. " +
    "Step 1: identify a range with clear support (base buy) and resistance. " +
    "Step 2: wait for a candle to close beyond the level (breakout). " +
    "Step 3: wait for price to retest the broken level. " +
    "Step 4: enter in the breakout direction, stop loss beyond the retested level, take profit at 2R.",
  source_image: "user-provided chart",
  screenshots: SCREENSHOTS,
  documentation: {
    steps: [
      {
        image: SCREENSHOTS[0],
        caption: "Step 1 – Identify a support/resistance range.",
      },
      {
        image: SCREENSHOTS[1],
        caption: "Step 2 – Wait for a candle to close beyond the level (breakout).",
      },
      {
        image: SCREENSHOTS[2],
        caption: "Step 3 – Wait for price to retest the broken level.",
      },
      {
        image: SCREENSHOTS[3],
        caption: "Step 4 – Enter with stop loss below the level and a 2R take-profit target.",
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
      predicate: "direction = 'disabled_breakout_retest'",
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

    const byDay = new Map();
    for (const r of rows) {
      const d = toUtcDate(r.ts);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(r);
    }

    for (const [day, dayBars] of byDay) {
      // Opening range = first 1 hour of the day = 12 x 5m bars.
      const rangeBars = dayBars.slice(0, 12);
      const postBars = dayBars.slice(12);
      if (rangeBars.length < 12 || postBars.length === 0) continue;

      const rangeHigh = Math.max(...rangeBars.map((b) => parseFloat(b.high)));
      const rangeLow = Math.min(...rangeBars.map((b) => parseFloat(b.low)));

      let state = "waiting_breakout";
      let breakoutDirection = null;

      for (let i = 0; i < postBars.length; i++) {
        const bar = postBars[i];
        const close = parseFloat(bar.close);
        const high = parseFloat(bar.high);
        const low = parseFloat(bar.low);

        if (state === "waiting_breakout") {
          if (close > rangeHigh) {
            state = "waiting_retest";
            breakoutDirection = "up";
          } else if (close < rangeLow) {
            state = "waiting_retest";
            breakoutDirection = "down";
          }
          continue;
        }

        if (state === "waiting_retest") {
          // A retest is a close back inside the range near the broken level.
          const retestUp = breakoutDirection === "up" && close <= rangeHigh;
          const retestDown = breakoutDirection === "down" && close >= rangeLow;

          if (retestUp || retestDown) {
            const entryPrice = roundPrice(symbol, close);
            const sl =
              breakoutDirection === "up"
                ? roundPrice(symbol, rangeLow)
                : roundPrice(symbol, rangeHigh);
            const risk = Math.abs(entryPrice - sl);
            if (risk === 0) continue;

            const direction = breakoutDirection === "up" ? "long" : "short";

            if (!passesBias(direction, getBias(biasRows, symbol, bar.ts))) {
              state = "waiting_breakout";
              breakoutDirection = null;
              continue;
            }

            const tp =
              direction === "long"
                ? roundPrice(symbol, entryPrice + 2 * risk)
                : roundPrice(symbol, entryPrice - 2 * risk);

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

              if (direction === "long") {
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
              } else {
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
              }
            }

            if (!outcome) {
              const last = postBars[postBars.length - 1];
              exitPrice = roundPrice(symbol, parseFloat(last.close));
              exitTs = last.ts;
              barsHeld = postBars.length - i - 1;
              outcomeR =
                direction === "long"
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
              htf_state: "breakout_retest",
              session_name: "opening_range_1h",
            });

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
      "Default variant seeded from user-provided chart image",
      JSON.stringify({}),
      BASE_SPEC.filters.symbols,
      ["5m"],
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
