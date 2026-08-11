# Data Integrity Audit — tradzfx-v2 Data Pipeline
**Report Date:** 2026-07-07  
**Auditor:** Copilot  
**Scope:** Complete data pipeline from MT5 CSV import through PIT backtest feature computation

---

## Executive Summary

The tradzfx-v2 data pipeline consists of 5 major stages:

1. **Candle Import** — MT5 CSV → `candles_1m` (raw OHLCV + spread + digits)
2. **Higher-Timeframe Aggregation** — `candles_1m` → `candles_5m/15m/1h/4h/1d_utc/1d_ny`
3. **Feature Generation** — DAGRunner computes 20+ features in topological order
4. **Historical Backfill** — Bulk compute all bars for all symbols (with HTF → LTF order)
5. **PIT Backtest** — LATERAL queries ensure per-bar isolation from future data

**Overall Assessment:** The pipeline exhibits **good architectural isolation** but has several **precision, timezone, and lookahead risks** that should be remediated.

---

## 1. Candle Import & Storage

### 1.1 MT5 CSV Import Process
**Location:** `scripts/backfill-candles-from-mt5-csv.js`

#### Parsing Logic
```javascript
function parseDateTime(dateStr, timeStr, offsetMinutes) {
  const [y, m, d] = dateStr.split(".").map(Number);
  const [H, M, S] = timeStr.split(":").map(Number);
  const localMs = Date.UTC(y, m - 1, d, H, M, S);
  return new Date(localMs - offsetMinutes * 60000);
}
```

**Issues:**
- ✅ **CORRECT** — MT5 timestamps are parsed as local time, then offset is subtracted to convert to UTC.
- ✅ **CORRECT** — Default `tzOffsetMinutes=180` (UTC+3) matches MT5 terminal default timezone.

#### CSV Format Expected
```
<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>
e.g., 2026.07.07\t14:30:45\t1.2345\t1.2350\t1.2340\t1.2348\t100\t5000\t15
```

**Precision Handling:**
```javascript
function countDecimals(value) {
  const s = String(value);
  const idx = s.indexOf(".");
  return idx < 0 ? 0 : s.length - idx - 1;
}

function inferDigits(o, h, l, c) {
  return Math.max(countDecimals(o), countDecimals(h), countDecimals(l), countDecimals(c));
}
```

**Issues:**
- ✅ **CORRECT** — Infers decimal places from OHLC values.
- ⚠️ **PRECISION RISK** — Decimal inference only from visible decimal places in CSV string representation. If CSV has trailing zeros stripped, may undercount.
- **Example:** `1.2300` stored as `1.23` → inferred as 2 decimals instead of 4.

#### Spread Conversion
```javascript
function spreadPointsToPips(spreadPoints, digits) {
  if (!Number.isFinite(spreadPoints) || spreadPoints <= 0) return 0;
  if (digits === 4) return spreadPoints;          // 4-digit: 1pt = 1pip
  return spreadPoints / 10;                        // 5-digit: 10pts = 1pip
}
```

**Issues:**
- ✅ **CORRECT** — Handles the standard pip/point conversion.
- ⚠️ **LIMITATION** — Treats only 4-digit vs. non-4-digit. Does not account for gold/commodities (e.g., XAUUSD is typically 2-decimal).
- 🚨 **SEVERITY: MEDIUM** — If XAUUSD is 2-digit, spreads stored 10x too large.

#### Volume & Bid/Ask
```javascript
const v = colIndex.vol >= 0 ? parseInt(parts[colIndex.vol], 10) || 0 : parseInt(parts[colIndex.tickvol], 10) || 0;
```

**Issues:**
- ✅ **CORRECT** — Handles both tick volume and real volume, falls back to tickvol.
- ✅ **CORRECT** — MT5 CSV only exports bid/ask as spread; actual OHLC is midpoint (or bid, depending on MT5 export mode).
- ⚠️ **ASSUMPTION** — No explicit documentation whether OHLC is bid or mid. Typically MT5 exports bid prices.

#### Database Insert
```javascript
const sql = `
  INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, broker, digits, spread)
  VALUES (...)
  ON CONFLICT (symbol, broker, ts) DO UPDATE SET
    o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c,
    v = EXCLUDED.v, broker = EXCLUDED.broker, digits = EXCLUDED.digits, spread = EXCLUDED.spread
`;
```

**Issues:**
- ✅ **CORRECT** — ON CONFLICT upsert allows re-import of corrected data.
- ⚠️ **DEDUPLICATION RISK** — If the same 1m candle is imported twice with different spreads, the later import overwrites. No validation that the new data is actually newer/better.

### 1.2 Data Quality Checks

**Suggested Validations (MISSING):**
```sql
-- Check for OHLC ordering violations (High < Low is invalid)
SELECT symbol, ts FROM candles_1m 
WHERE h < l 
LIMIT 10;

-- Check for gaps in 1m candles (missing 60 seconds)
SELECT symbol, ts, 
       LEAD(ts) OVER (PARTITION BY symbol ORDER BY ts) - ts as gap
FROM candles_1m
WHERE (LEAD(ts) OVER (PARTITION BY symbol ORDER BY ts) - ts) 
      > interval '1 minute'
LIMIT 10;

-- Check for duplicate timestamps per symbol
SELECT symbol, ts, COUNT(*) 
FROM candles_1m 
GROUP BY symbol, ts 
HAVING COUNT(*) > 1;
```

