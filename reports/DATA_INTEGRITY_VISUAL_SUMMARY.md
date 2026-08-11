# Data Integrity Audit — Visual Summary
**Date:** 2026-07-07  
**Quick Reference for Data Pipeline Issues**

---

## Data Pipeline Flow Diagram

```
MT5 Terminal
    │
    ├─→ Export 1m CSV (EURUSD_M1_*.csv)
    │   ├─ Format: DATE\tTIME\tOHLCV\tSPREAD\t...
    │   └─ Timezone: UTC+3 (MT5 default)
    │
    ▼
┌─────────────────────────────────────────────┐
│ STAGE 1: CSV Import                         │
│ File: backfill-candles-from-mt5-csv.js      │
├─────────────────────────────────────────────┤
│ ❌ ISSUE C1: No intra-bar validation        │
│ ❌ ISSUE C2: Decimal precision inference    │
│ ❌ ISSUE C3: Spread assumes 4 or 5 digit    │
│ ❌ ISSUE C4: No OHLC validation             │
│ ⚠️  ISSUE H5: Re-import overwrites silently │
├─────────────────────────────────────────────┤
│ Output: candles_1m table                    │
│   - OHLCV + spread (pips) + digits          │
│   - Timestamp: UTC (offset applied)         │
│   - PK: (symbol, broker, ts)                │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ STAGE 2: Higher-TF Aggregation              │
│ File: regenerate-higher-timeframes.js       │
├─────────────────────────────────────────────┤
│ 5m:    date_trunc('hour') + 5m * floor()    │
│ 15m:   date_trunc('hour') + 15m * floor()   │
│ 1h:    date_trunc('hour')                   │
│ 4h:    date_trunc('day') + 4h * floor()     │
│ 1d:    date_trunc('day')                    │
│ 1d_ny: (ts - 21h) date_trunc + 21h          │
├─────────────────────────────────────────────┤
│ ⚠️  ISSUE H2: Gap detection missing         │
│ ⚠️  ISSUE H4: Volume consolidation risky    │
├─────────────────────────────────────────────┤
│ Output: candles_5m, candles_15m, ... 1d_ny  │
│   - OHLCV + tick_count (no spread/digits)   │
│   - Timestamps: Aligned to TF boundaries    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ STAGE 3: Historical Feature Backfill        │
│ File: backfill-historical-features.js       │
├─────────────────────────────────────────────┤
│ Order: 1d → 4h → 1h → 5m (HTF first)        │
│ Per bar: DAGRunner.run({endTs: bar.ts})     │
├─────────────────────────────────────────────┤
│ ⚠️  ISSUE H3: Lookback inconsistent (500)   │
│ ⚠️  ISSUE H1: Cross-TF alignment unchecked   │
│ ❌ ISSUE C5: Feature TS alignment unchecked │
├─────────────────────────────────────────────┤
│ Output: 20+ feature tables                  │
│   - features_atr, features_zone, etc.       │
│   - One row per symbol/tf/ts                │
│   - TS should be candle close time          │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ STAGE 4: DAG Feature Computation            │
│ File: apps/engine/src/dag/runner.ts         │
├─────────────────────────────────────────────┤
│ For each feature (topological order):       │
│   1. Fetch candles: ts <= endTs (LIMIT 500) │
│   2. Compute output                         │
│   3. Insert to DB                           │
├─────────────────────────────────────────────┤
│ ❌ ISSUE C1: endTs not validated            │
│    ├─ May be intra-bar time                 │
│    ├─ Incomplete candle used                │
│    └─ Lookahead bias introduced             │
│ ⚠️  ISSUE H1: HTF not validated aligned     │
│ ❌ ISSUE C5: Feature TS not validated       │
├─────────────────────────────────────────────┤
│ Output: Computed features with all context  │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ STAGE 5: PIT Backtest Execution             │
│ File: backtest-pit-v2.js                    │
├─────────────────────────────────────────────┤
│ For each bar:                               │
│   1. Query signals at bar time (LATERAL)    │
│   2. Execute entry at next bar open         │
│   3. Track P&L to exit                      │
├─────────────────────────────────────────────┤
│ ✅ CORRECT: LATERAL ensures PIT isolation   │
│ ⚠️  ASSUMES: Features computed at bar closes│
│ ⚠️  ASSUMES: Spreads fixed (not per-bar)    │
├─────────────────────────────────────────────┤
│ Output: Backtest results, trades, P&L       │
└─────────────────────────────────────────────┘
```

---

## Critical Issues Visualization

### Issue C1: Intra-Bar Time Leads to Lookahead Bias

