/**
 * Create the "London Open Liquidity Sweep Sniper" strategy family + variant.
 *
 * Research summary:
 *   - The most commonly cited high-R/R scalping edge online is the Smart-Money
 *     "liquidity sweep + reversal" pattern (ICT / SMC): price runs the Asian
 *     session high/low at the London open, traps breakout traders, then reverses.
 *   - A tight stop placed just beyond the sweep wick and a 1:10 reward target
 *   - turns a small number of outsized winners into positive expectancy even with
 *   - a low win rate.  This matches the user's request for 1:10 R, small SL,
 *     sniper-style entries.
 *
 * Rules used here:
 *   - Asian range = high/low of EURUSD 1m candles from 00:00-07:00 UTC.
 *   - London window = 08:00-10:00 UTC.
 *   - Wait for the first 1m candle in the London window that sweeps the Asian
 *     high (bearish) or low (bullish) AND closes back inside the Asian range.
 *   - Enter a limit order at the Asian range extreme after the sweep.
 *   - Stop loss = sweep extreme + 0.2 pip buffer.
 *   - Take profit = 10 × risk (1:10 R/R).
 *   - Close any open trade at 11:00 UTC if neither SL nor TP has hit.
 *
 * NOTE: This is a research / experimental strategy.  The 1:10 target is very
 * ambitious and the backtest should be treated as a starting point, not a
 * guaranteed profitable system.
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

const FAMILY_ID = `london_open_liquidity_sweep_sniper${process.env.FAMILY_SUFFIX || ""}`;
const VARIANT_ID = `${FAMILY_ID}_default`;
const RUN_ID = `london-sniper-${Date.now()}`;

const SYMBOLS = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(",").map((s) => s.trim())
  : ["EURUSD"];

function pipSize(symbol) {
  if (symbol.includes("XAU") || symbol.includes("XAG")) return 0.01;
  if (symbol.includes("JPY")) return 0.01;
  return 0.0001;
}

const BASE_SPEC = {
  id: FAMILY_ID,
  name: "London Open Liquidity Sweep Sniper",
  version: "1.0.0",
  description:
    "Sniper scalping strategy based on the Smart-Money liquidity sweep pattern. " +
    "Price sweeps the Asian session high or low during the London open, then reverses. " +
    "Entry is a limit order at the Asian range extreme with a very tight stop beyond the sweep wick " +
    "and a 1:10 reward target. Designed for small-stop, high-R/R scalping on EURUSD 1m.",
  source_video: "smart_money_concepts_liquidity_sweep",
  screenshots: [],
  documentation: {
    steps: [
      {
        image: "",
        caption:
          "Step 1 – Mark the Asian session high/low (00:00-07:00 UTC).",
      },
      {
        image: "",
        caption:
          "Step 2 – At the London open (08:00-10:00 UTC) wait for a sweep of the Asian extreme followed by a close back inside the range.",
      },
      {
        image: "",
        caption:
          "Step 3 – Place a limit order at the Asian extreme, stop beyond the sweep wick, target 10R.",
      },
    ],
  },
  signalSource: "price_action",
  setup: [
    {
      id: "disabled_bias_anchor",
      feature: "features_bias",
      tf: "15m",
      predicate: "direction = 'disabled_london_sweep_sniper'",
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
    sl: "sweep_extreme + buffer",
    tp: "10 * risk",
    minRR: 10,
    timeoutBars: 0,
  },
  live: {
    mode: "paper",
    lotSize: 0.01,
    riskPerTradePct: 1,
    accountBalance: 10000,
    accountCurrency: "USD",
    signalTtlMinutes: 120,
    maxSpreadPips: 2,
    maxSlippagePoints: 5,
    entryZonePips: 0,
    maxPositionsPerSymbol: 1,
    maxPositionsTotal: 4,
    cooldownMinutes: 0,
  },
  filters: {
    symbols: SYMBOLS,
  },
  gates: [
    { id: "spread_gate", name: "spread", params: { maxSpreadPips: 2 } },
    {
      id: "session_gate",
      name: "session",
      params: { allowed: ["LONDON"] },
    },
  ],
};

function toUtcDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function timeOf(ts) {
  return new Date(ts).toISOString().slice(11, 16);
}

function decimalPlaces(symbol) {
  if (symbol.includes("XAU") || symbol.includes("XAG")) return 2;
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
       FROM candles_1m
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts`,
      [symbol, startTs, endTs]
    );

    if (rows.length === 0) {
      console.log(`[backtest] No 1m data for ${symbol}`);
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
      // Asian range: 00:00-07:00 UTC.
      // DB timestamps are end-of-period, so use bars stamped 00:05 through 07:00.
      const asianBars = dayBars.filter((b) => {
        const t = timeOf(b.ts);
        return t >= "00:05" && t <= "07:00";
      });
      if (asianBars.length < 10) continue;

      const asianHigh = Math.max(...asianBars.map((b) => parseFloat(b.high)));
      const asianLow = Math.min(...asianBars.map((b) => parseFloat(b.low)));

      // London window: 08:00-10:00 UTC (bars stamped 08:05 through 10:00).
      const londonBars = dayBars.filter((b) => {
        const t = timeOf(b.ts);
        return t >= "08:05" && t <= "10:00";
      });

      let sweep = null;
      for (const b of londonBars) {
        const h = parseFloat(b.high);
        const l = parseFloat(b.low);
        const c = parseFloat(b.close);

        if (h > asianHigh && c < asianHigh) {
          sweep = { ts: b.ts, direction: "short", extreme: h };
          break;
        }
        if (l < asianLow && c > asianLow) {
          sweep = { ts: b.ts, direction: "long", extreme: l };
          break;
        }
      }

      if (!sweep) continue;

      const buffer = 0.00002; // ~0.2 pip buffer beyond sweep wick
      const entryPrice =
        sweep.direction === "short" ? asianHigh : asianLow;
      const sl =
        sweep.direction === "short"
          ? roundPrice(symbol, sweep.extreme + buffer)
          : roundPrice(symbol, sweep.extreme - buffer);
      const risk = Math.abs(entryPrice - sl);

      // Sanity checks: risk must exist and be small (0.5 - 5 pips for "sniper" feel).
      const ps = pipSize(symbol);
      if (risk === 0 || risk < 0.5 * ps || risk > 5 * ps) continue;

      const direction = sweep.direction === "short" ? "short" : "long";
      if (!passesBias(direction, getBias(biasRows, symbol, sweep.ts))) continue;

      const tp =
        sweep.direction === "short"
          ? roundPrice(symbol, entryPrice - 10 * risk)
          : roundPrice(symbol, entryPrice + 10 * risk);

      const postBars = dayBars.filter(
        (b) => b.ts.getTime() > sweep.ts.getTime()
      );

      let triggered = false;
      let entryTs = null;
      let outcome = null;
      let outcomeR = 0;
      let exitPrice = null;
      let exitTs = null;
      let barsHeld = 0;

      for (let i = 0; i < postBars.length; i++) {
        const b = postBars[i];
        const h = parseFloat(b.high);
        const l = parseFloat(b.low);

        if (!triggered) {
          const hitsLong =
            sweep.direction === "long" && l <= entryPrice;
          const hitsShort =
            sweep.direction === "short" && h >= entryPrice;
          if (hitsLong || hitsShort) {
            triggered = true;
            entryTs = b.ts;
          } else {
            continue;
          }
        }

        barsHeld = i;

        if (sweep.direction === "short") {
          if (h >= sl) {
            outcome = "loss";
            outcomeR = -1;
            exitPrice = sl;
            exitTs = b.ts;
            break;
          }
          if (l <= tp) {
            outcome = "win";
            outcomeR = (entryPrice - tp) / risk;
            exitPrice = tp;
            exitTs = b.ts;
            break;
          }
        } else {
          if (l <= sl) {
            outcome = "loss";
            outcomeR = -1;
            exitPrice = sl;
            exitTs = b.ts;
            break;
          }
          if (h >= tp) {
            outcome = "win";
            outcomeR = (tp - entryPrice) / risk;
            exitPrice = tp;
            exitTs = b.ts;
            break;
          }
        }

        // Hard cut-off at 11:00 UTC (end of London morning window).
        if (timeOf(b.ts) > "11:00") {
          exitPrice = roundPrice(symbol, parseFloat(b.close));
          exitTs = b.ts;
          barsHeld = i;
          outcomeR =
            sweep.direction === "short"
              ? (entryPrice - exitPrice) / risk
              : (exitPrice - entryPrice) / risk;
          outcome = outcomeR >= 0 ? "win" : "loss";
          break;
        }
      }

      if (triggered && outcome) {
        results.push({
          run_id: RUN_ID,
          symbol,
          tf: "1m",
          ts: entryTs,
          grade: "A",
          direction: sweep.direction,
          confidence: 100,
          entry_zone: JSON.stringify({
            asianHigh,
            asianLow,
            sweepExtreme: sweep.extreme,
            entryPrice,
          }),
          stop_loss: sl,
          take_profit: tp,
          risk_reward: 10,
          outcome,
          outcome_r: Number(outcomeR.toFixed(2)),
          exit_price: exitPrice,
          exit_ts: exitTs,
          bars_held: barsHeld,
          htf_state: "london_open_sweep",
          session_name: "LONDON",
        });
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

  const rows = results.map((r) => {
    const zone = JSON.parse(r.entry_zone);
    return {
      id: randomUUID(),
      symbol: r.symbol,
      strategy_id: VARIANT_ID,
      variant_id: VARIANT_ID,
      family_id: FAMILY_ID,
      side: r.direction === "long" ? "buy" : "sell",
      entry_type: "limit",
      entry_price: zone.entryPrice,
      stop_loss: r.stop_loss,
      take_profit: r.take_profit,
      status: "closed",
      fill_price: zone.entryPrice,
      close_price: r.exit_price,
      outcome: r.outcome,
      outcome_r: r.outcome_r,
      risk_reward: r.risk_reward,
      created_at: r.ts,
      filled_at: r.ts,
      closed_at: r.exit_ts,
      trade_mode: "paper",
    };
  });

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
      "Default variant seeded from liquidity-sweep sniper research",
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