**Issues:**
- 🚨 **NO VALIDATION** — The import script does not validate OHLC ordering, gap detection, or duplicates.
- 🚨 **SEVERITY: HIGH** — Corrupted candles (h < l, zero volume) would silently persist.

---

## 2. Higher-Timeframe Aggregation

### 2.1 Aggregation SQL
**Location:** `scripts/regenerate-higher-timeframes.js`

#### Example for 5m Candles
```javascript
const TIMEFRAMES = [
  {
    name: "5m",
    table: "candles_5m",
    labelSql: "date_trunc('hour', ts) + interval '5 min' * floor(extract(minute from ts) / 5)",
  },
  {
    name: "1d_ny",
    table: "candles_1d_ny",
    labelSql: "date_trunc('day', ts - interval '21 hours') + interval '21 hours'",
  },
];
```

#### Aggregation Query
```sql
WITH labeled AS (
  SELECT
    <labelSql> AS ts_label,
    o, h, l, c, v,
    row_number() OVER (PARTITION BY <labelSql> ORDER BY ts ASC) AS rn_asc,
    row_number() OVER (PARTITION BY <labelSql> ORDER BY ts DESC) AS rn_desc
  FROM candles_1m
  WHERE symbol = $1
)
SELECT
  $1 AS symbol,
  ts_label,
  MIN(CASE WHEN rn_asc = 1 THEN o END) AS o,
  MAX(h) AS h,
  MIN(l) AS l,
  MIN(CASE WHEN rn_desc = 1 THEN c END) AS c,
  COALESCE(SUM(v), 0) AS v,
  COUNT(*) AS tick_count
FROM labeled
GROUP BY ts_label
ORDER BY ts_label
```

**Issues:**
- ✅ **CORRECT OHLC SELECTION** — Uses first candle's open, last candle's close, max high, min low.
- ✅ **CORRECT TIMEZONE HANDLING** — NY daily uses `ts - interval '21 hours'` to shift 21:00 UTC = 17:00 ET.
- ⚠️ **NO VOLUME CONSOLIDATION** — Volume is summed, which is correct for tick count but does not account for missing ticks.
- ⚠️ **NO WEEKEND/SESSION FILTERING** — If Monday has 500 candles and Friday is missing, Saturday is blank. No detection of market-hours disruption.

#### Candle Alignment Verification
**Location:** `scripts/verify-higher-timeframes.js`

```javascript
function labelForTF(ts, tf) {
  if (tf.minutes === 60) {
    return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate(), 
                            ts.getUTCHours(), 0, 0, 0));
  }
  if (tf.minutes === 240) {  // 4h
    return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate(), 
                            Math.floor(ts.getUTCHours() / 4) * 4, 0, 0, 0));
  }
}
```

**Issues:**
- ✅ **CORRECT ALIGNMENT** — Hourly candles start at :00, 4h candles at 00:00, 04:00, 08:00, etc. UTC.
- ✅ **CORRECT VERIFICATION** — `verify-higher-timeframes.js` compares regenerated candles vs. DB to detect divergence.

---

## 3. Feature Generation

### 3.1 DAG Runner Architecture
**Location:** `apps/engine/src/dag/runner.ts`

#### Candle Fetching (CRITICAL FOR LOOKAHEAD)
```typescript
private async fetchCandles(
  symbol: string,
  tf: TimeFrame,
  endTs: Date,
  count: number
): Promise<Candle[]> {
  const { rows } = await this.pool.query(
    `SELECT symbol, ts, o, h, l, c, v
     FROM ${table}
     WHERE symbol = $1 AND ts <= $2    // ← KEY: ts <= endTs (not <)
     ORDER BY ts DESC
     LIMIT $3`,
    [symbol, endTs, count]
  );
  
  const candles = rows.map(...).reverse();  // reverse to ascending order
  return candles;
}
```

**Issues:**
- ✅ **CORRECT** — Query uses `ts <= $2` (endTs inclusive), so the "current" candle is included.
- ✅ **CORRECT** — Reversed to ascending order so candles are chronologically ordered.
- ⚠️ **LOOKAHEAD RISK DETECTED** — If `endTs` is a candle close time AND the feature computes from the current candle BEFORE it closes, there is lookahead bias.

#### Example: Zone Detection
**Location:** `apps/engine/src/features/zone.ts`

```typescript
export interface ZoneInput {
  candles: Candle[];  // includes all candles up to endTs
  features_pivot: PivotOutput;
  features_atr: AtrOutput;
  features_htf_bias: HtfBiasOutput;
}

function detectZones(candles: Candle[]): ZoneOutput["zones"] {
  // Iterates through ALL candles, including the last one (endTs candle)
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    // Zone logic uses c.h, c.l, c.c — ALL of which are known at the endTs candle's close.
    const zone = { top: c.h, bottom: c.l, ... };
  }
}
```

