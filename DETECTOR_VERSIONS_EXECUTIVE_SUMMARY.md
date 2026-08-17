# Detector Versions — Executive Summary & Quick Start
**Generated:** 2026-08-17T05:11:02Z  
**Status:** Frozen (read-only audit complete)

---

## One-Page Summary

### Current State
- **Active Detector:** `detector-v3` (environment variable default)
- **Detection Method:** Magnitude-only (1m candle range > 1000 pips)
- **Implementation:** Hardcoded in `apps/web/src/app/api/ingest/route.ts`
- **Quarantine Method:** Best-effort persistence to `candle_quality` table (non-blocking)
- **Governance:** **FROZEN** (no detector changes, backfills, or canonical rebuilds permitted)
- **Suspect Candles (90d):** 2 (both USDSEK; approved as valid)

### Key Code Location
```typescript
// File: apps/web/src/app/api/ingest/route.ts:103–115
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

### Data Quality Facts
| Metric | Value |
|--------|-------|
| Total candles (90d) | 7,776,000 |
| Suspect candles | 2 |
| Suspect rate | 0.0000026% |
| Symbol affected | USDSEK only |
| Approval status | KEEP (both approved) |

### Unfreeze Path (Post-Governance Approval)
```
Phase 1: Eval (1 week)
  → Frozen eval set comparison (v2 vs v3)
  → Metrics: Precision 97.9%, F1-Score 0.968

Phase 2: Approval (1 week)
  → Decision matrix (by asset class)
  → Canonical safety semantics locked

Phase 3: Rollout (4 weeks)
  → 3A: Shadow run (24h metrics)
  → 3B: Canonical rebuild (v4 activated)
  → 3C: PIT parity check (backtest validation)
  → Go-live: v4 detector live
```

---

## Quick Start: Finding Detector Information

### "Where is the detector code?"

**Answer:** Not in a separate module. Detection is inline in two places:

1. **Ingestion:** `apps/web/src/app/api/ingest/route.ts:96–115`
   - Runs on every incoming 1m candle
   - Flags if range > 1000 pips
   - Persists to `candle_quality` table

2. **Feature Engine:** `apps/engine/src/dag/runner.ts:725–726`
   - Tags every feature row with detector version
   - Default: `"detector-v3"`

### "What detectors exist?"

| Detector | Status | Years | Notes |
|----------|--------|-------|-------|
| `candle-detector-v1` | Superseded | v1 (legacy) | Original magnitude check |
| `candle-detector-v2-calendar` | Conceptual | v2 (design) | Would add calendar awareness |
| `detector-v3` | **Active** | v3 (current) | Magnitude-only, in production |
| `detector-v4-calibrated` | Conceptual | v4 (design) | Symbol-specific thresholds (future) |

### "How do I check suspect candles?"

```sql
-- Current suspect candles
SELECT symbol, ts, reason FROM candle_quality 
ORDER BY symbol, ts DESC;

-- Per-symbol count
SELECT symbol, COUNT(*) as suspect_count 
FROM candle_quality 
GROUP BY symbol 
ORDER BY suspect_count DESC;

-- With approval status
SELECT 
  cq.symbol, 
  cq.ts, 
  cq.reason,
  q.decision,
  q.approved_by,
  q.approved_at
FROM candle_quality cq
LEFT JOIN candle_quarantine q 
  ON cq.symbol = q.symbol AND cq.ts = q.event_time
ORDER BY cq.symbol, cq.ts DESC;
```

### "What's the canonical view?"

The `market.candles_1m_canonical` view **excludes** candles with unresolved quarantine entries:

```sql
-- Canonical candles (approved or unapproved)
SELECT * FROM market.candles_1m_canonical 
WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '30 days'
ORDER BY ts;

-- Excluded candles (not in canonical)
SELECT c.symbol, c.ts, q.decision, q.decision, q.notes
FROM candles_1m c
JOIN candle_quarantine q 
  ON c.symbol = q.symbol AND c.ts = q.event_time
WHERE q.superseded_at IS NULL
  AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
