# PHASE 1 READINESS: COMPLETE INTEGRATION PACKAGE
**2026-08-17 07:19 UTC**

**Status:** All implementation assessments complete. Awaiting chair sign-off on Gate A + Phase 1 threshold.

---

## INTEGRATION SUMMARY

### Three Gates, Two Decisions

**Gate A (INVESTIGATION):** 2 XAUUSD rows (2026-07-06)
- Your decision: KEEP or EXCLUDE for each row (evidence-based)
- Impact: Determines Phase 1 blocker count
- Timeline: Requires your investigation + classification

**Gate B (IMPLEMENTATION):** v3-only gating
- Your decision: APPROVED (already compliant; no code changes)
- Impact: Canonical detector locked; v2 archived
- Timeline: Ready now; no delays

**Phase 1 Threshold (POLICY):** XAUUSD unblock criterion
- Your decision: APPROVE thresholds (≤2 1m, 0 HTF) or adjust
- Impact: Defines when feature backfill proceeds
- Timeline: Approve now; implementation follows immediately

---

## DECISION TREE: HOW YOUR CHOICES FLOW

```
Your Gate A Decision (2 rows)
    ↓
    ├─ Both KEEP (0 unresolved)
    │   ├─ Meets Phase 1 threshold ✅
    │   └─ Proceed → preflight → backfill → Phase 1 live (1h from now)
    │
    ├─ 1 KEEP + 1 EXCLUDE (0 unresolved)
    │   ├─ Meets Phase 1 threshold ✅
    │   └─ Proceed → preflight → backfill → Phase 1 live (1h from now)
    │
    ├─ Both EXCLUDE (0 unresolved)
    │   ├─ Meets Phase 1 threshold ✅
    │   └─ Proceed → preflight → backfill → Phase 1 live (1h from now)
    │
    └─ [Any outcome where decisions are explicit]
        ├─ ≤ 2 unresolved ✅
        ├─ All rows decided (no ambiguity) ✅
        └─ Phase 1 unblock criterion MET

Your Gate B Decision
    ↓
    └─ APPROVED (already compliant)
        └─ No code changes; v3 remains canonical

Your Phase 1 Threshold Decision
    ↓
    └─ APPROVE (or propose adjustments)
        └─ Once approved: developer executes preflight → backfill
```

---

## WHAT HAPPENS WHEN YOU APPROVE

### Immediate (07:19 → 07:20 UTC)

```
Chair approves Gate A + Phase 1 threshold
    ↓
Developer receives approval
    ↓
Developer marks Gate A rows in candle_eligibility:
    - KEEP rows → state = 'CLEAN' (eligible for features)
    - EXCLUDE rows → state = 'BLOCKED' (skipped in backfill)
```

### Next 10 Minutes (07:20 → 07:30 UTC)

```
Developer runs Phase 1 preflight:
    $ node scripts/backtest-pit-v2.js XAUUSD 90 --preflight
    
Output: Data quality verdict
    ├─ BLOCKED_SYSTEM_QUALITY? (corrupted lifecycle, missing candles)
    │   └─ HOLD backfill; report to chair
    │
    └─ HEALTHY? (all required features present, no gaps)
        └─ Proceed to backfill
```

### Next 30–60 Minutes (07:30 → 08:00 UTC)

```
Developer backfills historical features (XAUUSD only, Phase 1 shadow):
    $ export ZONE_BACKFILL_SKIP_OUTCOMES=1
    $ node scripts/backfill-historical-features.js XAUUSD 1d,4h,1h,5m --start 2026-05-20 --end 2026-08-17
    
During backfill:
    ├─ features_atr, features_spread, features_session (leaf) ✓
    ├─ features_opening_range (session-scoped event) ✓
    └─ No state/zone/lifecycle changes (Phase 1 shadow constraint)
```

### Final Step (08:00 → 08:05 UTC)

```
Developer enables feature worker (shadow mode):
    $ TM_DISABLE_FEATURE_JOBS=false (in .env or environment)
    $ systemctl restart tz-engine tz-web-v2
    
Result:
    ├─ Live bars trigger feature compute (inline + background jobs)
    ├─ Features persist to database (read-only for now; not yet live-traded)
    └─ Phase 1 LIVE (shadow mode active)
```

### Phase 1 Live Criteria Met

```
✅ v3-robust detector canonical (Gate B)
✅ XAUUSD 1m blockers ≤ 2, all decided (Gate A)
✅ XAUUSD HTF blockers = 0 (inherited from 1m)
✅ Historical features backfilled (90d window)
✅ Live feature pipeline enabled (shadow mode)
✅ Ready for live/backtest parity verification
```

---

## YOUR RESPONSE REQUIRED

**Use this template** (from `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md`):

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

## FILES READY FOR YOU

**Decision Framework (Use These):**
1. `GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md` — Investigation protocol + evidence collection checklist
2. `GATE_B_IMPLEMENTATION_ASSESSMENT_2026-08-17.md` — v3 confirmed canonical; v2 archived (no changes needed)
3. `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md` — Copy-paste template for your decisions
4. `CHAIR_DECISION_SUMMARY_2026-08-17.md` — Executive summary (this session)

**Reference Materials (Already Committed):**
5. `DETECTOR_V2_V3_COMPARISON_READONLY_2026-08-17.md` — Full v2 vs v3 semantics (6,200 lines)
6. `BLOCKER_REDUCTION_REPORT_READONLY_2026-08-17.md` — Blocker categories + actionability (5,800 lines)
7. `CHAIR_DECISION_PACKAGE_BLOCKERS_2026-08-17.md` — Original blocker analysis (3,500 lines)
8. `EXECUTIVE_SUMMARY_CHAIR_DECISIONS_2026-08-17.md` — Prior session summary (3,000 lines)

**All pushed to GitHub master**

---

## GOVERNANCE ENFORCED

✅ **Raw candles immutable** (evidence ledger; no modifications)
✅ **features_zone frozen** (board decision required to modify)
✅ **Auto-approval disabled** (chair decides per-row, per-gate)
✅ **v3 canonical detector** (v2 archived; no downgrade)
✅ **Phase 1 shadow mode** (features computed; not yet live-traded)

---

## WHAT'S NOT BLOCKED

Once you approve Gates A & B + Phase 1 threshold:

✅ Feature backfill proceeds (XAUUSD 90d)
✅ Live/backtest parity testing begins
✅ Strategy variant validation continues
✅ Worker enables (shadow mode)
✅ Live feature pipeline activates

---

## TIMELINE TO PHASE 1 LIVE

| Time | Action | Owner |
|------|--------|-------|
| 07:19 UTC | Framework ready; awaiting approval | Chair |
| **Your response time** | Gate A rows classified; Gate B + Phase 1 approved | **Chair** |
| +10 min | Developer applies decisions; runs preflight | Developer |
| +40 min | Feature backfill (if preflight HEALTHY) | Developer |
| +60 min | Worker enabled; Phase 1 LIVE (shadow mode) | Developer |

**Total time from your approval: ~1 hour**

---

## NEXT SENTENCE FROM YOU

```
"I've investigated the 2 XAUUSD rows and here are my decisions..."

[Then use the template above]
```

**Once you send that, I'll execute Phase 1 unblock immediately.**

---

**Ready for your approval. All implementation work is complete; waiting on your Gate A investigation + decision sign-off.**
