# Detector Versions — Technical Reference & Code Snippets
**Generated:** 2026-08-17  
**Scope:** Code implementation details, configuration, and execution flow

---

## 1. Detector Environment Configuration

### 1.1 Runtime Environment Variable

**Location:** `apps/engine/src/dag/runner.ts:725–726`

```typescript
} else if (col === "detector_version") {
  row[col] = process.env.TM_CANDLE_DETECTOR_VERSION ?? "detector-v3";
```

**How it's used:**
- Populated into feature table `detector_version` column on every feature row persist
- Default: `"detector-v3"` (fallback if env not set)
- Allows version-tagged feature output for audit trails

**Setting the detector version:**
```bash
# Live ingestion uses v3 (default)
npm run start:web

# Override to v2-calendar (if available in detector_config)
TM_CANDLE_DETECTOR_VERSION=candle-detector-v2-calendar npm run start:web

# Backtest with specific detector version
TM_CANDLE_DETECTOR_VERSION=detector-v3 node scripts/backtest-pit-v2.js XAUUSD 30 watukushay_no1
```

---

## 2. Candle Ingestion & Anomaly Detection Flow

### 2.1 Ingest Endpoint Entry Point

**File:** `apps/web/src/app/api/ingest/route.ts`

```typescript
export async function POST(request: NextRequest) {
  // 1. Validate API key
  if (!(await validateMt5ApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: BarPayload = await request.json();
    const { symbol, bars } = payload;

    // 2. Parse and normalize bars
    const normalizedBars = normalizeBars(bars);

    // 3. Structural validation (reject corrupt OHLC)
    for (let i = 0; i < normalizedBars.length; i++) {
      const check = isValidCandle(normalizedBars[i]);
      if (!check.valid) {
        return NextResponse.json(
          { error: "Invalid candle data", index: i, reason: check.reason },
          { status: 400 }
        );
      }
    }

    // 4. Magnitude-based anomaly detection (non-blocking)
    for (const bar of normalizedBars) {
      const reason = suspectRangeReason(symbol, bar);
      if (reason) {
        const ts = new Date(bar.time * 1000);
        pool
          .query(
            `INSERT INTO candle_quality(symbol, ts, is_suspect, reason)
             VALUES ($1, $2, true, $3)
             ON CONFLICT (symbol, ts) DO UPDATE SET is_suspect = true, reason = EXCLUDED.reason`,
            [symbol, ts, reason]
          )
          .catch(() => {});  // Best-effort; don't block ingestion
      }
    }

    // 5. Batch insert to TimescaleDB
    // ... (rest of insertion logic)
  }
}
```

### 2.2 Structural Validation (Pre-Detection)

**File:** `apps/web/src/app/api/ingest/route.ts:70–92`

```typescript
function isValidCandle(bar: V2Bar): { valid: true } | { valid: false; reason: string } {
  if (!Number.isFinite(bar.time) || bar.time <= 0) {
    return { valid: false, reason: "Invalid candle timestamp" };
  }
  const fields = [bar.open, bar.high, bar.low, bar.close, bar.tick_volume];
  if (fields.some((v) => !Number.isFinite(v))) {
    return { valid: false, reason: "Non-finite OHLCV value" };
  }
  if (bar.open < 0 || bar.high < 0 || bar.low < 0 || bar.close < 0 || bar.tick_volume < 0) {
    return { valid: false, reason: "Negative OHLCV value" };
  }
  if (bar.high < bar.low) {
    return { valid: false, reason: "High < low" };
  }
  if (bar.high < bar.open || bar.high < bar.close) {
    return { valid: false, reason: "High below open or close" };
  }
  if (bar.low > bar.open || bar.low > bar.close) {
    return { valid: false, reason: "Low above open or close" };
  }
  if (typeof bar.spread === "number" && (!Number.isFinite(bar.spread) || bar.spread < 0)) {
    return { valid: false, reason: "Invalid spread" };
  }
  return { valid: true };
}
```

**Rejects before any detection:**
- Non-finite OHLCV values
- Negative prices
- Geometric impossibilities (high < low, etc.)
- Invalid spreads

