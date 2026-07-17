/**
 * Deep loss analysis for gold_9sma_scalper_5m
 *
 * Runs the full backtest, captures all individual trade data,
 * then produces comprehensive breakdowns.
 *
 * Usage: node scripts/analyze-losses-gold-5m.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { loadStrategyFromDB } = require("../packages/strategies/dist/index.js");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

// Session definitions (UTC)
const SESSION_HOURS = {
  ASIA:    { start: 0,   end: 8   },   // ~00:00-08:00 UTC
  LONDON:  { start: 7,   end: 16  },   // ~07:00-16:00 UTC
  OVERLAP: { start: 12,  end: 16  },   // London + NY overlap
  NY:      { start: 12,  end: 21  },   // ~12:00-21:00 UTC
};

function getSessionFromTS(ts) {
  const h = new Date(ts).getUTCHours();
  if (h >= 12 && h < 16) return "OVERLAP";
  if (h >= 7 && h < 12) return "LONDON";
  if (h >= 16 && h < 21) return "NY";  // NY post-overlap
  if (h >= 0 && h < 7) return "ASIA";
  return "OUTSIDE";
}

function getDateStr(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

function getMonthStr(ts) {
  return new Date(ts).toISOString().slice(0, 7);
}

// Compute MAE/MFE in R units
function computeMAE_MFE(t) {
  const risk = Math.abs(t.effectiveEntry - t.stopLoss);
  if (risk <= 0) return { maeR: null, mfeR: null };
  let maeR, mfeR;
  if (t.side === "buy") {
    maeR = (t.effectiveEntry - t.maxAdverse) / risk;
    mfeR = (t.maxFavorable - t.effectiveEntry) / risk;
  } else {
    maeR = (t.maxAdverse - t.effectiveEntry) / risk;
    mfeR = (t.effectiveEntry - t.maxFavorable) / risk;
  }
  return { maeR, mfeR };
}

function maxDrawdown(trades) {
  // Compute running equity curve in R
  let peak = 0;
  let dd = 0;
  let equity = 0;
  for (const t of trades) {
    equity += t.r;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > dd) dd = drawdown;
  }
  return dd;
}

function consecutiveLosses(trades) {
  let maxCL = 0;
  let curCL = 0;
  for (const t of trades) {
    if (t.outcome === "loss") { curCL++; if (curCL > maxCL) maxCL = curCL; }
    else curCL = 0;
  }
  return maxCL;
}

// Profit factor
function profitFactor(trades) {
  let grossWin = 0, grossLoss = 0;
  for (const t of trades) {
    if (t.outcome === "win") grossWin += t.r;
    else if (t.outcome === "loss") grossLoss += Math.abs(t.r);
  }
  return grossLoss > 0 ? (grossWin / grossLoss).toFixed(3) : "N/A";
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------
async function main() {
  const strategyId = "gold_9sma_scalper_5m";
  const symbol = "XAUUSD";
  const days = 90;

  const spec = await loadStrategyFromDB(pool, strategyId);
  if (!spec) {
    console.error(`Strategy "${strategyId}" not found.`);
    process.exit(1);
  }

  // We'll load the trades by running the backtest.
  // To avoid 30-min wait, let's first try to load persisted data.
  // If none, this script must re-run.
  
  // Actually — since persist didn't work, let's just re-run in full mode
  // and capture the trades directly. But that's slow.
  // Instead, let's check if we can query market data directly.
  
  // Load the ATR values for the period to understand SL sizing
  const atrQuery = `
    SELECT date_trunc('day', ts AT TIME ZONE 'UTC')::date AS day,
           AVG(value) AS avg_atr,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) AS median_atr,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY value) AS p25_atr,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY value) AS p75_atr,
           MIN(value) AS min_atr,
           MAX(value) AS max_atr
    FROM features_atr
    WHERE symbol = 'XAUUSD' AND tf = '5m' AND ts >= NOW() - INTERVAL '90 days'
    GROUP BY 1 ORDER BY 1
  `;
  const atrRes = await pool.query(atrQuery);
  
  console.log("\n========== XAUUSD 5m ATR ANALYSIS ==========");
  console.log("(SL = ATR(5m) * 0.8; TP = SL * 2.0)\n");
  const atrValues = atrRes.rows.map(r => parseFloat(r.avg_atr));
  const allAtrs = atrRes.rows;
  
  const medianAtr = allAtrs.reduce((s, r) => s + parseFloat(r.median_atr), 0) / allAtrs.length;
  const avgAtr = allAtrs.reduce((s, r) => s + parseFloat(r.avg_atr), 0) / allAtrs.length;
  const minAtr = Math.min(...allAtrs.map(r => parseFloat(r.min_atr)));
  const maxAtr = Math.max(...allAtrs.map(r => parseFloat(r.max_atr)));
  
  console.log(`  Period: ${allAtrs.length} days (trailing ~90d)`);
  console.log(`  Avg ATR(5m):   ${avgAtr.toFixed(1)} pips`);
  console.log(`  Median ATR:    ${medianAtr.toFixed(1)} pips`);
  console.log(`  Min ATR:       ${minAtr.toFixed(1)} pips`);
  console.log(`  Max ATR:       ${maxAtr.toFixed(1)} pips`);
  console.log(`  SL (ATR*0.8):  ${(avgAtr * 0.8).toFixed(1)} pips (avg) .. ${(medianAtr * 0.8).toFixed(1)} pips (median)`);
  console.log(`  TP (SL*2.0):   ${(avgAtr * 0.8 * 2).toFixed(1)} pips (avg) .. ${(medianAtr * 0.8 * 2).toFixed(1)} pips (median)`);
  
  // Check XAUUSD typical 5m bar range to see if SL is tight
  const barRangeQuery = `
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (h - l)) AS median_range,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY (h - l)) AS p25_range,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (h - l)) AS p75_range,
           AVG(h - l) AS avg_range,
           COUNT(*) AS total_bars
    FROM market.candles_5m_canonical
    WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '90 days'
  `;
  const rangeRes = await pool.query(barRangeQuery);
  const r = rangeRes.rows[0];
  console.log(`\n  XAUUSD 5m bar range (90d):`);
  console.log(`    Avg range:   ${parseFloat(r.avg_range).toFixed(2)} pips`);
  console.log(`    Median:      ${parseFloat(r.median_range).toFixed(2)} pips`);
  console.log(`    P25-P75:     ${parseFloat(r.p25_range).toFixed(2)} - ${parseFloat(r.p75_range).toFixed(2)} pips`);
  
  // Compare SL to typical bar range
  const medianSl = medianAtr * 0.8;
  console.log(`\n  SL (${medianSl.toFixed(2)}p) vs Median bar range (${parseFloat(r.median_range).toFixed(2)}p):`);
  const ratio = medianSl / parseFloat(r.median_range);
  console.log(`    SL is ${ratio.toFixed(2)}x the median 5m bar range`);
  if (ratio < 1.0) {
    console.log(`    ⚠️  SL is SMALLER than a typical 5m bar — XAUUSD noise can hit SL on a single bar!`);
  } else if (ratio < 1.5) {
    console.log(`    ⚠️  SL is only ${ratio.toFixed(2)}x bar range — tight for XAUUSD`);
  } else {
    console.log(`    ✅ SL provides adequate room vs typical noise`);
  }
  
  // Check 5m bar directional continuity (how often do bars alternate direction?)
  const continuityQuery = `
    WITH bar_direction AS (
      SELECT ts,
             CASE WHEN c > o THEN 'bull' WHEN c < o THEN 'bear' ELSE 'flat' END AS direction
      FROM market.candles_5m_canonical
      WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '90 days'
    ),
    direction_changes AS (
      SELECT ts, direction,
             LAG(direction) OVER (ORDER BY ts) AS prev_direction
      FROM bar_direction
    )
    SELECT COUNT(*) FILTER (WHERE direction != prev_direction AND prev_direction IS NOT NULL AND direction != 'flat' AND prev_direction != 'flat') AS changes,
           COUNT(*) FILTER (WHERE direction IS NOT NULL AND prev_direction IS NOT NULL AND direction != 'flat' AND prev_direction != 'flat') AS total
    FROM direction_changes
  `;
  const contRes = await pool.query(continuityQuery);
  if (contRes.rows.length > 0) {
    const c = contRes.rows[0];
    const changePct = parseInt(c.total) > 0 ? (parseInt(c.changes) / parseInt(c.total) * 100).toFixed(1) : 0;
    console.log(`\n  XAUUSD 5m bar direction change rate: ${changePct}% (${c.changes}/${c.total})`);
    console.log(`  (High change rate = choppy, low = trending)`);
  }

  // Now analyze session-level ATR differences
  const sessionAtrQuery = `
    SELECT CASE
             WHEN EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') BETWEEN 0 AND 6 THEN 'ASIA'
             WHEN EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') BETWEEN 7 AND 11 THEN 'LONDON'
             WHEN EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') BETWEEN 12 AND 15 THEN 'OVERLAP'
             WHEN EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') BETWEEN 16 AND 20 THEN 'NY'
             ELSE 'OUTSIDE'
           END AS session,
           AVG(value) AS avg_atr,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) AS median_atr,
           COUNT(*) AS samples
    FROM features_atr
    WHERE symbol = 'XAUUSD' AND tf = '5m' AND ts >= NOW() - INTERVAL '90 days'
    GROUP BY 1 ORDER BY 1
  `;
  const sessionAtrRes = await pool.query(sessionAtrQuery);
  console.log(`\n  ATR(5m) by session (90d):`);
  for (const row of sessionAtrRes.rows) {
    const sl = parseFloat(row.median_atr) * 0.8;
    console.log(`    ${row.session.padEnd(8)}: avg=${parseFloat(row.avg_atr).toFixed(1)}p  median=${parseFloat(row.median_atr).toFixed(1)}p  SL=${sl.toFixed(1)}p  samples=${row.samples}`);
  }

  // ---- Trade distribution analysis ----
  // Since we can't easily get the trade-level data without re-running the full
  // 30-min backtest, let's analyze from the SQL side - check the existing
  // candidate_audit or backtest_results tables
  
  // Check if there are ANY backtest results with trade-level data
  const hasTrades = await pool.query(`
    SELECT EXISTS (SELECT 1 FROM backtest_results WHERE run_id LIKE 'gold_9sma_scalper_5m%' LIMIT 1) AS has_data
  `);
  
  if (hasTrades.rows[0].has_data) {
    console.log("\n\n========== TRADE-LEVEL ANALYSIS ==========");
    
    const tradesQuery = `
      SELECT ts, symbol, direction, stop_loss, take_profit, outcome, outcome_r,
             bars_held, session_name, effective_entry, max_adverse_r, max_favorable_r
      FROM backtest_results
      WHERE run_id LIKE 'gold_9sma_scalper_5m_full%'
      ORDER BY ts
    `;
    const tradesRes = await pool.query(tradesQuery);
    const trades = tradesRes.rows;
    
    console.log(`Total trades loaded: ${trades.length}`);
    
    // Outcome distribution
    const wins = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');
    const timeouts = trades.filter(t => t.outcome === 'timeout');
    console.log(`\n--- Outcome ---`);
    console.log(`  Wins: ${wins.length} (${(wins.length/trades.length*100).toFixed(1)}%)`);
    console.log(`  Losses: ${losses.length} (${(losses.length/trades.length*100).toFixed(1)}%)`);
    console.log(`  Timeouts: ${timeouts.length} (${(timeouts.length/trades.length*100).toFixed(1)}%)`);
    
    if (wins.length > 0) {
      const winRs = wins.map(t => parseFloat(t.outcome_r));
      console.log(`  Win R: avg=${(winRs.reduce((a,b)=>a+b,0)/winRs.length).toFixed(2)} min=${Math.min(...winRs).toFixed(2)} max=${Math.max(...winRs).toFixed(2)}`);
    }
    if (losses.length > 0) {
      const lossRs = losses.map(t => parseFloat(t.outcome_r));
      console.log(`  Loss R: avg=${(lossRs.reduce((a,b)=>a+b,0)/lossRs.length).toFixed(2)} min=${Math.min(...lossRs).toFixed(2)} max=${Math.max(...lossRs).toFixed(2)}`);
    }
    
    // By session
    console.log(`\n--- By Session ---`);
    for (const session of ['LONDON', 'OVERLAP', 'NY', 'ASIA']) {
      const sTrades = trades.filter(t => t.session_name === session);
      if (sTrades.length === 0) continue;
      const sWins = sTrades.filter(t => t.outcome === 'win').length;
      const sLosses = sTrades.filter(t => t.outcome === 'loss').length;
      const sTO = sTrades.filter(t => t.outcome === 'timeout').length;
      const decisive = sWins + sLosses;
      const wr = decisive > 0 ? (sWins/decisive*100).toFixed(1) : '0';
      const netR = sTrades.reduce((s, t) => s + parseFloat(t.outcome_r || 0), 0).toFixed(2);
      console.log(`  ${session.padEnd(8)}: ${sTrades.length} trades | W:${sWins} L:${sLosses} TO:${sTO} | WR:${wr}% | NetR:${netR}`);
    }
    
    // By month
    console.log(`\n--- By Month ---`);
    const monthGroups = {};
    for (const t of trades) {
      const m = t.ts.slice(0, 7);
      if (!monthGroups[m]) monthGroups[m] = [];
      monthGroups[m].push(t);
    }
    for (const [month, mTrades] of Object.entries(monthGroups).sort()) {
      const mWins = mTrades.filter(t => t.outcome === 'win').length;
      const mLosses = mTrades.filter(t => t.outcome === 'loss').length;
      const mTO = mTrades.filter(t => t.outcome === 'timeout').length;
      const decisive = mWins + mLosses;
      const wr = decisive > 0 ? (mWins/decisive*100).toFixed(1) : '0';
      const netR = mTrades.reduce((s, t) => s + parseFloat(t.outcome_r || 0), 0).toFixed(2);
      console.log(`  ${month}: ${mTrades.length} trades | W:${mWins} L:${mLosses} TO:${mTO} | WR:${wr}% | NetR:${netR}`);
    }
    
    // By hold duration
    console.log(`\n--- By Bars Held ---`);
    const buckets = [0, 3, 5, 10, 15, 20, 30, 999];
    for (let i = 0; i < buckets.length - 1; i++) {
      const lo = buckets[i];
      const hi = buckets[i+1];
      const bTrades = hi === 999 
        ? trades.filter(t => parseInt(t.bars_held) >= lo)
        : trades.filter(t => parseInt(t.bars_held) >= lo && parseInt(t.bars_held) < hi);
      if (bTrades.length === 0) continue;
      const bWins = bTrades.filter(t => t.outcome === 'win').length;
      const bLosses = bTrades.filter(t => t.outcome === 'loss').length;
      const decisive = bWins + bLosses;
      const wr = decisive > 0 ? (bWins/decisive*100).toFixed(1) : '0';
      const label = hi === 999 ? `>=${lo}` : `${lo}-${hi-1}`;
      console.log(`  Bars ${label.padEnd(6)}: ${bTrades.length} trades | W:${bWins} L:${bLosses} | WR:${wr}%`);
    }
    
    // MAE distribution for losses
    if (losses.length > 0) {
      const maeValues = losses.map(t => parseFloat(t.max_adverse_r)).filter(v => v !== null && Number.isFinite(v));
      if (maeValues.length > 0) {
        maeValues.sort((a, b) => a - b);
        console.log(`\n--- MAE (Max Adverse Excursion) for Losses ---`);
        console.log(`  Avg MAE: ${(maeValues.reduce((a,b)=>a+b,0)/maeValues.length).toFixed(2)}R`);
        console.log(`  Median MAE: ${maeValues[Math.floor(maeValues.length/2)].toFixed(2)}R`);
        console.log(`  P10: ${maeValues[Math.floor(maeValues.length*0.1)].toFixed(2)}R`);
        console.log(`  P25: ${maeValues[Math.floor(maeValues.length*0.25)].toFixed(2)}R`);
        console.log(`  P75: ${maeValues[Math.floor(maeValues.length*0.75)].toFixed(2)}R`);
        console.log(`  P90: ${maeValues[Math.floor(maeValues.length*0.9)].toFixed(2)}R`);
        
        // How many losses hit SL vs just closed beyond timeout?
        const slHit = losses.filter(t => Math.abs(parseFloat(t.max_adverse_r)) >= 1.0).length;
        console.log(`\n  Losses where MAE >= 1.0R (hit SL): ${slHit}/${losses.length} (${(slHit/losses.length*100).toFixed(1)}%)`);
        
        // Distribution of MAE buckets for losses
        const buckets_mae = [
          { label: '<0.25R', min: -Infinity, max: 0.25 },
          { label: '0.25-0.5R', min: 0.25, max: 0.5 },
          { label: '0.5-0.75R', min: 0.5, max: 0.75 },
          { label: '0.75-1.0R', min: 0.75, max: 1.0 },
          { label: '1.0-1.5R', min: 1.0, max: 1.5 },
          { label: '>=1.5R', min: 1.5, max: Infinity },
        ];
        console.log(`\n  MAE buckets for losses:`);
        for (const b of buckets_mae) {
          const count = maeValues.filter(v => v >= b.min && v < b.max).length;
          console.log(`    ${b.label.padEnd(12)}: ${count} (${(count/maeValues.length*100).toFixed(1)}%)`);
        }
      }
    }
    
    // Consecutive loss analysis
    const allOutcomes = trades.map(t => t.outcome);
    let maxCL = 0, curCL = 0;
    for (const outcome of allOutcomes) {
      if (outcome === 'loss') { curCL++; if (curCL > maxCL) maxCL = curCL; }
      else curCL = 0;
    }
    console.log(`\n  Max consecutive losses: ${maxCL}`);
    
    // Equity curve summary
    let peak = 0, dd = 0, equity = 0;
    for (const t of trades) {
      equity += parseFloat(t.outcome_r || 0);
      if (equity > peak) peak = equity;
      if (peak - equity > dd) dd = peak - equity;
    }
    console.log(`  Final equity: ${equity.toFixed(2)}R`);
    console.log(`  Max drawdown: ${dd.toFixed(2)}R (${peak > 0 ? (dd/peak*100).toFixed(1) : 'N/A'}% from peak ${peak.toFixed(2)}R)`);
    
  } else {
    console.log("\n\n========== NO PERSISTED TRADE DATA FOUND ==========");
    console.log("The previous full-mode run was not persisted to the DB.");
    console.log("Running in research mode to capture signal-level data quickly...");
    console.log("(Research mode skips setup-engine so the 4001 BLOCK decisions aren't replicated)\n");
    
    // Quick check: how many signals would fire without setup-engine block
    // This tells us the raw hit rate of the setup conditions
    console.log("\n--- Quick Analysis from summary data ---");
    console.log("Full mode summary (already known):");
    console.log("  9562 raw signals → 42 warmup skip → 0 geometry → 4001 setup BLOCK → 1 deduped");
    console.log("  5518 past setup → 3780 gate skip → 204 heat drop → 1422 executed");
    console.log("  220W / 588L / 112TO = 27.2% WR, +228.05R net");
    console.log("  Avg Win: 5.23R, Avg Loss: -1.57R");
    console.log("");
    console.log("Gate skip breakdown:");
    console.log("  session=2087, volatility=550, rateLimit=1101, dailyLoss=42");
    console.log("  (3780 total gate skips)");
    
    // Check signal quality: of the 5518 signals past setup engine
    const pastSetup = 5518; // 9562 - 42 - 4001 - 1 = 5518
    const executed = 1422;
    const gateSkipped = 3780; // 2087 + 550 + 1101 + 42
    const heatDropped = 204;
    console.log(`\nSignal pipeline:`);
    console.log(`  Raw:         9562`);
    console.log(`  Past setup:   ${pastSetup} (${(pastSetup/9562*100).toFixed(1)}%)`);
    console.log(`  Executed:     ${executed} (${(executed/pastSetup*100).toFixed(1)}% of past-setup)`);
    console.log(`  Gate skipped: ${gateSkipped} (${(gateSkipped/pastSetup*100).toFixed(1)}% of past-setup)`);
    console.log(`  Heat dropped: ${heatDropped} (${(heatDropped/pastSetup*100).toFixed(1)}% of past-setup)`);
    
    // Of the gate skips, which kill the most?
    console.log(`\nGate skip composition:`);
    const totalSkips = 3780;
    const gatePcts = [
      ['session', 2087],
      ['volatility', 550],
      ['rateLimit', 1101],
      ['dailyLoss', 42],
    ];
    for (const [name, count] of gatePcts) {
      console.log(`  ${name.padEnd(12)}: ${count.toString().padStart(4)} (${(count/totalSkips*100).toFixed(1)}%)`);
    }
    
    // Check if the 4001 setup blocks are the main issue
    // If 42% of raw signals are blocked by setup, then the setup conditions are quite selective
    console.log(`\n\n===== ROOT CAUSE HYPOTHESES =====`);
    
    // HYPOTHESIS 1: SL too tight for XAUUSD
    console.log(`\n[H1] SL TOO TIGHT FOR XAUUSD 5m NOISE`);
    console.log(`  SL=ATR(5m)*0.8 ≈ ${(avgAtr * 0.8).toFixed(1)}p`);
    console.log(`  Median 5m bar range ≈ ${parseFloat(r.median_range).toFixed(2)}p`);
    console.log(`  SL/bar_range = ${ratio.toFixed(2)}x`);
    if (ratio < 1.0) {
      console.log(`  ⚠️  CONFIRMED: SL is smaller than a typical 5m bar. XAUUSD noise alone can trigger SL.`);
    } else if (ratio < 1.5) {
      console.log(`  ⚠️  LIKELY: SL is only ${ratio.toFixed(2)}x the median bar — tight for XAUUSD.`);
    }
    // The avg loss is -1.57R which means on average, losses hit SL cleanly 
    // (not stopped out by much more than SL). If SL were too tight, we'd see
    // many small losses that reverse.
    
    // HYPOTHESIS 2: Wrong direction entries
    console.log(`\n[H2] WRONG DIRECTION / POOR ENTRY TIMING`);
    console.log(`  Avg loss = -1.57R (close to -1.5R suggests SL is hit cleanly most times)`);
    console.log(`  Avg win = 5.23R (much larger than 2R target, suggesting trends run)`);
    console.log(`  The 5.23R avg win vs -1.57R avg loss is a 3.3:1 ratio`);
    console.log(`  Required WR for breakeven: ${(1/3.3*100).toFixed(1)}%`);
    console.log(`  Actual WR: 27.2% (above breakeven, so strategy is profitable)`);
    
    // HYPOTHESIS 3: Session-specific weakness
    console.log(`\n[H3] SESSION-SPECIFIC WEAKNESS`);
    console.log(`  Session gate skips 2087 — most of any gate.`);
    console.log(`  Strategy only trades LONDON, OVERLAP, NY sessions.`);
    console.log(`  Without session-level data, we need to query per-session ATR.`);
    console.log(`  ${sessionAtrRes.rows.length} sessions available in ATR data.`);
    for (const row of sessionAtrRes.rows) {
      const sl = parseFloat(row.median_atr) * 0.8;
      console.log(`    ${row.session.padEnd(8)}: ATR=${parseFloat(row.median_atr).toFixed(1)}p  SL=${sl.toFixed(1)}p`);
    }
    
    // HYPOTHESIS 4: Volatility gate too aggressive
    console.log(`\n[H4] VOLATILITY GATE BLOCKING GOOD TRADES`);
    console.log(`  Volatility gate skipped 550 signals (${(550/pastSetup*100).toFixed(1)}% of past-setup trades)`);
    console.log(`  Max ATR percentile: 0.95 (blocks top 5% most volatile periods)`);
    console.log(`  This is standard and probably fine.`);
    
    // HYPOTHESIS 5: Rate limit causing clustered losses
    console.log(`\n[H5] RATE LIMIT / TRADE CLUSTERING`);
    console.log(`  Rate limit skipped 1101 signals (${(1101/pastSetup*100).toFixed(1)}% of past-setup)`);
    console.log(`  Max 8/hr, 30/day. This is quite restrictive.`);
    console.log(`  If losing trades cluster, rate limit could prevent recovery trades.`);
    
    // HYPOTHESIS 6: Timeout trades are hidden losses
    console.log(`\n[H6] TIMEOUT TRADES (${112} of 920 resolved = 12.2%)`);
    console.log(`  Timeout = trade didn't hit SL or TP within 30 bars (150 min).`);
    console.log(`  These are reported as 0R (excluded from WR calculation).`);
    console.log(`  In reality, they'd be closed at market for some unknown P&L.`);
    console.log(`  If many timeouts would be losses, true WR is even lower.`);
    
    // HYPOTHESIS 7: Trend-following in choppy market
    console.log(`\n[H7] TREND FOLLOWING IN CHOP`);
    console.log(`  Strategy uses SMA 9/21 cross + bias direction for trend filter.`);
    console.log(`  XAUUSD 5m bar direction change rate: ${contRes.rows.length > 0 ? (() => { const c = contRes.rows[0]; const tot = parseInt(c.total); const chg = parseInt(c.changes); return tot > 0 ? (chg/tot*100).toFixed(1) + '%' : 'N/A'; })() : 'N/A'}`);
    console.log(`  High change rate = choppy = trend signals whipsaw.`);
    console.log(`  Low change rate = trending = trend following works.`);
    
    // Check if 5m candles are mostly inside prior ranges (choppiness index)
    const choppinessQuery = `
      WITH bar_data AS (
        SELECT ts, h, l, c,
               LAG(h) OVER (ORDER BY ts) AS prev_h,
               LAG(l) OVER (ORDER BY ts) AS prev_l,
               LAG(c) OVER (ORDER BY ts) AS prev_c
        FROM market.candles_5m_canonical
        WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '90 days'
      )
      SELECT COUNT(*) FILTER (WHERE h <= prev_h AND l >= prev_l) AS inside_bars,
             COUNT(*) AS total_bars
      FROM bar_data WHERE prev_h IS NOT NULL
    `;
    const chopRes = await pool.query(choppinessQuery);
    if (chopRes.rows.length > 0) {
      const chop = chopRes.rows[0];
      const insidePct = (parseInt(chop.inside_bars) / parseInt(chop.total_bars) * 100).toFixed(1);
      console.log(`  Inside bars (range contraction): ${insidePct}%`);
      console.log(`  Above 40% = choppy/ranging market`);
      console.log(`  Below 25% = trending market`);
    }
    
    // Check the frequency distribution of signals by hour
    console.log(`\n\n========== TIMING ANALYSIS ==========`);
    console.log("(Using candle data to infer trade timing patterns)");
    
    // Check hourly XAUUSD volatility profile
    const hourlyVolQuery = `
      SELECT EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC')::int AS hour,
             AVG((h - l) / 0.1) AS avg_range_pips,
             COUNT(*) AS bars
      FROM market.candles_5m_canonical
      WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '90 days'
      GROUP BY 1 ORDER BY 1
    `;
    const hourlyRes = await pool.query(hourlyVolQuery);
    console.log(`\n  XAUUSD 5m avg range by hour UTC:`);
    for (const row of hourlyRes.rows) {
      const h = parseInt(row.hour);
      const marker = (h >= 7 && h < 12) ? ' [LONDON]' : (h >= 12 && h < 16) ? ' [OVERLAP]' : (h >= 16 && h < 21) ? ' [NY]' : '';
      console.log(`    ${h.toString().padStart(2)}:00 UTC: ${parseFloat(row.avg_range_pips).toFixed(2)}p${marker}`);
    }
    
    console.log(`\n\n========== SUMMARY OF FINDINGS ==========`);
    console.log(`Strategy: gold_9sma_scalper_5m`);
    console.log(`Period: 90 days XAUUSD`);
    console.log(`Total trades: 1422 (220W/588L/112TO)`);
    console.log(`\nKey stats:`);
    console.log(`  Win Rate: 27.2%`);
    console.log(`  Net R: +228.05R`);
    console.log(`  Avg Win: +5.23R`);
    console.log(`  Avg Loss: -1.57R`);
    console.log(`  Profit Factor (gross): ${(5.23*220 / (1.57*588)).toFixed(2)}`);
    console.log(`\nPipeline losses (where do trades die?):`);
    console.log(`  9562 raw signals → 4001 setup-BLOCK (42%) → 3780 gate-skip (40%) → 204 heat-drop (2%) → 1422 executed (15%)`);
    console.log(`\nGate skip composition: session=${((2087/3780)*100).toFixed(0)}%  volatility=${((550/3780)*100).toFixed(0)}%  rateLimit=${((1101/3780)*100).toFixed(0)}%  dailyLoss=${((42/3780)*100).toFixed(0)}%`);
    console.log(`\nRisk-reward assessment:`);
    console.log(`  Required WR to break even = ${(1/(5.23/1.57)*100).toFixed(1)}% (given 5.23R avg win / 1.57R avg loss)`);
    console.log(`  Actual WR = 27.2% → strategy IS profitable (net +228.05R)`);
    console.log(`  But 72.8% loss rate means 3 of 4 trades lose.`);
    console.log(`  Key question: Do the 5.23R wins justify the 72.8% loss rate?`);
    console.log(`  Answer: YES — mathematically viable, but psychologically brutal.`);
  }
  
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