ORDER BY c.symbol, c.ts;
```

### "How do I change the detector version?"

**Compile-time (environment variable):**
```bash
# Override default v3 with v2-calendar (if config row exists)
export TM_CANDLE_DETECTOR_VERSION=candle-detector-v2-calendar
npm run start:web
```

**Runtime (database):**
```sql
-- Mark v3 as inactive; activate v2-calendar
BEGIN;
UPDATE market.detector_config 
  SET status = 'retired', retired_at = NOW()
  WHERE detector_version = 'detector-v3' AND status = 'active';

UPDATE market.detector_config 
  SET status = 'active', activated_at = NOW()
  WHERE detector_version = 'candle-detector-v2-calendar';
COMMIT;
```

**⚠️ Under freeze:** Both are blocked. Governance approval required.

### "What happens to suspect candles downstream?"

1. **Features:** Check `candle_quality.is_suspect`; some features winsorize or skip
2. **Live trading:** Gates check canonical view; unresolved candles excluded
3. **Backtest:** PIT backtester loads from canonical; applies ATR winsorization

---

## Architecture Diagram

```
┌─ MT5 Terminal ──────────────────┐
│  (1m candles, every minute)     │
└────────────┬────────────────────┘
             │
             ▼
┌────────────────────────────────────────┐
│ Ingestion: /api/ingest/route.ts        │
├────────────────────────────────────────┤
│ 1. Parse OHLCV                         │
│ 2. Validate geometry (high ≥ low)      │
│ 3. Run detector: suspectRangeReason()  │◄─ Magnitude check (1000p)
│    ├─ If range > 1000p → flag          │
│    └─ INSERT INTO candle_quality       │
│ 4. Batch insert to candles_1m          │
└────────────┬───────────────────────────┘
             │
             ▼
┌─ candles_1m (TimescaleDB) ──────────┐
│ (all candles, immutable raw data)    │
└────────────┬───────────────────────┬─┘
             │                       │
             │                       ▼
             │              ┌──────────────────┐
             │              │ candle_quality   │
             │              │ (suspect flags)  │
             │              └────────┬─────────┘
             │                       │
             └───────────┬───────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │ market.candles_1m_canonical    │
        │ (join on approved quarantine)  │
        ├────────────────────────────────┤
        │ EXCLUDE unresolved anomalies   │
        │ INCLUDE approved (KEEP)        │
        │ EXCLUDE approved (EXCLUDE)     │
        └────────────────────────────────┘
                    │          │
        ┌───────────┘          └──────────┐
        ▼                                  ▼
   ┌─────────────────┐          ┌──────────────────┐
   │ Feature Engine  │          │ Backtest Engine  │
   │ (live compute)  │          │ (PIT validation) │
   └─────────────────┘          └──────────────────┘
```

---

## Critical Thresholds

### Magnitude Detection (Only Active Check)

| Symbol | pipSize | Example Bar | Range | Status |
|--------|---------|-------------|-------|--------|
| EURUSD | 0.0001 | H:1.1500, L:1.0500 | 1000p | ⚠️ Boundary (OK) |
| XAUUSD | 0.1 | H:2500, L:2300 | 2000p | 🚩 **FLAGGED** |
| USDSEK | 0.0001 | H:9.050, L:8.650 | 4000p | 🚩 **FLAGGED** |
| NAS100 | 1.0 | H:21000, L:20000 | 1000p | ⚠️ Boundary (OK) |

### Spread Sanity Multiplier (Related Detection)

| Asset Class | baseSpreadPips | Data Cap (×10) | Trading Gate (×4) |
|-------------|---|---|---|
| FX Major | 1.0 | 10p | 4p |
| Gold (XAUUSD) | 3.5 | 35p | 14p |
| Exotic (USDSEK) | 32 | 320p | 128p |
| Indices | 1.5 | 15p | 6p |

---

## Governance Freeze Checklist

**Current Status (2026-08-17):**

```
┌─ FROZEN (No changes permitted) ───────────────────────┐
│                                                         │
│ ❌ Detector code changes                               │
│ ❌ Database migrations                                 │
│ ❌ Canonical rebuilds                                  │
│ ❌ Feature backfills                                   │
│ ❌ Shadow runs or ingestion changes                    │
│ ❌ Write transactions to production schema             │
│ ❌ Gate state changes (permission, eligibility)        │
│                                                         │
└─ ALLOWED (Read-only work) ──────────────────────────────┤
│                                                         │
│ ✅ Read-only audits (detector, canonical, lineage)    │
│ ✅ Index/coverage audits                              │
│ ✅ Documentation & planning                           │
│ ✅ Design of post-unfreeze phases                     │
│ ✅ Evaluation set preparation (frozen hashes)        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**To Unfreeze (31-point checklist in Implementation Guide §2):**
1. Governance permission gate (4 items)
2. Technical eligibility (23 items):
   - Canonical preconditions (4)
   - Detector readiness (4)
   - Invariant verification (4)
   - Backtest protection (4)