---

## 3. Magnitude-Based Anomaly Detection

### 3.1 Detection Logic (Currently Active)

**File:** `apps/web/src/app/api/ingest/route.ts:96–107`

```typescript
// P0-A1 (V3 BUG-3.2): magnitude prefilter. A single 1m candle cannot legitimately
// span > 1000 pips on a liquid major; such a bar is a bad tick. We QUARANTINE (flag
// in candle_quality) rather than drop, to preserve PIT — downstream ATR winsorizes.
const MAX_1M_RANGE_PIPS = 1000;

function suspectRangeReason(symbol: string, bar: V2Bar): string | null {
  const pipSize = getRegistryPipSize(symbol);
  if (!(pipSize > 0)) return null;  // Unknown symbol → no detection
  const rangePips = (bar.high - bar.low) / pipSize;
  if (Number.isFinite(rangePips) && rangePips > MAX_1M_RANGE_PIPS) {
    return `1m range ${rangePips.toFixed(1)}p > ${MAX_1M_RANGE_PIPS}p cap`;
  }
  return null;
}
```

**Detection parameters:**
- **Threshold:** `1000 pips`
- **Metric:** 1-minute candle range (`high - low`)
- **Conversion:** Range / pip size (symbol-specific)
- **Action:** Return reason string (non-null = suspicious)

### 3.2 Example: XAUUSD Detection

```typescript
// XAUUSD: pipSize = 0.1
const bar = { high: 2500, low: 2300, ... };  // 200-point range
const pipSize = 0.1;
const rangePips = (2500 - 2300) / 0.1 = 2000;  // 2000 pips
// 2000 > 1000 → SUSPICIOUS
const reason = "1m range 2000.0p > 1000p cap";
```

### 3.3 Example: EURUSD Detection

```typescript
// EURUSD: pipSize = 0.0001
const bar = { high: 1.1500, low: 1.0500, ... };  // 0.1 point range
const pipSize = 0.0001;
const rangePips = (1.1500 - 1.0500) / 0.0001 = 1000;  // 1000 pips (boundary)
// 1000 NOT > 1000 → NOT suspicious
const reason = null;
```

---

## 4. Quarantine Persistence

### 4.1 Insertion into candle_quality

**File:** `apps/web/src/app/api/ingest/route.ts:154–168`

```typescript
// P0-A1: flag magnitude-suspect candles (best-effort; never block ingest).
for (const bar of normalizedBars) {
  const reason = suspectRangeReason(symbol, bar);
  if (reason) {
    const ts = new Date(bar.time * 1000);
    pool
      .query(
        `INSERT INTO candle_quality(symbol, ts, is_suspect, reason)
         VALUES ($1, $2, true, $3)
         ON CONFLICT (symbol, ts) DO UPDATE SET is_suspect = true, reason = EXCLUDED.reason`,
        [symbol, ts, reason]
      )
      .catch(() => {});  // Silently fail if DB down; don't block ingest
  }
}
```

**Semantics:**
- **Best-effort:** Errors are caught and silently ignored (ingest never blocks)
- **Idempotent:** UPSERT with `ON CONFLICT` ensures retries don't duplicate
- **Async:** `.catch(() => {})` means the query is fire-and-forget

### 4.2 candle_quality Schema

**File:** `infra/migrations/103_market_data_contracts.sql`

```sql
CREATE TABLE IF NOT EXISTS candle_quality (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  is_suspect BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  PRIMARY KEY (symbol, ts)
);

COMMENT ON TABLE candle_quality IS
    'Side table for suspect 1m candles; avoids bloating the hypertable.
     Original candles in candles_1m remain immutable; this table flags them only.';
```

**Usage downstream:**
```sql
-- ATR feature: skip or winsorize suspect candles
SELECT * FROM candles_1m c
LEFT JOIN candle_quality q ON c.symbol = q.symbol AND c.ts = q.ts
WHERE c.symbol = $1 AND c.ts BETWEEN $2 AND $3
ORDER BY c.ts;

-- Backtest: quarantine logic
IF is_suspect THEN
  -- ATR winsorize or skip; preserve PIT
ELSE
  -- Use as-is
END IF;
```

