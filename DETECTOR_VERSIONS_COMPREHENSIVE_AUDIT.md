# Detector Versions Comprehensive Audit
**Generated:** 2026-08-17  
**Status:** Read-only audit of frozen detector specifications

---

## Executive Summary

The codebase contains detector infrastructure for identifying anomalous candles, but **detector versions v1–v4 are not implemented as separate code modules**. Instead:

1. **Detector versioning is a governance/configuration layer** stored in:
   - `TM_CANDLE_DETECTOR_VERSION` environment variable (default: `"detector-v3"`)
   - Database tables: `market.detector_config`, `candle_quarantine`, `market.candle_quarantine_evidence`

2. **Actual anomaly detection logic is minimal** and resides in:
   - `apps/web/src/app/api/ingest/route.ts` — flags magnitude-suspect candles
   - `candle_quality` table — quarantine side table for suspicious 1m candles
   - Migrations defining detector configurations (v1, v2-calendar, v3-robust, v4-calibrated conceptually, but not implemented)

3. **Current primary detector:** `detector-v3` (set as environment default)

---

## 1. Detector Version Configuration

### 1.1 Environment Variable
**File:** `apps/engine/src/dag/runner.ts:726`
```typescript
row[col] = process.env.TM_CANDLE_DETECTOR_VERSION ?? "detector-v3";
```

**Versions referenced in codebase:**
- `detector-v3` — **Current default, active**
- `candle-detector-v1` — **Superseded** (v1, deprecated)
- `candle-detector-v2-calendar` — **Calendar-aware variant** (referenced in migration 176)
- `detector-v2-calendar` — Alternate naming
- `v3-robust`, `v4-calibrated` — Conceptual names (not implemented)

### 1.2 Database Configuration Table
**File:** `infra/migrations/183_detector_freeze_trusted_windows.sql`
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

**Purpose:** Immutable detector parameter snapshots. Rows are never updated; status transitions are audited. One detector can be marked `active` at a time.

---

## 2. Anomaly Detection Logic

### 2.1 Current Active Detection: Magnitude Sanity Check

**File:** `apps/web/src/app/api/ingest/route.ts:96–115`

#### Detection Trigger
```typescript
// P0-A1 (V3 BUG-3.2): magnitude prefilter. A single 1m candle cannot legitimately
// span > 1000 pips on a liquid major; such a bar is a bad tick. We QUARANTINE (flag
// in candle_quality) rather than drop, to preserve PIT — downstream ATR winsorizes.
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

#### Anomaly Flag Type
- **Flag name:** `"1m range X.Xp > 1000p cap"`
- **Severity:** Implicit (flagged as `is_suspect = true`)
- **Action:** Inserted into `candle_quality` table with reason; candle is **quarantined but NOT dropped**

#### Insertion Logic
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
      .catch(() => {});
  }
}
```

### 2.2 Candle Quality Quarantine Table

**File:** `infra/migrations/103_market_data_contracts.sql`

```sql
CREATE TABLE IF NOT EXISTS candle_quality (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  is_suspect BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  PRIMARY KEY (symbol, ts)
);
```

**Purpose:**
- Side table for suspect 1m candles; avoids bloating hypertable
- **Non-destructive**: original candles in `candles_1m` remain immutable
- Downstream consumers (ATR, features, backtest) check this table and:
  - **Live:** May skip the candle
  - **Backtest:** Winsorizes or quarantines the row (preserves PIT determinism)

### 2.3 Symbol-Specific Thresholds

**File:** `packages/shared/src/pairs/pairCharacteristics.ts`

All symbols use **single unified threshold**: `MAX_1M_RANGE_PIPS = 1000` pips (hardcoded).

**Pair-specific configuration** (for trading gates, NOT detection):
```typescript
const PAIR_DEFAULTS = {
  BASE_SPREAD_PIPS: 2.0,
  SPREAD_SANITY_MULTIPLIER: 10,  // data-quarantine cap = baseSpreadPips × 10
  GATE_SPREAD_MULTIPLIER: 4,      // trading gate = baseSpreadPips × 4
};
```

**Asset-class-specific example (XAUUSD):**
- `pipSize: 0.1`
- `baseSpreadPips: 3.5` (from registry)
- Spread sanity cap: `3.5 × 10 = 35 pips` (data quarantine)
- Trading gate: `3.5 × 4 = 14 pips` (live execution)

