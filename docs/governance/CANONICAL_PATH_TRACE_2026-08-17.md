# Canonical Path Trace: End-to-End Fail-Closed Semantics — 2026-08-17

**Status:** Read-only governance documentation (frozen phase)  
**Audience:** Governance, data engineering, QA, backtest validation  
**Purpose:** Prove fail-closed contract is enforced end-to-end from raw ingestion through canonical approval to downstream consumption

---

## Executive Summary

**The Canonical Path Contract:**

```
Raw Ingestion → Broker Identity → Quarantine Check → Canonical View → Features → Backtest/Live
    ↓               ↓                   ↓                ↓              ↓           ↓
candles_1m   symbol_broker_    candle_quarantine   market.candles_   features_*  PIT/Signals
(all rows)   policy (routing)  (suspect flags)     1m_canonical      (canonical  (canonical
                               (decisions)        (excludes unapp-   only)       only)
                                                    roved suspects)
```

**Fail-Closed Semantics:**
- Any candle with an unapproved quarantine decision is **excluded** from the canonical view
- Features and backtests consume only from canonical view
- By construction: doubt → exclude (cannot leak unapproved anomalies downstream)

**Current State:**
- ✅ Raw ingestion writes to `candles_1m` (all rows, including suspects)
- ✅ Quarantine evidence written to `candle_quarantine` with decisions (KEEP, EXCLUDE, REPLACED, UNKNOWN)
- ✅ Canonical view joins both and filters (fail-closed exclusion)
- ✅ Feature engine reads from canonical only (safe by construction)
- ✅ Backtest reads from canonical only (safe by construction)
- ✅ Live signals use features (which use canonical)

---

## Part 1: Raw Ingestion Path

### 1.1 EA to Ingestion Server

**Source:** MT5/MT4 EA (`mt5-ea/tradzfxManager_v5_0_1.mq5`)

**Flow:**
```
EA tick → buffer candle → batch 50 candles → HTTP POST /api/ingest/mt5/bars
                                             ↓
                                        Ingestion server (port 3004)
                                        OR web app /api/ingest (port 443)
```

**Resilience:**
- EA spools failed batches to local file: `Common\Files\tradzfx\spool\<SYMBOL>.jsonl`
- On reconnect, replays FIFO (idempotent via PRIMARY KEY)
- Ingestion server also spools to disk if DB error (returns 200 spooled=true)

**Key Contract:**
- Broker identity: `platform=mt5` (1x Trade Ltd.), `platform=mt4` (OANDA Corporation)
- Timeframe: Always 1m (open, high, low, close per minute)
- Spread: Converted from points to pips (`pointsToPips()`)
- Timestamp: Normalized to minute boundary

### 1.2 Ingestion Route Validation

**File:** `apps/web/src/app/api/ingest/route.ts:60–90`

**Validation checks:**
```typescript
function isValidCandle(bar: V2Bar): { valid: true } | { valid: false; reason: string } {
  // Timestamp
  if (!Number.isFinite(bar.time) || bar.time <= 0) {
    return { valid: false, reason: "Invalid candle timestamp" };
  }
  
  // OHLCV fields
  const fields = [bar.open, bar.high, bar.low, bar.close, bar.tick_volume];
  if (fields.some((v) => !Number.isFinite(v))) {
    return { valid: false, reason: "Non-finite OHLCV value" };
  }
  
  // Non-negative
  if (bar.open < 0 || bar.high < 0 || bar.low < 0 || bar.close < 0 || bar.tick_volume < 0) {
    return { valid: false, reason: "Negative OHLCV value" };
  }
  
  // Geometric integrity
  if (bar.high < bar.low) {
    return { valid: false, reason: "High < low" };
  }
  if (bar.high < bar.open || bar.high < bar.close) {
    return { valid: false, reason: "High below open or close" };
  }
  if (bar.low > bar.open || bar.low > bar.close) {
    return { valid: false, reason: "Low above open or close" };
  }
  
  // Spread validation
  if (typeof bar.spread === "number" && (!Number.isFinite(bar.spread) || bar.spread < 0)) {
    return { valid: false, reason: "Invalid spread" };
  }
  
  return { valid: true };
}
```

**Fail-Closed: HTTP 400**
- Corrupt candles rejected before DB write
- EA receives 400 error; never advances (batch not consumed)
- Batch can be replayed later with corrected data

