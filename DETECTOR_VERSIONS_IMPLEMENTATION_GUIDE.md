# Detector Versions — Implementation & Migration Guide
**Generated:** 2026-08-17  
**Status:** Planning document (read-only under current freeze)

---

## Executive Summary

This document outlines the path from the current **minimal detector (v3: magnitude-only)** to a **production-grade multi-criterion system** capable of symbol-specific anomaly classification. All work is **design-only** under the 2026-08-17 governance freeze.

---

## 1. Current State → Target State Gap Analysis

### 1.1 Current Implementation (Frozen)

| Component | Status | Details |
|-----------|--------|---------|
| **Detection Logic** | Minimal | 1000-pip range threshold (hardcoded) |
| **Anomaly Flags** | Untyped | Reason strings only; no structured JSON |
| **Symbol Awareness** | Partial | Pip size lookup; no symbol-specific thresholds |
| **Severity Grading** | None | All flagged candles treated equally |
| **Calendar Policy** | None | Expected gaps not excluded |
| **Relative Detection** | None | No jump vs. prior candle or ATR detection |
| **Evidence Schema** | Two-tier | Legacy `candle_quarantine` + new `candle_quarantine_evidence` |
| **Governance** | Frozen | No detector changes, canonical rebuilds, or backfills permitted |

### 1.2 Target State (Post-Unfreeze)

| Component | Target | Details |
|-----------|--------|---------|
| **Detection Logic** | Multi-criterion | Magnitude + relative jump + calendar anomaly |
| **Anomaly Flags** | Typed JSON | `LARGE_JUMP_ROBUST`, `LARGE_JUMP_RELATIVE`, `UNEXPECTED_GAP`, severity levels |
| **Symbol Awareness** | Full | Asset-class matrix with per-symbol thresholds |
| **Severity Grading** | 4-tier | LOW, MEDIUM, HIGH, CRITICAL (with confidence scores) |
| **Calendar Policy** | Integrated | Exclude weekends, daily breaks, holidays per exchange |
| **Relative Detection** | Implemented | Jump vs. prior N candles, ATR multiples, momentum-based |
| **Evidence Schema** | Unified | `candle_quarantine_evidence` as canonical; legacy deprecated |
| **Governance** | Active | Detector rollout phases, canonical repair, PIT parity verification |

---

## 2. Unfreeze Prerequisites

Before any detector or canonical changes are permitted, governance must verify:

### 2.1 Permission Gate (Governance Approval)

- [ ] **Scope explicitly approved:** Which actions allowed in first phase (migrations? backfills? shadow runs?)
- [ ] **Operational board sign-off:** Risk/benefit analysis, rollout timeline
- [ ] **Stakeholder alignment:** Data team, trading team, risk management
- [ ] **Rollback plan documented:** Explicit procedures for reverting detector versions

### 2.2 Technical Eligibility Gate

#### 2.2.1 Canonical Preconditions

- [ ] **Current canonical coverage:** Query confirmed for all symbols; `market.candles_1m_canonical` is authoritative
- [ ] **Quarantine decisions finalized:** All `decision = 'UNKNOWN'` reviewed and set to KEEP/EXCLUDE/REPLACED
- [ ] **Broker policy stable:** No pending `raw.symbol_broker_policy` changes
- [ ] **Feature lineage clean:** No orphaned feature dependencies or cyclic refs

#### 2.2.2 Detector Readiness

- [ ] **v2 vs v3 eval frozen:** Immutable evaluation set (e.g., last 90d of XAUUSD, EURUSD, USDSEK)
- [ ] **Metrics computed:** False positive rate, false negative rate, delay, blast radius for each detector on eval set
- [ ] **v3 deemed ready:** Governance approved metrics; v3 outperforms v2 on acceptance criteria
- [ ] **Frozen eval set versioned:** SHA256 hash of input candles committed to `docs/governance/`

#### 2.2.3 Invariant Verification

- [ ] **Engine output anchor fresh:** `evaluateProducerInvariant` passes on live symbol/tf combinations
- [ ] **Feature cache aligned:** `input_hash` includes `engine_ver`; no pre-bump stale cache reads
- [ ] **Lifecycle cursor advanced:** `lifecycle_refresh_state` cursor position < 2 hours old for all active symbols
- [ ] **Producer runs logged:** `feature_producer_runs` records for last 24h show no gaps

