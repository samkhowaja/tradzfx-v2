# CHAIR FORMAL DECISIONS RECORDED — 2026-08-17 07:25 UTC
**Chair Approval Status: LOCKED**

---

## DECISION RECORD

### Gate A: Framework Approved; Row Classification Deferred

**Chair Position:**
Gate A investigation protocol (`GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md`) is approved as the formal decision-making process.

**2 XAUUSD rows (2026-07-06) remain blocking canonical Phase 1 until:**
- Explicit per-row KEEP/EXCLUDE decisions are recorded in `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md`
- Evidence is documented (independent price source, cross-broker, calendar context)
- Decisions are applied to `candle_eligibility` state

**Status:** ⏳ AWAITING GATE A ROW CLASSIFICATION
**Blocking:** Phase 1 backfill + worker enable until decided

---

### Gate B: APPROVED (v3-Only Gating)

**Chair Decision: APPROVED AS IMPLEMENTED**

**Locked:**
- ✅ v3-robust is the only live gate in ingest + backtest
- ✅ v2 logic is archived; advisory-only
- ✅ Calendar-aware FX handling (weekends, Friday close, XAUUSD daily break)
- ✅ Canonical path is fail-closed
- ✅ v3 detector is canonical; v2 does NOT block
- ✅ `candle_quarantine` + explicit approval gating in place

**Status:** ✅ APPROVED (no code changes required)
**Effective immediately**

---

### Phase 1 Thresholds: APPROVED

**Chair Decision: APPROVED WITH GUARDRAILS**

**Phase 1 XAUUSD Proceeds Only When:**
1. ✅ Gate A: 2 rows explicitly decided (KEEP/EXCLUDE) and recorded
2. ✅ Canonical blockers ≤ approved Phase 1 thresholds:
   - XAUUSD 1m: ≤ 2 unresolved blockers (after Gate A decisions applied)
   - XAUUSD HTF (5m–1d): 0 unresolved (inherited from 1m)
3. ✅ Preflight passes: HEALTHY data quality verdict

**Pipeline Approved:**
- Preflight validation (confirm blockers respect thresholds)
- XAUUSD 90-day historical backfill
- Worker enable (shadow mode only)
- Live/backtest parity validation

**Immutability Constraints (LOCKED; No Relaxation):**
- ✅ Raw candles: immutable evidence ledger
- ✅ Fail-closed canonical policy
- ✅ `features_zone`: frozen (board approval required to modify)
- ✅ v3-only gating: no downgrade to v2
- ✅ Auto-approval: disabled (explicit per-row decisions only)

**Status:** ✅ APPROVED (contingent on Gate A decisions + preflight passing)
**Effective:** Upon Gate A completion

---

### Governance Lock: FORMALLY CONFIRMED

**Authority Split (Final):**
- **Chair:** Gate A decisions, Phase 1 authorization, backfill/worker approval
- **Developer:** Execute migrations, preflight, backfill, worker enable, parity tests
- **Board:** Changes to immutability, detector canon, features_zone freeze

**Immutable Constraints (Non-Negotiable):**
- ✅ Raw candles locked (no modifications)
- ✅ Canonical candles broker-aware, v3-gated, fail-closed
- ✅ `candle_quarantine` is single source of truth for anomaly evidence + approval
- ✅ `features_zone` frozen until post-Phase-1 board approval
- ✅ Auto-approval disabled (all canonical exclusions/keeps = explicit approval)

**Status:** ✅ LOCKED (board-level, non-reversible without new board resolution)

---

## EXECUTION PATH (CHAIR APPROVED)

### Immediate (Now → Gate A Row Classification)

**Developer Standing By:**
- Preflight script ready
- Backfill script ready
- Worker enable procedure ready
- All contingent on Gate A row decisions

**Chair Action Required:**
- Run Gate A investigation protocol
- Classify each row: KEEP or EXCLUDE
- Record decisions in `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md`
- Provide evidence per row (independent source, cross-broker, calendar)

### Upon Gate A Decisions (Developer Executes)

**Step 1: Apply Gate A Decisions**
```sql
-- KEEP rows: mark CLEAN in candle_eligibility
-- EXCLUDE rows: mark BLOCKED in candle_eligibility
```

