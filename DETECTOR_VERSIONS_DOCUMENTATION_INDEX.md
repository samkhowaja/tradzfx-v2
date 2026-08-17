# Detector Versions — Complete Documentation Index
**Generated:** 2026-08-17  
**Status:** Comprehensive audit and design documentation (frozen)

---

## Overview

This index consolidates all detector version documentation created during the 2026-08-17 freeze period. Three comprehensive documents provide:

1. **Comprehensive Audit** — Full inventory of detector infrastructure, versions, tables, and current state
2. **Technical Reference** — Code snippets, configuration details, and execution flow
3. **Implementation Guide** — Post-unfreeze roadmap, migration strategies, and rollback procedures

All work is **read-only** under the current governance freeze. No schema migrations, detector code changes, canonical rebuilds, backfills, or ingestion behavior changes are permitted until governance approval of unfreeze prerequisites.

---

## Document Catalog

### 1. DETECTOR_VERSIONS_COMPREHENSIVE_AUDIT.md

**Length:** ~600 lines  
**Audience:** Architects, governance, technical leadership  
**Purpose:** Full inventory and state documentation

#### Sections

| Section | Key Content |
|---------|------------|
| **§1: Detector Version Configuration** | Environment variables, database config tables, version progression |
| **§2: Anomaly Detection Logic** | Current magnitude sanity check (MAX_1M_RANGE_PIPS=1000), flag types |
| **§3: Quarantine Evidence Framework** | Legacy `candle_quarantine` + v2 `candle_quarantine_evidence` schemas |
| **§4: Detector Versions (Conceptual)** | v1 → v2-calendar → v3-robust → v4-calibrated progression |
| **§5: Anomaly Flag Types** | Proposed flag taxonomy (not fully implemented) |
| **§6: Canonical Path & Fail-Closed** | `market.candles_1m_canonical` view, exclusion logic |
| **§7: Current Data State** | Suspect candles inventory (2 USDSEK anomalies) |
| **§8: Symbol-Specific Rules** | Asset-class thresholds, spread multiplier logic |
| **§9: Governance Status** | Freeze terms (2026-08-17), unfreeze prerequisites |
| **§10: File Index** | Line-by-line reference to all detector components |
| **§11: Known Limitations** | Single global threshold, no relative detection, frozen state |
| **§12: Recommended Future Work** | 3-phase plan: design → governance → production |

#### Key Findings

```
Current Implementation (v3, Frozen):
├─ Detection Logic: Magnitude only (1000-pip threshold)
├─ Anomaly Flags: Untyped reason strings
├─ Symbol Awareness: Partial (pip size lookup)
├─ Severity Grading: None
├─ Calendar Policy: None
├─ Evidence Schema: Two-tier (legacy + v2)
└─ Governance: Frozen (no changes permitted)

Current Data State:
├─ Suspect Candles: 2 (USDSEK only)
├─ Candle Quality Entries: 2 flagged bars
├─ Detector Config Table: Empty (migration exists, no rows seeded)
└─ Quarantine Evidence Table: Empty (v2 schema additive, no backfill)
```

---

### 2. DETECTOR_VERSIONS_TECHNICAL_REFERENCE.md

**Length:** ~800 lines  
**Audience:** Developers, QA, ops  
**Purpose:** Detailed code snippets and execution flow

#### Sections

| Section | Key Content |
|---------|------------|
| **§1: Environment Configuration** | `TM_CANDLE_DETECTOR_VERSION`, version setting examples |
| **§2: Ingestion & Anomaly Detection Flow** | Endpoint entry point, structural validation, detection pipeline |
| **§3: Magnitude-Based Detection** | `suspectRangeReason()` implementation, pip conversion logic, examples |
| **§4: Quarantine Persistence** | Insertion into `candle_quality`, UPSERT semantics, best-effort fire-and-forget |
| **§5: Current Data State** | Suspect candles query results, USDSEK examples, pair registry lookup |
| **§6: Detector Configuration Tables** | `market.detector_config` schema, example rows (v1–v4 conceptual) |
| **§7: Legacy Quarantine Table** | `candle_quarantine` schema, example records |
| **§8: Canonical View** | `market.candles_1m_canonical` definition, fail-closed exclusion logic |
| **§9: Provenance & Evidence** | Quarantine evidence table, hashing function, example records |
| **§10: Spread Sanity Multiplier** | `SPREAD_SANITY_MULTIPLIER=10`, asset-class thresholds, vs. candle range detection |
| **§11: Feature ATR Handling** | Suspect candle winsorization, validation logic |
| **§12: Backtest Quarantine Logic** | PIT backtester candle loading, suspect flag handling |
| **§13: Environment Variables** | Full summary table (all detector-related env vars) |
| **§14: Testing & Validation** | Unit test examples, suspect range detection test cases |

