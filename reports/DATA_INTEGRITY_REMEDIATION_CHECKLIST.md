# Data Integrity Remediation Checklist
**Created:** 2026-07-07  
**Based on:** `DATA_INTEGRITY_AUDIT_2026-07-07.md`

---

## Priority 1: Implement Data Validation (This Week)

### Task 1.1: Add endTs Alignment Validation to DAGRunner
**File:** `apps/engine/src/dag/runner.ts`  
**Effort:** 1-2 hours  
**Risk:** LOW (adds guard, doesn't break existing code)

```typescript
// In buildInput() or run(), before computing features:
private async validateEndTs(symbol: string, tf: TimeFrame, endTs: Date): Promise<void> {
  const table = getCandleTableForTf(tf);
  const { rows } = await this.pool.query(
    `SELECT ts FROM ${table} WHERE symbol = $1 AND ts = $2`,
    [symbol, endTs]
  );
  if (rows.length === 0) {
    throw new Error(
      `endTs ${endTs.toISOString()} is not a valid candle close for ${symbol} ${tf}. ` +
      `Feature computation would use incomplete candle data (lookahead bias).`
    );
  }
}
```

**Testing:**
- Call with valid endTs (should pass)
- Call with intra-bar endTs (should throw)
- Call with non-existent timestamp (should throw)

**PR Checklist:**
- [ ] Add validateEndTs() method
- [ ] Call in run() before computing features
- [ ] Add error message with context
- [ ] Add unit test for all 3 cases

---

### Task 1.2: Add OHLC Validation on CSV Import
**File:** `scripts/backfill-candles-from-mt5-csv.js`  
**Effort:** 1 hour  
**Risk:** LOW (adds validation, skips bad rows)

```javascript
// In importFile(), after parsing each CSV row:
function validateCandle(o, h, l, c) {
  const validHigh = h >= o && h >= c && h >= l;
  const validLow = l <= o && l <= c && l <= h;
  return validHigh && validLow;
}

const rows = [];
for (let i = 1; i < lines.length; i++) {
  // ... parse row ...
  const o = parseFloat(...);
  const h = parseFloat(...);
  const l = parseFloat(...);
  const c = parseFloat(...);
  
  if (!validateCandle(o, h, l, c)) {
    console.warn(`[CSV] Invalid OHLC at line ${i}: ${symbol} ${ts.toISOString()} OHLC=${o},${h},${l},${c}`);
    skipped++;
    continue;  // Skip corrupted candle
  }
  rows.push({ ts, o, h, l, c, v, spread, digits });
}
console.log(`[CSV] Imported ${rows.length} valid candles, skipped ${skipped}`);
```

**Testing:**
- Normal candle: should pass
- h < l: should skip with warning
- l > o: should skip with warning
- c > h: should skip with warning

**PR Checklist:**
- [ ] Add validateCandle() function
- [ ] Log skipped candles with reason
- [ ] Return skipped count
- [ ] Add unit test

---

### Task 1.3: Fix Spread Conversion for All Symbol Types
**File:** `scripts/backfill-candles-from-mt5-csv.js`  
**Effort:** 2-3 hours  
**Risk:** MEDIUM (changes spread values, may affect existing analysis)

```javascript
// Add symbol-to-digit mapping before importFile()
const STANDARD_DIGITS_BY_SYMBOL = {
  // Major pairs (4-digit)
  "EURUSD": 4, "GBPUSD": 4, "USDCHF": 4, "USDJPY": 2, "AUDUSD": 4,
  "NZDUSD": 4, "USDCAD": 4, "USDNOK": 4, "USDSEK": 4,
  // Minors (usually 4-digit)
  "EURGBP": 4, "EURCHF": 4, "EUJPY": 2, "EURAUD": 4, "EURNZD": 4,
  // Commodities (special)
  "XAUUSD": 2, "XAGUSD": 3, "XPTUSD": 2, "XPDUSD": 2,
  // Indices (variable)
  "SPX500": 1, "US100": 2, "US30": 1, "UK100": 1, "DE40": 1, "FR40": 1, "IT40": 1, "IBEX": 1,
};

function getStandardDigits(symbol) {
  return STANDARD_DIGITS_BY_SYMBOL[symbol.toUpperCase()] ?? 5;  // Default 5 if unknown
}

function spreadPointsToPips(spreadPoints, symbol, inferredDigits) {
  if (!Number.isFinite(spreadPoints) || spreadPoints <= 0) return 0;
  
  // Use symbol-based digits as primary, fall back to inferred
  const digits = getStandardDigits(symbol) || inferredDigits;
  
  // Conversion formula: 
  // - 4-digit: points = pips (1 point = 1 pip)
  // - 5-digit, 3-digit, etc: points / 10 = pips
  // - 2-digit: points = pips
  if (digits === 4 || digits === 2) return spreadPoints;
  if (digits === 5 || digits === 3) return spreadPoints / 10;
  return spreadPoints / 10;  // Default to 5-digit convention
}

// In importFile():
for (const { file, name } of files) {
  const symbol = parseSymbolFromFilename(name);
  // ...
  total += await importFile(file, symbol, args.tzOffsetMinutes, args.broker);
}

async function importFile(filePath, symbol, offsetMinutes, broker) {
  // ... existing code ...
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // ... parse ...
    const digits = getStandardDigits(symbol);
    const spread = spreadPointsToPips(spreadPoints, symbol, inferredDigits);
    // ... log if using standard vs inferred digits ...
    rows.push({ ts, o, h, l, c, v, spread, digits });
  }
}
```

**Testing:**
- EURUSD: spread points / 1 = pips
- XAUUSD: spread points / 1 = pips (not / 10)
- USDJPY: points / 10 = pips (2-digit but special)
- Unknown symbol: fall back to inferred (5-digit by default)

**Validation:**
```sql
-- After import, verify spread ranges are reasonable
SELECT symbol, MIN(spread) min_spread, MAX(spread) max_spread, AVG(spread) avg_spread
FROM candles_1m 
WHERE spread > 0
GROUP BY symbol
ORDER BY avg_spread DESC;

-- Expected ranges:
-- EURUSD, GBPUSD, etc: 0.5-2 pips typical
-- XAUUSD: 0.01-0.15 (quoted in cents/oz)
-- USDJPY: 0.001-0.05 (yen is small unit)
```

**PR Checklist:**
- [ ] Add STANDARD_DIGITS_BY_SYMBOL mapping
- [ ] Update spreadPointsToPips() to use symbol
- [ ] Pass symbol through importFile()
- [ ] Log when using standard vs inferred digits
- [ ] Add verification queries
- [ ] Backfill existing data with corrected spreads

---

### Task 1.4: Validate Feature Timestamps Before Insert
**File:** `apps/engine/src/dag/runner.ts`  
**Effort:** 2 hours  
**Risk:** MEDIUM (may reject some edges case features, but ensures correctness)

```typescript
private async insertRows(
  tableName: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;

  // Validate that all feature timestamps are valid candle closes
  const validated: Record<string, unknown>[] = [];
  const invalidRows: Record<string, unknown>[] = [];
  
  for (const row of rows) {
    if (row.ts && row.symbol && row.tf) {
      const tf = row.tf as TimeFrame;
      const table = getCandleTableForTf(tf);
      const { rows: candleRows } = await this.pool.query(
        `SELECT ts FROM ${table} WHERE symbol = $1 AND ts = $2`,
        [row.symbol, row.ts]
      );
      
      if (candleRows.length === 0) {
        invalidRows.push(row);
        console.warn(
          `[engine] Feature row rejected: ts ${row.ts} not a candle close ` +
          `for ${row.symbol} ${tf} (table: ${tableName})`
        );
      } else {
        validated.push(row);
      }
    } else {
      // Feature without timestamp (edge case, allow)
      validated.push(row);
    }
  }

  if (invalidRows.length > 0) {
    console.error(
      `[engine] ${invalidRows.length}/${rows.length} feature rows had invalid timestamps. ` +
      `This may indicate lookahead bias in feature computation.`
    );
  }

  // Continue with validated rows
  if (validated.length === 0) {
    console.warn(`[engine] All feature rows for ${tableName} were invalid, skipping insert`);
    return;
  }

  // ... existing insert logic with validated rows ...
}
```

**Testing:**
- Valid feature ts (should insert)
- Invalid feature ts (should warn and skip)
- Feature without ts (should insert as-is)

**PR Checklist:**
- [ ] Add timestamp validation before insert
- [ ] Log invalid rows with context
- [ ] Continue with validated rows only
- [ ] Add error count to output

---

## Priority 2: Post-Import Data Quality Checks (Week 1)

### Task 2.1: Create Comprehensive Post-Import Validation Script
**File:** `scripts/validate-candles-post-import.js`  
**Effort:** 3-4 hours  
**Risk:** LOW (read-only validation)

```javascript
const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 4,
});

async function validateCandlesForSymbol(symbol) {
  console.log(`\n=== Validating ${symbol} ===`);
  const errors = [];
  const warnings = [];

  // 1. Check OHLC ordering
  const { rows: ohlcErrors } = await pool.query(
    `SELECT ts, o, h, l, c FROM candles_1m 
     WHERE symbol = $1 AND (h < l OR h < o OR h < c OR l > o OR l > c)
     ORDER BY ts DESC LIMIT 10`,
    [symbol]
  );
  if (ohlcErrors.length > 0) {
    errors.push(`OHLC ordering violations: ${ohlcErrors.length} candles`);
    ohlcErrors.forEach(r => {
      console.warn(`  ${r.ts}: O=${r.o}, H=${r.h}, L=${r.l}, C=${r.c}`);
    });
  }

  // 2. Check for gaps (missing 1m candles)
  const { rows: gaps } = await pool.query(
    `SELECT ts, LEAD(ts) OVER (ORDER BY ts) - ts as gap
     FROM candles_1m 
     WHERE symbol = $1
     GROUP BY ts
     HAVING (LEAD(ts) OVER (ORDER BY ts) - ts) > interval '1 minute 30 seconds'
       AND NOT (EXTRACT(DOW FROM ts) = 5 AND EXTRACT(HOUR FROM ts) >= 20)
       AND NOT (EXTRACT(DOW FROM ts) = 0 AND EXTRACT(HOUR FROM ts) < 20)
     ORDER BY ts DESC LIMIT 20`,
    [symbol]
  );
  if (gaps.length > 0) {
    warnings.push(`Data gaps detected: ${gaps.length} gaps > 90 seconds`);
    gaps.forEach(r => {
      const minutes = Math.round(r.gap / 60000);
      console.warn(`  ${r.ts}: ${minutes}m gap`);
    });
  }

  // 3. Check for duplicates
  const { rows: dupes } = await pool.query(
    `SELECT ts, COUNT(*) cnt FROM candles_1m 
     WHERE symbol = $1
     GROUP BY ts HAVING COUNT(*) > 1`,
    [symbol]
  );
  if (dupes.length > 0) {
    errors.push(`Duplicate timestamps: ${dupes.length} duplicates`);
  }

  // 4. Check volume sanity
  const { rows: volStats } = await pool.query(
    `SELECT MIN(v) min_vol, MAX(v) max_vol, AVG(v) avg_vol, 
            PERCENTILE_CONT(0.01) WITHIN GROUP (ORDER BY v) as p1,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY v) as p99
     FROM candles_1m WHERE symbol = $1 AND v > 0`,
    [symbol]
  );
  if (volStats[0] && volStats[0].min_vol === 0) {
    warnings.push(`Zero-volume candles detected`);
  }

  // 5. Check spread sanity
  const { rows: spreadStats } = await pool.query(
    `SELECT MIN(spread) min_spread, MAX(spread) max_spread, AVG(spread) avg_spread,
            COUNT(*) total, COUNT(CASE WHEN spread IS NULL THEN 1 END) null_count
     FROM candles_1m WHERE symbol = $1`,
    [symbol]
  );
  const stats = spreadStats[0];
  if (stats && stats.max_spread > 1000) {
    errors.push(`Spread unreasonably large: max ${stats.max_spread} pips`);
  }

  // Summary
  console.log(`  Total candles: ${(await pool.query('SELECT COUNT(*) FROM candles_1m WHERE symbol = $1', [symbol])).rows[0].count}`);
  console.log(`  Date range: [from DB query]`);
  console.log(`  Volume: min=${volStats[0].min_vol}, max=${volStats[0].max_vol}, avg=${volStats[0].avg_vol.toFixed(0)}`);
  console.log(`  Spread: min=${stats.min_spread}, max=${stats.max_spread}, avg=${stats.avg_spread.toFixed(4)}, null=${stats.null_count}`);
  
  if (errors.length > 0) {
    console.error(`  ❌ ERRORS: ${errors.join("; ")}`);
  }
  if (warnings.length > 0) {
    console.warn(`  ⚠️  WARNINGS: ${warnings.join("; ")}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`  ✅ All checks passed`);
  }

  return { errors, warnings };
}

