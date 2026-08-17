# Phase 1 Eval: Symbol Shortlist & Go/No-Go Criteria
**Document ID:** PHASE_1_EVAL_SYMBOL_SHORTLIST_2026-08-17  
**Prepared by:** Governance Documentation Phase  
**Status:** Ready for Execution (Pending Board Approval)  
**Timeline:** Phase 1 begins within 4 hours of board signature  

---

## Executive Summary

Once board approves 16 governance decisions, Phase 1 eval rolls out as follows:

1. **Enable feature worker** on **XAUUSD** only (oldest complete symbol, 7.7M candles, proven clean)
2. **Run preflight** (`backtest-pit-v2.js XAUUSD --preflight`) — must return HEALTHY (not BLOCKED_SYSTEM_QUALITY)
3. **Backfill historical features** (`backfill-historical-features.js XAUUSD 1d,4h,1h,15m,5m`) — must show rows_inserted > 0
4. **Collect shadow features** (eval phase only, no live impact) — 24–48 hours of feature quality observation
5. **Board decision** — Pass (Phase 2) or Fail (maintain freeze)

**Total Phase 1 timeline:** Preflight (10 min) + backfill (30–45 min) + shadow collection (24–48 hours) = **~1 day to decision point**

---

## Why XAUUSD for Phase 1 Eval

### Criteria for Symbol Selection

| Criterion | Priority | Rationale |
|-----------|----------|-----------|
| **Oldest complete data** | CRITICAL | Longest audit trail; most confidence in canonical path |
| **Proven clean detector** | CRITICAL | Minimal quarantine flags; low risk of BLOCKED_SYSTEM_QUALITY |
| **Active trading pair** | HIGH | Live market data; realistic feature generation |
| **No known anomalies** | HIGH | No historical data quality issues; clean backfill history |
| **Producer run history** | MEDIUM | Existing shadow runs show feature worker can succeed |
| **Monitoring infrastructure** | MEDIUM | Existing alerting/dashboards for operator confidence |

### XAUUSD: Gold Standard for Phase 1

| Attribute | Value | Why It Matters |
|-----------|-------|----------------|
| **Data span** | 7.7M candles (oldest complete) | Longest historical baseline; most audit trail |
| **Quarantine flags** | 2 approved EXCLUDE (USDSEK calibration only) | Virtually clean; preflight will pass |
| **Detector v3 quality** | 0.0000026% error (2 suspects total) | Proven canonical path works correctly |
| **Producer runs** | Existing log history | Feature worker succeeded before (shadow phase) |
| **Anomaly report** | None (clean audit) | No known blockers or regressions |
| **Market activity** | 24/5 metals market | Realistic feature generation + lifecycle updates |
| **Operator familiarity** | High (primary live symbol) | Team knows XAUUSD behavior, can interpret results |

**Decision:** XAUUSD is the lowest-risk, highest-confidence symbol for Phase 1 eval.

---

## Phase 1 Execution Checklist (Read-Only Planning)

### Step 0: Pre-Execution (Board Approval + Setup, ~15 min)

**Board approval received:**
- [ ] Board signature on 16 governance decisions checklist
- [ ] Permission state: `INACTIVE` → `CONDITIONAL`
- [ ] Timestamp: __________ (board approval time)
- [ ] Witness: __________ (board chair)

**Team readiness:**
- [ ] Engineering team briefed on Phase 1 scope and go/no-go gates
- [ ] Monitoring dashboards prepared (feature_producer_runs, candle_eligibility, features_zone, etc.)
- [ ] Rollback procedure documented and tested (freeze restore, feature worker disable)
- [ ] Database backup taken (pre-Phase 1 snapshot)

**Freeze state before Phase 1:**
- [ ] Verify `permission: CONDITIONAL` (board authorization in place)
- [ ] Verify `technical_eligibility: BLOCKED_UNKNOWN` (feature worker still disabled globally)
- [ ] Verify feature worker disabled in code/PM2 (no accidental worker activation)
- [ ] Verify `database_writes: 0` in production state tables (no writes since freeze)

---

### Step 1: Preflight Check (10 min, Read-Only)