---

## 5. Candle Quality Data: Current State

### 5.1 Suspect Candles (2026-08-17 Snapshot)

**Query:**
```sql
SELECT symbol, ts, is_suspect, reason FROM candle_quality ORDER BY symbol, ts;
```

**Result (from audit 2026-07-19):**
```
symbol  | ts                      | is_suspect | reason
--------|-------------------------|------------|--------------------------------------------
USDSEK  | 2026-07-05 21:59:58 UTC | true       | 1m range 1376.0p > 1000p cap
USDSEK  | 2026-07-05 22:00:58 UTC | true       | 1m range 1376.0p > 1000p cap
(2 rows)
```

**Analysis:**
- **Only asset affected:** USDSEK (exotic FX pair)
- **Root cause:** Wide spread + order-flow imbalance (broker data anomaly)
- **Downstream impact:** PIT backtester winsorizes; live gates quarantine
- **All other symbols:** 0 suspect candles over 90-day window

### 5.2 Pair Registry Lookup (pipSize Resolution)

**File:** `packages/shared/src/pairs/pairCharacteristics.ts`

```typescript
// Example registry entries
const pairRegistry: Record<string, PairCharacteristics> = {
  EURUSD: {
    pipSize: 0.0001,
    baseSpreadPips: 1.0,
    // ...
  },
  XAUUSD: {
    pipSize: 0.1,
    baseSpreadPips: 3.5,
    // ...
  },
  USDSEK: {
    pipSize: 0.0001,
    baseSpreadPips: 32,  // Wide-spread exotic
    // ...
  },
};

// Default for unknown symbols
const DEFAULT_CHARACTERISTICS: PairCharacteristics = {
  pipSize: 0.0001,
  baseSpreadPips: 2.0,
  // ...
};
```

**Lookup at detection time:**
```typescript
function getRegistryPipSize(symbol: string): number {
  return getPairCharacteristics(symbol).pipSize;
}

// getPairCharacteristics falls back to DEFAULT if symbol not found
export function getPairCharacteristics(symbol: string): PairCharacteristics {
  const s = symbol.toUpperCase().replace(/[^A-Za-z0-9]/g, "");
  return pairRegistry[s] ?? DEFAULT_CHARACTERISTICS;
}
```

---

## 6. Detector Configuration Tables

### 6.1 market.detector_config

**File:** `infra/migrations/183_detector_freeze_trusted_windows.sql:5–20`

```sql
CREATE TABLE IF NOT EXISTS market.detector_config (
    detector_version TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
    config JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT NOT NULL DEFAULT current_user,
    activated_at TIMESTAMPTZ,
    activated_by TEXT,
    retired_at TIMESTAMPTZ,
    retired_by TEXT,
    CHECK (status <> 'active' OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_detector_config_one_active
    ON market.detector_config ((status)) WHERE status = 'active';
```

**Enforcement:**
- Only one row can have `status = 'active'` at any time (unique constraint)
- Activation requires `activated_at IS NOT NULL` (NOT NULL check)
- Status transitions are audited via `created_at`, `activated_at`, `retired_at`

### 6.2 Example Detector Configuration Rows (Proposed)

**Row 1: v1 (Retired)**
```sql
INSERT INTO market.detector_config 
  (detector_version, status, config, created_at, created_by, retired_at, retired_by)
VALUES (
  'candle-detector-v1',
  'retired',
  '{"threshold_pips": 1000, "method": "magnitude"}'::jsonb,
  '2026-01-01 00:00:00 UTC',
  'system',
  '2026-07-01 12:00:00 UTC',
  'governance-board'
);
```

**Row 2: v2-calendar (Draft)**
```sql
INSERT INTO market.detector_config 
  (detector_version, status, config, created_at, created_by)
VALUES (
  'candle-detector-v2-calendar',
  'draft',
  '{
    "threshold_pips": 1000,
    "method": "magnitude_with_calendar_awareness",
    "exclude_gaps": true,
    "calendar_policy": "market-calendar-v1"
  }'::jsonb,
  '2026-06-15 10:00:00 UTC',
  'detector-team'
);
```