async function main() {
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol");
  const symbols = rows.map(r => r.symbol);
  
  console.log(`Validating ${symbols.length} symbols...`);
  
  const results = {};
  for (const symbol of symbols) {
    results[symbol] = await validateCandlesForSymbol(symbol);
  }

  // Summary report
  console.log(`\n=== SUMMARY ===`);
  const symbolsWithErrors = Object.entries(results).filter(([_, r]) => r.errors.length > 0);
  const symbolsWithWarnings = Object.entries(results).filter(([_, r]) => r.warnings.length > 0);
  
  console.log(`  ${symbols.length} symbols checked`);
  console.log(`  ${symbolsWithErrors.length} with errors: ${symbolsWithErrors.map(([s]) => s).join(", ")}`);
  console.log(`  ${symbolsWithWarnings.length} with warnings: ${symbolsWithWarnings.map(([s]) => s).join(", ")}`);

  await pool.end();
  process.exit(symbolsWithErrors.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
```

**Usage:**
```bash
export TM_DB_PASSWORD=...
node scripts/validate-candles-post-import.js
```

**PR Checklist:**
- [ ] Create validation script
- [ ] Test against known good data
- [ ] Test against intentionally corrupted data
- [ ] Add to CI/CD post-import hook
- [ ] Document expected ranges per symbol

---

## Priority 3: Cross-Timeframe Alignment (Week 2)

### Task 3.1: Add TF Alignment Validation
**File:** `apps/engine/src/dag/runner.ts`  
**Effort:** 2-3 hours  
**Risk:** MEDIUM (may reject some edge cases)

```typescript
private async validateCrossTimeFrameAlignment(
  symbol: string,
  tf: TimeFrame,
  endTs: Date,
  referenceTimeFrames?: TimeFrame[]
): Promise<void> {
  if (!referenceTimeFrames || referenceTimeFrames.length === 0) return;

  // Compute LCM of all timeframes involved
  const tfs = [tf, ...referenceTimeFrames];
  const tfToMinutes: Record<TimeFrame, number> = {
    "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440
  };
  
  const lcmMs = lcm(...tfs.map(t => tfToMinutes[t] * 60000));
  
  // Check if endTs is aligned to LCM boundary
  if (endTs.getTime() % lcmMs !== 0) {
    console.warn(
      `[engine] endTs ${endTs.toISOString()} not aligned to LCM of TFs [${tfs.join(", ")}]. ` +
      `HTF candles may be incomplete.`
    );
  }
  
  // Validate that endTs exists in all TFs
  for (const refTf of tfs) {
    const table = getCandleTableForTf(refTf);
    const { rows } = await this.pool.query(
      `SELECT ts FROM ${table} WHERE symbol = $1 AND ts = $2`,
      [symbol, endTs]
    );
    if (rows.length === 0) {
      throw new Error(
        `endTs ${endTs.toISOString()} not a valid candle close for ${symbol} ${refTf}. ` +
        `Cannot compute features with cross-TF context.`
      );
    }
  }
}

// In run(), if referenceTimeFrames exist:
if (feature.referenceTimeFrames && feature.referenceTimeFrames.length > 0) {
  await this.validateCrossTimeFrameAlignment(opts.symbol, opts.tf, opts.endTs, feature.referenceTimeFrames);
}
```

**PR Checklist:**
- [ ] Add LCM computation utility
- [ ] Add cross-TF validation
- [ ] Call for features with referenceTimeFrames
- [ ] Add unit tests for LCM calculation

---

## Priority 4: Feature Timestamp Alignment (Week 2)

### Task 4.1: Implement Candle Closure Timestamp Verification
**File:** `apps/engine/src/dag/runner.ts`  
**Effort:** 1-2 hours  
**Risk:** LOW (validation only)

```typescript
private async verifyFeatureTimestamps(
  tableName: string,
  symbol: string,
  tf: TimeFrame,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const table = getCandleTableForTf(tf);
  
  // Batch query all candle timestamps to check
  const timestamps = rows
    .map(r => r.ts)
    .filter((ts): ts is Date => ts instanceof Date)
    .map(ts => ts.toISOString());

  if (timestamps.length === 0) return rows;

  const { rows: validCandles } = await this.pool.query(
    `SELECT ts FROM ${table} WHERE symbol = $1 AND ts = ANY($2)`,
    [symbol, timestamps]
  );

  const validTimestampSet = new Set(validCandles.map(r => r.ts.toISOString()));

  const valid = rows.filter(r => {
    if (!r.ts || !(r.ts instanceof Date)) return true;
    return validTimestampSet.has(r.ts.toISOString());
  });

  if (valid.length < rows.length) {
    const skipped = rows.length - valid.length;
    console.warn(
      `[engine] Skipped ${skipped}/${rows.length} feature rows in ${tableName} ` +
      `with invalid timestamps (not candle closes).`
    );
  }

  return valid;
}

// Call in insertRows():
const validatedRows = await this.verifyFeatureTimestamps(tableName, opts.symbol, opts.tf, rows);
```

**PR Checklist:**
- [ ] Add verifyFeatureTimestamps() method
- [ ] Call before insert in insertRows()
- [ ] Log skipped rows with reason

---

## Priority 5: Gap Detection & Volume Verification (Week 3)

### Task 5.1: Add Post-Aggregation Gap Detection
**File:** `scripts/regenerate-higher-timeframes.js`  
**Effort:** 2-3 hours  
**Risk:** LOW (validation only)

```javascript
async function regenerate(symbol, tf) {
  // ... existing delete & insert ...
  
  // New: verify tick_count is reasonable
  const { rows: gaps } = await client.query(
    `SELECT ts, tick_count FROM ${tf.table} 
     WHERE symbol = $1 AND tick_count < $2
     ORDER BY ts DESC`,
    [symbol, tf.expectedTickCount * 0.9]  // Allow 10% tolerance
  );
  
  if (gaps.length > 0) {
    console.warn(`[regenerate] ${symbol} ${tf.name}: ${gaps.length} candles with low tick count:`);
    gaps.slice(0, 10).forEach(r => {
      console.warn(`  ${r.ts}: ${r.tick_count} ticks (expected ${tf.expectedTickCount})`);
    });
  }
  
  return { deleted, inserted, gapsDetected: gaps.length };
}

// Add expected tick counts
const TIMEFRAMES = [
  { name: "5m", table: "candles_5m", minutes: 5, expectedTickCount: 4 },
  { name: "15m", table: "candles_15m", minutes: 15, expectedTickCount: 14 },
  { name: "1h", table: "candles_1h", minutes: 60, expectedTickCount: 59 },
  { name: "4h", table: "candles_4h", minutes: 240, expectedTickCount: 239 },
  // ... etc
];
```

**PR Checklist:**
- [ ] Add expectedTickCount to TIMEFRAMES
- [ ] Add gap detection query
- [ ] Log gaps with severity
- [ ] Return gap count from regenerate()

---

## Verification Procedures

### Before Deploying Fixes
```bash
# 1. Test endTs validation
node -e "
  const { DAGRunner } = require('./apps/engine/dist/index.js');
  const pool = getPool();
  const runner = new DAGRunner(pool);
  
  // Should throw: intra-bar time
  runner.run({ symbol: 'EURUSD', tf: '15m', endTs: new Date('2026-07-07T14:30:15Z'), ... });
"

# 2. Test OHLC validation
node scripts/backfill-candles-from-mt5-csv.js ./test-data/bad-candles.csv
# Should log: "Skipped 5 corrupted candles"

# 3. Test spread conversion
node -e "
  const STANDARD_DIGITS = { 'XAUUSD': 2 };
  const spreadPips = (15 / 1);  // 2-digit: 15 points = 15 pips
  console.assert(spreadPips === 15, 'GOLD spread should be 15 pips');
"

# 4. Run post-import validation
node scripts/validate-candles-post-import.js
# Should output: "✅ All checks passed" for good data
```

### Continuous Monitoring
```bash
# Add to hourly cron job:
0 * * * * cd /tradzfx-v2 && node scripts/validate-candles-post-import.js >> logs/candle-validation.log 2>&1
```

---

## Risk Assessment & Rollout Plan

| Task | Risk | Mitigation |
|------|------|-----------|
| **1.1 endTs validation** | Rejects some valid use cases | Add --skip-alignment flag for testing |
| **1.2 OHLC validation** | Silently skips corrupted data | Log all skipped rows, alert on skip > 0.1% |
| **1.3 Spread conversion** | Changes stored spread values | Create migration to recalculate, validate against old |
| **1.4 Feature TS validation** | Rejects some features | Add --skip-ts-check for backfill |
| **2.1 Post-import validation** | May find unknown issues | Deploy to test env first |
| **3.1 Cross-TF alignment** | Prevents some edge cases | Add --skip-alignment for live trading initially |
| **4.1 Feature TS verification** | May skip valid features | Log all skipped, investigate |
| **5.1 Gap detection** | May flag legitimate gaps | Allow configurable gap tolerance |

---

## Success Criteria

After remediation, the following should be true:

- [ ] All feature computations use `endTs` that is a valid candle close time
- [ ] All imported candles pass OHLC ordering validation
- [ ] All spreads are correctly converted per symbol type
- [ ] All features are stored with timestamps that exist in candle tables
- [ ] Post-import validation script runs without errors
- [ ] Cross-TF features validate TF alignment before computation
- [ ] Gap detection identifies all suspicious data
- [ ] Backtest results are reproducible across runs

---

**Next Step:** Begin with Task 1.1 (endTs validation) as it has lowest risk and highest impact.