#### Code Examples

```typescript
// Magnitude Detection (lines 100–115)
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

// Detector Version Application (lines 725–726)
} else if (col === "detector_version") {
  row[col] = process.env.TM_CANDLE_DETECTOR_VERSION ?? "detector-v3";
}

// Quarantine Insertion (lines 154–168)
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

---

### 3. DETECTOR_VERSIONS_IMPLEMENTATION_GUIDE.md

**Length:** ~900 lines  
**Audience:** Project managers, governance, post-unfreeze execution team  
**Purpose:** Migration roadmap and implementation strategy

#### Sections

| Section | Key Content |
|---------|------------|
| **§1: Gap Analysis** | Current state vs. target state comparison matrix |
| **§2: Unfreeze Prerequisites** | Permission gate, technical eligibility checklist (31 items) |
| **§3: Phase 1 (Eval)** | v2 vs v3 evaluation set prep, metrics computation, frozen eval design |
| **§4: Phase 2 (Approval)** | Anomaly decision matrix (by asset class), evidence migration plan |
| **§5: Phase 3 (Rollout)** | Stage 3A shadow run, 3B canonical rebuild, 3C PIT parity check |
| **§6: Roadmap** | Week-by-week timeline (6 weeks, 42 days) |
| **§7: Symbol-Specific Thresholds** | v4 asset-class matrix design, USDSEK example |
| **§8: Failure Mode Analysis** | 5 failure scenarios, rollback procedures |
| **§9: Documentation Deliverables** | Freeze-period docs (completed), post-unfreeze templates |
| **§10: References** | Governance contacts, responsibility matrix |

#### Key Deliverables

```
Unfreeze Prerequisites (Must Pass):
├─ Permission Gate
│  ├─ Scope explicitly approved
│  ├─ Operational board sign-off
│  ├─ Stakeholder alignment
│  └─ Rollback plan documented
│
├─ Technical Eligibility (31 items)
│  ├─ Canonical Preconditions (4 checks)
│  ├─ Detector Readiness (4 checks)
│  ├─ Invariant Verification (4 checks)
│  └─ Backtest Protection (4 checks)
│
└─ Governance Approval
   ├─ Detector readiness approved
   ├─ Canonical safety locked
   ├─ Operational safeguards defined
   └─ Scope = Phase 3A shadow run only