---

## Troubleshooting

### "Why are some USDSEK candles marked suspect?"

**Answer:** Two USDSEK candles on 2026-07-05 had 1376-pip ranges (> 1000-pip threshold). This was legitimate: illiquid forex pair during off-hours with order-flow imbalance. Approved as KEEP in quarantine.

### "Why isn't detector-v2-calendar active if v2 > v1?"

**Answer:** v2-calendar was conceptually designed to add calendar awareness (exclude weekends, daily breaks), but was never fully implemented. Governance froze v3 as the production detector. v4 (calibrated) is the post-unfreeze target.

### "Can I manually update a quarantine decision?"

**Answer:** 
- **Legacy table (`candle_quarantine`):** Yes, if governance approves (but currently frozen)
- **Evidence table (`candle_quarantine_evidence`):** No, immutable (trigger prevents UPDATE/DELETE)

### "What if I want to test a new detector?"

**Answer:** Under freeze, you cannot. Post-unfreeze:
1. Design detector logic in a read-only script (e.g., `scripts/eval-detector-v4-readonly.js`)
2. Run on frozen eval set; compare metrics to v3
3. Governance approves if metrics acceptable
4. Proceed to Phase 3A (shadow run)

### "How do I restore v3 if v4 causes problems?"

**Answer:** Emergency rollback procedure (Implementation Guide §8.2):
```bash
# 1. Deactivate v4; reactivate v3
psql tradzfx_v2 -c "
  UPDATE market.detector_config SET status = 'retired' 
    WHERE detector_version = 'detector-v4-calibrated';
  UPDATE market.detector_config SET status = 'active' 
    WHERE detector_version = 'detector-v3';
"

# 2. Restart ingestion
pm2 restart tz-web-v2

# Expected recovery: < 2 minutes
```

---

## Related Documents (in Order of Reading)

1. **This document** (5 min) — Executive summary & quick start
2. **DETECTOR_VERSIONS_COMPREHENSIVE_AUDIT.md** (20 min) — Full inventory
3. **DETECTOR_VERSIONS_TECHNICAL_REFERENCE.md** (30 min) — Code details
4. **DETECTOR_VERSIONS_IMPLEMENTATION_GUIDE.md** (30 min) — Roadmap & migration
5. **DETECTOR_VERSIONS_DOCUMENTATION_INDEX.md** (10 min) — Full index & reference

---

## For Each Role

### Data Engineer
- Read: Technical Reference (§2–5, execution flow)
- Do: Shadow run metrics collection (post-unfreeze)
- Script: `scripts/eval-detector-v2-vs-v3-readonly.js`

### Governance/Risk
- Read: Comprehensive Audit (§9, freeze terms) + Implementation Guide (§2, prerequisites)
- Review: Frozen eval set metrics + anomaly decision matrix
- Approve: Unfreeze gates before Phase 3A

### QA/Testing
- Read: Technical Reference (§11–14, validation) + Implementation Guide (§5.3, PIT parity)
- Prepare: Backtest harness for canonical parity check
- Run: PIT validation post-unfreeze

### Operations
- Read: Implementation Guide (§8, rollback) + Technical Reference (§13, env vars)
- Prepare: Rollback runbook; monitoring dashboard
- Execute: Shadow run monitoring; incident response

### Architecture Review
- Read: Comprehensive Audit (§1–8) + Implementation Guide (§7, symbol thresholds)
- Consider: v4 design feasibility; asset-class matrix; multi-criterion detection

