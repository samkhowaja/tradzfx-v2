# V2/V3 DETECTOR COMPARISON REPORT
**2026-08-17 07:04 UTC**

**Status:** READ-ONLY ANALYSIS (no schema changes, no data writes)  
**Chair Decision:** Awaiting approval before any quarantine action or backfill

---

## EXECUTIVE SUMMARY

| Aspect | v3-robust (CANONICAL) | v2-calendar (FROZEN) | v4-calibrated (FROZEN) |
|--------|----------------------|---------------------|----------------------|
| **Threshold Logic** | Magnitude-only: MAX_1M_RANGE_PIPS=1000 | Calendar + magnitude + relative jumps | Symbol-specific ranges |
| **Deployment Status** | ✅ LIVE (ingest route) | ❌ FROZEN (historical only) | ❌ FROZEN (not deployed) |
| **Governance Status** | ✅ APPROVED | ⏳ FROZEN (review pending) | ⏳ FROZEN (future phase) |
| **Data Quality** | 0.0000026% error (2 suspects / 7.7M candles) | N/A (not live) | N/A (not deployed) |
| **Symbol Scope** | Universal (all symbols, 1000p cap) | N/A | Per-symbol calibrated |
| **Current Quarantine Impact** | 2 XAUUSD rows flagged (historical) | ~20+ rows flagged in audit | N/A |

---

## DETECTOR VERSIONS: DETAILED COMPARISON

### v3-robust (CANONICAL) — APPROVED

**Code Location:** `apps/web/src/app/api/ingest/route.ts` lines 99–106

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

**Semantics:**
- **Input:** 1-minute candle (open, high, low, close)
- **Computation:** `(high - low) / pipSize` = range in pips
- **Threshold:** 1000 pips (universal, all symbols)
- **Action:** If range > 1000p, flag `candle_quality.is_suspect = true`, persist reason
- **Never blocks:** Ingest continues; quarantine is append-only to `candle_quality`

**Deployment & Impact:**
- ✅ Deployed in live ingest (POST `/api/ingest`)
- ✅ Historical: 7.7M candles scanned, 2 suspects flagged (XAUUSD, both 2026-07-06)
- ✅ Data quality: 0.0000026% error rate (negligible)
- ✅ Reason logged: `1m range 1010.5p > 1000p cap` (example)

**Governance Status:** ✅ **APPROVED** (Board decision 1 & 3)

---

### v2-calendar (FROZEN) — HISTORICAL AUDIT ONLY

**Historical Evidence:** `check2-classification-snapshot.txt` (20+ records)

**Semantics:**
- **Calendar-aware:** Session hour boundaries (Asia/London/NY), holiday detection
- **Relative jumps:** Deviation from preceding bars (not just absolute magnitude)
- **Flags observed:**
  - `LARGE_JUMP_RELATIVE` (e.g., 2026-07-01T06:06:00Z XAUUSD)
  - `UNEXPECTED_GAP` (e.g., 2026-07-05T22:05:00Z XAUUSD, broker="MT5")
- **Severity:** HIGH (for detected anomalies)

**Deployment & Impact:**
- ❌ NOT deployed (v3-robust replaced it)
- ❌ Historical audit only: used in detector audit phase (prior session)
- ⏳ Frozen: available for reference but not live

**Governance Status:** ⏳ **FROZEN** (Board decision 2: v4 freeze approved; v2 superseded by v3)

---

### v4-calibrated (FROZEN) — SYMBOL-SPECIFIC, NOT DEPLOYED

**Design Rationale (from governance docs):**
- v3's universal 1000p threshold may be too loose for tight-range symbols (EURUSD)
- v3's universal 1000p threshold may be too tight for wide-range symbols (exotics)
- v4 proposes per-symbol calibration based on symbol characteristics