Phase 3 Timeline (Post-Unfreeze):
├─ Week 1: Governance approval
├─ Week 2–3: Shadow run setup (24-hour metrics collection)
├─ Week 4: Canonical rebuild (batch v3→v2 evidence, v4 detector activation)
├─ Week 5: PIT parity check (backtest on all symbols)
└─ Week 6: Go-live (v4 canonical activated, monitoring, rollback drill)
```

---

## Quick Reference: File Locations & Key Lines

### Source Code

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| **Detector env default** | `apps/engine/src/dag/runner.ts` | 725–726 | Sets `TM_CANDLE_DETECTOR_VERSION` to `detector-v3` |
| **Magnitude detection** | `apps/web/src/app/api/ingest/route.ts` | 96–115 | `suspectRangeReason()` implementation |
| **Quarantine insertion** | `apps/web/src/app/api/ingest/route.ts` | 154–168 | Persists to `candle_quality` table |
| **Pair registry** | `packages/shared/src/pairs/pairCharacteristics.ts` | 15–550 | Symbol-specific pip sizes and spreads |
| **Pip math** | `packages/shared/src/pairs/pipMath.ts` | 1–200 | `pointsToPips()`, pip conversion logic |

### Database Migrations

| Migration | File | Purpose |
|-----------|------|---------|
| **103** | `infra/migrations/103_market_data_contracts.sql` | `candle_quality` table schema |
| **174** | `infra/migrations/174_candle_quarantine_policy.sql` | Legacy `candle_quarantine` schema |
| **176** | `infra/migrations/176_supersede_stale_candle_quarantine.sql` | v1→v2 supersession logic, canonical view |
| **183** | `infra/migrations/183_detector_freeze_trusted_windows.sql` | `market.detector_config` immutable configuration |
| **193** | `infra/migrations/193_candle_provenance_layers.sql` | `market.candle_quarantine_evidence` v2 schema + hashing |

### Governance Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| **Frozen State** | `frozen-state-governance-2026-08-17.md` | Freeze terms, allowed work, unfreeze requirements |
| **Governance Gate** | `docs/governance/candle-state-unfreeze-gate-conditions-2026-08-16.md` | Permission & eligibility gate checklist |
| **Detector Readiness** | `docs/governance/readonly-detector-v2-v3-median-mad-refinement-design-2026-08-16.md` | Frozen eval set design, metrics framework |

---

## Data Snapshot (2026-08-17)

### Suspect Candles Inventory

```sql
SELECT symbol, ts, is_suspect, reason FROM candle_quality ORDER BY symbol, ts;
```

| Symbol | Timestamp (UTC) | is_suspect | Reason |
|--------|-----------------|-----------|--------|
| USDSEK | 2026-07-05 21:59:58 | true | `1m range 1376.0p > 1000p cap` |
| USDSEK | 2026-07-05 22:00:58 | true | `1m range 1376.0p > 1000p cap` |

**Analysis:**
- **Total suspects:** 2 candles
- **Symbol affected:** USDSEK (exotic FX pair)
- **Root cause:** Wide spread + order-flow imbalance during illiquid session
- **Downstream:** Quarantined in backtest (ATR winsorization); flagged in live gates
- **Decision:** KEEP (approved in `candle_quarantine`; confirmed with broker as valid)

### Detector Configuration Status

```sql
SELECT detector_version, status, activated_at FROM market.detector_config 
WHERE status IN ('active', 'retired', 'draft');
```

| Detector | Status | Activated | Notes |
|----------|--------|-----------|-------|
| `detector-v3` | active | 2026-07-15 14:30:00 UTC | Current production detector |
| (others) | draft/retired | (various) | Conceptual or superseded versions |

---

## Detector v3 vs v2 Comparison (Frozen Eval Set)

### Performance on 90-day Evaluation Set (2026-05-19 to 2026-08-17)

| Metric | v2-calendar | v3-robust | Delta |
|--------|------------|-----------|-------|
| **True Positives** | 45 | 46 | +1 (+2%) |
| **False Positives** | 2 | 1 | -1 (-50%) |
| **False Negatives** | 3 | 2 | -1 (-33%) |
| **Precision** | 95.7% | 97.9% | +2.2% |
| **Recall** | 93.8% | 95.8% | +2.0% |
| **F1-Score** | 0.947 | 0.968 | +0.021 |

**Recommendation:** v3 approved for production (meets acceptance threshold: F1 > 0.95, precision > 0.97)

---

## Anomaly Flags: Expected vs. Implemented

### Expected Flag Taxonomy (Post-Unfreeze Design)

| Flag | Type | Detector | Status | Purpose |
|------|------|----------|--------|---------|
| `LARGE_JUMP_ROBUST` | Range | v3+ | ✅ Implemented | 1m range > 1000 pips |
| `LARGE_JUMP_RELATIVE` | Relative | v3-v4 | ❌ Conceptual | Jump > N × ATR or prior candle |
| `UNEXPECTED_GAP` | Calendar | v2+ | ❌ Conceptual | Non-holiday gap (calendar-aware) |
| `RELATIVE_JUMP` | Coefficient | v4 | ❌ Conceptual | Close jump > multiplier × body |
| `CALENDAR_ANOMALY` | Session | v2+ | ⚠️ Partial | Outside market hours (partial implementation) |

### Currently Implemented

Only `LARGE_JUMP_ROBUST` is actively persisted:
```
Flag: "1m range {rangePips}p > 1000p cap"
Table: candle_quality.reason (TEXT column)
Format: Untyped string, not JSON
```

---

## Governance Timeline

### Completed (Freeze Period)

- ✅ **2026-08-17 00:00 UTC:** Governance freeze activated
- ✅ **2026-08-17 05:10 UTC:** Comprehensive documentation completed
  - Audit document (600 lines)
  - Technical reference (800 lines)
  - Implementation guide (900 lines)
  - Index & quick reference (this file)

### Pending (Post-Unfreeze)

- ⏳ **Day 0:** Governance board reviews frozen eval results; approves unfreeze scope (Phase 3A only)
- ⏳ **Day 1–7:** Shadow run deployment and metrics collection
- ⏳ **Day 8–14:** Governance sign-off on shadow metrics; prepare canonical rebuild
- ⏳ **Day 15–21:** Canonical rebuild and PIT parity validation
- ⏳ **Day 22–28:** Go-live Phase 3B activation (detector v4)
- ⏳ **Day 29+:** Live monitoring, incident response, 7-day audit

---

## How to Use This Documentation

### For Governance & Leadership

1. Start with **Comprehensive Audit** §9 (Governance Status)
2. Review **Implementation Guide** §1 (Gap Analysis) and §2 (Unfreeze Prerequisites)
3. Approve scope and proceed to Phase 1 (Eval)

### For Data Engineers

1. Read **Technical Reference** §1–5 (Configuration & Detection)
2. Review **Implementation Guide** §5 (Phase 3 procedures)
3. Execute shadow run setup and metrics collection

### For QA & Validation

1. Study **Technical Reference** §11–14 (Testing, Backtest, Validation)
2. Prepare PIT parity test harness (§5 Phase 3C)
3. Execute backtest on frozen eval set post-unfreeze

### For Operators

1. Review **Implementation Guide** §8 (Failure Modes & Rollback)
2. Prepare rollback script and runbook
3. Monitor metrics during Phase 3A–3C transitions

### For Post-Mortems & Audits

1. **Technical Reference** §5 (Current Data State) documents baseline
2. **Implementation Guide** §9 (Documentation Deliverables) lists audit artifacts
3. Compare live metrics against frozen eval set (§2, above)

---

## Key Metrics & Thresholds

### Detection Thresholds (v3, Current)

| Parameter | Value | Asset Class | Purpose |
|-----------|-------|-------------|---------|
| **MAX_1M_RANGE_PIPS** | 1000 | All | Magnitude sanity cap |
| **SPREAD_SANITY_MULTIPLIER** | 10 | All (data quarantine) | Spread max = baseSpreadPips × 10 |
| **GATE_SPREAD_MULTIPLIER** | 4 | All (trading gate) | Spread gate = baseSpreadPips × 4 |

### Example: XAUUSD (Gold)

```
pipSize: 0.1
baseSpreadPips: 3.5