**Issues:**
- ✅ **CORRECT FOR CLOSED CANDLES** — If `endTs` is the close of the last candle (e.g., 14:30:00 for a 15m candle), the candle is complete.
- 🚨 **LOOKAHEAD IF OPEN** — If `endTs` is before the candle close (e.g., 14:30:15 during the candle), using the candle's OHLC is lookahead.
- ⚠️ **NO GUARD** — The runner does NOT validate that `endTs` is exactly a candle close time. If called at 14:30:15 on a 15m chart, it would use the incomplete candle.

#### HTF Bias Fetching
**Location:** `apps/engine/src/features/htfBias.ts`

```typescript
export interface HtfBiasInput {
  candles: Candle[];                     // LTF candles up to endTs
  higherTfCandles?: Record<TimeFrame, Candle[]>;  // HTF candles
}

function computeRawNodes(
  featureTf: TimeFrame,
  higherTfCandles: Record<TimeFrame, Candle[]> | undefined,
  weights: Record<TimeFrame, number>
): RawNode[] {
  for (const tf of tfs) {
    const candles = higherTfCandles?.[tf];
    const swing = candles && candles.length > 0 ? detectSwingBreak(candles) : null;
    // swing is from the LAST candle in higherTfCandles
  }
}

function detectSwingBreak(candles: Candle[]): SwingBreak | null {
  if (candles.length < 20) return null;
  const lookback = 10;
  const current = candles[candles.length - 1];  // last candle in array
  const prior = candles.slice(-lookback - 1, -1);
  
  if (current.c > Math.max(...prior.map((c) => c.h))) {
    return { direction: "bullish", level: highest, eventType: "bos", ts: current.ts };
  }
}
```

**Issues:**
- ✅ **SAME INTEGRITY** — HTF candles are also fetched with `ts <= endTs`, so the HTF "current" candle is included.
- 🚨 **LOOKAHEAD IF ENDTS IS INTRA-CANDLE** — If `endTs` is 4h 14:30 (30 minutes into a 1h candle), the 1h candle is incomplete, but HTF bias would use it for the 4h analysis.
- ⚠️ **NO CROSS-TF ALIGNMENT** — Runner does not validate that `endTs` aligns to multiple timeframes simultaneously. E.g., if `endTs` is not an hour boundary, the 1h candle is incomplete.

### 3.2 Feature Computation Order (Topological Sort)
**Location:** `apps/engine/src/dag/graph.ts`

```typescript
export class FeatureDAG {
  register(feature: FeatureDefinition<any, any>) {
    this.features.set(feature.name, feature);
    // Build dependency graph
  }

  sort(symbol: string, tf: TimeFrame, requested: string[]): FeatureDefinition<any, any>[] {
    // Topological sort: ensures atr is computed before structure (which depends on atr)
    // Does NOT sort by timeframe (HTF before LTF)
  }
}
```

**Issues:**
- ✅ **CORRECT** — Topological sort ensures dependencies are computed first.
- 🚨 **NO HTF-BEFORE-LTF ORDER** — The DAG does not enforce that higher-timeframe features are computed before lower-timeframe features. If HTF bias needs 4h candles but 4h features haven't been computed, they may be missing.
- ✅ **MITIGATED** — Historical backfill script explicitly iterates TFs in order: `DEFAULT_TFS = ["1d", "4h", "1h", "5m"]`, so HTF is computed first during backfill.

### 3.3 Feature-Specific Lookahead Analysis

#### Zone Detection
**Location:** `apps/engine/src/features/zone.ts`

```typescript
function classifyFormation(
  zoneKind: "supply" | "demand" | "fvg" | "breaker",
  candle: Candle,
  prev: Candle | undefined
): Formation {
  const range = candle.h - candle.l;
  const bodyPct = range > 0 ? Math.abs(candle.c - candle.o) / range : 0;
  // ... logic uses complete OHLC from both current and prior candle
}
```

**Issues:**
- ✅ **SAFE** — If zones are only emitted AFTER a candle closes (endTs is the close time), no lookahead.
- 🚨 **RISK** — Zones use prior candle for context. If called intra-bar on the prior candle, intra-bar prices leak.

#### Structure Events (BOS, MSS, CHoCH)
**Location:** `apps/engine/src/features/structure.ts`

```typescript
function detectBreakEvents(candles: Candle[], pivots: PivotOutput["pivots"]): RawBreakEvent[] {
  const sorted = [...pivots].sort(...);
  let lastHigh = sorted.find((p) => p.kind === "high");

  for (let i = 1; i < sorted.length; i++) {
    const pivot = sorted[i];
    if (pivot.kind === "high" && lastHigh && pivot.price > lastHigh.price) {
      const breakCandle = findFirstCandle(
        candles,
        lastHigh.ts,
        pivot.ts,
        (c) => c.c > lastHigh!.price
      );
      // breakCandle is the first candle whose close is above lastHigh
    }
  }
}

function findFirstCandle(
  candles: Candle[],
  startTs: Date,
  endTs: Date | undefined,
  predicate: (c: Candle) => boolean
): Candle | undefined {
  for (const c of candles) {
    if (c.ts.getTime() < startTs.getTime()) continue;
    if (endTs && c.ts.getTime() > endTs.getTime()) break;  // ← prevents future candles
    if (predicate(c)) return c;
  }
  return undefined;
}
```