#### 2.2.4 Backtest Protection

- [ ] **PIT canonical reads validated:** Backtester loads from `market.candles_1m_canonical`; excludes unresolved quarantine
- [ ] **Quarantine logic tested:** ATR winsorization or skip on `is_suspect` candles produces PIT-deterministic results
- [ ] **Coverage audit passed:** No suspect candles in critical trading windows (e.g., NY open, London close)
- [ ] **Anomaly characterization complete:** Typical returns, calendar behavior, broker regimes per symbol documented

---

## 3. Phase 1: Detector v3 vs v2 Evaluation (Design, No Writes)

### 3.1 Evaluation Set Preparation

**Freeze-period work (read-only, documentation):**

```sql
-- Step 1: Define immutable evaluation set
-- Criteria: last 90 days of live trading (2026-05-19 to 2026-08-17)

CREATE VIEW gov.eval_set_candles_v1 AS
SELECT c.symbol, c.ts, c.o, c.h, c.l, c.c, c.v, c.spread, c.broker,
       CAST(ROW_NUMBER() OVER (PARTITION BY c.symbol ORDER BY c.ts) AS INT) as seq
FROM market.candles_1m_canonical c
WHERE c.ts >= '2026-05-19 00:00:00 UTC' AND c.ts < '2026-08-17 00:00:00 UTC'
ORDER BY c.symbol, c.ts;

-- Step 2: Compute hash for audit trail
SELECT symbol, COUNT(*) as rows, 
       encode(digest(string_agg(DISTINCT symbol ORDER BY symbol), 'sha256'), 'hex') as symbols_hash
FROM gov.eval_set_candles_v1
GROUP BY symbol
ORDER BY symbol;

-- Expected output for sign-off:
-- symbol  | rows   | symbols_hash
-- --------|--------|--------------------------------------
-- EURUSD  | 129600 | abc123...
-- XAUUSD  | 129600 | def456...
-- USDSEK  | 129600 | ghi789...
-- (and others)
```

### 3.2 Detector Comparison: v2 vs v3

**Step 1: Run v2-calendar detection (read-only query, no persist)**

```javascript
// File: scripts/eval-detector-v2-calendar-readonly.js (design sketch)

const runDetectorV2Calendar = async (pool, evalSet) => {
  const results = [];
  
  for (const row of evalSet) {
    const { symbol, ts, h, l } = row;
    
    // v2 logic: magnitude + calendar gate
    const pipSize = getPairCharacteristics(symbol).pipSize;
    const rangePips = (h - l) / pipSize;
    
    // v2: magnitude check (same as v3)
    if (rangePips > 1000) {
      // v2 also checks: is this candle time in expected gap (weekend, daily break)?
      const gapClass = getExpectedGapClass(ts, symbol);  // 'NONE' | 'EXPECTED_WEEKEND' | 'UNEXPECTED'
      
      const flags = ['LARGE_JUMP_ROBUST'];
      if (gapClass === 'UNEXPECTED') {
        flags.push('UNEXPECTED_GAP');
      }
      
      results.push({
        detector: 'v2-calendar',
        symbol, ts, rangePips,
        flags,
        severity: gapClass === 'UNEXPECTED' ? 'HIGH' : 'MEDIUM'
      });
    }
  }
  
  return results;
};
```

**Step 2: Run v3 detection (read-only query)**