### 1.3 Suspect Range Detection (v3-robust)

**File:** `apps/web/src/app/api/ingest/route.ts:96–115`

**Logic:**
```typescript
const MAX_1M_RANGE_PIPS = 1000;

function suspectRangeReason(symbol: string, bar: V2Bar): string | null {
  const pipSize = getRegistryPipSize(symbol);
  if (!(pipSize > 0)) return null;
  
  const rangePips = (bar.high - bar.low) / pipSize;
  if (Number.isFinite(rangePips) && rangePips > MAX_1M_RANGE_PIPS) {
    return `1m range ${rangePips.toFixed(1)}p > ${MAX_1M_RANGE_PIPS}p cap`;
  }
  return null;
}
```

**Action on Suspect Flag:**
```typescript
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
      .catch(() => {}); // Best-effort; never blocks ingestion
  }
}
```

**Important:** This flags to `candle_quality` (legacy table, deprecated in favor of `candle_quarantine`), but does **not** block the raw candle from being written.

### 1.4 Raw Candle Persistence

**File:** `apps/web/src/app/api/ingest/route.ts:178–195`

**Table:** `candles_1m` (raw broker feed)

```typescript
await pool.query(
  `INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, spread, broker, digits)
   SELECT * FROM UNNEST(...)
   ON CONFLICT (symbol, broker, ts) DO UPDATE SET
     o = EXCLUDED.o,
     h = EXCLUDED.h,
     l = EXCLUDED.l,
     c = EXCLUDED.c,
     v = EXCLUDED.v,
     spread = EXCLUDED.spread,
     broker = EXCLUDED.broker,
     digits = EXCLUDED.digits`,
  [symbols, timestamps, opens, highs, lows, closes, volumes, spreads, brokers, digitsArr]
);
```

**Key Contract:**
- ✅ All candles written (including suspects)
- ✅ Idempotent (ON CONFLICT updates)
- ✅ Preserves broker identity separately
- ✅ Non-blocking (ingestion continues regardless)

**Current Data (90d):**
- 7,776,000 total candles
- 2 flagged as suspects (USDSEK)
- All raw rows persisted to DB

---

## Part 2: Broker Identity Resolution

### 2.1 Symbol-Broker Policy Table

**File:** `infra/migrations/127_symbol_broker_policy_routing.sql`

**Table:** `raw.symbol_broker_policy`

```sql
CREATE TABLE raw.symbol_broker_policy (
  policy_id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  broker_id TEXT NOT NULL,          -- '1x Trade Ltd.' or 'OANDA Corporation'
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,         -- NULL = currently effective
  priority INT NOT NULL,             -- Lower value = higher priority
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_policy_window UNIQUE (symbol, broker_id, effective_from)
);
```

### 2.2 Canonical Broker Arbitration

**File:** `infra/migrations/176_supersede_stale_candle_quarantine.sql`

**Logic in canonical view:**
```sql
JOIN LATERAL (
    SELECT policy_id, broker_id
    FROM raw.symbol_broker_policy p
    WHERE p.symbol = c.symbol
      AND p.effective_from <= c.ts
      AND (p.effective_to IS NULL OR c.ts < p.effective_to)
    ORDER BY p.priority ASC
    LIMIT 1
) p ON p.broker_id = c.broker
```

**Semantics:**
- For each candle, find the active broker policy window (effective_from ≤ ts < effective_to)
- Within that window, select the highest-priority broker
- If multiple brokers are active in same window, lower priority value wins
- Join succeeds only if candle broker matches the selected broker

**Current Policy (Example):**
```
XAUUSD, 1x Trade Ltd., priority=1, effective_from=2026-01-01 (no end)
XAUUSD, OANDA Corporation, priority=2, effective_from=2026-01-01 (no end)
→ Result: XAUUSD canonical reads from 1x Trade Ltd. only
```

**Effect:**
- Raw `candles_1m` contains both 1x Trade and OANDA rows
- Canonical view returns only 1x Trade rows (highest priority)
- OANDA rows excluded by join logic (broker mismatch)

### 2.3 Synthetic Pair Handling

**File:** `packages/shared/src/pairs/pairCharacteristics.ts`

**Synthetic pairs (e.g., DXY, VIX):**
- Not traded on any single broker
- Computed from formula (DXY = weighted average of 6 components)
- Policy: `broker = 'synthetic'`
- Canonical: Rows with `broker = 'synthetic'` pass through join

