/**
 * Create the "1-Minute Fibonacci Gold-Zone Scalp" strategy family + variant from
 * the video (https://www.youtube.com/watch?v=AlsXNhTm4AA&t=345s), then run a
 * price-action backtest on EURUSD 1m candles using stored 1m swing pivots.
 *
 * Backtest rules (derived from the transcript):
 *   1. Identify a short-term trend: higher lows/higher highs (uptrend) or lower
 *      highs/lower lows (downtrend) on the 1m chart.
 *   2. Wait for a break of structure (BOS): a new swing high above the previous
 *      high in an uptrend, or a new swing low below the previous low in a downtrend.
 *   3. Draw the Fibonacci retracement from the swing origin to the BOS extreme.
 *   4. Place a limit order at the 0.618 golden-zone retracement.
 *   5. Stop loss at the 1.0 swing extreme; take profit at the previous swing low/high.
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

const FAMILY_ID = `one_minute_fib_gold_zone_scalp${process.env.FAMILY_SUFFIX || ""}`;
const VARIANT_ID = `${FAMILY_ID}_default`;
const RUN_ID = `1m-fib-${Date.now()}`;

const SYMBOLS = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(",").map((s) => s.trim())
  : ["EURUSD"];

function pipSize(symbol) {
  if (symbol.includes("XAU") || symbol.includes("XAG")) return 0.01;
  if (symbol.includes("JPY")) return 0.01;
  return 0.0001;
}

const SCREENSHOTS = [
  "/strategies/1m-fib-scalp/01_trend.jpg",
  "/strategies/1m-fib-scalp/02_bos.jpg",
  "/strategies/1m-fib-scalp/03_gold_zone.jpg",
  "/strategies/1m-fib-scalp/04_examples.jpg",
];

const BASE_SPEC = {
  id: FAMILY_ID,
  name: "1-Minute Fibonacci Gold-Zone Scalp",
  version: "1.0.0",
  description:
    "A no-indicator 1-minute scalping strategy. " +
    "Identify the current micro-trend, wait for a break of structure, " +
    "then enter at the 0.618 Fibonacci golden-zone retracement with the trend. " +
    "Stop loss at the swing origin (1.0); take profit at the previous swing low/high.",
  source_video: "https://www.youtube.com/watch?v=AlsXNhTm4AA&t=345s",
  screenshots: SCREENSHOTS,
  documentation: {
    steps: [
      {
        image: SCREENSHOTS[0],
        caption: "Step 1 – Identify the short-term micro-trend on the 1m chart.",
      },
      {
        image: SCREENSHOTS[1],
        caption: "Step 2 – Wait for a break of structure.",
      },
      {
        image: SCREENSHOTS[2],
        caption: "Step 3 – Enter at the 0.618 Fibonacci golden-zone retracement.",
      },
      {
        image: SCREENSHOTS[3],
        caption: "Step 4 – Target the previous swing low/high; flip direction on a stop-out.",
      },
    ],
  },
  signalSource: "indicator",
  setup: [
    {
      id: "disabled_bias_anchor",
      feature: "features_bias",
      tf: "15m",
      predicate: "direction = 'disabled_1m_fib_scalp'",
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
    signalTtlMinutes: 30,
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

function decimalPlaces(symbol) {
  if (symbol.includes("XAU") || symbol.includes("XAG")) return 2;
  if (symbol.includes("JPY")) return 3;
  return 5;
}

function roundPrice(symbol, price) {
  return Number(price.toFixed(decimalPlaces(symbol)));
}

const BIAS_FILTER = process.env.BIAS_FILTER || null;

async function loadBias(symbol, startTs, endTs) {
  const { rows } = await pool.query(
    `SELECT ts, direction FROM features_bias WHERE symbol = $1 AND tf = '15m' AND ts >= $2 AND ts <= $3`,
    [symbol, startTs, endTs]
  );
  return rows;
}

function getBias(biasRows, ts) {
  let best = null;
  for (const r of biasRows) {
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

async function runBacktest(symbol, startTs, endTs) {
  const { rows: candles } = await pool.query(
    `SELECT ts, o as open, h as high, l as low, c as close
     FROM candles_1m
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, startTs, endTs]
  );

  if (candles.length === 0) return [];

  const biasRows = await loadBias(symbol, startTs, endTs);

  const { rows: pivots } = await pool.query(
    `SELECT ts, kind, price
     FROM features_pivot
     WHERE symbol = $1 AND tf = '1m' AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, startTs, endTs]
  );

  // Build alternating swing list (take latest high/low per timestamp).
  const swings = [];
  let lastKind = null;
  for (const p of pivots) {
    if (p.kind !== lastKind) {
      swings.push({ ts: p.ts, kind: p.kind, price: parseFloat(p.price) });
      lastKind = p.kind;
    } else {
      // Same kind: keep the more extreme recent one.
      const last = swings[swings.length - 1];
      if (
        (p.kind === "high" && parseFloat(p.price) > last.price) ||
        (p.kind === "low" && parseFloat(p.price) < last.price)
      ) {
        last.ts = p.ts;
        last.price = parseFloat(p.price);
      }
    }
  }

  const results = [];
  const usedTs = new Set();

  // Look for short setups: new low below previous low (BOS) after lower highs.
  for (let i = 3; i < swings.length; i++) {
    if (swings[i].kind !== "low") continue;
    const L2 = swings[i];
    const H1 = swings[i - 1];
    const L1 = swings[i - 2];
    const H0 = swings[i - 3];

    if (H1.kind !== "high" || L1.kind !== "low" || H0.kind !== "high") continue;

    // Downtrend: lower highs and lower lows.
    if (!(H1.price < H0.price && L2.price < L1.price)) continue;

    const entry = roundPrice(symbol, L2.price + 0.618 * (H1.price - L2.price));
    const sl = roundPrice(symbol, H1.price);
    // Target the previous swing low only if it lies below the entry.
    if (L1.price >= entry) continue;
    const tp = roundPrice(symbol, L1.price);
    const risk = Math.abs(sl - entry);
    if (risk === 0) continue;
    if ((entry - tp) / risk < 0.5) continue;
    // Ignore tiny 1m noise swings (5 pips minimum swing).
    if (H1.price - L2.price < 5 * pipSize(symbol)) continue;

    // Find index in candles just after L2, then require a confirming close below L1.
    let candleIdx = candles.findIndex((c) => c.ts.getTime() > L2.ts.getTime());
    if (candleIdx === -1) continue;
    let confirmed = false;
    for (; candleIdx < candles.length; candleIdx++) {
      if (parseFloat(candles[candleIdx].close) < L1.price) {
        confirmed = true;
        break;
      }
    }
    if (!confirmed) continue;

    let triggered = false;
    let entryTs = null;
    let outcome = null;
    let outcomeR = 0;
    let exitPrice = null;
    let exitTs = null;
    let barsHeld = 0;

    for (let j = candleIdx; j < candles.length; j++) {
      const bar = candles[j];
      const high = parseFloat(bar.high);
      const low = parseFloat(bar.low);

      if (!triggered) {
        // Setup invalidated if price retraces all the way back above the swing high.
        if (high >= H1.price) break;
        // Limit sell at entry is hit when price reaches the level.
        if (high >= entry) {
          triggered = true;
          entryTs = bar.ts;
        }
        continue;
      }

      barsHeld = j - candleIdx;
      if (high >= sl) {
        outcome = "loss";
        outcomeR = -1;
        exitPrice = sl;
        exitTs = bar.ts;
        break;
      }
      if (low <= tp) {
        outcome = "win";
        outcomeR = (entry - tp) / risk;
        exitPrice = tp;
        exitTs = bar.ts;
        break;
      }

      // Time-out after 15 minutes (15 bars).
      if (barsHeld >= 15) {
        exitPrice = roundPrice(symbol, parseFloat(bar.close));
        exitTs = bar.ts;
        outcomeR = (entry - exitPrice) / risk;
        outcome = outcomeR >= 0 ? "win" : "loss";
        break;
      }
    }

    if (triggered && outcome && passesBias("short", getBias(biasRows, entryTs))) {
      results.push(makeResult(symbol, "short", entry, sl, tp, entryTs, exitPrice, exitTs, outcome, outcomeR, barsHeld, {
        H0: H0.price,
        H1: H1.price,
        L1: L1.price,
        L2: L2.price,
      }));
    }
  }

  // Look for long setups: new high above previous high (BOS) after higher lows.
  for (let i = 3; i < swings.length; i++) {
    if (swings[i].kind !== "high") continue;
    const H2 = swings[i];
    const L1 = swings[i - 1];
    const H1 = swings[i - 2];
    const L0 = swings[i - 3];

    if (L1.kind !== "low" || H1.kind !== "high" || L0.kind !== "low") continue;

    // Uptrend: higher lows and higher highs.
    if (!(L1.price > L0.price && H2.price > H1.price)) continue;

    const entry = roundPrice(symbol, H2.price - 0.618 * (H2.price - L1.price));
    const sl = roundPrice(symbol, L1.price);
    // Target the previous swing high only if it lies above the entry.
    if (H1.price <= entry) continue;
    const tp = roundPrice(symbol, H1.price);
    const risk = Math.abs(entry - sl);
    if (risk === 0) continue;
    if ((tp - entry) / risk < 0.5) continue;
    // Ignore tiny 1m noise swings (5 pips minimum swing).
    if (H2.price - L1.price < 5 * pipSize(symbol)) continue;

    // Find index in candles just after H2, then require a confirming close above H1.
    let candleIdx = candles.findIndex((c) => c.ts.getTime() > H2.ts.getTime());
    if (candleIdx === -1) continue;
    let confirmed = false;
    for (; candleIdx < candles.length; candleIdx++) {
      if (parseFloat(candles[candleIdx].close) > H1.price) {
        confirmed = true;
        break;
      }
    }
    if (!confirmed) continue;

    let triggered = false;
    let entryTs = null;
    let outcome = null;
    let outcomeR = 0;
    let exitPrice = null;
    let exitTs = null;
    let barsHeld = 0;

    for (let j = candleIdx; j < candles.length; j++) {
      const bar = candles[j];
      const high = parseFloat(bar.high);
      const low = parseFloat(bar.low);

      if (!triggered) {
        // Setup invalidated if price retraces all the way back below the swing low.
        if (low <= L1.price) break;
        if (low <= entry) {
          triggered = true;
          entryTs = bar.ts;
        }
        continue;
      }

      barsHeld = j - candleIdx;
      if (low <= sl) {
        outcome = "loss";
        outcomeR = -1;
        exitPrice = sl;
        exitTs = bar.ts;
        break;
      }
      if (high >= tp) {
        outcome = "win";
        outcomeR = (tp - entry) / risk;
        exitPrice = tp;
        exitTs = bar.ts;
        break;
      }

      if (barsHeld >= 15) {
        exitPrice = roundPrice(symbol, parseFloat(bar.close));
        exitTs = bar.ts;
        outcomeR = (exitPrice - entry) / risk;
        outcome = outcomeR >= 0 ? "win" : "loss";
        break;
      }
    }

    if (triggered && outcome && passesBias("long", getBias(biasRows, entryTs))) {
      results.push(makeResult(symbol, "long", entry, sl, tp, entryTs, exitPrice, exitTs, outcome, outcomeR, barsHeld, {
        L0: L0.price,
        L1: L1.price,
        H1: H1.price,
        H2: H2.price,
      }));
    }
  }

  return results;
}

function makeResult(symbol, direction, entry, sl, tp, entryTs, exitPrice, exitTs, outcome, outcomeR, barsHeld, levels) {
  return {
    run_id: RUN_ID,
    symbol,
    tf: "1m",
    ts: entryTs,
    grade: "A",
    direction,
    confidence: 100,
    entry_price: entry,
    entry_zone: JSON.stringify(levels),
    stop_loss: sl,
    take_profit: tp,
    risk_reward: Number((Math.abs(tp - entry) / Math.abs(sl - entry)).toFixed(2)),
    outcome,
    outcome_r: Number(outcomeR.toFixed(2)),
    exit_price: exitPrice,
    exit_ts: exitTs,
    bars_held: barsHeld,
    htf_state: "1m_fib_gold_zone",
    session_name: "micro_trend",
  };
}

async function insertResults(results) {
  if (results.length === 0) return;
  const columns = [
    "run_id", "symbol", "tf", "ts", "grade", "direction", "confidence",
    "entry_zone", "stop_loss", "take_profit", "risk_reward",
    "outcome", "outcome_r", "exit_price", "exit_ts", "bars_held",
    "htf_state", "session_name",
    "variant_id", "family_id", "strategy_id",
  ];
  for (const r of results) {
    r.variant_id = VARIANT_ID;
    r.family_id = FAMILY_ID;
    r.strategy_id = VARIANT_ID;
  }
  const placeholders = results
    .map((_, i) => `(${columns.map((_, c) => `$${i * columns.length + c + 1}`).join(", ")})`)
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
    "id", "symbol", "strategy_id", "variant_id", "family_id", "side",
    "entry_type", "entry_price", "stop_loss", "take_profit", "status",
    "fill_price", "close_price", "outcome", "outcome_r", "risk_reward",
    "created_at", "filled_at", "closed_at", "trade_mode",
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
    .map((_, i) => `(${columns.map((_, c) => `$${i * columns.length + c + 1}`).join(", ")})`)
    .join(", ");
  const values = rows.flatMap((row) => columns.map((c) => row[c]));
  await pool.query(`INSERT INTO orders (${columns.join(", ")}) VALUES ${placeholders}`, values);
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
    [FAMILY_ID, BASE_SPEC.name, BASE_SPEC.description, "price_action", JSON.stringify(BASE_SPEC)]
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
    [VARIANT_ID, FAMILY_ID, `${BASE_SPEC.name} (default)`, "Default variant seeded from 1m Fibonacci scalping video", JSON.stringify({}), BASE_SPEC.filters.symbols, ["1m"], true]
  );

  console.log(`[seed] Family '${FAMILY_ID}' + variant '${VARIANT_ID}' created`);

  const endTs = new Date();
  const startTs = new Date(endTs.getTime() - 90 * 24 * 60 * 60 * 1000);

  const results = await runBacktest("EURUSD", startTs, endTs);
  await insertResults(results);
  await insertOrders(results);

  const wins = results.filter((r) => r.outcome === "win").length;
  const losses = results.filter((r) => r.outcome === "loss").length;
  const netR = results.reduce((s, r) => s + r.outcome_r, 0);

  await pool.query(
    `INSERT INTO backtest_runs (id, symbol, tf, start_ts, end_ts, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET sample_count = EXCLUDED.sample_count`,
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