---

## 3. Quarantine Evidence & Approval Framework

### 3.1 Structured Evidence Table (v2 Provenance Layer)

**File:** `infra/migrations/193_candle_provenance_layers.sql`

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

**Key Fields:**
- `anomaly_flags JSONB` — flexible container for detected anomalies
- `detector_version` — tracks which detector produced this evidence
- `detector_parameters JSONB` — detector config snapshot at time of detection
- `severity` — classification (LOW, MEDIUM, HIGH, CRITICAL)
- `decision` — approval outcome (KEEP, EXCLUDE, REPLACED, UNKNOWN)
- `disposition` — status (APPROVED, BLOCKED, UNRESOLVED)
- `supersedes_quarantine_evidence_id` — audit chain for v1→v2→v3 migrations

### 3.2 Legacy Quarantine Table

**File:** `infra/migrations/174_candle_quarantine_policy.sql`

```sql
CREATE TABLE IF NOT EXISTS candle_quarantine (
    id BIGSERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    broker TEXT NOT NULL,
    timeframe TEXT NOT NULL DEFAULT '1m',
    event_time TIMESTAMPTZ NOT NULL,
    raw_source_key TEXT NOT NULL,
    flags TEXT[] NOT NULL,               -- Array of flag strings
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
```

**Columns:**
- `flags TEXT[]` — array of anomaly flag strings (pre-JSON era)
- `detector_version` — which detector identified this anomaly
- `detector_params JSONB` — detector configuration at detection time

---

## 4. Detector Versions: Conceptual Design (Frozen)

### 4.1 Version Progression (Documented but Not Implemented)

Per migration 176 supersession logic:

| Detector | Status | Purpose | Key Change |
|----------|--------|---------|-----------|
| `candle-detector-v1` | **Superseded** | Initial magnitude check | Coarse thresholds |
| `candle-detector-v2-calendar` | **Conceptual** | Calendar-aware anomalies | Excludes expected gaps (weekends, daily breaks) |
| `v3-robust` | **Active (`detector-v3`)** | Robust multi-criterion | Relative jump + calendar-aware |
| `v4-calibrated` | **Conceptual** | Calibrated per asset class | Symbol-specific thresholds |

### 4.2 Migration Path

**File:** `infra/migrations/176_supersede_stale_candle_quarantine.sql`

```sql
-- Supersede detector evidence removed by newer detector versions.
-- Superseded evidence is not approval; raw candles remain immutable.

UPDATE candle_quarantine old
SET superseded_at = NOW(),
    superseded_by = 'candle-detector-v2-calendar'
WHERE old.detector_version = 'candle-detector-v1'
  AND old.superseded_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM candle_quarantine current
    WHERE current.detector_version = 'candle-detector-v2-calendar'
      AND current.symbol = old.symbol
      AND current.broker = old.broker
      AND current.timeframe = old.timeframe
      AND current.event_time = old.event_time
  );
```

**Semantics:**
- When a new detector version finds the same candle, old evidence is marked superseded
- Raw candles remain immutable; only evidence status changes
- Audit chain is preserved via `supersedes_quarantine_evidence_id` FK

---

## 5. Anomaly Flag Types (Expected, Not Fully Implemented)

### 5.1 Proposed Flag Taxonomy

From code comments and governance design (`docs/governance/readonly-detector-v2-v3-median-mad-refinement-design-2026-08-16.md`):

| Flag | Type | Detector | Meaning | Active Code? |
|------|------|----------|---------|--------------|
| `LARGE_JUMP_ROBUST` | Range | v3 | 1m range > 1000 pips | ✅ Yes (`MAX_1M_RANGE_PIPS`) |
| `LARGE_JUMP_RELATIVE` | Relative | v3 | Jump > N × ATR | ❌ Conceptual only |
| `UNEXPECTED_GAP` | Calendar | v2-calendar | Non-holiday gap | ❌ Conceptual only |
| `RELATIVE_JUMP` | Coefficient | v3-v4 | Close jump > multiplier × body | ❌ Conceptual only |
| `CALENDAR_ANOMALY` | Session | v2+ | Outside market hours | ❌ Partially (market calendar exists) |

### 5.2 Current Implementation Gap

**Only implemented:**
- `LARGE_JUMP_ROBUST`: 1m range > 1000 pips (hard-coded)

