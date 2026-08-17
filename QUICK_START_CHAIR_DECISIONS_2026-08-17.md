# PHASE 1 READINESS: QUICK START FOR CHAIR
**2026-08-17 07:20 UTC**

---

## YOU ARE HERE

Session has delivered complete governance framework + Gate A/B assessment + Phase 1 readiness.

**Your next action: 1 decision + 1 approval = Phase 1 live in ~1 hour**

---

## THREE THINGS YOU NEED TO DECIDE

### 1️⃣ Gate A: XAUUSD 2 Rows (Investigation Required)

**What:** 2 candles on 2026-07-06, flagged at ~1010.5p (1.05% above 1000p threshold)

**Your decision:** KEEP (real market event) or EXCLUDE (hard corruption) for each row?

**How to decide:**
- Check OHLC geometry (valid or corrupt?)
- Cross-check vs public gold price on 2026-07-06
- Check adjacent bars (isolated spike or context?)
- Document evidence per row

**File to read:** `GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md` (investigation protocol)

---

### 2️⃣ Gate B: v3-Only Gating (Ready Now)

**Status:** ✅ ALREADY COMPLIANT

**What:** v3-robust detector is canonical in production; v2 is archived

**Code verified:** `apps/web/src/app/api/ingest/route.ts` lines 96–110

**Your decision:** APPROVED (no code changes needed)

**File to read:** `GATE_B_IMPLEMENTATION_ASSESSMENT_2026-08-17.md` (verification details)

---

### 3️⃣ Phase 1 Threshold: XAUUSD Unblock Criterion

**What:** Tolerance for unresolved blockers before feature backfill proceeds

**Proposed:**
- 1m: ≤ 2 unresolved blockers, all explicitly decided (Gate A rows)
- HTF: 0 unresolved (inherited from 1m)

**Your decision:** APPROVE or adjust?

**File to read:** `PHASE_1_READINESS_INTEGRATION_PACKAGE_2026-08-17.md` (full details)

---

## HOW TO RESPOND

**Copy this template and fill it out:**

```
CHAIR DECISIONS — 2026-08-17 07:XX UTC

GATE A INVESTIGATION:
- XAUUSD Row 1 (2026-07-06):
  - Geometry: [VALID / INVALID]
  - Public reference: [CONFIRMS / CONTRADICTS / NO DATA]
  - Adjacent context: [NORMAL / ELEVATED / ANOMALOUS]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [2–3 sentences]

- XAUUSD Row 2 (2026-07-06):
  - Geometry: [VALID / INVALID]
  - Public reference: [CONFIRMS / CONTRADICTS / NO DATA]
  - Adjacent context: [NORMAL / ELEVATED / ANOMALOUS]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [2–3 sentences]

GATE B IMPLEMENTATION:
- v3-only gating confirmed canonical: APPROVED
- v2 already archived (no code changes needed): APPROVED

PHASE 1 THRESHOLD:
- XAUUSD 1m: ≤ 2 unresolved, all decided: APPROVED
- XAUUSD HTF: 0 unresolved: APPROVED
- Feature backfill unblock: READY

CHAIR: _________________________ DATE/TIME: ___________ UTC
```

**File to use:** `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md` (copy-paste ready)

---

## FILES TO READ (IN ORDER)

| Priority | File | Read Time | Purpose |
|----------|------|-----------|---------|
| 🔴 **CRITICAL** | `CHAIR_DECISION_SUMMARY_2026-08-17.md` | 5 min | Overview of this session |
| 🔴 **CRITICAL** | `GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md` | 10 min | Investigation protocol for 2 rows |
| 🟡 **HIGH** | `PHASE_1_READINESS_INTEGRATION_PACKAGE_2026-08-17.md` | 15 min | Full integration workflow |
| 🟢 **REFERENCE** | `GATE_B_IMPLEMENTATION_ASSESSMENT_2026-08-17.md` | 5 min | v3 confirmed, v2 archived |
| 🟢 **TEMPLATE** | `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md` | 2 min | Copy-paste decision format |

---

## TIMELINE

| Time | Action | Owner |
|------|--------|-------|
| 07:20 UTC | You investigate Gate A rows | **Chair** |
| **Your time** | Gate A classification + Gate B/Phase 1 approval | **Chair** |
| +10 min | Developer applies decisions + runs preflight | Developer |
| +40 min | Feature backfill (if preflight HEALTHY) | Developer |
| +70 min | Worker enable; Phase 1 LIVE (shadow mode) | Developer |

**Total to Phase 1 live: ~1 hour 15 minutes from your approval**

---

## WHAT'S LOCKED (NO CHANGES WITHOUT BOARD)

✅ Raw candles (immutable evidence ledger)
✅ features_zone (frozen)
✅ Auto-approval (disabled)
✅ v3 detector (canonical; v2 archived)

---

## GIT COMMITS THIS SESSION

Latest commits on master:
- `e8c8197` - SESSION_COMPLETION
- `2cb3911` - PHASE_1_READINESS
- `126c8fa` - CHAIR_DECISION_SUMMARY
- `b62636e` - CHAIR_RESPONSE_TEMPLATE
- `425cadf` - GATE_B_IMPLEMENTATION
- `7e4d1be` - GATE_A_INVESTIGATION

All pushed to GitHub

---

## YOUR NEXT SENTENCE

**"I've investigated the 2 XAUUSD rows. Here are my decisions:"**

[Then use the template above to list your per-row decisions]

---

**Once you send that, Phase 1 unblock executes immediately.**

**Ready for your approval.**