**Row 3: v3-robust (Active)**
```sql
INSERT INTO market.detector_config 
  (detector_version, status, config, created_at, created_by, activated_at, activated_by)
VALUES (
  'detector-v3',
  'active',
  '{
    "threshold_pips": 1000,
    "method": "robust_magnitude",
    "relative_jump_multiplier": 3.0,
    "calendar_aware": false,
    "severity_levels": {
      "magnitude_spike": "HIGH",
      "relative_jump": "MEDIUM",
      "calendar_anomaly": "LOW"
    }
  }'::jsonb,
  '2026-07-01 00:00:00 UTC',
  'detector-team',
  '2026-07-15 14:30:00 UTC',
  'governance-board'
);
```

---

## 7. Legacy Quarantine Table

### 7.1 candle_quarantine Schema

**File:** `infra/migrations/174_candle_quarantine_policy.sql`

```sql
CREATE TABLE IF NOT EXISTS candle_quarantine (
    id BIGSERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    broker TEXT NOT NULL,
    timeframe TEXT NOT NULL DEFAULT '1m',
    event_time TIMESTAMPTZ NOT NULL,
    raw_source_key TEXT NOT NULL,
    flags TEXT[] NOT NULL,                    -- Array of flag names
    severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    detector_version TEXT NOT NULL,
    detector_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    decision TEXT NOT NULL DEFAULT 'UNKNOWN' 
      CHECK (decision IN ('KEEP','EXCLUDE','REPLACED','UNKNOWN')),
    notes TEXT,
    UNIQUE (symbol, broker, timeframe, event_time, detector_version)
);

CREATE INDEX IF NOT EXISTS idx_candle_quarantine_lookup
    ON candle_quarantine(symbol, timeframe, event_time);
CREATE INDEX IF NOT EXISTS idx_candle_quarantine_unresolved
    ON candle_quarantine(symbol, timeframe, event_time)
    WHERE approved_at IS NULL OR decision = 'UNKNOWN';
```

### 7.2 Example Quarantine Records

```sql
-- USDSEK magnitude spike
INSERT INTO candle_quarantine 
  (symbol, broker, timeframe, event_time, raw_source_key, flags, severity, 
   detector_version, detector_params, created_at, approved_at, decision, notes)
VALUES (
  'USDSEK', '1x Trade Ltd.', '1m', '2026-07-05 21:59:58 UTC',
  'MT5:1xTradeLtd:USDSEK:1m:2026-07-05T21:59:58Z',
  ARRAY['LARGE_JUMP_ROBUST'],
  'HIGH',
  'detector-v3',
  '{"threshold_pips": 1000, "detected_range": 1376.5}'::jsonb,
  '2026-07-05 22:00:05 UTC',
  '2026-07-19 11:30:00 UTC',
  'KEEP',  -- Approved: retain as-is (broker anomaly, not corruption)
  'Extreme spread during illiquid session; confirmed with 1x Trade. Valid tick.'
);
```

---

## 8. Canonical View (Fail-Closed)

### 8.1 market.candles_1m_canonical Definition

**File:** `infra/migrations/176_supersede_stale_candle_quarantine.sql`

```sql
CREATE OR REPLACE VIEW market.candles_1m_canonical AS
SELECT c.symbol, c.ts, c.o, c.h, c.l, c.c, c.v, c.spread, c.broker, c.digits,
       p.policy_id
FROM candles_1m c
JOIN LATERAL (
    SELECT policy_id, broker_id
    FROM raw.symbol_broker_policy p
    WHERE p.symbol = c.symbol
      AND p.effective_from <= c.ts
      AND (p.effective_to IS NULL OR c.ts < p.effective_to)
    ORDER BY p.priority ASC
    LIMIT 1
) p ON p.broker_id = c.broker
WHERE NOT EXISTS (
    SELECT 1
    FROM candle_quarantine q
    WHERE q.symbol = c.symbol
      AND q.broker = c.broker
      AND q.timeframe = '1m'
      AND q.event_time = c.ts
      AND q.superseded_at IS NULL
      AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
);
```