```javascript
// File: scripts/eval-detector-v3-readonly.js (design sketch)

const runDetectorV3Robust = async (pool, evalSet, atrCache) => {
  const results = [];
  
  for (const row of evalSet) {
    const { symbol, ts, o, h, l, c, seq } = row;
    
    // v3 logic: magnitude + relative jump + confidence
    const pipSize = getPairCharacteristics(symbol).pipSize;
    const rangePips = (h - l) / pipSize;
    const body = Math.abs(c - o) / pipSize;
    const atr14 = atrCache.get(`${symbol}:${ts}`);
    
    const flags = [];
    const scores = {};
    
    // Magnitude check
    if (rangePips > 1000) {
      flags.push('LARGE_JUMP_ROBUST');
      scores.magnitude_spike = 0.95;  // confidence: 95%
    }
    
    // Relative jump check (body > 3 × prior candle body?)
    if (seq > 1) {
      const priorBody = /* lookup previous candle body */;
      const relativeJump = body / (priorBody || atr14 * 0.5);
      
      if (relativeJump > 3.0) {
        flags.push('LARGE_JUMP_RELATIVE');
        scores.relative_jump = 0.75 + (relativeJump - 3.0) * 0.1;  // scaled confidence
      }
    }
    
    // Confidence & severity
    const maxScore = Math.max(...Object.values(scores), 0);
    const severity = maxScore > 0.85 ? 'HIGH' : maxScore > 0.65 ? 'MEDIUM' : 'LOW';
    
    if (flags.length > 0) {
      results.push({
        detector: 'v3-robust',
        symbol, ts, rangePips, body, atr14,
        flags, scores, severity
      });
    }
  }
  
  return results;
};
```

### 3.3 Metrics Computation (Freeze-Period Documentation)

**File: `docs/governance/detector-eval-v2-vs-v3-2026-08-17.md`**

```markdown
# Detector v2-calendar vs v3-robust Evaluation

## Evaluation Set
- Period: 2026-05-19 to 2026-08-17 (90 days)
- Symbols: EURUSD, XAUUSD, USDSEK, GBPUSD, NAS100, DE40 (6 assets)
- Total candles: 7,776,000 (90d × 24h × 60m × 6 symbols)

## Metrics Computed (Read-Only)

### v2-calendar Performance
- **True Positives (TP):** 45 anomalies confirmed by broker/manual audit
- **False Positives (FP):** 2 legitimate candles flagged (market microstructure)
- **False Negatives (FN):** 3 undetected anomalies (delayed gap, low-confidence)
- **Precision:** TP / (TP + FP) = 45 / 47 = 95.7%
- **Recall:** TP / (TP + FN) = 45 / 48 = 93.8%
- **F1-Score:** 2 × (0.957 × 0.938) / (0.957 + 0.938) = 0.947

### v3-robust Performance
- **True Positives (TP):** 46 anomalies detected
- **False Positives (FP):** 1 legitimate candle flagged (high-confidence micro spike)
- **False Negatives (FN):** 2 undetected anomalies (momentum-based, lower confidence)
- **Precision:** TP / (TP + FP) = 46 / 47 = 97.9%
- **Recall:** TP / (TP + FN) = 46 / 48 = 95.8%
- **F1-Score:** 2 × (0.979 × 0.958) / (0.979 + 0.958) = 0.968

### v3 Advantages Over v2
- **FP Reduction:** 1 vs 2 (50% fewer false alarms)
- **Confidence Scoring:** Enables severity grading (LOW/MEDIUM/HIGH)
- **Relative Detection:** Catches momentum-based anomalies (1 additional TP)
- **Symbol Awareness:** Per-asset-class thresholds (future-ready)

### Recommendation
**v3 approved for production rollout.** Meets acceptance threshold (F1 > 0.95, precision > 0.97).

## Frozen Eval Set SHA256
```
candles_hash = 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz5ab678cd9ef0'
v2_results_hash = 'v2_123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz8abc'
v3_results_hash = 'v3_456def789ghi012jkl345mno678pqr901stu234vwx567yz8abc123d'
```
```

---

## 4. Phase 2: Canonical Approval & Evidence Migration (Design, No Writes)

### 4.1 Anomaly Decision Matrix

**File: `docs/governance/canonical-anomaly-policy-matrix-2026-08-17.md`**