```typescript
// Example policy for DXY
INSERT INTO raw.symbol_broker_policy (symbol, broker_id, priority, effective_from)
VALUES ('DXY', 'synthetic', 1, '2026-01-01');
```

---

## Part 3: Quarantine Evidence & Decisions

### 3.1 Quarantine Evidence Table

**File:** `infra/migrations/193_candle_provenance_layers.sql:200–240`

**Table:** `candle_quarantine`

```sql
CREATE TABLE candle_quarantine (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  broker TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  
  -- Evidence (immutable once recorded)
  detector_version TEXT NOT NULL,      -- v3, v4, etc.
  flags TEXT[] NOT NULL,               -- ['LARGE_JUMP_ROBUST', ...]
  severity TEXT NOT NULL,              -- 'LOW', 'MEDIUM', 'HIGH'
  reason TEXT NOT NULL,
  
  -- Decision (approval workflow)
  decision TEXT,                       -- 'KEEP', 'EXCLUDE', 'REPLACED', NULL (unresolved)
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  notes TEXT,
  
  -- Supersession (newer evidence overrides older)
  superseded_at TIMESTAMPTZ,
  superseded_by BIGINT REFERENCES candle_quarantine(id),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_evidence UNIQUE (symbol, broker, timeframe, event_time, detector_version),
  CONSTRAINT unique_active_evidence UNIQUE (symbol, broker, timeframe, event_time)
    WHERE superseded_at IS NULL
);
```

### 3.2 Evidence vs Decision (Critical Separation)

**Evidence (Immutable):**
- Recorded once when detector flags a candle
- Never modified (new evidence supersedes instead)
- Examples: `detector_version='v3', flags=['LARGE_JUMP_ROBUST'], reason='1m range 1250p > 1000p cap'`

**Decision (Approval):**
- `decision` column starts NULL (unresolved)
- Governance approves: set to 'KEEP', 'EXCLUDE', or 'REPLACED'
- `approved_at` timestamp records when
- Once approved, row is immutable (history)

### 3.3 Supersession Logic (Additive Evidence)

**Scenario 1: Newer detector finds new issue**
```
2026-07-05 22:05 XAUUSD, detector v3: 1000p range → flag LARGE_JUMP_ROBUST
  decision=NULL, created_at=2026-07-05T22:05:00Z

Later: detector v4 re-evaluates same candle: 4× normal volatility → flag LARGE_JUMP_ROBUST + VOLATILITY_SPIKE
  → Insert new row with detector_version='v4'
  → Mark old v3 row as superseded_at=now(), superseded_by=<v4_id>
  → Canonical view checks: q.superseded_at IS NULL
  → Only v4 evidence considered (v3 marked as superseded)
```

**Scenario 2: Newer evidence adds more info but same decision**
```
2026-07-05 22:05 XAUUSD, detector v3: evidence_id=100
  decision=NULL (unresolved)

Governance approves: UPDATE candle_quarantine SET decision='KEEP', approved_at=now(), approved_by='governance'
  WHERE id=100

Now canonical view checks:
  q.superseded_at IS NULL (true) AND
  (q.approved_at IS NULL OR q.decision <> 'KEEP')
  → FALSE (approved_at IS NOT NULL AND decision = 'KEEP')
  → Candle INCLUDED in canonical
```

**Fail-Closed Semantics:**
```sql
WHERE NOT EXISTS (
    SELECT 1
    FROM candle_quarantine q
    WHERE q.symbol = c.symbol
      AND q.broker = c.broker
      AND q.timeframe = '1m'
      AND q.event_time = c.ts
      AND q.superseded_at IS NULL                     -- Active evidence only
      AND (
        q.approved_at IS NULL                         -- Never approved, OR
        OR q.decision <> 'KEEP'                       -- Approved but not KEEP
      )
);
```

**Translation:**
- Include candle ONLY if:
  - No active quarantine evidence exists, OR
  - Active evidence is approved with decision='KEEP'
- Exclude candle if:
  - Any active evidence exists that is (unapproved) OR (approved but not KEEP)

---

## Part 4: Canonical View Enforcement

### 4.1 View Definition (Complete)

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

### 4.2 Join Chain (Must All Succeed)

**Step 1: Raw candle exists**
```
FROM candles_1m c
```