**Issues:**
- ✅ **SAFE** — `findFirstCandle` enforces `endTs` boundary, so no future candles are used.
- ✅ **CORRECT** — BOS is only confirmed after a candle closes beyond the level.

#### Sweep Detection
**Location:** `apps/engine/src/features/sweep.ts`

```typescript
function hasPrecedingStructureEvent(
  events: StructureOutput["events"],
  candles: Candle[],
  sweepIdx: number
): boolean {
  const startIdx = Math.max(0, sweepIdx - STRUCTURE_LOOKBACK_BARS);  // 10 bars
  const startTs = candles[startIdx]?.ts;
  const sweepTs = candles[sweepIdx]?.ts;
  
  return events.some(
    (e) =>
      VALID_STRUCTURE_EVENTS.has(e.eventType) &&
      e.ts >= startTs &&
      e.ts <= sweepTs
  );
}
```

**Issues:**
- ✅ **SAFE** — Only looks back 10 bars, no future reference.
- ⚠️ **CONTEXT RISK** — If sweep is detected on the last candle (intra-bar) before it closes, the structure event check could use an intra-bar price.

### 3.4 Summary: Lookahead Risk Assessment

| Feature | Risk | Severity | Mitigation |
|---------|------|----------|-----------|
| **Zone** | Uses complete OHLC; if endTs is intra-bar, lookahead | HIGH | Ensure endTs is candle close time |
| **Structure** | Same as zone | HIGH | Same |
| **HTF Bias** | Uses incomplete HTF candle if endTs not aligned | MEDIUM | Align endTs to LCM of all TFs |
| **Sweep** | Lookback window is safe, but inducement confirmation may look forward | MEDIUM | Ensure endTs guard |
| **Pricing** | Computes from current candle only; safe | LOW | — |
| **Displacement** | Checks displacement ratio from candles up to endTs; safe | LOW | — |

---

## 4. Historical Feature Backfill

### 4.1 Backfill Execution Order
**Location:** `scripts/backfill-historical-features.js`

```javascript
const DEFAULT_TFS = ["1d", "4h", "1h", "5m"];

async function backfillSymbolTf(symbol, tf, requestedFeatures, startTs, endTs) {
  const timestamps = await getBarTimestamps(symbol, tf, startTs, endTs);
  
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    await runner.run({
      symbol,
      tf,
      endTs: ts,  // ← Process each bar individually
      requestedFeatures,
      lookbackBars: 500,
      skipCache: true,
      batchInserts: true,
    });
  }
}

async function main() {
  const tfs = tfsArg ? tfsArg.split(",") : DEFAULT_TFS;
  
  for (const tf of tfs) {  // ← Outer loop: process TFs in order (HTF first)
    const result = await backfillSymbolTf(symbol, tf, requestedFeatures, startTs, endTs);
  }
}
```

**Issues:**
- ✅ **CORRECT ORDER** — TFs processed high-to-low (1d → 4h → 1h → 5m), so HTF context is available for LTF features.
- ✅ **CORRECT ISOLATION** — Each bar processes features only up to that bar's close time.
- ⚠️ **LOOKBACK WINDOW** — `lookbackBars: 500` means 500 bars of history are fetched. For 1d, that's ~2 years. For 5m, ~3 days. Inconsistent lookback depth may cause feature variance across TFs.

### 4.2 Zone Outcome Recording
**Location:** `scripts/backfill-historical-features.js`

```javascript
const ZONE_BACKFILL_SKIP_OUTCOMES = process.env.ZONE_BACKFILL_SKIP_OUTCOMES === "1";
```

**Issues:**
- ✅ **ALLOWS SKIPPING** — Can skip zone outcome recording to speed up backfill, then run outcomes separately.
- ⚠️ **TWO-PASS BACKFILL** — If outcomes are skipped and later backfilled separately, zone quality scores computed from incomplete outcome data may be unreliable initially.

---

## 5. PIT Backtest Feature Generation

### 5.1 PIT SQL Structure
**Location:** `scripts/backtest-pit-v2.js`

#### Signal Query Example
```sql
SELECT COUNT(*) as signal_count
FROM features_zone f
LATERAL (
  SELECT 1 FROM candles_1m c
  WHERE c.symbol = f.symbol AND c.ts <= f.ts
  ORDER BY c.ts DESC LIMIT 1
) AS latest_candle
WHERE f.symbol = $1 AND f.tf = $2 AND f.ts <= $3  -- ← LATERAL ensures point-in-time
  AND f.direction = 'bullish'
  AND f.zone_kind IN ('supply', 'demand')
GROUP BY f.ts;
```

**Issues:**
- ✅ **CORRECT PIT ISOLATION** — LATERAL JOIN ensures only features available at time T are queried.
- ✅ **CORRECT** — Features are filtered by `f.ts <= $3`, preventing future signals.
- ⚠️ **ASSUMPTION** — Assumes feature `ts` = bar close time. If features are computed intra-bar, this breaks.

#### Entry/SL/TP SQL Compilation
```javascript
function buildEntryPriceSql(entry_type, entry_price_expr) {
  if (entry_type === "market") {
    return `(SELECT c.o FROM candles_1m c WHERE ... ORDER BY c.ts DESC LIMIT 1)`;
  }
  if (entry_type === "limit") {
    return entry_price_expr;  // e.g., user-defined price
  }
}
```