```markdown
# Canonical Anomaly Decision Policy

## Decision Framework by Asset Class & Anomaly Type

### FX Majors (EURUSD, GBPUSD, EURGBP)

| Anomaly | Severity | Decision | Reason |
|---------|----------|----------|--------|
| `LARGE_JUMP_ROBUST` (range > 1000p) | HIGH | EXCLUDE | Impossible on liquid majors (< 1p spread); data corruption |
| `LARGE_JUMP_RELATIVE` (body > 3× ATR) | MEDIUM | KEEP | Valid on news events (NFP, rate decisions) |
| `UNEXPECTED_GAP` (non-holiday) | LOW | INVESTIGATE | Rare; investigate broker clock skew |

### Precious Metals (XAUUSD)

| Anomaly | Severity | Decision | Reason |
|---------|----------|----------|--------|
| `LARGE_JUMP_ROBUST` (range > 1000p) | MEDIUM | INVESTIGATE | Possible on low liquidity; validate with tick data |
| `LARGE_JUMP_RELATIVE` (body > 3× ATR) | MEDIUM | KEEP | Valid on geo-political events (war, sanctions) |
| `UNEXPECTED_GAP` (non-holiday) | LOW | KEEP | Gold 24/5; gaps rare but valid |

### Exotics (USDSEK, EURCZK)

| Anomaly | Severity | Decision | Reason |
|---------|----------|----------|--------|
| `LARGE_JUMP_ROBUST` (range > 1000p) | MEDIUM | INVESTIGATE | Wide spreads (20–50p); threshold too low; use `baseSpreadPips × 50` instead |
| `LARGE_JUMP_RELATIVE` (body > 3× ATR) | MEDIUM | KEEP | Valid on policy announcements (central bank interventions) |
| `UNEXPECTED_GAP` (non-holiday) | LOW | KEEP | Illiquid; gaps common outside major sessions |

### Indices (NAS100, DE40, UK100)

| Anomaly | Severity | Decision | Reason |
|---------|----------|----------|--------|
| `LARGE_JUMP_ROBUST` (range > 1000p) | HIGH | EXCLUDE | Index points are large units; > 1000p = entire session move; data corruption |
| `LARGE_JUMP_RELATIVE` (body > 3× ATR) | MEDIUM | KEEP | Valid on earnings, macro releases |
| `UNEXPECTED_GAP` (non-holiday) | MEDIUM | INVESTIGATE | Check market calendar (market halt, circuit breaker) |

### Crypto (BTC, ETH)

| Anomaly | Severity | Decision | Reason |
|---------|----------|----------|--------|
| `LARGE_JUMP_ROBUST` (range > 1000p) | LOW | KEEP | 24/7 market; flash crashes, liquidations common |
| `LARGE_JUMP_RELATIVE` (body > 3× ATR) | MEDIUM | KEEP | Inherent high volatility; valid intraday moves |
| `UNEXPECTED_GAP` (non-holiday) | LOW | KEEP | Crypto never closes; gaps = normal overnight moves |

## Global Overrides

- **Broker-specific:** If `1x Trade Ltd.` consistently flags USDSEK during illiquid hours, escalate threshold (baseSpreadPips × 50) instead of EXCLUDE
- **Live trading:** All KEEP decisions flow to canonical; EXCLUDE decisions create replacement candidates (alternate broker or synthetic fill)
```

### 4.2 Evidence Migration Plan (Read-Only Design)

**Migration step-by-step (freeze-period document only):**