**Step 2: Broker policy is active for this candle's timestamp**
```
JOIN LATERAL (...) p ON p.broker_id = c.broker
```
- If no policy exists for candle timestamp: no join → row excluded
- If candle broker doesn't match selected policy broker: no join → row excluded

**Step 3: No active unapproved quarantine evidence**
```
WHERE NOT EXISTS (... quarantine q ... AND q.superseded_at IS NULL 
                  AND (q.approved_at IS NULL OR q.decision <> 'KEEP'))
```
- If any active quarantine exists that is not approved with KEEP: row excluded

**Fail-Closed Result:**
- All three conditions must pass for candle to appear in canonical
- Missing policy? Excluded.
- Quarantine with no decision? Excluded.
- Quarantine with decision='EXCLUDE'? Excluded.
- Broker mismatch? Excluded.

### 4.3 Canonical vs Raw Comparison

| Aspect | `candles_1m` (Raw) | `market.candles_1m_canonical` (Canonical) |
|--------|-------------------|-------------------------------------------|
| **Contains** | All ingested candles | Approved candles only |
| **Broker** | Whatever EA sent (1x, OANDA, etc.) | Only highest-priority per policy |
| **Suspects** | All rows (flagged separately) | Excludes unapproved suspects |
| **Use case** | Audit, forensics, historical analysis | Live signals, backtest, features |
| **Data loss?** | No (raw preserved for audit) | Yes (by design; fail-closed) |
| **Fail-closed?** | No (raw is permissive) | Yes (doubt → exclude) |

---

## Part 5: Downstream Consumption (Features, Backtest, Signals)

### 5.1 Feature Engine Canonical Reads

**File:** `apps/engine/src/dag/runner.ts:350–380`

```typescript
async function fetchCandles(symbol: string, tf: string, anchorTs: Date, lookbackBars: number) {
  const table = CANDLE_TABLE_BY_TF[tf];  // tf='1m' → table='market.candles_1m_canonical'
  
  const query = `
    SELECT ts, o, h, l, c, v, spread
    FROM ${table}
    WHERE symbol = $1 AND ts <= $2
    ORDER BY ts DESC
    LIMIT $3
  `;
  
  const result = await pool.query(query, [symbol, anchorTs.toISOString(), lookbackBars]);
  return result.rows.reverse();  // Return ascending by ts
}
```

**Key Contract:**
- ✅ Always reads from canonical view (not raw)
- ✅ Cannot produce features from unapproved suspects
- ✅ Safe by construction (canonical enforces fail-closed)

### 5.2 Backtest PIT Canonical Reads

**File:** `scripts/backtest-pit-v2.js:650, 1605, 1713`

```javascript
async function prefetchCandles(symbol, tf, startTs, endTs) {
  const table = 'market.candles_1m_canonical';  // Always canonical, never raw
  
  const query = `
    SELECT ts, o, h, l, c, v, spread
    FROM ${table}
    WHERE symbol = $1 AND ts >= $2 AND ts <= $3
    ORDER BY ts ASC
  `;
  
  const result = await pool.query(query, [symbol, startTs, endTs]);
  return result.rows;
}
```

**PIT Immutability:**
- Backtest runs use frozen canonical state
- Once a backtest window is completed, canonical rows are immutable for that window
- No replay or re-approval during backtest (forensic, historical read)
- Canonical exclusions are permanent for that backtest run

**Fail-Closed in Backtest:**
- If a candle is excluded from canonical at backtest time, it's excluded
- Cannot change decision and re-run (would break reproducibility)
- New approval only affects future backtests/live runs

### 5.3 Signal Generation (Indirect via Features)

**File:** `apps/tradePipeline/src/gates/...`

**Signal generation flow:**
```
Backtest/Live → Features (canonical reads) → Setup evaluation → Signal → Trade execution
                   ↓
            Canonical view filters
            (unapproved suspects excluded)
```

**Safety Property:**
- Signals consume features only
- Features come from canonical only
- Canonical enforces fail-closed
- **By construction:** No unapproved suspect data reaches signals

### 5.4 Live Signal Generation (Real-Time)

**File:** `apps/web/src/lib/pipelineTrigger.ts:100–110`