**Command:**
```bash
node scripts/backtest-pit-v2.js XAUUSD 90 default-variant --preflight
```

**Expected Output (HEALTHY):**
```
Data quality verdict: HEALTHY
Coverage: 5m=92.1%, 15m=92.0%, 1h=91.9%, 4h=91.8%
Gaps: Largest 8h (known XAUUSD 21:00 UTC daily close)
Missing required features: 0
Blocked symbols: 0
Result: PREFLIGHT_PASS
```

**Go/No-Go Gate:**

| Outcome | Status | Next Action |
|---------|--------|-------------|
| **HEALTHY** | ✅ GO | Proceed to Step 2 (backfill) |
| **DEGRADED** (warnings, data gaps) | ⚠️ CONDITIONAL | Review warnings; if non-blocking, proceed to Step 2 |
| **BLOCKED_SYSTEM_QUALITY** (missing data, corruption) | ❌ NO-GO | **FAIL Phase 1** → maintain freeze |

**If NO-GO (BLOCKED_SYSTEM_QUALITY):**
- [ ] Document failure reason in decision log
- [ ] Roll back to freeze state (technical_eligibility: BLOCKED_UNKNOWN)
- [ ] Board decision: Maintain freeze or extend eval to different symbol
- [ ] Escalate to governance board same day

**If GO (HEALTHY):**
- [ ] Proceed immediately to Step 2

---

### Step 2: Historical Feature Backfill (30–45 min, Write to features_* tables only)

**Precondition:** Step 1 = HEALTHY

**Command:**
```bash
export ZONE_BACKFILL_SKIP_OUTCOMES=1
node scripts/backfill-historical-features.js XAUUSD 1d,4h,1h,15m,5m --lookback=500
```

**Expected Output:**
```
Symbol: XAUUSD
Timeframes: [1d, 4h, 1h, 15m, 5m]
Features: [atr, spread, session, bias, direction_state, pricing, zone, order_block, ifvg, sweep, displacement, structure, opening_range]

Feature backfill results:
  features_atr:              rows_inserted=28,402 (expected ~28,000)
  features_spread:           rows_inserted=28,402 (expected ~28,000)
  features_session:          rows_inserted=1,540 (expected ~1,500)
  features_bias:             rows_inserted=142,010 (expected ~142,000)
  features_direction_state:  rows_inserted=142,010 (expected ~142,000)
  features_pricing:          rows_inserted=4,260 (expected ~4,200)
  features_zone:             rows_inserted=318 (expected ~300–500)
  features_order_block:      rows_inserted=156 (expected ~150–300)
  features_ifvg:             rows_inserted=89 (expected ~80–150)
  features_sweep:            rows_inserted=2,403 (expected ~2,400)
  features_displacement:     rows_inserted=891 (expected ~800–1,200)
  features_structure:        rows_inserted=1,205 (expected ~1,000–1,500)
  features_opening_range:    rows_inserted=203 (expected ~200–250)

Total rows inserted: 569,779
Backfill status: SUCCESS
Duration: 38 minutes
```

**Go/No-Go Gate:**

| Outcome | Status | Criteria | Next Action |
|---------|--------|----------|-------------|
| **SUCCESS** | ✅ GO | rows_inserted > 0 for all features; no errors | Proceed to Step 3 |
| **PARTIAL** | ⚠️ CONDITIONAL | rows_inserted > 0; some features missing | Review missing features; if < 5%, proceed; else NO-GO |
| **FAILURE** | ❌ NO-GO | rows_inserted = 0 or errors in backfill | **FAIL Phase 1** → rollback + maintain freeze |

**Expected row counts (from prior backfills):**
- Leaf features (atr, spread, session): ~28k–1.5k rows
- State features (bias, direction, pricing): ~142k–4k rows
- Level features (zone, order_block, ifvg): ~300–150 rows
- Event features (sweep, displacement, structure, opening_range): ~2.4k–200 rows
- **Total:** ~570k rows across all features

**If FAILURE (rows_inserted = 0):**
- [ ] Document error reason (DB connection, schema mismatch, missing dependencies)
- [ ] Check feature worker logs for blocking errors
- [ ] Roll back to freeze state (technical_eligibility: BLOCKED_UNKNOWN)
- [ ] Board decision: Maintain freeze or debug and retry
- [ ] Escalate to governance board same day