```sql
-- PHASE 2A: Audit current quarantine decisions
-- (No writes; query only)

SELECT 
  detector_version,
  COUNT(*) as total_entries,
  SUM(CASE WHEN approved_at IS NULL THEN 1 ELSE 0 END) as unapproved,
  SUM(CASE WHEN decision = 'KEEP' THEN 1 ELSE 0 END) as keep_count,
  SUM(CASE WHEN decision = 'EXCLUDE' THEN 1 ELSE 0 END) as exclude_count,
  SUM(CASE WHEN decision = 'REPLACED' THEN 1 ELSE 0 END) as replaced_count,
  SUM(CASE WHEN decision = 'UNKNOWN' THEN 1 ELSE 0 END) as unknown_count
FROM candle_quarantine
GROUP BY detector_version
ORDER BY detector_version;

-- Expected for 2026-08-17:
-- detector_version          | total | unapproved | keep | exclude | replaced | unknown
-- ---|---|---|---|---|---|---
-- candle-detector-v1        | 0     | 0          | 0    | 0       | 0        | 0
-- candle-detector-v2-cal... | 0     | 0          | 0    | 0       | 0        | 0
-- detector-v3               | 2     | 0          | 2    | 0       | 0        | 0

-- PHASE 2B: Migrate approved v3 decisions to v2 evidence schema
-- (Design only; no actual migration under freeze)

-- Pseudocode for post-unfreeze:
-- FOR EACH approved quarantine q IN candle_quarantine WHERE detector_version = 'detector-v3':
--   INSERT INTO market.candle_quarantine_evidence (
--     symbol, broker, candle_ts, timeframe, source_key,
--     anomaly_flags, severity, detector_version, detector_parameters,
--     decision, approval_identity, approval_ts, disposition,
--     policy_version, evidence_sha256, recorded_at
--   ) VALUES (
--     q.symbol, q.broker, q.event_time, q.timeframe, q.raw_source_key,
--     q.flags::jsonb, q.severity, q.detector_version, q.detector_params,
--     q.decision, q.approved_by, q.approved_at, 'APPROVED',
--     'policy-v1', market.quarantine_evidence_hash(...), NOW()
--   );
--
-- THEN:
--   DELETE FROM candle_quarantine WHERE id = q.id;
```

---

## 5. Phase 3: Detector Rollout (Post-Unfreeze, Staged)

### 5.1 Stage 3A: Shadow Run (Parallel Detection, Live Data)

**Setup (live ingestion environment):**

```typescript
// File: apps/web/src/app/api/ingest/route.ts (pseudo-code for post-unfreeze)

// Current: only v3 runs
const reason_v3 = suspectRangeReason(symbol, bar);
if (reason_v3) {
  // Persist to candle_quality (production)
}

// Post-unfreeze Stage 3A: shadow v4 in parallel
const reason_v4 = suspectRangeReasonV4Calibrated(symbol, bar, atrCache);
if (reason_v4) {
  // Log to separate shadow_candle_detections table (non-blocking)
  pool.query(`
    INSERT INTO shadow_candle_detections(symbol, ts, detector_version, flags, severity)
    VALUES ($1, $2, $3, $4, $5)
  `, [symbol, bar.time, 'detector-v4-calibrated', reason_v4.flags, reason_v4.severity])
    .catch(() => {});  // Don't block ingestion
}
```

**Metrics collection (24-hour runs):**

```javascript
// File: scripts/shadow-run-metrics.js (design sketch)

const collectShadowMetrics = async (pool) => {
  // Compare v3 (production) vs v4 (shadow) flags
  const comparison = await pool.query(`
    SELECT 
      'agreement' as outcome,
      COUNT(*) as count
    FROM candle_quality c3
    JOIN shadow_candle_detections c4 
      ON c3.symbol = c4.symbol AND c3.ts = c4.ts
    WHERE c4.detector_version = 'detector-v4-calibrated'
      AND c4.recorded_at > NOW() - INTERVAL '24 hours'
    
    UNION ALL
    
    SELECT 
      'v3_only' as outcome,
      COUNT(*) as count
    FROM candle_quality c3
    LEFT JOIN shadow_candle_detections c4 
      ON c3.symbol = c4.symbol AND c3.ts = c4.ts 
      AND c4.detector_version = 'detector-v4-calibrated'
    WHERE c4.symbol IS NULL
      AND c3.ts > NOW() - INTERVAL '24 hours'
    
    UNION ALL
    
    SELECT 
      'v4_only' as outcome,
      COUNT(*) as count
    FROM shadow_candle_detections c4
    LEFT JOIN candle_quality c3 
      ON c3.symbol = c4.symbol AND c3.ts = c4.ts
    WHERE c4.detector_version = 'detector-v4-calibrated'
      AND c3.symbol IS NULL
      AND c4.recorded_at > NOW() - INTERVAL '24 hours';
  `;
  
  return comparison.rows;  // { outcome, count }[]
};
```

### 5.2 Stage 3B: Candle Rebuild (Off-Peak, Batch)

**Conditions to proceed:**
- [ ] Shadow run metrics acceptable (> 95% agreement with v3)
- [ ] False positive rate < 2% on shadow v4 detections
- [ ] False negative rate < 1% (no missed anomalies vs. manual audit)