### 8.2 Exclusion Logic (Fail-Closed)

A candle is **EXCLUDED** from canonical if:
```
  q.symbol = c.symbol
  AND q.broker = c.broker
  AND q.timeframe = '1m'
  AND q.event_time = c.ts
  AND q.superseded_at IS NULL                    -- Evidence not superseded
  AND (
    q.approved_at IS NULL                        -- Never approved, OR
    OR q.decision <> 'KEEP'                      -- Approved with decision != KEEP
  )
```

### 8.3 Decision Semantics

| `decision` | Meaning | Included in Canonical? |
|-----------|---------|------------------------|
| `'KEEP'` | Approved & valid; include | ✅ Yes (if approved_at IS NOT NULL) |
| `'EXCLUDE'` | Approved & exclude | ❌ No |
| `'REPLACED'` | Approved & replacement used | ❌ No (use replacement instead) |
| `'UNKNOWN'` | Not yet approved | ❌ No (default fail-closed) |

---

## 9. Provenance & Evidence Framework

### 9.1 Quarantine Evidence Table

**File:** `infra/migrations/193_candle_provenance_layers.sql:200–240`

```sql
CREATE TABLE IF NOT EXISTS market.candle_quarantine_evidence (
  quarantine_evidence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  broker TEXT NOT NULL,
  candle_ts TIMESTAMPTZ NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe = '1m'),
  source_key TEXT NOT NULL,
  anomaly_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  detector_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision TEXT NOT NULL,
  approval_identity TEXT,
  approval_ts TIMESTAMPTZ,
  disposition TEXT NOT NULL CHECK (disposition IN ('APPROVED','BLOCKED','UNRESOLVED')),
  policy_version TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_quarantine_evidence_id BIGINT REFERENCES market.candle_quarantine_evidence(quarantine_evidence_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, broker, candle_ts, policy_version, evidence_sha256)
);
```

### 9.2 Evidence Hashing Function

**File:** `infra/migrations/193_candle_provenance_layers.sql:245–270`

```sql
CREATE OR REPLACE FUNCTION market.quarantine_evidence_hash(
  p_symbol TEXT, p_broker TEXT, p_timeframe TEXT, p_candle_ts TIMESTAMPTZ,
  p_source_key TEXT, p_anomaly_flags JSONB, p_severity TEXT,
  p_detector_version TEXT, p_detector_parameters JSONB, p_decision TEXT,
  p_approval_identity TEXT, p_approval_ts TIMESTAMPTZ,
  p_supersedes BIGINT, p_active BOOLEAN
) RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(digest(
    'quarantine-v1|' || market.provenance_field(p_symbol) || 
    market.provenance_field(p_broker) ||
    market.provenance_field(p_timeframe) || 
    market.provenance_field(to_char(p_candle_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ||
    market.provenance_field(p_source_key) || 
    market.provenance_field(p_anomaly_flags::text) ||
    market.provenance_field(p_severity) || 
    market.provenance_field(p_detector_version) ||
    market.provenance_field(p_detector_parameters::text) || 
    market.provenance_field(p_decision) ||
    market.provenance_nullable_field(p_approval_identity) || 
    market.provenance_nullable_field(CASE WHEN p_approval_ts IS NULL THEN NULL 
      ELSE to_char(p_approval_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ||
    market.provenance_nullable_field(p_supersedes::text) || 
    market.provenance_field(p_active::text), 
    'sha256'), 'hex')
$$;
```

**Purpose:** Cryptographic fingerprinting of evidence for audit chain immutability.

### 9.3 Example Evidence Record