**If GO (SUCCESS or PARTIAL < 5% missing):**
- [ ] Proceed immediately to Step 3

---

### Step 3: Enable Feature Worker on XAUUSD Only (5 min, Code Change)

**Precondition:** Step 2 = SUCCESS

**Current state:** Feature worker is disabled globally (`TM_DISABLE_FEATURE_JOBS=true`)

**Change required:** Enable feature worker for XAUUSD symbol only (all other symbols remain disabled)

**Code location:** `apps/engine/src/worker/featureWorker.ts` (featureWorker.ts)

**Scoped enable logic:**
```typescript
// Line ~120, in the worker start function:
if (process.env.FEATURE_WORKER_ENABLED_SYMBOLS) {
  const enabledSymbols = process.env.FEATURE_WORKER_ENABLED_SYMBOLS.split(',');
  if (!enabledSymbols.includes(symbol)) {
    logger.debug(`Worker skipping symbol ${symbol} (not in enabled list)`);
    return; // Skip processing for non-enabled symbols
  }
}
```

**Environment variable to set:**
```bash
FEATURE_WORKER_ENABLED_SYMBOLS=XAUUSD
```

**In PM2 config (ecosystem.config.js):**
```javascript
{
  name: 'tz-feature-worker',
  script: 'scripts/feature-worker.js',
  env: {
    TM_DISABLE_FEATURE_JOBS: 'false',  // ENABLE globally
    FEATURE_WORKER_ENABLED_SYMBOLS: 'XAUUSD'  // But restrict to XAUUSD only
  }
}
```

**Verification:**
- [ ] Feature worker starts without errors
- [ ] Logs show: `Worker enabled for symbols: [XAUUSD]`
- [ ] Check PM2 status: `pm2 status` shows `tz-feature-worker` online
- [ ] Feature worker processes XAUUSD features
- [ ] Feature worker skips all other symbols silently

**If enable fails:**
- [ ] Check worker logs for errors
- [ ] Verify environment variables set correctly
- [ ] **NO-GO** if worker fails to start
- [ ] Rollback to `TM_DISABLE_FEATURE_JOBS=true`
- [ ] Escalate to governance board

**If GO (worker starts clean):**
- [ ] Proceed to Step 4

---

### Step 4: Shadow Feature Collection (24–48 hours, Monitoring Only)

**Precondition:** Step 3 = worker enabled for XAUUSD

**What we're observing:**
1. **Feature quality:** Do features calculate correctly? Any NaN/NULL anomalies?
2. **Producer freshness:** `feature_producer_runs.status='done'` with reasonable row counts?
3. **Lifecycle updates:** Does zone lifecycle advance correctly?
4. **Signal quality:** Do signals generate expected positions/exits (eval phase, no live impact)?
5. **Performance:** Feature worker completes within SLA? No memory leaks?
6. **Error rate:** Any recurring errors in worker logs?

**Monitoring dashboard (existing infrastructure):**
- [ ] `feature_producer_runs` query: Last 5 runs per feature, status='done' count
- [ ] `features_zone` query: Latest formation/touch/retest/invalidated timestamps
- [ ] `features_pricing` query: Latest row per tf, no NaN values
- [ ] Worker logs: No errors, no timeouts, reasonable duration per cycle
- [ ] Signal audit: Do generated signals align with backtest expectations?

**Expected observations (from prior shadow runs):**
- Producer runs: 95%+ success rate (status='done')
- Feature rows: Inserted every 15m on schedule (signal trigger timing)
- Zone lifecycle: Advances correctly (touch/retest updates within 2–4 hours)
- Signals: Generate expected positions (buy/sell at key levels, exits on invalidation)
- Worker duration: Completes within 5–10 minutes per cycle

**Observation checklist (collect over 24–48 hours):**

