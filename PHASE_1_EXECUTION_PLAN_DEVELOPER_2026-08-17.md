# PHASE 1 EXECUTION PLAN — DEVELOPER READY
**2026-08-17 07:26 UTC**

**Status:** Chair has approved Gates B & Phase 1 thresholds. Gate A investigation framework is approved. Awaiting Gate A row classification to proceed with Phase 1 unblock.

---

## CURRENT STATE

### Chair Approvals (✅ LOCKED)

- ✅ **Gate B:** v3-only gating is canonical; v2 archived (no code changes needed)
- ✅ **Phase 1 Thresholds:** XAUUSD ≤2 1m blockers (all decided), 0 HTF blockers
- ✅ **Gate A Framework:** Investigation protocol approved; row decisions deferred
- ✅ **Governance:** Immutability locked (raw candles, fail-closed policy, features_zone frozen)

### Blocking Item (⏳ PENDING)

- ⏳ **Gate A Row Classification:** 2 XAUUSD rows (2026-07-06) must be explicitly decided (KEEP/EXCLUDE) and recorded

### Readiness (✅ SYSTEMS READY)

- ✅ Preflight script tested and ready
- ✅ Backfill script tested and ready
- ✅ Worker enable procedure ready
- ✅ All contingent on Gate A decisions

---

## GATE A: WHAT DEVELOPER NEEDS FROM CHAIR

Chair must provide:

```
GATE A INVESTIGATION RESULTS:

XAUUSD Row 1 (2026-07-06, first instance):
  - Geometry: [VALID / INVALID]
  - Public reference: [CONFIRMS / CONTRADICTS / NO DATA]
  - Adjacent context: [NORMAL / ELEVATED / ANOMALOUS]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [reason]

XAUUSD Row 2 (2026-07-06, second instance):
  - Geometry: [VALID / INVALID]
  - Public reference: [CONFIRMS / CONTRADICTS / NO DATA]
  - Adjacent context: [NORMAL / ELEVATED / ANOMALOUS]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [reason]
```

**Format:** Any clear format acceptable (text, filled template, etc.)

**Once received:** Developer applies decisions and executes Phase 1 unblock

---

## PHASE 1 EXECUTION SEQUENCE

### Step 1: Apply Gate A Decisions to Canonical Eligibility

**Upon receiving chair's Gate A row classifications:**

```bash
# If Row 1 = KEEP:
psql -h localhost -U postgres -d tradzfx_v2 -c "
  UPDATE market.candle_eligibility 
  SET state = 'CLEAN', approved_at = NOW(), approved_by = 'chair'
  WHERE symbol = 'XAUUSD' AND ts = [Row1_timestamp] AND state = 'PERSISTED'
"

# If Row 1 = EXCLUDE:
psql -h localhost -U postgres -d tradzfx_v2 -c "
  UPDATE market.candle_eligibility 
  SET state = 'BLOCKED', approved_at = NOW(), approved_by = 'chair', reason = '[Row1_reason]'
  WHERE symbol = 'XAUUSD' AND ts = [Row1_timestamp] AND state = 'PERSISTED'
"

# Repeat for Row 2
```

**Expected outcome:**
- KEEP rows: state = 'CLEAN' (eligible for feature compute)
- EXCLUDE rows: state = 'BLOCKED' (skipped in feature pipeline)
- Both rows: recorded in audit trail with timestamp + approver

**Time:** ~5 minutes

---

### Step 2: Run Phase 1 Preflight Validation

**Purpose:** Confirm XAUUSD data quality meets Phase 1 thresholds

```bash
node scripts/backtest-pit-v2.js XAUUSD 90 --preflight
```

**Preflight checks:**
- Lifecycle corruption detected? (lifecycle_refresh_state, features_zone integrity)
- Required candles present? (candles_1m data intact for 90d window)
- Required features present? (leaf features backfilled or available)
- Canonical blockers ≤ Phase 1 thresholds? (after Gate A decisions applied)