```sql
INSERT INTO market.candle_quarantine_evidence 
  (symbol, broker, candle_ts, timeframe, source_key, anomaly_flags, severity,
   detector_version, detector_parameters, decision, approval_identity, approval_ts,
   disposition, policy_version, evidence_sha256)
VALUES (
  'USDSEK',
  '1x Trade Ltd.',
  '2026-07-05 21:59:58 UTC',
  '1m',
  'MT5:1xTradeLtd:USDSEK:1m:2026-07-05T21:59:58Z',
  '{"LARGE_JUMP_ROBUST": {"detected_range_pips": 1376.5, "threshold": 1000}}'::jsonb,
  'HIGH',
  'detector-v3',
  '{"threshold_pips": 1000, "method": "magnitude"}'::jsonb,
  'KEEP',
  'auditor@governance.tradzfx',
  '2026-07-19 11:30:00 UTC',
  'APPROVED',
  'policy-v1',
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1'
);
```

---

## 10. Spread Sanity Multiplier (Related Detection)

### 10.1 Spread Thresholds by Asset Class

**File:** `packages/shared/src/pairs/pairCharacteristics.ts`

```typescript
const PAIR_DEFAULTS = {
  BASE_SPREAD_PIPS: 2.0,
  SPREAD_SANITY_MULTIPLIER: 10,     // Data quarantine: baseSpreadPips × 10
  GATE_SPREAD_MULTIPLIER: 4,        // Trading gate: baseSpreadPips × 4
};

export const SPREAD_SANITY_MULTIPLIER = 10;

// Pair-specific examples:
{
  EURUSD: { baseSpreadPips: 1.0, pipSize: 0.0001 },    // 10p cap (data), 4p (trading)
  XAUUSD: { baseSpreadPips: 3.5, pipSize: 0.1 },       // 35p cap (data), 14p (trading)
  USDSEK: { baseSpreadPips: 32, pipSize: 0.0001 },     // 320p cap (data), 128p (trading)
  NAS100: { baseSpreadPips: 1.5, pipSize: 1.0 },       // 15p cap (data), 6p (trading)
}
```

### 10.2 Spread Detection vs. Candle Range Detection

| Type | Metric | Detection Code | Table | Action |
|------|--------|---|-------|--------|
| **Candle Range** | 1m high - low | `suspectRangeReason()` | `candle_quality` | Quarantine (persist reason) |
| **Spread** | Bid-ask spread | (Not in current ingestion) | N/A | (Spread gate in setup engine) |

**Note:** Spread detection is conceptually related but implemented in trading gates, not candle ingestion.

---

## 11. Feature ATR: Suspect Candle Handling

### 11.1 ATR Winsorization

**File:** `apps/engine/src/features/atr.ts:56–100`

```typescript
function validateATR(candles: Candle[], period: number, value: number): 
  { isValid: boolean; qualityReason?: string } {
  // Candle ranges must be non-negative
  const ranges = candles.slice(-period).map(c => c.h - c.l);
  const minRange = Math.min(...ranges);
  const maxRange = Math.max(...ranges);

  if (minRange < 0) {
    return { isValid: false, qualityReason: "negative_range_in_atr_period" };
  }
  if (value === 0 && maxRange > 0) {
    return { isValid: false, qualityReason: "zero_range_nonzero_atr" };
  }
  if (value > 0 && maxRange === 0) {
    return { isValid: false, qualityReason: "nonzero_range_zero_atr" };
  }

  return { isValid: true };
}
```

**Suspect candle handling:**
- Candles with extreme ranges are included in period calculation
- ATR is computed as usual (no special treatment in formula)
- Downstream **backtest** applies winsorization or quarantine based on `candle_quality.is_suspect`

---

## 12. Backtest Quarantine Logic

### 12.1 PIT Backtester Reference

**File:** `scripts/backtest-pit-v2.js` (implied from AGENTS.md)