**Step 2: Run Phase 1 Preflight**
```bash
node scripts/backtest-pit-v2.js XAUUSD 90 --preflight
```
- Confirm data quality verdict: HEALTHY (proceed) or BLOCKED (halt)
- Verify canonical blockers ≤ Phase 1 thresholds

**Step 3: Feature Backfill (If Preflight HEALTHY)**
```bash
export ZONE_BACKFILL_SKIP_OUTCOMES=1
node scripts/backfill-historical-features.js XAUUSD 1d,4h,1h,5m --start 2026-05-20 --end 2026-08-17
```
- Backfill leaf + session features only (no zone, no state)
- 90-day window: 2026-05-20 → 2026-08-17
- Phase 1 shadow mode: computed, not live-traded

**Step 4: Worker Enable**
```bash
TM_DISABLE_FEATURE_JOBS=false
systemctl restart tz-engine tz-web-v2
```
- Live bars trigger feature compute
- Features persist (read-only; not live-traded)
- Phase 1 LIVE (shadow mode)

---

## TIMELINE (CHAIR APPROVED)

| Time | Action | Owner | Duration | Status |
|------|--------|-------|----------|--------|
| 07:25 UTC | Gate A/B/Phase 1 chair decisions | Chair | 0 min | ✅ COMPLETE |
| 07:25 → ?? | Gate A row classification | Chair | ~30 min | ⏳ PENDING |
| +5 min | Developer applies Gate A decisions | Developer | 5 min | ⏳ PENDING |
| +10 min | Phase 1 preflight | Developer | 10 min | ⏳ PENDING |
| +20 min | Feature backfill (if HEALTHY) | Developer | 30 min | ⏳ PENDING |
| +50 min | Worker enable; Phase 1 LIVE | Developer | 5 min | ⏳ PENDING |

**Total to Phase 1 live: ~1 hour from Gate A row decisions**

---

## NEXT ACTION (CHAIR)

**Use:** `GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md` (investigation protocol)

**Investigate:** 2 XAUUSD rows (2026-07-06, ~1010.5p each)
- OHLC geometry (valid/invalid)
- Public gold reference (confirms/contradicts/no data)
- Adjacent bars (normal/elevated/anomalous)
- Per-row decision: KEEP or EXCLUDE

**Record:** `CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md`
```
GATE A INVESTIGATION:
- XAUUSD Row 1: [KEEP/EXCLUDE], evidence: [reason]
- XAUUSD Row 2: [KEEP/EXCLUDE], evidence: [reason]
```

**Send:** Completed response to developer

---

## GIT COMMIT RECORD

**Latest commits (all pushed to master):**
- 8e9b354: INDEX_CHAIR_DECISION_PACKAGE
- 668646b: 00_SESSION_FINAL_SUMMARY
- 11bd01c: QUICK_START_CHAIR_DECISIONS
- e8c8197: SESSION_COMPLETION
- 2cb3911: PHASE_1_READINESS
- 126c8fa: CHAIR_DECISION_SUMMARY
- b62636e: CHAIR_DECISION_RESPONSE_TEMPLATE
- 425cadf: GATE_B_IMPLEMENTATION
- 7e4d1be: GATE_A_INVESTIGATION

**New commit (this decision record):** CHAIR_FORMAL_DECISIONS_RECORDED_2026-08-17

---

## FORMAL APPROVAL SIGNATURE

```
CHAIR FORMAL DECISIONS — 2026-08-17 07:25 UTC

Gate A Framework:      APPROVED (row classification deferred to investigation)
Gate B (v3-only):      APPROVED (no code changes required; already compliant)
Phase 1 Thresholds:    APPROVED (with immutability guardrails locked)
Governance Lock:       CONFIRMED (authority split, non-reversible constraints)

Execution Path:        READY (preflight → backfill → worker enable)
Blocking Item:         Gate A row KEEP/EXCLUDE decisions (pending investigation)
Phase 1 Target:        ~08:40 UTC (upon Gate A classification + preflight passing)

Authority:
- Chair: Gate A decisions, backfill authorization
- Developer: Execute preflight, backfill, worker enable
- Board: Changes to immutability or detector canon

Status: READY FOR GATE A INVESTIGATION + PHASE 1 EXECUTION
```

---

**Decision Status: ✅ FORMALLY LOCKED**

**Next Action: Chair investigates Gate A rows using approved protocol**

**Upon Gate A decisions: Developer executes Phase 1 unblock (no further approvals needed)**