**Issues:**
- ✅ **CORRECT** — Market orders use next candle open, which is known at the signal bar close.
- ⚠️ **SLIPPAGE ASSUMPTION** — Does not model actual fill slippage. Uses hard-coded assumptions or average spreads.

### 5.2 Data Availability Timeline (Visual)

```
Signal Bar:           14:30:00 - 14:35:00
├─ Open:              14:30:00 ✓ known
├─ High:              14:30:XX ✓ known at bar close
├─ Low:               14:30:XX ✓ known at bar close
├─ Close:             14:35:00 ✓ known
├─ Volume:            14:35:00 ✓ known
└─ Signal Computed:   14:35:00 ✓ at close

Entry Bar:            14:35:00 - 14:40:00
├─ Open:              14:35:00 ✓ known at signal bar close
├─ High:              14:35:XX ? unknown
├─ Low:               14:35:XX ? unknown
├─ Close:             14:40:00 ? unknown
└─ Entry Executed:    14:35:XX ✓ at open (market) or limit price

Exit Conditions:      14:35:XX onwards
├─ Take Profit:       triggered when price >= TP
├─ Stop Loss:         triggered when price <= SL
└─ Time Stop:         triggered after N candles
```

**Issues:**
- ✅ **CORRECT** — Entry is filled at entry bar's OPEN, which is the first known price.
- ⚠️ **SPREAD ASSUMPTION** — Entry price = Open ± spread/2 (hard-coded assumption, not per-bar).
- ⚠️ **SLIPPAGE ASSUMPTION** — Fixed slippage model, does not account for market impact.

---

## 6. Data Quality Sanity Checks

### 6.1 Implemented Checks

#### Candle Ordering
✅ **Implemented in:** `verify-higher-timeframes.js`
```javascript
for (const [key, b] of buckets) {
  const e = existingMap.get(key);
  if (!e) missing++;
  if (b.o === e.o && b.h === e.h && b.l === e.l && b.c === e.c) exact++;
  else mismatch++;
}
```

**Coverage:** Compares regenerated vs. stored candles, detects divergence.

#### Feature Cache Integrity
✅ **Implemented in:** `apps/engine/src/dag/cache.ts`
```typescript
async get(featureName: string, inputHash: string): Promise<Output | null>
async set(featureName: string, inputHash: string, output: Output, outputHash: string): Promise<void>
```

**Coverage:** Content-addressed caching prevents recomputation if input hasn't changed.

### 6.2 Missing Checks

🚨 **OHLC Ordering Validation** (NOT IMPLEMENTED)
```sql
-- Should validate that High >= Open, High >= Close, High >= Low
SELECT symbol, ts FROM candles_1m WHERE h < l OR h < o OR h < c ORDER BY ts DESC LIMIT 10;
```

🚨 **Candle Gap Detection** (NOT IMPLEMENTED)
```sql
-- Should detect missing 1m candles (except weekends)
SELECT symbol, ts, LEAD(ts) OVER (PARTITION BY symbol ORDER BY ts) - ts as gap
FROM candles_1m
WHERE (LEAD(ts) OVER (PARTITION BY symbol ORDER BY ts) - ts) > interval '1 minute 30 seconds'
  AND NOT (EXTRACT(DOW FROM ts) = 5 AND EXTRACT(HOUR FROM ts) > 20)  -- exclude Fri 20:00+
LIMIT 10;
```

🚨 **Feature Timestamp Alignment** (NOT IMPLEMENTED)
```sql
-- Should validate that feature timestamps are candle close times
SELECT symbol, tf, ts, COUNT(*) cnt 
FROM features_zone 
WHERE NOT EXISTS (
  SELECT 1 FROM candles_1m c 
  WHERE c.symbol = features_zone.symbol 
    AND c.ts = features_zone.ts
)
GROUP BY symbol, tf, ts
LIMIT 10;
```

🚨 **Cross-Symbol Contamination** (NOT IMPLEMENTED)
```sql
-- Should detect if features computed at symbol X appear in symbol Y data
SELECT * FROM features_zone 
WHERE symbol NOT IN (SELECT DISTINCT symbol FROM candles_1m)
LIMIT 10;
```

---

## 7. Identified Issues & Severity Assessment

### 🚨 CRITICAL (High Risk, Immediate Action Required)

#### Issue C1: No Intra-Bar Endtime Validation
**Location:** `apps/engine/src/dag/runner.ts` (fetchCandles)  
**Description:** Features are computed with `endTs` but there is no validation that `endTs` is a candle close time. If called at 14:30:15 during a 15m candle that closes at 14:45:00, the incomplete candle will be used, introducing lookahead bias.

**Impact:** 
- Backtest results could be overfitted (prices move favorably after signal).
- Live trading could enter based on incomplete candle data.
- Feature distributions may not match reality.

**Remediation:**
```typescript
// Add guard in buildInput()
const table = getCandleTableForTf(opts.tf);
const { rows } = await this.pool.query(
  `SELECT ts FROM ${table} WHERE symbol = $1 AND ts = $2`,
  [opts.symbol, opts.endTs]
);
if (rows.length === 0) {
  throw new Error(`endTs ${opts.endTs} is not a valid candle close for ${opts.symbol} ${opts.tf}`);
}
```

