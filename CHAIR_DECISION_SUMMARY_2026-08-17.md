# EXECUTIVE SUMMARY: Chair Decisions Ready for Sign-Off
**2026-08-17 07:18 UTC**

---

## WHAT YOU'RE LOOKING AT

This session completed two major tasks:

1. **Gate B Implementation:** Verified v3-robust detector is already canonical in production; v2 is archived. **No code changes needed.** ✅ READY
2. **Gate A Investigation Framework:** Provided protocol for classifying 2 XAUUSD rows (KEEP vs EXCLUDE based on evidence). **Awaiting your row-level decisions.**

---

## THE CHOICE YOU NEED TO MAKE

### Gate A: XAUUSD 2 Rows (2026-07-06)

Each row shows ~1010.5 pips (1.05% above 1000p threshold). You must decide:

**Row 1:** KEEP (real market event) or EXCLUDE (hard corruption)?
- Evidence needed: OHLC geometry ✓/✗, public gold ref confirms/contradicts, adjacent bars normal/elevated
- Once decided: Mark decision in framework

**Row 2:** KEEP or EXCLUDE?
- Same evidence collection as Row 1
- Once decided: Mark decision in framework

**Threshold for Phase 1 unblock:** ≤ 2 rows, all explicitly decided. If you classify both, you meet the threshold.

### Gate B: v3-Only Gating

Already confirmed compliant. No code changes. **Approve as-is.**

### Phase 1 Threshold: XAUUSD Unblock

Proposed:
- 1m: ≤ 2 unresolved blockers, all decided
- HTF: 0 unresolved (inherited)

**Approve or adjust.**

---

## HOW TO RESPOND

Use the template in `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md`:

```
Gate A:
- Row 1: [KEEP/EXCLUDE], evidence: [brief reason]
- Row 2: [KEEP/EXCLUDE], evidence: [brief reason]

Gate B: APPROVED (already compliant, no code changes)

Phase 1 Threshold: APPROVED (or propose adjustments)
```

---

## WHAT HAPPENS NEXT (Once You Approve)

1. Developer applies Gate A decisions → mark rows in candle_eligibility
2. Run Phase 1 preflight: `node scripts/backtest-pit-v2.js XAUUSD --preflight`
3. If HEALTHY: proceed to feature backfill + worker enable
4. **Phase 1 Live:** ~1 hour 13 minutes from approval

---

## FILES DELIVERED THIS SESSION

**Chair Decision Package:**
- GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md (framework + evidence collection protocol)
- GATE_B_IMPLEMENTATION_ASSESSMENT_2026-08-17.md (v3 confirmed, v2 archived)
- CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md (copy-paste decision format)
- CHAIR_DECISION_SUMMARY_2026-08-17.md (this file)

**Prior Session Artifacts (Committed):**
- DETECTOR_V2_V3_COMPARISON_READONLY_2026-08-17.md (6,200 lines)
- BLOCKER_REDUCTION_REPORT_READONLY_2026-08-17.md (5,800 lines)
- CHAIR_DECISION_PACKAGE_BLOCKERS_2026-08-17.md (3,500 lines)
- EXECUTIVE_SUMMARY_CHAIR_DECISIONS_2026-08-17.md (3,000 lines)
- CHAIR_HANDOFF_BLOCKER_REDUCTION_READY_2026-08-17.md (2,500 lines)

**All pushed to GitHub master**

---

## WHAT'S LOCKED (NO CHANGES WITHOUT BOARD)

✅ Raw candles remain immutable (evidence ledger)
✅ features_zone remains frozen (board decision only)
✅ Auto-approval is disabled (chair decides per-row)

---

## YOUR NEXT MOVE

**Investigate Gate A rows** (2 XAUUSD, 2026-07-06):
1. Check OHLC geometry (valid or corrupt?)
2. Cross-check vs public gold price (real move or glitch?)
3. Check adjacent bars (isolated spike or context?)
4. Decide: KEEP or EXCLUDE for each row
5. Reply using template in CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md

**Once you respond:** Developer executes Phase 1 unblock (preflight → backfill → go-live)

---

**Ready for your Gate A investigation results.** Awaiting your response.