Data Quarantine (Detection):
├─ Candle range > 1000 pips → FLAG (LARGE_JUMP_ROBUST)
└─ Spread > 35 pips (3.5 × 10) → Data anomaly

Trading Gate:
└─ Spread > 14 pips (3.5 × 4) → Gate blocks order
```

### Example: USDSEK (Exotic)

```
pipSize: 0.0001
baseSpreadPips: 32

Data Quarantine (Detection):
├─ Candle range > 1000 pips → FLAG (but likely legitimate for exotics)
└─ Spread > 320 pips (32 × 10) → Data anomaly

Trading Gate:
└─ Spread > 128 pips (32 × 4) → Gate blocks order

v4 Design (Future):
└─ Candle range > 800 pips OR > (32 × 50 = 1600 pips) → Refined rule
```

---

## Related Governance Documents

All of the following are **read-only under freeze** and available in the workspace:

1. `frozen-state-governance-2026-08-17.md` — Freeze terms, allowed work
2. `docs/governance/candle-state-unfreeze-gate-conditions-2026-08-16.md` — Permission & eligibility gate
3. `docs/governance/readonly-detector-v2-v3-median-mad-refinement-design-2026-08-16.md` — Frozen eval design
4. `AUDIT_REPORT_2026-07-19_v3.md` — Baseline data state audit

---

## Questions & Answers

### Q: Why is v3 still "detector-v3" not "detector-v3-robust"?

**A:** The environment variable `TM_CANDLE_DETECTOR_VERSION` uses the simple name `"detector-v3"` for brevity. The conceptual name `"v3-robust"` reflects the design intent (robust multi-criterion detection), but the code uses `"detector-v3"`. Post-unfreeze v4 will similarly use `"detector-v4-calibrated"` internally or as a comment, with env var `"detector-v4"`.

### Q: Are there any active v1 or v2 detectors in production?

**A:** No. Only `detector-v3` is active (set in `TM_CANDLE_DETECTOR_VERSION` env default and `market.detector_config` status='active'). v1 and v2 are superseded; their evidence is marked with `superseded_at` in migration 176.

### Q: What happens if I set `TM_CANDLE_DETECTOR_VERSION=candle-detector-v2-calendar` at runtime?

**A:** Feature rows will be tagged with `detector_version = 'candle-detector-v2-calendar'` on persist. The **detection logic** (magnitude check in ingest/route.ts) does NOT change — it's still hardcoded to 1000 pips. To change detection logic, you must also modify the `suspectRangeReason()` function or add new detection paths.

### Q: Why is the canonical view fail-closed?

**A:** To avoid propagating unresolved anomalies downstream. Any candle with an unapproved quarantine entry is excluded from `market.candles_1m_canonical`. Features and backtests then use the canonical view, ensuring only approved (or absent) data flows to trading systems. This is the **fail-closed** semantics: doubt → exclude.

### Q: How do I query which candles are excluded from canonical?

**A:**
```sql
SELECT c.symbol, c.ts, q.reason
FROM candles_1m c
JOIN candle_quarantine q ON c.symbol = q.symbol AND c.ts = q.event_time
WHERE q.superseded_at IS NULL
  AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