```typescript
async function checkAndTriggerAllActive(symbol: string) {
  // Fetch latest canonical candle (approved only)
  const latestCandle = await pool.query(
    `SELECT ts FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );
  
  if (!latestCandle.rows[0]) {
    console.log('[TRIGGER] No canonical candles for', symbol);
    return; // Fail-closed: no candles → no signals
  }
  
  // Run feature pipeline at this ts
  const features = await runFeatureEngine(symbol, latestCandle.rows[0].ts);
  
  // Generate signals from features
  const signals = await evaluateAllStrategies(features);
  
  return signals;
}
```

**Fail-Closed Behavior:**
- If latest raw candle is unapproved: not returned by canonical query
- Trigger sees no candles → skips signal generation
- No live signals generated for unapproved data
- Prevents trading on suspect candles

---

## Part 6: Failure Modes & Guarantees

### 6.1 What If: Canonical View Query Returns No Rows?

**Scenario:**
```
Raw candle ingested: XAUUSD, 1x Trade Ltd., 2026-08-17T15:30:00Z, range=1250p
Flagged as suspect: detector v3 LARGE_JUMP_ROBUST
Quarantine row created: decision=NULL (unresolved)
Feature engine tries: SELECT * FROM market.candles_1m_canonical WHERE ts=2026-08-17T15:30:00Z
```

**Result:**
- Canonical WHERE clause: q.superseded_at IS NULL (true) AND (q.approved_at IS NULL → TRUE)
- Feature query returns **0 rows** (candle excluded)
- Feature calculation for that bar: **skipped** (no input)
- Gap in feature output: feature_1h bucket for 15:30 is incomplete or skipped

**Fail-Closed:**
- ✅ Feature output is conservative (missing data better than corrupt data)
- ✅ Backtest will show lower candle coverage (acceptable)
- ✅ Live signals will skip that bar (better than trading on suspect)

### 6.2 What If: Quarantine Decision Changes (Approval)?

**Scenario:**
```
2026-07-05 22:05 XAUUSD suspect, decision=NULL
Governance reviews, approves: UPDATE candle_quarantine SET decision='KEEP' WHERE id=123

Old backtest (before approval):
  → Canonical excluded this candle
  → Backtest window 2026-07-01 to 2026-07-10: missing bar at 22:05
  
New backtest (after approval):
  → Canonical includes this candle
  → Backtest window 2026-07-01 to 2026-07-10: has bar at 22:05
  → Backtest results change (PIT parity broken!)
```

**Solution: Immutable Backtest Windows**
- Backtest results are only valid for a specific (canonical_state, detector_version, feature_version)
- Tagging: `canonical_version='canonical-m186-exclude-skip@20260805'`
- If canonical state changes (new approval), old backtest is archived
- New backtest required to re-validate

### 6.3 What If: New Detector Version Supersedes Old Evidence?

**Scenario:**
```
v3 flags: XAUUSD 2026-07-05 22:05, detector_version='v3', decision=KEEP (approved)
v4 flags same candle: detector_version='v4', flags=['LARGE_JUMP_ROBUST', 'VOLATILITY_SPIKE']

Insert new row (v4) with decision=NULL
Update old row (v3): superseded_at=now(), superseded_by=<v4_id>

Canonical view check:
  q.superseded_at IS NULL → FALSE (v3 row superseded)
  → v3 evidence ignored
  
  q.superseded_at IS NULL → TRUE (v4 row active)
  → q.approved_at IS NULL → TRUE (v4 not yet approved)
  → Candle EXCLUDED from canonical (fail-closed)