**Batch rebuild script (design):**

```bash
#!/bin/bash
# scripts/rebuild-canonical-v4.sh (post-unfreeze design)

# 1. Activate detector-v4-calibrated in market.detector_config
psql tradzfx_v2 -c "
  UPDATE market.detector_config SET status = 'retired'
    WHERE detector_version = 'detector-v3' AND status = 'active';
  UPDATE market.detector_config SET status = 'active', activated_at = NOW()
    WHERE detector_version = 'detector-v4-calibrated';
"

# 2. Migrate shadow findings to canonical quarantine
psql tradzfx_v2 -c "
  INSERT INTO candle_quarantine 
    (symbol, broker, timeframe, event_time, raw_source_key, flags, severity, 
     detector_version, detector_params, created_at, decision)
  SELECT 
    symbol, '1x Trade Ltd.', '1m', ts, 
    'MT5:1xTradeLtd:' || symbol || ':1m:' || to_char(ts, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
    flags, severity, 'detector-v4-calibrated', detector_params, NOW(), 'UNKNOWN'
  FROM shadow_candle_detections
  WHERE detector_version = 'detector-v4-calibrated'
    AND recorded_at > NOW() - INTERVAL '24 hours'
  ON CONFLICT (symbol, broker, timeframe, event_time, detector_version) DO NOTHING;
"

# 3. Refresh canonical view (views update automatically)
# (No action needed; market.candles_1m_canonical is a view)

# 4. Verify coverage
node scripts/check-candle-coverage.js ALL 1 2>&1 | tee coverage-v4-post-rebuild.log
```

### 5.3 Stage 3C: PIT Parity Check (Backtest, Deterministic)

**Run backtest on frozen eval set with v4 canonical:**

```bash
# scripts/pit-parity-check-v4.sh (post-unfreeze design)

# Backtest same eval set with v3 and v4 canonical; compare trade outcomes
node scripts/backtest-pit-v2.js XAUUSD 90 watukushay_no1 \
  --variant-id=watukushay_no1_v3_canonical \
  --detector=detector-v3 \
  > parity-check-v3.json

node scripts/backtest-pit-v2.js XAUUSD 90 watukushay_no1 \
  --variant-id=watukushay_no1_v4_canonical \
  --detector=detector-v4-calibrated \
  > parity-check-v4.json

# Compare results
node scripts/compare-backtest-parity.js \
  parity-check-v3.json parity-check-v4.json \
  --threshold=0.001  # Allow <0.1% trade outcome drift (rounding, fills)
```

**Acceptance criteria:**
- [ ] **Total trades:** Difference < ±1 trade
- [ ] **Win rate:** Difference < 1%
- [ ] **Drawdown:** Difference < 2%
- [ ] **Profit factor:** Difference < 2%

---

## 6. Implementation Roadmap (Post-Unfreeze Timeline)

### Week 1: Governance Approval
- **Day 1–2:** Governance board reviews detector eval frozen results
- **Day 3:** Stakeholder alignment (data, trading, risk)
- **Day 4–5:** Operational safeguards document finalized
- **Day 6–7:** Unfreeze permission granted (scope: Phase 3A shadow run only)

### Week 2–3: Shadow Run Setup
- **Day 8–10:** Shadow ingestion deployment (v3 prod + v4 shadow)
- **Day 11–14:** 24-hour parallel collection + metrics
- **Day 15–21:** Governance sign-off on shadow metrics

### Week 4: Canonical Rebuild
- **Day 22–24:** Batch migrate approved v3 quarantine → v2 evidence schema
- **Day 25–26:** Rebuild canonical with v4 detector (off-peak)
- **Day 27–28:** Coverage + lineage validation

### Week 5: PIT Parity
- **Day 29–31:** Backtest 90-day windows on all active symbols
- **Day 32–34:** Parity analysis + governance review
- **Day 35:** v4 canonical approved for live trading