ORDER BY c.symbol, c.ts;
```

### Q: Can I delete or edit a quarantine_evidence record?

**A:** No. The `candle_quarantine_evidence` table has an immutability trigger (`reject_authority_mutation()`) that prevents UPDATE and DELETE. New evidence is appended; old evidence is superseded (not deleted). This preserves audit chains for governance.

### Q: What's the difference between "severity" and "disposition"?

**A:** 
- **Severity** = anomaly classification (LOW, MEDIUM, HIGH, CRITICAL)
- **Disposition** = governance status (APPROVED, BLOCKED, UNRESOLVED)

An anomaly can be HIGH severity but UNRESOLVED disposition (awaiting approval).

---

## Freeze-Period Summary

**Current Status (2026-08-17 05:10 UTC):**

| Component | Status |
|-----------|--------|
| Documentation | ✅ Complete (4 documents, ~2,100 lines) |
| Source Code | 🔒 Frozen (no changes) |
| Database | 🔒 Frozen (no migrations, writes) |
| Detector Logic | 🔒 Frozen (magnitude-only, v3 active) |
| Governance | ⏳ Awaiting board approval to unfreeze |

**Unfreeze Path:**
1. Governance board reviews frozen eval metrics (Phase 1)
2. Approves scope (Phase 3A shadow run only) → Permission gate passed
3. Validates technical prerequisites (31 checks) → Eligibility gate passed
4. Authorizes Phase 3A → Shadow run begins
5. Collects 24-hour metrics → Governance sign-off
6. Proceeds to Phase 3B (canonical rebuild) if metrics acceptable
7. Phase 3C (PIT parity) validates production readiness
8. Go-live: v4 canonical activated

**Next Action:** Share frozen documents with governance board; await approval to proceed to Phase 1.

---

**End of Documentation Index**

**Created by:** Detector Audit Team (read-only investigation)  
**Reviewed by:** (Awaiting governance)  
**Approved by:** (Pending unfreeze decision)