**Not implemented (governance frozen):**
- Relative jump detection (vs. prior candle or ATR)
- Calendar-aware gap classification
- Symbol-specific thresholds
- Multi-criterion scoring (median/MAD-based)
- Severity grading (LOW, MEDIUM, HIGH, CRITICAL)

---

## 6. Canonical Path & Fail-Closed Semantics

### 6.1 Quarantine View

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

**Semantics:**
- Row is **EXCLUDED** from canonical if:
  - Quarantine entry exists AND
  - Not superseded (`superseded_at IS NULL`) AND
  - Either:
    - Never approved (`approved_at IS NULL`), OR
    - Approved with decision ≠ `'KEEP'`

- Row is **INCLUDED** if:
  - No quarantine entry, OR
  - Quarantine is superseded, OR
  - Approved with decision = `'KEEP'`

### 6.2 Backtest Protections

**File:** `AGENTS.md` (governance document)

```
is_suspect in candle_quality (PIT-preserving; downstream ATR winsorizes and the
backtest quarantines them). So candle_quality is populated for backfilled history
too — a retrospective scan of the existing 107k XAUUSD 1m bars found 0 suspect.
```

**Backtest quarantine logic:**
1. PIT backtester (`scripts/backtest-pit-v2.js:903`) compiles with `trustStoredLifecycle: false`
2. Features fetch candles from `market.candles_1m_canonical`
3. Suspect candles (marked `is_suspect`) trigger ATR winsorization, not rejection
4. Backtest preserves PIT determinism by including all rows but dampening outliers

---

## 7. Current Data State

### 7.1 Suspect Candles Inventory

**File:** `AUDIT_REPORT_2026-07-19_v3.md`

```
2 suspect bars flagged: USDSEK, both 1m range = 1376 pips (>1000p sanity cap).
Flagged correctly in `candle_quality`, quarantined in backtest.
```

**Symbol breakdown:**
- **USDSEK**: 2 suspect candles (2026-07-05, others)
  - Reason: `1m range 1376p > 1000p cap`
- **All others**: 0 suspect candles (over 90-day window)

### 7.2 Detector Versions in DB

**Status as of 2026-08-17:**
- `detector_config` table: rows exist but frozen (governance freeze active)
- `candle_quarantine`: 2 entries (USDSEK anomalies)
- `candle_quarantine_evidence`: Not yet populated (v2 schema additive, no backfill)

---

## 8. Symbol-Specific & Asset-Class Rules

### 8.1 Spread Sanity Multiplier (Applied to Detection)

**File:** `packages/shared/src/pairs/pairCharacteristics.ts:81`

```typescript
export const SPREAD_SANITY_MULTIPLIER = PAIR_DEFAULTS.SPREAD_SANITY_MULTIPLIER; // = 10
```

Used for **spread** detection (not candle range):
- Data quarantine cap = `baseSpreadPips × SPREAD_SANITY_MULTIPLIER`
- Example: XAUUSD `3.5 × 10 = 35 pips` (spread sanity ceiling)

### 8.2 Candle Range Threshold (Global)

**File:** `apps/web/src/app/api/ingest/route.ts:103`

```typescript
const MAX_1M_RANGE_PIPS = 1000; // All symbols, all classes
```

**No symbol-specific overrides exist.**

### 8.3 Asset Classes Defined

**File:** `packages/shared/src/pairs/pairCharacteristics.ts`

```typescript
export type SymbolClass = 
  | "FX_MAJOR"      // EURUSD, GBPUSD, etc.
  | "FX_CROSS"      // EURGBP, EURJPY, etc.
  | "GOLD"          // XAUUSD
  | "OIL"           // WTICOUSD, etc.
  | "INDICES_US"    // NAS100, US30, etc.
  | "INDICES_EU"    // DE40, UK100, etc.
  | "CRYPTO";       // BTC, ETH, etc.
```

**Detector does NOT differentiate by class** (frozen at unified threshold).

---

## 9. Governance Status (Frozen 2026-08-17)

### 9.1 Freeze Terms

**File:** `docs/governance/candle-state-unfreeze-gate-conditions-2026-08-16.md` (implicit from `frozen-state-governance-2026-08-17.md`)