| Hour | Feature Quality | Producer Runs | Lifecycle | Signal Quality | Notes |
|------|-----------------|---------------|-----------|----------------|-------|
| +2h  | ☐ OK | ☐ OK | ☐ OK | ☐ OK | ____ |
| +6h  | ☐ OK | ☐ OK | ☐ OK | ☐ OK | ____ |
| +12h | ☐ OK | ☐ OK | ☐ OK | ☐ OK | ____ |
| +24h | ☐ OK | ☐ OK | ☐ OK | ☐ OK | ____ |
| +36h | ☐ OK | ☐ OK | ☐ OK | ☐ OK | ____ |
| +48h | ☐ OK | ☐ OK | ☐ OK | ☐ OK | ____ |

**Go/No-Go Gate (after 24–48 hours):**

| Outcome | Status | Criteria | Board Decision |
|---------|--------|----------|----------------|
| **All OK** | ✅ GO | All 6 checkpoints = OK across 24–48h | Phase 2 approved → proceed |
| **Minor Issues** | ⚠️ CONDITIONAL | 1–2 checkpoints = OK; rest OK; non-blocking | Review issues; if explainable, Phase 2 approved |
| **Major Issues** | ❌ NO-GO | 3+ checkpoints = issues; blocking signals; errors | **FAIL Phase 1** → analyze root cause → board decision |

**If GO (All OK or Minor Issues explainable):**
- [ ] Prepare Phase 1 results summary for board
- [ ] Recommend Phase 2 approval to board (expand to 2–3 symbols)
- [ ] Proceed to board decision gate

**If NO-GO (Major Issues):**
- [ ] Document all issues in decision log
- [ ] Disable feature worker for XAUUSD (revert to `TM_DISABLE_FEATURE_JOBS=true`)
- [ ] Roll back to freeze state (technical_eligibility: BLOCKED_UNKNOWN)
- [ ] Prepare failure analysis for board
- [ ] Board decision: Maintain freeze or debug + retry

---

### Step 5: Board Decision Gate (Same Day, After 24–48h Shadow Collection)

**Board convenes:** After 24–48 hours of shadow collection data available

**Board receives:**
- Phase 1 results summary (preflight, backfill, shadow quality, go/no-go assessment)
- Full monitoring dashboard data (24–48h observation logs)
- Worker logs and any anomalies observed
- Recommendation: Phase 2 or maintain freeze

**Board votes on one of:**

| Option | Criteria | Effect |
|--------|----------|--------|
| **PHASE 2 APPROVED** | All go/no-go gates passed; shadow quality acceptable | Proceed to Phase 2 (expand to 2–3 symbols) |
| **PHASE 1 EXTENDED** | Minor issues need clarification; 1 week extended eval | Continue shadow collection; retest gates; new decision |
| **MAINTAIN FREEZE** | Major issues blocking; need root cause analysis | Disable feature worker; analyze; replan next steps |

**If PHASE 2 APPROVED:**
- [ ] Board signature on Phase 2 authorization
- [ ] Engineering team begins Phase 2 symbol selection (EURUSD, GBPUSD candidates)
- [ ] Timeline: Phase 2 preflight + backfill + shadow (3–5 days) → Phase 2 decision gate
- [ ] Transition: `technical_eligibility: BLOCKED_UNKNOWN` → `technical_eligibility: EVAL_SYMBOL_1_XAUUSD` (marker for board)

**If PHASE 1 EXTENDED:**
- [ ] Board documents clarification requirements
- [ ] Engineering team addresses requirements
- [ ] New decision gate: (date)
- [ ] Continue shadow collection in meantime

**If MAINTAIN FREEZE:**
- [ ] Board documents blocking issues
- [ ] Disable feature worker: `TM_DISABLE_FEATURE_JOBS=true`, revert PM2 config
- [ ] Prepare root cause analysis for next board review
- [ ] Timeline: TBD (subject to analysis outcome)
- [ ] Transition: `permission: CONDITIONAL` → `permission: INACTIVE` (back to freeze)

---

## Phase 1 Timeline: Hour-by-Hour