```
15-minute Candle:  14:15:00 ─────────► 14:30:00 (close)
                        │                 │
                   Complete               Complete
                   candle data            OHLCV known
                   gathering              at this point
                        │                 │
                        │
Feature Computation if endTs = 14:30:15 (WRONG):
                        │
                        ├──────────┐
                        │          │
                   Uses 1m candles │
                   including      │
                   14:30-14:31     │
                   (INCOMPLETE!)   │
                        │          │
                   Prices not      │
                   yet closed,     │
                   HIGH/LOW not    │
                   final!          │ ← LOOKAHEAD
                        │          │   BIAS!
                        └──────────┘
                   
Feature Computation if endTs = 14:30:00 (CORRECT):
                        │
                        ├──────────┐
                        │          │
                   Uses only       │
                   complete        │
                   14:00-14:30     │
                   candles         │
                        │          │
                   All data        │
                   closed and      │
                   final           │ ← SAFE
                        │          │
                        └──────────┘
```

**Impact:** Features computed intra-bar will have overfitted backtest results (prices move favorably after signal).

---

### Issue C2 & C3: Spread Precision & Conversion

```
MT5 CSV Export (original):
    XAUUSD (gold)
    SPREAD: 15 points

Current Logic (WRONG):
    digits = inferred from "15" string = 2
    But: if CSV rounds to "1.2300" → "1.23" → inferred as 2 (correct by accident)
    But: if CSV rounds to "1.23" already → inferred as 2 (correct)
    But: for XAUUSD with 2 decimals:
         spreadPointsToPips(15, digits=2) = 15 / 10 = 1.5 pips ← WRONG!
         Should be: 15 / 1 = 15 pips

Fixed Logic:
    standardDigits = STANDARD_DIGITS_BY_SYMBOL["XAUUSD"] = 2
    spreadPointsToPips(15, "XAUUSD") = 15 / 1 = 15 pips ← CORRECT
    (because 2-digit symbols: points = pips, not / 10)

Impact on Trading:
    Entry cost estimated as 1.5 pips
    Actual cost is 15 pips
    Backtest overstates profitability by 10x for gold trades
```

---

### Issue C4: No OHLC Validation

```
Corrupted CSV row:
    EURUSD, 2026.07.07 14:30:00
    Open:   1.2345
    High:   1.2340 ← WRONG! Less than Low
    Low:    1.2350
    Close:  1.2348

Current behavior:
    ✗ No validation
    ✗ Inserted silently
    ✗ Zone detection breaks: top = h=1.2340, bottom = l=1.2350 → top < bottom
    ✗ Pivot detection breaks: can't find swing point

With Fix:
    ✗ Detected: high (1.2340) < low (1.2350)
    ✓ Row skipped with warning
    ✓ Feature computation remains safe
```

---

### Issue C5: Feature Timestamp Misalignment

```
Feature Computed for EURUSD 15m:
    ✓ Correct: ts = 2026-07-07 14:30:00 (valid 15m close)
    
    ✗ Wrong: ts = 2026-07-07 14:30:15 (not a valid close!)
    
    ✗ Wrong: ts = 2026-07-07 14:31:00 (5m close, not 15m close!)

PIT Backtest Query:
    SELECT * FROM features_zone 
    WHERE ts = 14:30:15
    
    ✗ Query returns nothing → signal not triggered
    ✗ Backtest results differ from live

Fix:
    Before INSERT, validate:
        SELECT ts FROM candles_15m 
        WHERE symbol='EURUSD' AND ts='2026-07-07 14:30:15'
        
    If empty → reject feature row with error
```

---

## Issue Severity Heatmap

```
┌──────────────────────────┬──────────┬────────────┐
│ Issue                    │ Severity │ Likelihood │
├──────────────────────────┼──────────┼────────────┤
│ C1: Intra-bar validation │ 🔴 HIGH  │ MEDIUM     │
│ C2: Decimal precision    │ 🔴 HIGH  │ MEDIUM     │
│ C3: Spread conversion    │ 🔴 HIGH  │ HIGH       │
│ C4: OHLC validation      │ 🔴 HIGH  │ LOW        │
│ C5: Feature TS align     │ 🔴 HIGH  │ MEDIUM     │
├──────────────────────────┼──────────┼────────────┤
│ H1: Cross-TF alignment   │ 🟡 MED   │ MEDIUM     │
│ H2: Gap detection        │ 🟡 MED   │ LOW        │
│ H3: Lookback inconsist.  │ 🟡 MED   │ MEDIUM     │
│ H4: Volume consolidation │ 🟡 MED   │ LOW        │
│ H5: Re-import overwrites  │ 🟡 MED   │ MEDIUM     │
├──────────────────────────┼──────────┼────────────┤
│ L1: Documentation        │ 🟢 LOW   │ LOW        │
│ L2: Spread window size   │ 🟢 LOW   │ LOW        │
└──────────────────────────┴──────────┴────────────┘

Likelihood = How often this would be encountered in practice
```