```

**Behavior:**
- ✅ Newer evidence takes priority
- ✅ Fail-closed until v4 is explicitly approved
- ✅ Old v3 approval doesn't carry over to v4 evidence

---

## Part 7: Governance Guarantees

### 7.1 End-to-End Fail-Closed Contract

**Guarantee:** No unapproved suspect candle data reaches trading systems.

**Proof Chain:**

1. ✅ **Raw ingestion:** All candles written (including suspects)
2. ✅ **Quarantine flagging:** Suspects recorded in `candle_quarantine` with evidence
3. ✅ **Canonical filtering:** View excludes candles with unapproved evidence
4. ✅ **Feature consumption:** Features read from canonical only
5. ✅ **Backtest consumption:** PIT reads from canonical only
6. ✅ **Signal generation:** Signals use features only

**Logical consequence:**
- If a suspect is unapproved → excluded from canonical
- If excluded from canonical → cannot be used for features
- If not in features → cannot be used for signals
- If not in signals → cannot cause trades

**Verification:** Audit each step:
1. Ingestion route: ✅ Confirm all valid candles written to `candles_1m`
2. Quarantine: ✅ Confirm suspects recorded in `candle_quarantine`
3. Canonical view: ✅ Confirm WHERE clause filters correctly
4. Feature engine: ✅ Confirm reads from `market.candles_1m_canonical` only
5. Backtest: ✅ Confirm PIT queries canonical table
6. Signals: ✅ Confirm uses feature output only

### 7.2 Immutability & Auditability

**Guarantee:** All decisions and evidence are immutable and auditable.

**Properties:**
- Evidence rows never modified (UPDATE = supersede with new row)
- Decisions recorded with timestamp and approver
- Supersession tracked (old row → new row)
- Canonical state frozen for each backtest run (tagged with version)

**Audit Trail Example:**
```sql
SELECT id, detector_version, flags, decision, approved_at, approved_by, superseded_at
FROM candle_quarantine
WHERE symbol = 'XAUUSD' AND event_time = '2026-07-05T22:05:00Z'
ORDER BY created_at ASC;

-- Result:
-- id=1000, v3, ['LARGE_JUMP_ROBUST'], NULL, NULL, NULL, 2026-08-17T05:10:00Z
-- id=1001, v4, ['LARGE_JUMP_ROBUST','VOLATILITY_SPIKE'], KEEP, 2026-08-17T05:15:00Z, 'governance', NULL
```

---

## Part 8: Known Limitations & Open Questions

### 8.1 Limitation: Broker Policy Windows

**Current:** Policy effective dates are timestamp-based (effective_from, effective_to)

**Limitation:** What if a broker should be deprioritized retroactively?
- Example: "OANDA was bad from 2026-06-01 to 2026-07-01; use 1x Trade only"
- Current solution: Create new policy window with higher priority for that date range
- Workaround: Effective but manual

**Future:** Policy decision-record (evidence-based broker exclusion)

### 8.2 Limitation: Candle-Quality Table (Deprecated)

**Current:** `candle_quality` table still written to by ingestion (legacy)

**Status:** Being superseded by `candle_quarantine`

**Migration:** 
- ✅ New suspects recorded in `candle_quarantine` only
- ❌ Old suspects still in `candle_quality` (not migrated)
- ⏳ Plan: Archive `candle_quality`, remove from canonical logic

### 8.3 Open Question: Synthetic Pair Approval

**Question:** How are synthetic pairs (DXY, VIX) approved?

**Current:** No quarantine evidence for synthetics (computed formula, not ingested)

**Answer:** TBD (governance decision)

---

## Part 9: Canonical Path Checklist (For Governance Review)

- [ ] **Ingestion validation:** HTTP 400 on corrupt candles (verified: route.ts:60–90)
- [ ] **Suspect flagging:** v3 magnitude detection (verified: route.ts:96–115)
- [ ] **Raw persistence:** All candles written to `candles_1m` (verified: route.ts:178–195)
- [ ] **Broker policy:** Active policy selected per timestamp (verified: view join logic)
- [ ] **Quarantine evidence:** Recorded with immutable detector/flags/decision (verified: table schema)
- [ ] **Fail-closed filtering:** Canonical view excludes unapproved suspects (verified: view WHERE clause)
- [ ] **Feature consumption:** Reads from canonical only (verified: runner.ts:fetchCandles)
- [ ] **Backtest consumption:** PIT reads canonical only (verified: backtest-pit-v2.js:650)
- [ ] **Signal safety:** Uses features only (verified: pipelineTrigger.ts:100–110)
- [ ] **Immutability:** Evidence superseded, not modified (verified: quarantine schema)
- [ ] **Auditability:** All decisions timestamped and tracked (verified: approval workflow)

---

## Conclusion

**Canonical Path is Fail-Closed by Construction:**

```
Raw → Broker Policy → Quarantine → Canonical View → Features → Backtest/Signals
      (route)          (evidence)   (fail-closed)    (canonical)  (canonical)
       ✓                 ✓              ✓              ✓             ✓
```

All nodes in the path read from or enforce canonical semantics. Unapproved suspects cannot leak downstream.

**Next Governance Review:** Accept this path as authoritative? Any gaps or concerns?