**Severity:** 🚨 **HIGH** — Potential for systemic lookahead bias across all features.

---

#### Issue C2: Decimal Precision Inference from CSV String
**Location:** `scripts/backfill-candles-from-mt5-csv.js` (countDecimals)  
**Description:** Decimals are inferred from the CSV string representation. If the CSV has trailing zeros stripped (e.g., `1.2300` → `1.23`), the digits count will be wrong.

**Impact:**
- Spread conversion will be incorrect (4-digit vs. 5-digit distinction lost).
- Features that depend on pip/point scaling will be wrong.
- XAUUSD spreads likely 10x too large (2-digit but treated as 4-digit).

**Remediation:**
```javascript
// Store the raw CSV row and infer digits from formatting rules, not string length
// E.g., EURUSD is always 4-digit, GOLD is always 2-digit
const STANDARD_DIGITS = {
  "EURUSD": 4, "GBPUSD": 4, "NZDUSD": 4, "AUDUSD": 4,
  "XAUUSD": 2, "XAGUSD": 3, "XPTUSD": 2,
};
const digits = STANDARD_DIGITS[symbol] || inferDigits(o, h, l, c);
```

**Severity:** 🚨 **HIGH** — Impacts spread modeling and pip calculations.

---

#### Issue C3: Spread Conversion Assumes 4-Digit or 5-Digit
**Location:** `scripts/backfill-candles-from-mt5-csv.js` (spreadPointsToPips)  
**Description:** Only handles 4-digit (points = pips) and non-4-digit (points / 10 = pips). Does not handle gold (2-digit), commodities (3-digit), or other non-standard pairs.

**Impact:**
- XAUUSD spreads stored 10x too large (2-digit should be points = pips, not points / 10).
- Spread gate in backtest will be miscalibrated.
- Trading costs underestimated for non-standard pairs.

**Remediation:**
```javascript
function spreadPointsToPips(spreadPoints, symbol) {
  const digitMap = {
    4: 1,     // 1 point = 1 pip
    5: 0.1,   // 10 points = 1 pip
    2: 1,     // GOLD: 1 point = 1 pip
    3: 1,     // SILVER: 1 point = 1 pip
  };
  const digitsForSymbol = STANDARD_DIGITS[symbol] ?? 5;
  return spreadPoints * (digitMap[digitsForSymbol] ?? 0.1);
}
```

**Severity:** 🚨 **HIGH** — Especially critical if gold/commodities are backtested.

---

#### Issue C4: No OHLC Validation on Import
**Location:** `scripts/backfill-candles-from-mt5-csv.js`  
**Description:** CSV import does not validate that High >= Low, High >= Open, High >= Close, Low <= Open, Low <= Close. Corrupted candles silently persist.