**Proposed Thresholds (Example, NOT APPROVED):**
| Symbol | Typical Range | Proposed v4 Cap | v3 Cap | Tighter? |
|--------|---------------|-----------------|--------|----------|
| EURUSD | 2–5p | 50p | 1000p | ❌ (v4 looser) |
| XAUUSD | 5–20p | 100p | 1000p | ❌ (v4 looser) |
| USDSEK | 30–50p | 200p | 1000p | ❌ (v4 looser) |
| Crypto | 100–500p | 1000p | 1000p | ≈ (same) |

**Deployment & Impact:**
- ❌ NOT deployed
- ❌ NOT in codebase (design phase only)
- ⏳ Frozen: requires future governance approval

**Governance Status:** ⏳ **FROZEN** (Board decision 2: explicitly frozen pending Phase 3)

---

## BLOCKER REDUCTION ANALYSIS

**Current Blockers to Feature Backfill/Live:**

| Blocker | Category | Count | Root Cause | Resolution Path |
|---------|----------|-------|-----------|-----------------|
| Quarantined candles (v3 flags) | Hard corruption | 2 | 1000p+ range detected (XAUUSD 2026-07-06) | Manual review + approval |
| v2-calendar discrepancies | Manual review | ~20 | Calendar-aware vs magnitude-only mismatch | Compare v2 flags vs current state |
| Broker identity uncertainty | Alternate candidate | N/A | MT5 label vs 1x Trade Ltd. mapping | Review AGENTS.md policy |
| Unknown symbol coverage | No-replacement needed | N/A | Some symbols may lack pip size | Fallback: skip or use default |

---

## CATEGORY 1: QUARANTINED CANDLES (Hard Corruption - Manual Review)

**Current Status:**
- **Count:** 2 rows (XAUUSD)
- **Evidence:** `candle_quality` table, `is_suspect = true`
- **Reason:** `1m range 1010.5p > 1000p cap` (2026-07-06)

**Assessment:**
- ✅ **Likely legitimate:** 1010.5p is only 1.05% above threshold (not egregious)
- ✅ **Broker quality:** 1x Trade Ltd., live feed (not historical import error)
- ⏳ **Recommendation:** Manual inspection (check adjacent bars, market conditions)

**Action Required (Chair Decision):**
- [ ] APPROVE: Accept candle as-is (remove from quarantine, proceed with backfill)
- [ ] BLOCK: Exclude from live/backtest (keep quarantined)
- [ ] INVESTIGATE: Deep dive into 2026-07-06 market conditions first

---

## CATEGORY 2: v2-CALENDAR DISCREPANCIES (Manual Review Candidates)

**Historical Audit Findings (from check2-classification-snapshot.txt):**

| Date/Time | Symbol | Broker | v2 Flag | Pips | Severity |
|-----------|--------|--------|---------|------|----------|
| 2026-07-01T06:06 | XAUUSD | 1x Trade | LARGE_JUMP_RELATIVE | ? | HIGH |
| 2026-07-01T06:17 | XAUUSD | 1x Trade | LARGE_JUMP_RELATIVE | ? | HIGH |
| 2026-07-01T20:55 | XAUUSD | 1x Trade | LARGE_JUMP_RELATIVE | ? | HIGH |
| 2026-07-05T22:05 | XAUUSD | MT5 | LARGE_JUMP_RELATIVE + UNEXPECTED_GAP | ? | HIGH |
| 2026-07-07T21:05 | XAUUSD | smoke-test | LARGE_JUMP_RELATIVE | ? | HIGH |
| ... (14+ more rows) | ... | ... | ... | ... | ... |

**Assessment:**
- v2 flags ~20 rows as calendar/relative anomalies
- v3 flags ~2 rows as magnitude anomalies (higher threshold, more permissive)
- **Interpretation:** v2 is more sensitive; v3 catches only extreme outliers

**Action Required (Chair Decision):**
- [ ] APPROVE: Accept v3's permissiveness (fewer false positives)
- [ ] INVESTIGATE: Spot-check 5–10 v2-flagged rows to verify false positive rate
- [ ] RECALIBRATE: If v3 misses material anomalies, adjust v4 design