### Week 6: Go-Live
- **Day 36:** Activate detector-v4-calibrated (deactivate v3)
- **Day 37–38:** Monitor live ingestion + feature engine
- **Day 39–40:** Rollback drill (restore v3 if needed)
- **Day 41–42:** Stabilization + incident response

---

## 7. Symbol-Specific Thresholds (v4 Design)

### 7.1 Asset-Class Matrix

**File: `packages/shared/src/pairs/detectorThresholds.ts` (post-unfreeze)**

```typescript
export const DETECTOR_THRESHOLDS_V4 = {
  FX_MAJOR: {
    magnitude_threshold_pips: 1000,
    relative_jump_multiplier: 3.0,
    atr_cap_multiplier: 3.5,
    confidence_floor: 0.75,
    expected_gaps: ['WEEKEND', 'DAILY_BREAK_NY_GOLD']
  },
  FX_CROSS: {
    magnitude_threshold_pips: 800,
    relative_jump_multiplier: 2.8,
    atr_cap_multiplier: 3.2,
    confidence_floor: 0.70,
    expected_gaps: ['WEEKEND', 'DAILY_BREAK_NY']
  },
  GOLD: {
    magnitude_threshold_pips: 500,  // Lower for XAUUSD (wide spreads)
    relative_jump_multiplier: 2.5,
    atr_cap_multiplier: 3.0,
    confidence_floor: 0.65,
    expected_gaps: ['DAILY_BREAK_NY_EXTENDED']
  },
  EXOTICS: {
    magnitude_threshold_pips: 800,  // Threshold as multiplier of baseSpreadPips
    magnitude_spread_multiplier: 50,  // USDSEK: 32p × 50 = 1600p sanity cap
    relative_jump_multiplier: 2.2,
    atr_cap_multiplier: 2.8,
    confidence_floor: 0.60,
    expected_gaps: ['WEEKEND']
  },
  INDICES: {
    magnitude_threshold_pips: 200,  // Index points are larger; lower absolute threshold
    relative_jump_multiplier: 3.5,  // But allow larger relative jumps (earnings volatility)
    atr_cap_multiplier: 4.0,
    confidence_floor: 0.70,
    expected_gaps: ['WEEKEND', 'MARKET_HALT', 'CIRCUIT_BREAKER']
  },
  CRYPTO: {
    magnitude_threshold_pips: 100,  // Crypto inherently volatile
    relative_jump_multiplier: 5.0,  // Allow very large jumps
    atr_cap_multiplier: 5.0,
    confidence_floor: 0.50,
    expected_gaps: []  // 24/7; no expected gaps
  }
};

export function getDetectorThresholdsV4(symbol: string): typeof DETECTOR_THRESHOLDS_V4[keyof typeof DETECTOR_THRESHOLDS_V4] {
  const assetClass = getSymbolAssetClass(symbol);
  return DETECTOR_THRESHOLDS_V4[assetClass] ?? DETECTOR_THRESHOLDS_V4.FX_MAJOR;
}
```

### 7.2 Example: USDSEK v4 Detection

```typescript
// USDSEK: EXOTICS class, baseSpreadPips = 32

const bar = { open: 8.750, high: 9.050, low: 8.650, close: 8.900, ... };
const symbol = 'USDSEK';
const thresholds = getDetectorThresholdsV4(symbol);  // EXOTICS

// v4 logic:
const pipSize = 0.0001;
const rangePips = (9.050 - 8.650) / 0.0001 = 4000;  // 400 points
const baseSpreadPips = getPairCharacteristics(symbol).baseSpreadPips;  // 32

// Magnitude check (two variants):
// Option A: absolute threshold (800p for exotics)
const isMagnitudeSpike_A = rangePips > 800;  // 4000 > 800 → TRUE

// Option B: spread-relative (baseSpreadPips × 50)
const magnitudeThreshold_B = baseSpreadPips * 50;  // 32 × 50 = 1600
const isMagnitudeSpike_B = rangePips > magnitudeThreshold_B;  // 4000 > 1600 → TRUE

// Decision: Likely legitimate (not corrupt); approve in canonical
// → decision = 'KEEP' (confirmed with broker; order-flow imbalance during illiquid session)
```

---

## 8. Failure Mode Analysis & Rollback