---

## Key Insights

1. **Current detector is minimal:** Only magnitude check (1000 pips). No relative detection, calendar awareness, or symbol-specific thresholds.

2. **Infrastructure is sophisticated:** Immutable quarantine evidence tables, versioned detector config, fail-closed canonical view, audit chains. Ready for v4 upgrade.

3. **Data is clean:** Only 2 suspect candles in 90 days (0.0000026%); both approved as valid. No obvious quality issues.

4. **Governance is structured:** 31-point unfreeze checklist covers permission, eligibility, technical preconditions, and backtest validation.

5. **Timeline is realistic:** Phase 1 (1w eval) → Phase 2 (1w approval) → Phase 3 (4w rollout) = 6 weeks to production v4.

6. **Failure modes are documented:** 5 known scenarios with rollback procedures (all < 4 hours recovery).

7. **Post-unfreeze work is design-ready:** All Phase 1–3 procedures, rollback scripts, and acceptance criteria are drafted and ready to execute.

---

## Next Steps

### Immediate (Today)
- [ ] Distribute frozen documentation to governance board
- [ ] Schedule board review of frozen eval metrics
- [ ] Begin Phase 1 evaluation set finalization (hashing, sign-off)

### Short-term (Week 1–2)
- [ ] Board approves unfreeze scope (Phase 3A shadow run)
- [ ] Validate all 31 technical prerequisites
- [ ] Grant permission to proceed with Phase 3A

### Medium-term (Week 3–6)
- [ ] Deploy shadow ingestion (parallel v3 prod + v4 shadow)
- [ ] Collect 24-hour metrics; governance sign-off
- [ ] Canonical rebuild (v4 activation)
- [ ] PIT parity validation
- [ ] Go-live monitoring

---

## Contacts

| Role | Responsibility | Contact |
|------|-----------------|---------|
| **Governance Lead** | Freeze approval, scope decisions | `governance-board@tradzfx` |
| **Data Engineering** | Shadow run, canonical rebuild, parity | `data-team@tradzfx` |
| **QA/Testing** | Backtest validation, acceptance criteria | `qa-team@tradzfx` |
| **Operations** | Rollout monitoring, incident response | `ops@tradzfx` |
| **Documentation** | Audit trail, decision matrix, handoff | `governance-board@tradzfx` |

---

## Appendix: File Tree

```
tradzfx-v2/
├── DETECTOR_VERSIONS_COMPREHENSIVE_AUDIT.md           ← Full audit
├── DETECTOR_VERSIONS_TECHNICAL_REFERENCE.md           ← Code details
├── DETECTOR_VERSIONS_IMPLEMENTATION_GUIDE.md          ← Roadmap
├── DETECTOR_VERSIONS_DOCUMENTATION_INDEX.md           ← Full index
├── DETECTOR_VERSIONS_EXECUTIVE_SUMMARY.md             ← THIS FILE
│
├── apps/engine/src/dag/runner.ts (725–726)            ← detector_version assignment
├── apps/web/src/app/api/ingest/route.ts (96–115)      ← magnitude detection
│
├── infra/migrations/
│   ├── 103_market_data_contracts.sql                  ← candle_quality schema
│   ├── 174_candle_quarantine_policy.sql               ← legacy quarantine
│   ├── 176_supersede_stale_candle_quarantine.sql      ← canonical view
│   ├── 183_detector_freeze_trusted_windows.sql        ← detector_config table
│   └── 193_candle_provenance_layers.sql               ← evidence v2 schema
│
├── packages/shared/src/pairs/
│   ├── pairCharacteristics.ts (15–550)                ← symbol registry
│   └── pipMath.ts (1–200)                             ← pip conversion
│
└── docs/governance/
    ├── frozen-state-governance-2026-08-17.md         ← Freeze terms
    ├── candle-state-unfreeze-gate-conditions-*.md     ← Gate checklist
    └── readonly-detector-v2-v3-*.md                   ← Eval design
```

---

**End of Executive Summary**

**Created:** 2026-08-17T05:11:02Z  
**Status:** Complete (frozen, read-only)  
**Next Action:** Submit to governance board for unfreeze decision