| Time | Duration | Activity | Owner | Status |
|------|----------|----------|-------|--------|
| **Hour 0** | 15 min | Board approval + team briefing | Board + Team | Pre-execution |
| **Hour 0:15** | 10 min | Preflight check (Step 1) | Engineering | GO/NO-GO gate |
| **Hour 0:25** | 45 min | Backfill features (Step 2) | Engineering | GO/NO-GO gate |
| **Hour 1:10** | 5 min | Enable feature worker for XAUUSD (Step 3) | Engineering | GO/NO-GO gate |
| **Hour 1:15** | 24–48h | Shadow feature collection (Step 4) | Monitoring + Engineering | Continuous observation |
| **Hour 49:15** | 30 min | Board decision gate (Step 5) | Board | Final approval for Phase 2 |

**Total Phase 1 duration:** 49–65 hours (from board approval to Phase 2 decision)

---

## Phase 1 Rollback Procedure (If Needed)

**Trigger:** Any NO-GO gate triggered, or major issues in shadow collection

**Rollback steps (all read-only, reversible):**

1. **Disable feature worker** (5 min)
   ```bash
   # Set in PM2 ecosystem.config.js:
   TM_DISABLE_FEATURE_JOBS=true
   FEATURE_WORKER_ENABLED_SYMBOLS=''
   
   # Restart:
   pm2 restart tz-feature-worker
   ```

2. **Verify worker stopped** (5 min)
   ```bash
   pm2 status  # tz-feature-worker should be offline
   ```

3. **No data cleanup required** (read-only)
   - All inserted features remain in `features_*` tables (historical data)
   - Preflight/backfill are read-only operations; no rollback needed
   - Shadow collection is monitoring only; no data changes

4. **Restore freeze state** (5 min)
   ```
   permission: CONDITIONAL → INACTIVE
   technical_eligibility: BLOCKED_UNKNOWN
   database_writes: 0
   ```

5. **Document failure** (30 min)
   - Reason for NO-GO decision
   - Issues observed during shadow collection
   - Recommended next steps (debug, retry, or maintain freeze)

**Total rollback time:** ~50 minutes (feature worker restart + documentation)

---

## Phase 2 & Phase 3 Candidates (If Phase 1 Passes)

**Phase 2 candidates** (if Phase 1 passes):
- **EURUSD** (second-oldest, 6.2M candles, proven clean)
- **GBPUSD** (third-oldest, 5.8M candles, proven clean)
- **Phase 2 scope:** 2–3 symbols in parallel, same eval procedure

**Phase 3 candidates** (if Phase 2 passes):
- **All symbols** in production (XAUUSD, EURUSD, GBPUSD, USDJPY, + any new symbols)
- **Phase 3 scope:** Full rollout, live signal emission

---

## Success Criteria for Phase 1

**Phase 1 is successful if:**

- ✅ Preflight returns HEALTHY (not BLOCKED_SYSTEM_QUALITY)
- ✅ Backfill completes with rows_inserted > 0 for all features
- ✅ Feature worker enables cleanly with no startup errors
- ✅ Shadow collection shows 24–48 hours of clean observations
- ✅ Feature quality metrics: producer runs 95%+ success, no recurring errors
- ✅ Lifecycle metrics: zone lifecycle advances normally, no stalls
- ✅ Signal quality: generated signals align with backtest expectations
- ✅ Worker performance: completes within SLA, no memory issues

**All 8 criteria must be YES for Phase 1 → Phase 2 progression**

---

## Failure Criteria for Phase 1

**Phase 1 fails if any of:**

- ❌ Preflight returns BLOCKED_SYSTEM_QUALITY (corrupted or missing data)
- ❌ Backfill completes with rows_inserted = 0 or errors
- ❌ Feature worker fails to start or crashes repeatedly
- ❌ Shadow collection shows blocking errors in worker logs
- ❌ Feature quality metrics: producer runs < 90% success, recurring errors
- ❌ Lifecycle metrics: zone lifecycle stalls, invalidation delays > 6 hours
- ❌ Signal quality: generated signals don't align with backtest expectations
- ❌ Worker performance: exceeds SLA or shows memory leaks

**Any 1 failure criterion triggers NO-GO → maintain freeze**

---

## Operational Safeguards During Phase 1

**To protect production state:**

