/**
 * London Open Liquidity Sweep Sniper — Key-Level TP variant.
 *
 * This tests the user's idea:
 *   - SL = low/high of the 5m candle that contains the sweep (computed from 1m).
 *   - TP = nearest higher-timeframe key level beyond the Asian range
 *          (pivot highs/lows + supply/demand zones from 5m/15m/1h).
 *   - Reward/risk is capped between 2 and 10 so we still aim for "sniper"
 *     outsized gains but do not chase unrealistic levels.
 *
 * If no suitable key level exists the setup is skipped.
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

const FAMILY_ID = `london_open_liquidity_sweep_sniper_keylevel${process.env.FAMILY_SUFFIX || ""}`;
const VARIANT_ID = `${FAMILY_ID}_default`;
const RUN_ID = `london-sniper-keylevel-${Date.now()}`;

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
  name: "London Open Liquidity Sweep Sniper (Key-Level TP)",
  version: "1.0.0",
  description:
    "Sniper scalping strategy using the London-open liquidity sweep. " +
    "SL is placed beyond the 5m candle extreme that contains the sweep. " +
    "TP is the nearest multi-timeframe key level (pivot / supply / demand) " +
    "beyond the Asian range, targeting 2-10R. Designed to test the user's idea " +
    "that a structural 5m SL + key-level TP improves the fixed-10R version.",
  source_video: "smart_money_concepts_liquidity_sweep",
  screenshots: [],
  documentation: {
    steps: [
      {
        image: "",
        caption: "Step 1 – Mark the Asian range high/low (00:00-07:00 UTC).",
      },
      {
        image: "",
        caption:
          "Step 2 – At London open, wait for a sweep of the Asian extreme with a close back inside.",
      },
      {
        image: "",
        caption:
          "Step 3 – Enter at the Asian extreme, SL beyond the 5m candle extreme, TP at the nearest HTF key level beyond the range.",
      },
    ],
  },
  signalSource: "price_action",
  setup: [
    {
      id: "disabled_bias_anchor",
      feature: "features_bias",
      tf: "15m",
      predicate: "direction = 'disabled_london_sniper_keylevel'",
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
    sl: "5m_candle_extreme + buffer",
    tp: "nearest_htf_key_level_beyond_asian_range",
    minRR: 2,
    maxRR: 10,
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

function buildKeyLevels(pivots, zones, sweepTs, day, direction, asianHigh, asianLow) {
  const cutoff = new Date(sweepTs.getTime() - 5 * 24 * 60 * 60 * 1000);
  const levels = [];

  for (const tf of ["5m", "15m", "1h"]) {
    pivots
      .filter(
        (p) =>
          p.tf === tf &&
          p.ts.getTime() <= sweepTs.getTime() &&
          p.ts.getTime() >= cutoff.getTime()
      )
      .forEach((p) => {
        const pr = parseFloat(p.price);
        if (direction === "short" && pr < asianLow) {
          levels.push({ price: pr, source: `pivot_${tf}_${p.kind}` });
        }
        if (direction === "long" && pr > asianHigh) {
          levels.push({ price: pr, source: `pivot_${tf}_${p.kind}` });
        }
      });

    zones
      .filter(
        (z) =>
          z.tf === tf &&
          z.ts.getTime() <= sweepTs.getTime() &&
          z.ts.getTime() >= cutoff.getTime()
      )
      .forEach((z) => {
        if (direction === "short" && z.zone_kind === "demand") {
          levels.push({ price: parseFloat(z.bottom), source: `zone_${tf}_demand` });
        }
        if (direction === "long" && z.zone_kind === "supply") {
          levels.push({ price: parseFloat(z.top), source: `zone_${tf}_supply` });
        }
      });
  }

  // Choose the nearest level beyond the Asian range.
  if (direction === "short") {
    const valid = levels.filter((l) => l.price < asianLow);
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => (a.price > b.price ? a : b));
  } else {
    const valid = levels.filter((l) => l.price > asianHigh);
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => (a.price < b.price ? a : b));
  }
}

async function runBacktest(symbols, startTs, endTs) {
  const results = [];

  for (const symbol of symbols) {
    const { rows: m1Rows } = await pool.query(
      `SELECT ts, o as open, h as high, l as low, c as close
       FROM candles_1m
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts`,
      [symbol, startTs, endTs]
    );

    if (m1Rows.length === 0) {
      console.log(`[backtest] No 1m data for ${symbol}`);
      continue;
    }

    const biasRows = await loadBias(startTs, endTs);

    const { rows: pivots } = await pool.query(
      `SELECT ts, tf, kind, price
       FROM features_pivot
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3`,
      [symbol, new Date(startTs.getTime() - 5 * 24 * 60 * 60 * 1000), endTs]
    );

    const { rows: zones } = await pool.query(
      `SELECT ts, tf, zone_kind, top, bottom
       FROM features_zone
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3`,
      [symbol, new Date(startTs.getTime() - 5 * 24 * 60 * 60 * 1000), endTs]
    );

    const byDay = new Map();
    for (const r of m1Rows) {
      const d = toUtcDate(r.ts);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(r);
    }

    for (const [day, dayBars] of byDay) {
      const asianBars = dayBars.filter((b) => {
        const t = timeOf(b.ts);
        return t >= "00:05" && t <= "07:00";
      });
      if (asianBars.length < 10) continue;

      const asianHigh = Math.max(...asianBars.map((b) => parseFloat(b.high)));
      const asianLow = Math.min(...asianBars.map((b) => parseFloat(b.low)));

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

      // 5m candle containing the sweep, built from 1m data.
      const windowStart = new Date(sweep.ts.getTime() - 5 * 60 * 1000);
      const m5Window = dayBars.filter(
        (b) =>
          b.ts.getTime() > windowStart.getTime() &&
          b.ts.getTime() <= sweep.ts.getTime()
      );
      if (m5Window.length === 0) continue;

      const m5High = Math.max(...m5Window.map((b) => parseFloat(b.high)));
      const m5Low = Math.min(...m5Window.map((b) => parseFloat(b.low)));

      const buffer = 0.00002;
      const entryPrice =
        sweep.direction === "short" ? asianHigh : asianLow;
      const sl =
        sweep.direction === "short"
          ? roundPrice(symbol, m5High + buffer)
          : roundPrice(symbol, m5Low - buffer);
      const risk = Math.abs(entryPrice - sl);

      // "Sniper" SL must be small (0.5 - 5 pips).
      const ps = pipSize(symbol);
      if (risk < 0.5 * ps || risk > 5 * ps) continue;

      const direction = sweep.direction === "short" ? "short" : "long";
      if (!passesBias(direction, getBias(biasRows, symbol, sweep.ts))) continue;

      const keyLevel = buildKeyLevels(
        pivots,
        zones,
        sweep.ts,
        day,
        sweep.direction,
        asianHigh,
        asianLow
      );
      if (!keyLevel) continue;

      let rr = Math.abs(keyLevel.price - entryPrice) / risk;
      if (rr < 2 || rr > 10) continue;
      const tp = roundPrice(symbol, keyLevel.price);

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
            outcomeR = rr;
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
            outcomeR = rr;
            exitPrice = tp;
            exitTs = b.ts;
            break;
          }
        }

        if (timeOf(b.ts) > "11:00") {
          exitPrice = roundPrice(symbol, parseFloat(b.close));
          exitTs = b.ts;
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
            m5High,
            m5Low,
            entryPrice,
            tpSource: keyLevel.source,
            tpRR: rr,
          }),
          stop_loss: sl,
          take_profit: tp,
          risk_reward: Number(rr.toFixed(2)),
          outcome,
          outcome_r: Number(outcomeR.toFixed(2)),
          exit_price: exitPrice,
          exit_ts: exitTs,
          bars_held: barsHeld,
          htf_state: "london_open_sweep_keylevel",
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
      "Key-level TP variant requested by user",
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