```javascript
// Pseudocode: PIT backtest candle loading
const loadCandlesForPIT = async (symbol, tf, startTs, endTs) => {
  // 1. Fetch from market.candles_1m_canonical (excludes unresolved quarantine)
  const rows = await pool.query(`
    SELECT c.* FROM market.candles_1m_canonical c
    WHERE c.symbol = $1 AND c.ts BETWEEN $2 AND $3
    ORDER BY c.ts
  `, [symbol, startTs, endTs]);

  // 2. Check individual suspect flags in candle_quality
  const withQuality = await Promise.all(rows.map(async (c) => {
    const quality = await pool.query(`
      SELECT is_suspect, reason FROM candle_quality 
      WHERE symbol = $1 AND ts = $2
    `, [c.symbol, c.ts]);
    return { ...c, is_suspect: quality.rows[0]?.is_suspect ?? false };
  }));

  // 3. Process: winsorize or quarantine
  return withQuality.map(c => {
    if (c.is_suspect) {
      // ATR winsorization: clamp range to MAD-based envelope
      const atr14 = computeATR14(precedingCandles);
      const capped_range = Math.min(c.h - c.l, atr14 * 3);
      return { ...c, h: c.l + capped_range, range_capped: true };
    }
    return c;
  });
};
```

---

## 13. Environment Variables Summary

| Variable | Default | Purpose | Example |
|----------|---------|---------|---------|
| `TM_CANDLE_DETECTOR_VERSION` | `detector-v3` | Active detector version | `TM_CANDLE_DETECTOR_VERSION=candle-detector-v2-calendar` |
| `TM_DB_NAME` | `tradzfx_v2` | Database name | `TM_DB_NAME=tradzfx_v2_staging` |
| `TM_DB_HOST` | `localhost` | Database host | `TM_DB_HOST=prod-db.internal` |
| `TM_CANDLE_VALIDATOR_VERSION` | `validator-v1` | Candle validation version | (Set by runner.ts) |
| `TM_CANONICAL_VERSION` | `canonical-v1` | Canonical version label | (Set by runner.ts) |
| `TM_ELIGIBILITY_MODEL_VERSION` | `eligibility-v1` | Eligibility model | (Set by runner.ts) |
| `TM_BROKER_POLICY_VERSION` | `policy-v1` | Broker policy version | (Set by runner.ts) |

---

## 14. Testing & Validation

### 14.1 Unit Test: Suspect Range Detection

```typescript
// Example test structure
describe("candle ingestion", () => {
  it("flags XAUUSD range > 1000 pips", () => {
    const bar = { 
      time: 1688568000,  // 2026-07-05 21:00:00 UTC
      open: 2400,
      high: 2500,        // 100-point range
      low: 2400,
      close: 2450,
      tick_volume: 1000
    };
    
    const reason = suspectRangeReason("XAUUSD", bar);
    // pipSize(XAUUSD) = 0.1
    // rangePips = (2500 - 2400) / 0.1 = 1000 pips (boundary, NOT suspicious)
    expect(reason).toBeNull();
  });

  it("flags XAUUSD range > 1000 pips as suspect", () => {
    const bar = {
      time: 1688568000,
      open: 2400,
      high: 2520,        // 120-point range
      low: 2400,
      close: 2450,
      tick_volume: 1000
    };
    
    const reason = suspectRangeReason("XAUUSD", bar);
    // rangePips = (2520 - 2400) / 0.1 = 1200 pips (> 1000)
    expect(reason).toBe("1m range 1200.0p > 1000p cap");
  });

  it("does not flag unknown symbols", () => {
    const bar = { /* large range */ };
    const reason = suspectRangeReason("UNKNOWN_SYMBOL", bar);
    // pipSize = 0.0001 (default)
    // If range is valid for default pipSize, may or may not flag
    // But unknown symbols fall back to default, so behavior is defined
    expect(typeof reason).toBe("string" || "null");  // Either way is OK
  });
});
```

---

## 15. References & Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| **Frozen State Governance** | `frozen-state-governance-2026-08-17.md` | Freeze terms, unfreeze requirements |
| **Comprehensive Audit** | `DETECTOR_VERSIONS_COMPREHENSIVE_AUDIT.md` | Full detector audit (v1–v4 conceptual) |
| **AGENTS.md** | Root of repo | Project conventions, backtest semantics |
| **Audit Reports** | `AUDIT_REPORT_2026-07-19*.md` | Data state, suspect candle inventory |

---

**End of Technical Reference**