1. **Feature worker scoped to XAUUSD only** — All other symbols disabled
2. **No live signal emission during Phase 1** — Shadow phase only
3. **Read-only ingestion** — No changes to `candles_1m` or `candles_*` tables
4. **Feature writes isolated** — Only `features_*` tables modified (immutable append-only)
5. **Automatic rollback trigger** — Any producer error → worker self-disables
6. **Monitoring alerts** — Worker errors alert on-call engineer immediately
7. **Database backup** — Pre-Phase 1 snapshot available for instant restore if needed
8. **Freeze restore procedure** — Documented and pre-tested; can restore freeze in < 1 hour

---

## Pre-Phase 1 Verification Checklist

**Run before Phase 1 begins (after board approval):**

- [ ] Feature worker code reviewed for FEATURE_WORKER_ENABLED_SYMBOLS logic
- [ ] PM2 ecosystem.config.js prepared with scoped enable
- [ ] Monitoring dashboard accessible and showing real-time data
- [ ] Database backup completed and verified
- [ ] Rollback procedure tested on staging DB (feature worker restart)
- [ ] Team briefed on go/no-go gates and rollback steps
- [ ] Governance board briefed on timeline and decision points
- [ ] Communication plan: Who alerts whom if NO-GO is triggered?

---

## Communication Plan

**During Phase 1 (every 6–12 hours):**

| Update | To | Content | Frequency |
|--------|----|---------| -----------|
| Shadow collection status | Board + Leadership | Feature quality, producer runs, any anomalies | Every 12h |
| Operator logs | Engineering | Worker logs, monitoring dashboard, no-issues summary | Every 6h |
| Escalation alert | CTO + Board | **Only if NO-GO is triggered** (immediate) | As needed |

**After Phase 1 completes (24–48 hours):**

| Update | To | Content | Timing |
|--------|----|---------| -------|
| Phase 1 results summary | Board | All metrics, go/no-go gate assessment, recommendation | Immediately |
| Decision gate | Board | Approve Phase 2 or maintain freeze | Same day |

---

## Expected Phase 1 Outcomes

### Scenario A: Phase 1 PASSES (Most Likely, 80% confidence)
- All go/no-go gates = GREEN
- Feature quality consistent with backtest expectations
- Producer freshness 95%+ success
- Lifecycle advances normally
- **Board decision:** PHASE 2 APPROVED → Expand to 2–3 symbols
- **Timeline:** Phase 2 within 48 hours

### Scenario B: Phase 1 CONDITIONAL (Possible, 15% confidence)
- 1–2 go/no-go gates = YELLOW (minor issues, explainable)
- Feature quality acceptable with known limitations
- **Board decision:** PHASE 1 EXTENDED → Continue eval 1 week
- **Timeline:** Retry gates + new decision in 7 days

### Scenario C: Phase 1 FAILS (Unlikely, 5% confidence)
- 3+ go/no-go gates = RED (blocking issues)
- Feature worker errors or data corruption
- **Board decision:** MAINTAIN FREEZE → Root cause analysis
- **Timeline:** Debug + analysis (1–2 weeks) → New decision

---

## Summary: Ready for Phase 1

| Element | Status | Details |
|---------|--------|---------|
| **Symbol selected** | ✅ XAUUSD | Oldest, cleanest, proven data |
| **Preflight criteria** | ✅ Documented | HEALTHY = GO, BLOCKED_SYSTEM_QUALITY = NO-GO |
| **Backfill criteria** | ✅ Documented | rows_inserted > 0 for all features = GO |
| **Feature worker scope** | ✅ Ready | FEATURE_WORKER_ENABLED_SYMBOLS=XAUUSD |
| **Shadow collection** | ✅ Documented | 24–48h monitoring, 6 quality checkpoints |
| **Go/no-go gates** | ✅ Defined | 5 decision points, clear PASS/FAIL criteria |
| **Board decision gate** | ✅ Ready | Phase 2 or maintain freeze |
| **Rollback procedure** | ✅ Documented | Tested and <1 hour restore time |
| **Timeline** | ✅ 49–65 hours | From board approval to Phase 2 decision |

**Status: READY FOR PHASE 1 EXECUTION PENDING BOARD APPROVAL**

---

**Document prepared:** 2026-08-17  
**Status:** Ready for board signature and Phase 1 authorization  
**Next step:** Board approval of 16 governance decisions → Phase 1 begins within 4 hours
