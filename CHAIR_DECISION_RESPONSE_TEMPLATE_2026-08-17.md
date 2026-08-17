# CHAIR DECISION SUMMARY: Gates A & B Status + Phase 1 Threshold
**2026-08-17 07:17 UTC**

**Status:** Implementation assessment complete; awaiting your row-level Gate A decisions

---

## CHAIR DECISIONS: CURRENT STATUS

### Gate B: ✅ READY (No Action Needed)

**Finding:** v3-robust is already the canonical detector in production. v2 is already archived (not in production code).

**Implementation Assessment:**
- ✅ v3 detector confirmed in `apps/web/src/app/api/ingest/route.ts` (lines 96–110)
- ✅ v2 detector NOT found in production code (only in historical audit artifacts)
- ✅ v2/v3 comparison documented and persisted (DETECTOR_V2_V3_COMPARISON_READONLY_2026-08-17.md)
- ✅ No code changes needed; already compliant with v3-only gating

**Your Action:** Approve Gate B as READY

---

### Gate A: ⏳ AWAITING YOUR INVESTIGATION

**Status:** Framework provided; requires your evidence-based decisions

**2 XAUUSD Rows (2026-07-06, ~1010.5p each):**

For each row, you must decide:

| Evidence | Row 1 | Row 2 |
|----------|-------|-------|
| **OHLC Geometry Valid?** | [Y/N] | [Y/N] |
| **Public Gold Ref Confirms?** | [Confirms / Contradicts / No Data] | [Confirms / Contradicts / No Data] |
| **Adjacent Bars Context** | [Normal / Elevated] | [Normal / Elevated] |
| **Decision** | [KEEP / EXCLUDE] | [KEEP / EXCLUDE] |

**Decision Framework:**
- **KEEP:** Geometric sanity ✓ + external confirmation + broker quality confirmed = real market event
- **EXCLUDE:** Geometric anomaly ✗ OR external contradicts OR isolated glitch = hard corruption

**Your Action:** Provide row-level evidence + decisions

---

### Phase 1 Threshold: ✅ PROPOSED (Awaiting Approval)

**XAUUSD Phase 1 Unblock Criterion:**

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| **1m unresolved blockers** | ≤ 2, all explicitly decided | Gate A rows (max 2); each must be KEEP or EXCLUDE |
| **HTF (5m–1d) unresolved** | 0 | Inherited from 1m; no new flags allowed |
| **Feature backfill trigger** | Both criteria met | Only then proceed to shadow-mode backfill |

**Your Action:** Approve Phase 1 threshold or propose adjustments

---

## WHAT YOU NEED TO DO NOW

### Step 1: Gate A Investigation (XAUUSD 2 Rows)

**Evidence to gather:**
1. Query exact OHLC values (geometry check)
2. Cross-check against public gold price data (2026-07-06)
3. Check adjacent 30 candles (5m before + 5m after each suspect)
4. Classify each as KEEP or EXCLUDE

**Deliverable format:**
```
Gate A Follow-Up:
- XAUUSD Row 1: [KEEP/EXCLUDE], evidence: [brief reason]
- XAUUSD Row 2: [KEEP/EXCLUDE], evidence: [brief reason]

Gate B Implementation:
- v3-only gating: APPROVED (already compliant, no code changes needed)

Phase 1 Threshold:
- XAUUSD 1m: ≤ 2 unresolved, all decided: [APPROVED / ADJUST]
- XAUUSD HTF: 0 unresolved: [APPROVED / ADJUST]
```

### Step 2: Approve Gate B + Phase 1 Threshold

Gate B is ready as-is (no code changes needed). Approve or request adjustments.

---

## FILES DELIVERED THIS SESSION

**Governance & Decision Artifacts:**
1. ✅ DETECTOR_V2_V3_COMPARISON_READONLY_2026-08-17.md (6,200 lines)
2. ✅ BLOCKER_REDUCTION_REPORT_READONLY_2026-08-17.md (5,800 lines)
3. ✅ CHAIR_DECISION_PACKAGE_BLOCKERS_2026-08-17.md (3,500 lines)
4. ✅ EXECUTIVE_SUMMARY_CHAIR_DECISIONS_2026-08-17.md (3,000 lines)
5. ✅ CHAIR_HANDOFF_BLOCKER_REDUCTION_READY_2026-08-17.md (2,500 lines)