---

## Fix Priority Matrix

```
High Impact / Low Effort (Do First):
    ☑️ C1: endTs validation (2h) → prevents lookahead
    ☑️ C4: OHLC validation (1h) → prevents corruption
    ☑️ C5: Feature TS validation (2h) → ensures alignment

High Impact / Medium Effort (Do Next):
    ☑️ C3: Spread conversion (3h) → fixes gold/commodities
    ☑️ C2: Decimal precision (2h) → fixes pip calculations

Medium Impact / Low Effort (Do Later):
    ☑️ H1: Cross-TF alignment (2h)
    ☑️ H3: Lookback standardization (1h)

Medium Impact / Medium Effort (Schedule):
    ☑️ H2: Gap detection (3h)
    ☑️ H4: Volume verification (2h)
    ☑️ H5: Import timestamp tracking (2h)
```

---

## Recommended Testing Plan

### Test 1: Detect Lookahead Bias (C1)
```sql
-- Create intentionally wrong feature
INSERT INTO features_zone (symbol, tf, ts, ...)
VALUES ('EURUSD', '15m', '2026-07-07 14:30:15', ...)
-- During candle 14:30-14:45, at 14:30:15

-- Should fail after fix:
-- Error: ts 2026-07-07 14:30:15 is not a valid candle close for EURUSD 15m
```

### Test 2: Reject Corrupted Candles (C4)
```bash
# Create bad candle where h < l
# Import should warn and skip
node scripts/backfill-candles-from-mt5-csv.js ./bad.csv --tz-offset-minutes=180
# Expected: "[CSV] Invalid OHLC at line 5: EURUSD 2026-07-07 14:30:00 - skipped"
```

### Test 3: Verify Spread Conversion (C3)
```sql
-- XAUUSD with 15 pips spread
INSERT INTO candles_1m VALUES 
  ('XAUUSD', '2026-07-07 14:30:00', ..., 15, 2)

-- After import with fix:
SELECT spread FROM candles_1m WHERE symbol='XAUUSD'
-- Should show: spread=15 pips (not 1.5)
```

### Test 4: Feature Timestamp Validation (C5)
```sql
-- Insert feature at wrong time
INSERT INTO features_zone (symbol, tf, ts, ...) 
VALUES ('EURUSD', '15m', '2026-07-07 14:31:00', ...)

-- Should be rejected: 14:31:00 is not a 15m close
```

---

## Post-Fix Verification Checklist

```
After deploying all fixes:

Data Import Phase:
  ☐ Import test CSV with 100 rows
  ☐ Verify all rows pass OHLC validation
  ☐ Verify spreads converted correctly per symbol
  ☐ Verify timestamps in UTC
  
Feature Computation Phase:
  ☐ Compute features for one bar
  ☐ Verify endTs is valid candle close
  ☐ Verify all features have aligned timestamps
  ☐ Verify no lookahead in features
  
Backtest Phase:
  ☐ Run backtest on test symbol
  ☐ Verify results reproducible (same seed → same P&L)
  ☐ Verify spread costs match actual data
  ☐ Verify no overnight gaps in live backtest
  
Validation Phase:
  ☐ Run post-import validation script
  ☐ Verify ✅ All checks passed
  ☐ Schedule hourly validation job
  ☐ Verify no gaps or anomalies detected
```

---

## Files to Review / Modify

```
Priority 1 (Critical):
  📝 apps/engine/src/dag/runner.ts          (validateEndTs)
  📝 scripts/backfill-candles-from-mt5-csv.js (OHLC validation, spread fix)
  📝 apps/engine/src/dag/runner.ts          (feature TS validation)

Priority 2 (High):
  📝 scripts/validate-candles-post-import.js (NEW - comprehensive checks)
  📝 scripts/regenerate-higher-timeframes.js (add gap detection)

Supporting Docs:
  📖 DATA_INTEGRITY_AUDIT_2026-07-07.md      (full analysis)
  📖 DATA_INTEGRITY_REMEDIATION_CHECKLIST.md (task breakdown)
  📖 README.md                               (add CSV format doc)
```

---

**Summary:** 5 critical issues identified, all fixable in 15-20 hours of development. 
Post-fix, data pipeline will be **production-safe** for backtesting and live trading.