**Impact:**
- Corrupted candles break zone detection (can't compute top/bottom).
- Pivot detection fails (can't identify swing points).
- Backtest results invalid.

**Remediation:**
```javascript
const rows = [];
for (let i = 1; i < lines.length; i++) {
  // ... parse row ...
  
  // Validate OHLC ordering
  if (h < l || h < o || h < c || l > o || l > c) {
    console.warn(`[CSV] Invalid OHLC at line ${i}: ${symbol} ${ts.toISOString()}`);
    continue;  // Skip corrupted candle
  }
  rows.push({ ts, o, h, l, c, v, spread, digits });
}
```

**Severity:** 🚨 **HIGH** — Data corruption without warning.

---

#### Issue C5: Feature TS Alignment Not Validated
**Location:** `apps/engine/src/dag/runner.ts`  
**Description:** Features are stored with `ts` field, but there is no requirement that `ts` matches a candle close time. Features may be computed/stored with misaligned timestamps.

**Impact:**
- PIT backtest query assumes feature.ts is a valid bar time; misaligned features cause SQL errors or missing signals.
- Historical backfill may produce features at wrong timestamps.

**Remediation:**
```typescript
private async insertRows(tableName: string, rows: Record<string, unknown>[]): Promise<void> {
  for (const row of rows) {
    if (row.ts && row.symbol && row.tf) {
      const candle = await this.pool.query(
        `SELECT ts FROM ${getCandleTableForTf(row.tf as TimeFrame)} 
         WHERE symbol = $1 AND ts = $2`,
        [row.symbol, row.ts]
      );
      if (candle.rowCount === 0) {
        throw new Error(`Feature ts ${row.ts} not a candle close for ${row.symbol} ${row.tf}`);
      }
    }
  }
  // ... continue with insert ...
}
```

**Severity:** 🚨 **HIGH** — Silent feature misalignment causes subtle bugs.

---

### ⚠️ HIGH (Medium Risk, Should Fix)

#### Issue H1: No Cross-TimeFrame Alignment Validation
**Location:** `apps/engine/src/dag/runner.ts`  
**Description:** If `endTs` is 14:30:15, it may be a valid 5m close but not a 1h close. HTF features will use incomplete candles.

**Impact:**
- HTF bias computed from incomplete 1h/4h/1d candles.
- Less severe than C1 because HtfBias only uses candle closes for swing detection, but still inaccurate.

**Remediation:**
```typescript
const lcmSeconds = lcm(tf, feature.referenceTimeFrames);
const alignedEndTs = new Date(Math.floor(opts.endTs.getTime() / lcmSeconds) * lcmSeconds);
if (alignedEndTs.getTime() !== opts.endTs.getTime()) {
  throw new Error(`endTs ${opts.endTs} not aligned to all TFs in closure`);
}
```

**Severity:** ⚠️ **MEDIUM** — HTF bias may be slightly inaccurate.

---

#### Issue H2: Candle Gaps & Weekend Handling Not Detected
**Location:** `scripts/regenerate-higher-timeframes.js`  
**Description:** Candle aggregation does not account for missing candles (gaps, weekends, market closures). If Friday 16:00 UTC is missing, Saturday candle will be empty or merged into Monday.

**Impact:**
- Backtest gap between Friday and Monday not detected; entries may look like intraday continuation.
- Zone/structure features may span weekend gaps.

**Remediation:**
```sql
-- After aggregation, insert gap markers or reject bars with < expected tick_count
INSERT INTO candles_4h (symbol, ts, gap_flag)
SELECT symbol, ts, 1 FROM (
  SELECT symbol, ts, COUNT(*) cnt FROM candles_1m
  GROUP BY symbol, ts
) WHERE cnt < 240 - 1  -- 4h = 240 minutes, allow 1-min tolerance
```

**Severity:** ⚠️ **MEDIUM** — Causes gap-spanning signals that wouldn't exist in live trading.

---

#### Issue H3: Lookback Window Inconsistent Across TFs
**Location:** `scripts/backfill-historical-features.js`  
**Description:** `lookbackBars: 500` is applied uniformly, but 500 bars of 1d is ~2 years, while 500 bars of 5m is ~3 days. Feature distributions will be unstable.

**Impact:**
- Zone outcomes learned from 2 years of 1d data but only 3 days of 5m data.
- Variance in feature values across TFs.

**Remediation:**
```javascript
const lookbackDays = 90;
const lookbackMinutes = lookbackDays * 24 * 60;
const lookbackBars = {
  "1d": lookbackDays,
  "4h": lookbackMinutes / 240,
  "1h": lookbackMinutes / 60,
  "5m": lookbackMinutes / 5,
};
```

**Severity:** ⚠️ **MEDIUM** — Feature variance reduces model stability.

---

#### Issue H4: Volume Consolidation Without Tick Verification
**Location:** `scripts/regenerate-higher-timeframes.js`  
**Description:** Volume is summed from 1m candles, but if 1m candles are missing, the aggregated volume will be lower than expected, not detecting the gap.

**Impact:**
- Volume-based features (volume spikes, confirmation) unreliable during data gaps.

**Remediation:**
```sql
-- Store both volume and tick_count; post-process to detect gaps
SELECT
  ...
  COALESCE(SUM(v), 0) AS v,
  COUNT(*) AS tick_count
FROM labeled
GROUP BY ts_label
HAVING COUNT(*) >= <expected_tick_count> - 1  -- tolerance for missing ticks
```

**Severity:** ⚠️ **MEDIUM** — Volume-based signals may be misleading.

---

#### Issue H5: No Duplicate Candle Detection on Re-Import
**Location:** `scripts/backfill-candles-from-mt5-csv.js`  
**Description:** ON CONFLICT upsert overwrites candles with the same (symbol, broker, ts), but no validation that the new data is better/newer. A corrupted re-import would silently overwrite good data.

**Impact:**
- If accidental re-import with wrong data, no warning.
- Backfill from multiple sources (MT5, other brokers) may have conflicting data, harder to debug.

**Remediation:**
```javascript
// Before upsert, validate that new data is better (e.g., more recent import timestamp)
// Store an import_timestamp column to track source freshness
const sql = `
  INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, broker, digits, spread, import_timestamp)
  VALUES (...)
  ON CONFLICT (symbol, broker, ts) DO UPDATE SET
    o = EXCLUDED.o, h = EXCLUDED.h, ...
    import_timestamp = EXCLUDED.import_timestamp
  WHERE EXCLUDED.import_timestamp > candles_1m.import_timestamp  -- only if newer
`;
```

**Severity:** ⚠️ **MEDIUM** — Risk of silent data corruption on re-import.

---

### ℹ️ INFORMATIONAL (Low Risk, Nice-to-Have)

#### Issue L1: No Documentation of CSV Format Expectations
**Location:** `scripts/backfill-candles-from-mt5-csv.js` header comment  
**Description:** CSV format is documented in code but not in README or schema docs. Hard to know if a CSV is valid without reading the code.

**Impact:** User error on CSV export/import.  
**Remediation:** Add README section with CSV format spec and validation checklist.  
**Severity:** ℹ️ **LOW** — Documentation issue, not data integrity issue.

---

#### Issue L2: Spread Feature Only Uses Last 20 Candles
**Location:** `apps/engine/src/features/spread.ts` (limit: 20)  
**Description:** Average spread is computed from only 20 recent 1m candles. May not be representative if market conditions change.

**Impact:** Spread gate may be miscalibrated during high-volatility periods.  
**Remediation:** Make limit configurable; default to 100 or 200 candles (1.5-3 hours).  
**Severity:** ℹ️ **LOW** — Minor calibration issue.

---

## 8. Data Integrity Verification Procedures

### 8.1 Pre-Import Checklist
```bash
# 1. Verify CSV format
head -5 EURUSD_M1_*.csv

# 2. Check for corrupted lines (expect 9 columns)
awk -F '\t' 'NF != 9 { print NR": "$0 }' EURUSD_M1_*.csv | head

# 3. Spot-check OHLC ordering
awk -F '\t' 'NR > 1 && ($3 > $4 || $4 < $5) { print NR": "$0 }' EURUSD_M1_*.csv | head

# 4. Verify timezone offset is correct
# (compare CSV times against MT5 terminal screenshot)
```

### 8.2 Post-Import Validation
```sql
-- Check for gaps
SELECT symbol, ts, LEAD(ts) OVER (ORDER BY ts) - ts as gap
FROM candles_1m 
WHERE gap > interval '1 minute 30 seconds'
  AND NOT (EXTRACT(DOW FROM ts) = 5 AND EXTRACT(HOUR FROM ts) > 20)
LIMIT 10;

-- Check OHLC ordering
SELECT symbol, ts FROM candles_1m 
WHERE h < l OR h < o OR h < c 
LIMIT 10;

-- Check volume sanity
SELECT symbol, COUNT(*) cnt, MIN(v) min_vol, MAX(v) max_vol, AVG(v) avg_vol
FROM candles_1m 
GROUP BY symbol
ORDER BY avg_vol DESC;

-- Check spread range
SELECT symbol, MIN(spread) min_spread, MAX(spread) max_spread, AVG(spread) avg_spread
FROM candles_1m 
WHERE spread > 0
GROUP BY symbol
ORDER BY avg_spread DESC;
```

### 8.3 Feature Integrity Checks
```sql
-- Check that all feature timestamps are candle closes
SELECT DISTINCT f.symbol, f.tf, f.ts
FROM features_zone f
WHERE NOT EXISTS (
  SELECT 1 FROM candles_1m c 
  WHERE c.symbol = f.symbol AND c.ts = f.ts
)
LIMIT 20;

-- Check for feature timestamp gaps (should be continuous if bars are continuous)
SELECT symbol, tf, 
       ts, LEAD(ts) OVER (PARTITION BY symbol, tf ORDER BY ts) - ts as gap
FROM features_zone
WHERE gap > interval '15 minutes'
LIMIT 20;

-- Check for feature row duplicates
SELECT symbol, tf, ts, COUNT(*) cnt
FROM features_zone
GROUP BY symbol, tf, ts
HAVING COUNT(*) > 1
LIMIT 20;
```

---

## 9. Recommendations

### 🔴 Immediate Action (This Week)

1. **Add endTs alignment validation** to DAGRunner.
   - Ensure `endTs` is a candle close time.
   - Prevent intra-bar feature computation.
   - **Effort:** 1-2 hours.

2. **Fix spread conversion for all symbol types**.
   - Add symbol-to-digits mapping.
   - Validate spreads are in valid range (0-100 pips).
   - **Effort:** 2-3 hours.

3. **Add OHLC validation on CSV import**.
   - Skip or flag candles with h < l or l > o.
   - **Effort:** 1 hour.

4. **Run post-import sanity checks** on all imported data.
   - Gap detection, OHLC ordering, volume sanity.
   - **Effort:** 2-3 hours.

### 🟡 Short Term (This Month)

5. **Add cross-TF alignment check** in feature computation.
   - Prevent HTF feature computation with intra-bar LTF times.
   - **Effort:** 3-4 hours.

6. **Implement feature timestamp validation** before DB insert.
   - Ensure all features store at valid candle close times.
   - **Effort:** 2 hours.

7. **Add candle gap detection** post-aggregation.
   - Flag candles with < expected tick count.
   - **Effort:** 2-3 hours.

8. **Standardize lookback windows** across TFs.
   - Use lookback days instead of fixed bar count.
   - **Effort:** 1-2 hours.

### 🟢 Future Enhancements

9. Document CSV import format and validation in README.
10. Add import_timestamp column to candles to track re-import freshness.
11. Increase spread feature lookback from 20 to 100+ candles.
12. Implement comprehensive data quality dashboard for production monitoring.

---

## 10. Conclusion

The tradzfx-v2 data pipeline is architecturally sound with good separation of concerns (import → aggregation → feature computation → backtest). However, there are **5 critical data integrity risks** that should be remediated immediately:

1. ✅ **No intra-bar time validation** → Can cause lookahead bias
2. ✅ **Decimal precision loss** → Spread/pip calculations wrong
3. ✅ **Spread conversion assumes standard digits** → Gold spreads 10x too large
4. ✅ **No OHLC validation on import** → Corrupted candles persist
5. ✅ **Feature TS alignment not checked** → Features at wrong times

Once these are fixed, the pipeline will be **production-safe** for live trading and backtesting.

---

**Report Completed:** 2026-07-07  
**Reviewed by:** Copilot  
**Status:** Ready for remediation planning