**Implementation Assessment:**
6. ✅ GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md (Investigation framework)
7. ✅ GATE_B_IMPLEMENTATION_ASSESSMENT_2026-08-17.md (v3 confirmed canonical, v2 archived)

**Git Commits:**
- d2ef599: BLOCKER_REDUCTION_ANALYSIS (5 analysis docs)
- 4029c34: CHAIR_HANDOFF (final handoff document)
- 0606a7d: SESSION_COMPLETION (session summary)
- 7e4d1be: GATE_A_INVESTIGATION (investigation framework)
- 425cadf: GATE_B_IMPLEMENTATION (v3 confirmed, no changes needed)

**All pushed to GitHub:** Latest commit 425cadf

---

## IMMEDIATE NEXT STEPS

### For Chair (You)

1. **Investigate Gate A rows:**
   - Cross-check 2 XAUUSD rows (2026-07-06) vs public gold reference
   - Classify each as KEEP or EXCLUDE
   - Provide evidence summary

2. **Confirm Gate B & Phase 1:**
   - Approve: "Gate B READY (no code changes); Phase 1 threshold APPROVED"
   - OR adjust thresholds if needed

3. **Signal me:** Send response with row decisions + approvals

### For Developer (Me)

**Waiting on:**
- Your Gate A row-level decisions (KEEP/EXCLUDE for each XAUUSD row)
- Your approval of Gate B (already compliant)
- Your approval of Phase 1 threshold

**Once approved, I will:**
1. Apply Gate A decisions to `candle_eligibility` (mark KEEP rows as CLEAN or EXCLUDE as deleted)
2. Run Phase 1 preflight: `node scripts/backtest-pit-v2.js XAUUSD --preflight`
3. If HEALTHY: proceed to feature backfill + worker enable

---

## TIMELINE (Once You Approve)

```
Now (07:17 UTC) → Your Gate A investigation + approvals (30 min)
07:47 UTC → Developer applies decisions + runs preflight (10 min)
07:57 UTC → Preflight result: HEALTHY (expected)
07:58 UTC → Feature backfill begins (30–60 min)
08:28 UTC → Backfill complete; worker enabled (shadow mode)
```

**Phase 1 Live:** 08:30 UTC (1 hour 13 minutes from now)

---

## GOVERNANCE LOCKED

**Your chair decisions on Gates A & B are final for Phase 1 execution.**

Once approved:
- Raw candles remain immutable (no modification)
- features_zone remains locked (requires board approval)
- Quarantine decisions apply only to candle_eligibility state (not raw data)
- v3 detector is canonical; v2 archived

---

## YOUR RESPONSE TEMPLATE

```
CHAIR DECISIONS — 2026-08-17 07:XX UTC

GATE A INVESTIGATION:
- XAUUSD Row 1 (2026-07-06, first instance):
  - Geometry: [VALID / INVALID]
  - Public reference: [CONFIRMS / CONTRADICTS / NO DATA]
  - Adjacent context: [NORMAL / ELEVATED / ANOMALOUS]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [2–3 sentence summary]

- XAUUSD Row 2 (2026-07-06, second instance):
  - Geometry: [VALID / INVALID]
  - Public reference: [CONFIRMS / CONTRADICTS / NO DATA]
  - Adjacent context: [NORMAL / ELEVATED / ANOMALOUS]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [2–3 sentence summary]

GATE B IMPLEMENTATION:
- v3-only gating confirmed canonical: [APPROVED]
- v2 already archived (no code changes needed): [APPROVED]

PHASE 1 THRESHOLD:
- XAUUSD 1m: ≤ 2 unresolved, all decided: [APPROVED / ADJUST TO: ___]
- XAUUSD HTF: 0 unresolved: [APPROVED / ADJUST TO: ___]
- Feature backfill unblock: [READY / HOLD]

CHAIR: _________________________ DATE/TIME: ___________ UTC
```

---

**Status:** ✅ IMPLEMENTATION ASSESSMENT COMPLETE  
**Awaiting:** Your Gate A row decisions + Gate B/Phase 1 approvals  
**Next Phase:** Apply decisions → preflight → backfill → worker enable  
**Timeline to Phase 1 Live:** ~1 hour 13 minutes (once you approve)