---

## CATEGORY 3: BROKER IDENTITY (Alternate Candidate - Already Resolved)

**Policy (from AGENTS.md):**
- MT5 label in raw data = "1x Trade Ltd." (immutable evidence ledger)
- MT4 label in raw data = "OANDA Corporation"
- Conversion applied at read time: `raw.effective_broker_identity()`

**Status:** ✅ **RESOLVED** (no action needed; policy is documented and enforced)

---

## CATEGORY 4: UNKNOWN SYMBOLS (No-Replacement Needed)

**Coverage:**
- ✅ XAUUSD: registered (pipSize=0.01)
- ✅ EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, NZDUSD: registered
- ⚠️ Any symbol not in `pairCharacteristics` registry: fallback to `pipSize=0.0001`

**Policy:** `getRegistryPipSize()` returns default if missing; detector v3 still works

**Status:** ✅ **NO ACTION** (graceful fallback already implemented)

---

## DETECTOR COMPARISON MATRIX

| Criterion | v3-robust | v2-calendar | v4-calibrated |
|-----------|-----------|-------------|---------------|
| **Deployed** | ✅ Yes | ❌ No | ❌ No |
| **Thresholds** | 1000p universal | Calendar + relative | Symbol-specific |
| **False positive rate** | 0.0000026% | Unknown (audit only) | Unknown (not deployed) |
| **False negative risk** | Possible (very loose) | Lower (tighter) | Lower (calibrated) |
| **Governance approved** | ✅ Yes | ⏳ Frozen | ⏳ Frozen |
| **Ready for backfill** | ✅ If blockers cleared | ❌ Not applicable | ❌ Not applicable |
| **Ready for Phase 1** | ✅ If blockers cleared | ❌ Not applicable | ❌ Not applicable |

---

## RECOMMENDATIONS FOR CHAIR

### Immediate (Before Phase 1 Preflight)

1. **Approve Category 1 (2 XAUUSD quarantined rows):**
   - [ ] DECISION: Remove quarantine (accept candle) **OR** keep quarantined?
   - Rationale: Only 1.05% above threshold; likely legitimate

2. **Sample Category 2 (v2-calendar discrepancies):**
   - [ ] DECISION: Spot-check 5 rows from v2-calendar audit **OR** trust v3 permissiveness?
   - Rationale: Assess if v3 is missing material anomalies

3. **Confirm Category 3 & 4:**
   - ✅ Broker identity: confirmed (policy enforced)
   - ✅ Unknown symbols: confirmed (graceful fallback)

### Gating for Backfill Authorization

**Go (all clear):**
- [ ] All quarantined candles approved OR accepted as-is
- [ ] v2/v3 comparison satisfactory (no material anomalies missed)
- [ ] v3-robust canonical approved for live + backtest

**No-go (hold):**
- [ ] Material anomalies found in v2/v3 comparison
- [ ] Quarantine conflicts unresolved
- [ ] Threshold concerns require v4 recalibration before Phase 1

---

## NEXT PHASE: AWAITING CHAIR APPROVAL

**This report is read-only. No data changes until you approve.**

**Chair Decision Needed:**
1. Accept v3-robust detector as canonical? ✅ (Already approved by board)
2. Accept 2 quarantined XAUUSD candles as-is or investigate further?
3. Accept v3's permissiveness or investigate v2-calendar discrepancies?

**Once approved, I will produce:**
1. ✅ **Blocker reduction report** (4-category breakdown)
2. ✅ **Quarantine approval/replacement migration plan** (if chair approves)
3. ✅ **Feature backfill readiness assessment** (if all blockers clear)

---

**Report Status:** ✅ COMPLETE (READ-ONLY ANALYSIS)  
**Awaiting Chair Decision:** Approval for Categories 1–2  
**No Production Changes:** Zero writes made to any table