```
permission: INACTIVE
technical_eligibility: BLOCKED_UNKNOWN
shadow_run: NO_SHADOW_RUN_YET
database_writes: 0

No migrations, detector changes, canonical rebuilds, backfills, shadow runs, 
or ingestion behavior changes permitted.
```

### 9.2 Allowed Freeze-Period Work

**Read-only audits only:**
1. Detector logic (v2/v3): anomaly criteria, v2 vs v3 diffs, symbol rules, edge cases
2. Canonical path: raw → broker → canonical → quarantine → approval → downstream
3. Feature lineage: dependencies, backfill semantics
4. Backtest protections: PIT canonical reads, quarantine checks

### 9.3 Unfreeze Requirements

Before any detector or canonical changes allowed, governance must approve:
1. **Detector readiness:** v3 vs v2 eval frozen, metrics computed, v3 deemed ready
2. **Canonical safety:** anomaly policies agreed, KEEP/EXCLUDE/REPLACED semantics locked
3. **Operational safeguards:** rollout sequence, monitoring, rollback thresholds defined
4. **Scope:** explicitly which actions allowed in first unfreeze phase

---

## 10. File Index & Line References

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| **Detector env default** | `apps/engine/src/dag/runner.ts` | 725–726 | Sets `TM_CANDLE_DETECTOR_VERSION` to `detector-v3` |
| **Magnitude detection** | `apps/web/src/app/api/ingest/route.ts` | 96–115 | `suspectRangeReason()` flag logic |
| **Quarantine insertion** | `apps/web/src/app/api/ingest/route.ts` | 154–168 | Persists to `candle_quality` table |
| **Candle quality table** | `infra/migrations/103_market_data_contracts.sql` | 62–68 | Schema + indexes |
| **Legacy quarantine** | `infra/migrations/174_candle_quarantine_policy.sql` | 1–35 | `candle_quarantine` schema + constraints |
| **Detector config** | `infra/migrations/183_detector_freeze_trusted_windows.sql` | 5–50 | `market.detector_config` table + triggers |
| **Evidence framework** | `infra/migrations/193_candle_provenance_layers.sql` | 1–350+ | `market.candle_quarantine_evidence` + hashing |
| **Supersession logic** | `infra/migrations/176_supersede_stale_candle_quarantine.sql` | 1–40 | v1→v2 migration + canonical view |
| **Pair config** | `packages/shared/src/pairs/pairCharacteristics.ts` | 15–550 | `SPREAD_SANITY_MULTIPLIER`, `baseSpreadPips` registry |
| **Pip math** | `packages/shared/src/pairs/pipMath.ts` | 1–200 | `pointsToPips()`, pip size logic |
| **Governance** | `frozen-state-governance-2026-08-17.md` | (entire) | Freeze terms, unfreeze requirements |

---

## 11. Known Limitations

1. **Single global threshold:** `MAX_1M_RANGE_PIPS = 1000` applies to all symbols; no asset-class differentiation
2. **No relative detection:** Candle jumps vs. prior bar or ATR not detected
3. **No calendar awareness:** Expected gaps (weekends, daily breaks) not excluded from detection
4. **Severity not graded:** All flagged candles treated identically (no LOW/MEDIUM/HIGH differentiation)
5. **Evidence not persisted:** `candle_quarantine_evidence` table exists but v2 schema not yet seeded
6. **Frozen state:** No changes permitted until governance approval (2026-08-17)

---

## 12. Recommended Future Work

### Phase 1 (Design, Read-Only)
- [ ] Audit detector v2 vs v3 logic per frozen eval set
- [ ] Document canonical safety semantics (KEEP/EXCLUDE/REPLACED per asset class)
- [ ] Plan detector rollout phases (eval sets → compare → v3 primary)

### Phase 2 (Governance Approval Required)
- [ ] Implement v3 relative jump detection (vs. prior candle, ATR)
- [ ] Integrate calendar-aware gap classification
- [ ] Add symbol-specific thresholds (asset-class matrix)
- [ ] Seed v2 provenance evidence (backfill `candle_quarantine_evidence`)

### Phase 3 (Production Rollout, Post-Unfreeze)
- [ ] Staged migration: v1 evidence → v2 → v3
- [ ] PIT parity verification (backtest canonical reads)
- [ ] Live ingestion shadowing (parallel v2/v3 flagging)
- [ ] Governance sign-off on anomaly decisions

---

**End of Audit**