**Expected output:**
```
XAUUSD Phase 1 Preflight Results:
- Data quality verdict: HEALTHY / DEGRADED / BLOCKED_SYSTEM_QUALITY
- Canonical blockers: N (should be ≤ 2 after Gate A applied)
- HTF blockers: 0 (inherited from 1m, should be 0)
- Coverage: 90 days (2026-05-20 → 2026-08-17)
- Ready for Phase 1: YES / NO
```

**Success criteria:**
- Data quality: HEALTHY (or DEGRADED with non-blocking issues)
- Canonical blockers: ≤ 2 (all decided; Gate A rows applied)
- HTF blockers: 0 (inherited from 1m)

**Failure handling:**
- If BLOCKED_SYSTEM_QUALITY: stop; report to chair
- If blockers > threshold: stop; report to chair
- If preflight passes: proceed to Step 3

**Time:** ~10 minutes

---

### Step 3: Feature Backfill (90-Day Historical Window)

**Purpose:** Compute leaf + session features for XAUUSD 90-day window (Phase 1 shadow)

**Prerequisites (must all be YES):**
- ✅ Gate A decisions applied to candle_eligibility
- ✅ Preflight passed with HEALTHY verdict
- ✅ Canonical blockers ≤ Phase 1 thresholds
- ✅ HTF blockers = 0

**Backfill command:**

```bash
# Set zone outcome skip (Phase 1 shadow; zone outcomes backfilled separately later)
export ZONE_BACKFILL_SKIP_OUTCOMES=1

# Backfill leaf + session features (1d → 5m, high-to-low for HTF context)
node scripts/backfill-historical-features.js XAUUSD 1d,4h,1h,5m --start 2026-05-20 --end 2026-08-17
```

**Features backfilled:**
- ✅ features_atr (leaf; canonical-only; always backfilled)
- ✅ features_spread (leaf; canonical-only; 1m producer averaged)
- ✅ features_session (leaf; session-scoped; session boundaries from DEFAULT_SESSION_WINDOWS)
- ✅ features_opening_range (event; session-scoped ORB; range_completion_ts logic)
- ❌ features_zone (frozen; Phase 1 shadow constraint)
- ❌ features_bias, features_direction_state (state features; not in Phase 1 shadow)

**Backfill parameters:**
- Window: 2026-05-20 → 2026-08-17 (90 days)
- Symbols: XAUUSD only (Phase 1 single-symbol trial)
- Timeframes: 1d, 4h, 1h, 5m (high-to-low for HTF context)
- Lookback: 500 bars per feature (standard for leaf+session)
- Mode: non-production (shadow; results read-only, not live-traded)

**Expected output:**
```
Backfill complete:
- features_atr: N rows inserted/updated
- features_spread: N rows inserted/updated
- features_session: N rows inserted/updated
- features_opening_range: N rows inserted/updated
- Total: N rows; 0 errors
```

**Success criteria:**
- Zero backfill errors
- Row counts match expected (roughly N candles × 4 features × timeframes)
- No features_zone rows modified
- All rows timestamped with current backfill run

**Time:** ~30 minutes (depends on DB load; 90d × 4 features × 4 timeframes)

---

### Step 4: Worker Enable (Shadow Mode Activation)

**Purpose:** Activate live feature pipeline for XAUUSD (shadow mode; computed but not live-traded)

**Prerequisites (must all be YES):**
- ✅ Gate A decisions applied
- ✅ Preflight passed
- ✅ Backfill completed with zero errors

**Environment activation:**

```bash
# Set worker to enabled (live bars trigger feature compute)
export TM_DISABLE_FEATURE_JOBS=false

# Restart feature engine + web worker
systemctl restart tz-engine tz-web-v2

# Verify worker is online
curl http://localhost:3000/api/v2/pipeline/health
# Expected: { "status": "ok", "database": { "connected": true }, ... }

# Tail logs to confirm XAUUSD trigger + feature compute
tail -f logs/engine.log | grep XAUUSD
# Expected: "[engine] XAUUSD 1m trigger; computing features..."
```