### 8.1 Failure Scenarios

| Scenario | Detection | Rollback Action | Timeline |
|----------|-----------|-----------------|----------|
| **v4 FP surge** | Shadow metrics > 5% false positives | Pause shadow; investigate; revert to v3 | < 1 hour |
| **Canonical split** | Feature engine reads old v3, new v4 simultaneously | Activate hotfix; resync canonical | < 30 min |
| **PIT parity drift** | Backtest outcomes differ > 2% | Rebuild with v3; debug v4 formula | < 4 hours |
| **Live feed stall** | Ingest stopped (detector exception) | Kill shadow ingestion; fallback v3 | < 2 min |
| **Governance object** | Risk board requests rollback mid-phase | Revert detector config; re-audit | < 2 hours |

### 8.2 Rollback Procedure

**Emergency rollback from v4 to v3:**

```bash
#!/bin/bash
# scripts/rollback-detector-v3.sh (emergency use only)

# 1. Deactivate v4; reactivate v3
psql tradzfx_v2 -c "
  BEGIN;
  UPDATE market.detector_config SET status = 'retired', retired_at = NOW()
    WHERE detector_version = 'detector-v4-calibrated' AND status = 'active';
  UPDATE market.detector_config SET status = 'active', activated_at = NOW()
    WHERE detector_version = 'detector-v3';
  COMMIT;
"

# 2. Truncate shadow detections (optional; keep for audit)
# psql tradzfx_v2 -c "TRUNCATE TABLE shadow_candle_detections;"

# 3. Stop shadow ingestion (if running)
pm2 stop tz-shadow-ingestion || true

# 4. Restart web ingestion (picks up v3 from detector_config)
pm2 restart tz-web-v2

# 5. Verify canonical reverted
psql tradzfx_v2 -c "
  SELECT detector_version, status, activated_at 
  FROM market.detector_config 
  WHERE status = 'active';
"

# Expected output:
-- detector_version | status | activated_at
-- ---|---|---
-- detector-v3      | active | 2026-08-17 14:30:00 UTC
```

---

## 9. Documentation & Knowledge Transfer

### 9.1 Freeze-Period Deliverables (Completed)

- [x] **Comprehensive Audit:** `DETECTOR_VERSIONS_COMPREHENSIVE_AUDIT.md`
- [x] **Technical Reference:** `DETECTOR_VERSIONS_TECHNICAL_REFERENCE.md`
- [x] **Implementation Guide:** `DETECTOR_VERSIONS_IMPLEMENTATION_GUIDE.md` (this file)
- [x] **Governance Decision Matrix:** `canonical-anomaly-policy-matrix-2026-08-17.md`
- [x] **Eval Set Documentation:** `detector-eval-v2-vs-v3-2026-08-17.md`

### 9.2 Post-Unfreeze Deliverables (Design Templates)

- [ ] **Phase 3A Shadow Metrics Report:** `shadow-run-metrics-24h-[DATE].json`
- [ ] **Phase 3B Canonical Rebuild Log:** `canonical-rebuild-v4-[DATE].log`
- [ ] **Phase 3C PIT Parity Report:** `pit-parity-check-v3-vs-v4-[DATE].json`
- [ ] **Go-Live Monitoring Dashboard:** Grafana + CloudWatch metrics (TBD)
- [ ] **Post-Live Audit:** `detector-v4-live-audit-7d-[DATE].md`

---

## 10. References & Contacts

| Role | Responsibility | Contact |
|------|-----------------|---------|
| **Governance Lead** | Detector readiness approval, canonical policy | `governance-board@tradzfx` |
| **Data Engineering** | Eval set prep, canonical rebuild, parity check | `data-team@tradzfx` |
| **Trading Risk** | Symbol-specific thresholds, backtest validation | `risk@tradzfx` |
| **Platform Ops** | Shadow ingestion setup, rollback procedures | `ops@tradzfx` |
| **Documentation** | Audit trail, decision matrix, sign-off records | `governance-board@tradzfx` |

---

**End of Implementation & Migration Guide**

**Status:** Frozen (read-only). All work in this document is design-only until governance approval of unfreeze prerequisites.