**Live pipeline activation:**
- ✅ Ingest route: bars arrive → quarantine check → feature trigger
- ✅ Feature engine: live bars → feature compute (inline + background jobs)
- ✅ Feature persist: rows written to `features_*` tables (read-only; not live-traded)
- ✅ Shadow mode: computed features are readable but not consumed by live traders

**Success criteria:**
- Worker process online (systemctl status shows "active")
- Health endpoint returns connected = true
- Engine logs show XAUUSD feature computes
- No errors in worker or engine logs

**Time:** ~5 minutes

---

## PHASE 1 LIVE CRITERIA (FINAL CHECKLIST)

Once all steps complete, confirm Phase 1 readiness:

```
✅ Gate A: 2 XAUUSD rows decided (KEEP/EXCLUDE) + recorded
✅ Gate B: v3-only gating canonical; no code changes
✅ Phase 1: Thresholds met (≤2 1m blockers, 0 HTF blockers)
✅ Preflight: HEALTHY data quality verdict
✅ Backfill: 90d XAUUSD features computed (leaf + session)
✅ Worker: Live pipeline enabled (shadow mode)
✅ Logs: Zero errors; XAUUSD triggers + computes visible
✅ Governance: Immutability locked (raw candles, fail-closed, features_zone frozen)

Phase 1 Status: LIVE (shadow mode, XAUUSD only, read-only compute)
Next Phase: Live/backtest parity validation (Phase 1b)
```

---

## TIMELINE ESTIMATE

| Step | Action | Duration | Cumulative |
|------|--------|----------|-----------|
| 1 | Apply Gate A decisions | 5 min | 5 min |
| 2 | Run Phase 1 preflight | 10 min | 15 min |
| 3 | Feature backfill (90d) | 30 min | 45 min |
| 4 | Worker enable + verify | 5 min | 50 min |
| — | **Phase 1 LIVE** | — | **~08:16 UTC** |

**Total time from Gate A decisions to Phase 1 live: ~50 minutes**

---

## ERROR HANDLING

### If Preflight Fails (BLOCKED_SYSTEM_QUALITY)

**Stop immediately; report to chair:**
- What is blocked? (lifecycle corruption, missing candles, missing features)
- What is the corrective action?
- Can we proceed with degraded verdict, or must we halt?

**Chair decides:** Proceed (degraded) or halt Phase 1

---

### If Backfill Errors

**Stop immediately; report to chair:**
- Which feature failed? (atr, spread, session, opening_range)
- What is the error? (SQL error, compute error, timeout)
- Can we retry, or must we halt?

**Chair decides:** Retry, skip feature, or halt Phase 1

---

### If Worker Fails to Start

**Stop immediately; report to chair:**
- Is DB connected?
- Are environment variables set?
- Are logs showing errors?

**Chair decides:** Troubleshoot or halt Phase 1

---

## DEVELOPER: STANDING BY

All systems ready. Awaiting chair's Gate A row classification.

**Upon receipt of Gate A decisions, execute steps 1–4 in sequence with no further approvals needed.**

---

## KEY DOCUMENTS (FOR REFERENCE)

- **CHAIR_FORMAL_DECISIONS_RECORDED_2026-08-17.md** — Chair approvals locked
- **GATE_A_INVESTIGATION_XAUUSD_2026-08-17.md** — Investigation protocol (for chair)
- **PHASE_1_READINESS_INTEGRATION_PACKAGE_2026-08-17.md** — Full integration details
- **CHAIR_DECISION_RESPONSE_TEMPLATE_2026-08-17.md** — Decision template (for chair)

---

## STATUS

```
✅ Gates B & Phase 1: APPROVED by chair
✅ All systems: READY for execution
✅ Developer: STANDING BY
⏳ Gate A rows: AWAITING CHAIR CLASSIFICATION

Target: Phase 1 LIVE at ~08:16 UTC (upon Gate A decisions)
```

---

**Developer is ready to execute Phase 1 unblock immediately upon receipt of chair's Gate A row decisions.**
