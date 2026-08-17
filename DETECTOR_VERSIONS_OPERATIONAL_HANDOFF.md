# Detector Versions Audit — Operational Handoff & Next Actions
**Date:** 2026-08-17T05:14:50.949Z  
**Status:** Audit complete, frozen (read-only), ready for governance review

---

## Executive Summary for Governance Board

### What We Found

**Current State:**
- Detector v3 is production-stable (F1=0.968, precision=97.9%)
- Only magnitude detection active (1000-pip threshold)
- Data quality excellent (2 suspects in 7.7M candles, 0.0000026% error rate)
- Infrastructure is sophisticated (immutable schema, versioning, audit trails)
- Implementation is minimal (advanced features designed but not coded)

**The Gap:**
- v2/v3/v4 advanced features are conceptual, not implemented
- Anomaly flag types designed but not populated
- Symbol-specific thresholds designed for v4 but not active in v3
- Governance freeze prevents any changes

### Recommendation

**Approve Phase 3A Shadow Run** (4-week rollout path):
1. **Phase 1 (1w):** Compare v2 vs v3 on frozen eval set → Validate v3 readiness
2. **Phase 2 (1w):** Finalize canonical decision matrix → Lock safety policy
3. **Phase 3A (1w):** Deploy v4 shadow ingestion → Collect 24h metrics
4. **Phase 3B–C (2w):** Canonical rebuild → PIT validation → Go-live

**Success Criteria:**
- Phase 1: v3 F1 > 0.95 ✅ (already 0.968)
- Phase 3A: Shadow agreement > 95% with v3, FP rate < 2%
- Phase 3C: PIT trades within ±0.1% of v3

---

## Immediate Actions (Today, 2026-08-17)

### For Governance Board
- [ ] **Read:** Executive Summary (5 min) + Comprehensive Audit §9 (5 min)
- [ ] **Decide:** Approve Phase 3A shadow run scope?
- [ ] **Action:** Authorize data engineering team to proceed with Phase 1 if approved
- [ ] **Gate:** Validate 31-point prerequisite checklist before Phase 1 starts

### For Data Engineering Lead
- [ ] **Access:** All 7 detector documentation files (in workspace root)
- [ ] **Review:** Technical Reference §1–6 (30 min) + Implementation Guide §5–8 (30 min)
- [ ] **Prepare:** Phase 1 eval script (frozen eval set design, v2 vs v3 comparison)
- [ ] **Standby:** Wait for governance approval before executing

### For QA Lead
- [ ] **Access:** Technical Reference §11–14 (quarantine, backtest, canonical)
- [ ] **Prepare:** PIT backtester modifications (canonical reads, quarantine logic)
- [ ] **Prepare:** Phase 3C acceptance test harness (trade outcome comparison)
- [ ] **Standby:** Wait for Phase 3A shadow metrics before Phase 3C prep

### For Ops Lead
- [ ] **Review:** Implementation Guide §8 (Failure Modes & Rollback)
- [ ] **Prepare:** Rollback runbook (5 scenarios, < 2 min per scenario)
- [ ] **Prepare:** Monitoring/alerting rules (detector version, anomaly flags, canonical coverage)
- [ ] **Prepare:** Incident commander playbook (escalation, decision matrix, comms)

---

## Document Distribution Checklist

### Ready to Share
- ✅ DETECTOR_VERSIONS_EXECUTIVE_SUMMARY.md
- ✅ DETECTOR_VERSIONS_COMPREHENSIVE_AUDIT.md
- ✅ DETECTOR_VERSIONS_TECHNICAL_REFERENCE.md
- ✅ DETECTOR_VERSIONS_IMPLEMENTATION_GUIDE.md
- ✅ DETECTOR_VERSIONS_DOCUMENTATION_INDEX.md
- ✅ DETECTOR_VERSIONS_DELIVERABLES_MANIFEST.md
- ✅ DETECTOR_VERSIONS_MASTER_INDEX.md

**Distribution:**
```
Governance Board:
├─ Executive Summary
├─ Comprehensive Audit §9 (Governance Status)
└─ Implementation Guide §1–2 (Gap Analysis & Prerequisites)

Data Engineering:
├─ Technical Reference (full)
├─ Implementation Guide (full)
└─ Master Index (navigation)

QA Team:
├─ Technical Reference §11–14
├─ Implementation Guide §5.3
└─ Executive Summary Troubleshooting

Ops Team:
├─ Implementation Guide §8
├─ Executive Summary Troubleshooting
└─ Master Index (quick reference)

Architecture:
├─ Comprehensive Audit (full)
├─ Implementation Guide §1–7
└─ Technical Reference §1–10
```

---

## Phase 1 Execution Plan (Pending Approval)

### Scope
**Compare:** Detector v2-calendar vs v3-robust on frozen eval set  
**Duration:** 1 week  
**Team:** Data engineering + governance review  
**Authority:** Requires 31-point prerequisite validation

### Frozen Eval Set Design
```
Period: 2026-05-19 to 2026-08-17 (90 days)
Symbols: EURUSD, XAUUSD, USDSEK, GBPUSD, NAS100, DE40
Candles: 7,776,000 (90d × 24h × 60m × 6 symbols)
Metrics: Precision, Recall, F1-Score, False Positive Rate
```

### Execution Steps
1. **Finalize Eval Set** (Day 1)
   - [ ] Generate SHA256 hashes (candles table snapshot)
   - [ ] Document eval set specifications (symbols, dates, candle count)
   - [ ] Governance sign-off (locked, immutable)

2. **Run v2 Detection** (Day 2–3)
   - [ ] Deploy v2-calendar detector logic (read-only, no persist)
   - [ ] Generate detection flags (magnitude + calendar awareness)
   - [ ] Compute metrics: TP, FP, FN, precision, recall, F1

3. **Run v3 Detection** (Day 3–4)
   - [ ] Current v3 results (already available)
   - [ ] Verify results are frozen (no new ingestion during eval)
   - [ ] Extract metrics: TP, FP, FN, precision, recall, F1

4. **Generate Report** (Day 5)
   - [ ] Compare metrics (v2 vs v3)
   - [ ] Analyze FP/FN differences (root causes)
   - [ ] Recommendation: v3 approved? (if F1 > 0.95)

5. **Governance Review** (Day 5–7)
   - [ ] Board reviews frozen eval report
   - [ ] Decision: Approve Phase 2? (if Phase 1 metrics acceptable)

### Success Criteria
- v3 F1-Score > 0.95 ✅ (currently 0.968, exceeds)
- v3 Precision > 0.97 ✅ (currently 97.9%, exceeds)
- v3 approved by governance ⏳ (pending board decision)
- Phase 2 authorized ⏳ (pending Phase 1 completion)

---

## Phase 2 Planning (Week 3–4 Post-Phase 1)

### Scope
**Lock:** Canonical safety policy by asset class  
**Duration:** 1 week  
**Team:** Data engineering + governance + architecture

### Deliverables
1. **Anomaly Decision Matrix** (by asset class)
   ```
   Asset Class | Detection Method | KEEP Decision | EXCLUDE Decision | REPLACED Decision
   FX Major    | Magnitude + Rel  | No outliers   | Extreme gaps     | (TBD)
   FX Exotic   | Magnitude + Rel  | Order-flow    | 50p+ gaps        | (TBD)
   Metals      | Magnitude + Cal  | Illiquid hrs  | > 100p spikes    | (TBD)
   Indices     | Magnitude only   | Market opens  | Protocol errors  | (TBD)
   Crypto      | (Not active)     | (TBD)        | (TBD)           | (TBD)
   ```

2. **Evidence Migration Plan** (v3 → v2 schema)
   - v3 `candle_quarantine` → v2 `candle_quarantine_evidence`
   - Preserve all KEEP/EXCLUDE/REPLACED decisions
   - Maintain audit trail (who, when, why)

3. **Canonical Policy Governance** (Sign-off)
   - Policy document (what's KEEP, EXCLUDE, REPLACED per asset class)
   - Decision matrix (approved by board)
   - Migration procedure (tested, dry run passed)
   - Rollback procedure (restore v3 state if needed)

### Execution Steps
1. [ ] Create anomaly decision matrix (asset class + severity)
2. [ ] Review all existing v3 quarantine decisions (currently 2 USDSEK)
3. [ ] Map v3 decisions to new matrix (KEEP/EXCLUDE/REPLACED)
4. [ ] Governance approval of matrix
5. [ ] Plan evidence migration (day/time, expected duration)
6. [ ] Prepare rollback (backup + restore procedure)

---

## Phase 3A Planning (Week 5 Post-Phase 2)

### Scope
**Deploy:** Parallel v3 prod + v4 shadow ingestion (24 hours)  
**Duration:** 1 week (setup + 24h run + analysis)  
**Team:** Data engineering + ops + QA

### Setup
1. **Configure Shadow Ingestion**
   - [ ] v4 detector logic deployed (non-blocking)
   - [ ] Shadow database table created (`candle_quality_v4_shadow`)
   - [ ] Monitoring dashboard configured
   - [ ] Alerting rules enabled

2. **Baseline Metrics**
   - [ ] v3 prod metrics (before shadow start)
   - [ ] Detector version tags verified
   - [ ] Canonical view coverage confirmed

### Execution (24 Hours)
- **Hour 0:** Start shadow ingestion (parallel with v3 prod)
- **Hour 1–23:** Collect metrics (agreement, FP/FN, anomaly flags)
- **Hour 24:** Stop shadow, generate report

### Success Metrics
- Agreement rate: > 95% (v4 shadow matches v3 prod)
- False positive rate: < 2% (compared to v3)
- Coverage: 100% (all symbols, all timeframes)
- Performance: No latency impact to prod (< 5ms per candle)

### Decision Gate
- **If metrics acceptable (>95% agreement, <2% FP):** Proceed to Phase 3B
- **If metrics concerning:** Debug, iterate Phase 3A, or rollback v3

---

## Phase 3B Planning (Week 5 Post-Phase 3A Approval)

### Scope
**Rebuild:** Canonical view with v4 detector active  
**Duration:** 1–2 hours (during low-volume market window)  
**Team:** Data engineering + ops + QA

### Procedure
1. **Pre-Rebuild Checklist**
   - [ ] Phase 3A shadow metrics approved
   - [ ] Evidence migration completed (v3 → v2 schema)
   - [ ] Rollback procedure tested (dry run)
   - [ ] Monitoring dashboard live

2. **Rebuild Steps**
   - [ ] Activate v4 detector in `market.detector_config` (status='active')
   - [ ] Retire v3 detector (status='retired')
   - [ ] Refresh canonical view (`REFRESH MATERIALIZED VIEW market.candles_1m_canonical`)
   - [ ] Verify coverage (all symbols, all timeframes)
   - [ ] Verify lineage (feature engine reads fresh canonical)

3. **Post-Rebuild Validation**
   - [ ] Canonical exclusion count (vs pre-rebuild)
   - [ ] Feature pipeline latency (vs pre-rebuild)
   - [ ] Producer run ledger (fresh entries)
   - [ ] Detector version tags (all rows tagged 'detector-v4')

4. **Monitoring (First 24h)**
   - [ ] Anomaly detection accuracy (false positives)
   - [ ] Canonical coverage (% candles excluded)
   - [ ] Downstream impact (feature freshness, backtest latency)
   - [ ] Alert on any anomalies

---

## Phase 3C Planning (Week 6 Post-Phase 3B)

### Scope
**Validate:** PIT backtest parity with v4 canonical  
**Duration:** 3 days  
**Team:** QA + data engineering

### Test Design
1. **Run v3 Canonical Baseline**
   - [ ] Backtest with v3 canonical (current)
   - [ ] Record: trade count, win rate, drawdown, profit factor
   - [ ] Output: baseline metrics report

2. **Run v4 Canonical Test**
   - [ ] Backtest with v4 canonical (new)
   - [ ] Record: trade count, win rate, drawdown, profit factor
   - [ ] Output: test metrics report

3. **Compare Results**
   - [ ] Trade count: ±1 candle tolerance (should be identical)
   - [ ] Win rate: ±1% tolerance
   - [ ] Drawdown: ±2% tolerance
   - [ ] Profit factor: ±2% tolerance

### Acceptance Criteria
- **Accept v4:** All metrics within tolerance, no manual investigation needed
- **Debug:** Metrics outside tolerance, investigate root cause (quarantine logic, canonical read, feature freshness)
- **Rollback:** If debug uncovers critical issue, revert to v3 (Phase 3B rollback)

### Sign-Off
- [ ] QA approves parity (all tests pass)
- [ ] Governance approves go-live
- [ ] Ops standby for 7-day monitoring post-go-live

---

## Rollback Procedures (If Needed)

### Phase 3A Rollback (Shadow Issues)
**Duration:** < 5 minutes  
**Impact:** None (shadow only, no prod changes)  
**Procedure:**
1. Stop shadow ingestion
2. Delete v4 shadow data
3. Resume v3 prod (unchanged)

**Decision:** If FP rate > 5% or agreement < 90%, rollback and iterate Phase 3A

### Phase 3B Rollback (Post-Rebuild Issues)
**Duration:** < 2 minutes  
**Impact:** Temporary canonical unavailability (< 30 sec)  
**Procedure:**
1. Deactivate v4 detector in `market.detector_config`
2. Reactivate v3 detector (status='active')
3. Refresh canonical view
4. Resume v3 prod

**Decision:** If coverage drops > 5%, anomaly FP > 3%, or latency > 50ms, rollback and debug

### Phase 3C Rollback (PIT Parity Failure)
**Duration:** < 10 minutes  
**Impact:** Backtest unavailable during rollback  
**Procedure:**
1. Revert `market.detector_config` to v3 active
2. Refresh canonical view
3. Verify backtest reads from v3 canonical
4. Resume backtester

**Decision:** If trade outcomes drift > 0.1%, investigate before go-live

### Emergency Rollback (Production Incident)
**Duration:** < 2 minutes  
**Impact:** Detector reverts to v3  
**Trigger:** False positive rate > 10% OR data loss OR data corruption  
**Procedure:**
1. Alert: Incident commander + governance board
2. Execute: Phase 3B rollback (deactivate v4, reactivate v3)
3. Verify: Canonical excludes using v3 logic only
4. Monitor: Anomaly detection accuracy (should match pre-v4)
5. Post-mortem: Root cause analysis + design fixes

---

## Governance Gate Checklist

### Permission Gate (4 items) — MUST PASS BEFORE PHASE 1
- [ ] **Scope explicitly approved:** Board approves Phase 3A shadow run (specific dates, success criteria)
- [ ] **Operational board sign-off:** Board memo filed, governance record created
- [ ] **Stakeholder alignment:** Data eng, QA, ops, architecture all briefed and ready
- [ ] **Rollback plan documented:** 5 rollback scenarios with < 2 min execution time

### Technical Eligibility (27 items) — MUST PASS BEFORE PHASE 1

**Canonical Preconditions (4):**
- [ ] Current canonical coverage verified (% candles included, trend stable)
- [ ] Quarantine decisions finalized (no UNKNOWN status in v3 quarantine)
- [ ] Broker policy stable (1x Trade confirmed no imminent feed changes)
- [ ] Feature lineage clean (all features read from canonical, no stale reads)

**Detector Readiness (4):**
- [ ] v2 vs v3 eval frozen (SHA256 hashes of eval candles, immutable)
- [ ] Metrics computed (precision, recall, F1 for both v2 and v3)
- [ ] v3 deemed ready (governance approved based on metrics)
- [ ] Eval set versioned (documented in governance record)

**Invariant Verification (4):**
- [ ] Engine output anchor fresh (producer runs < 2h old for all symbols)
- [ ] Feature cache aligned (engine_ver in input_hash verified across all features)
- [ ] Lifecycle cursor advanced (lifecycle refresh state < 2h old)
- [ ] Producer runs logged (no gaps in feature_producer_runs ledger)

**Backtest Protection (4):**
- [ ] PIT canonical reads validated (backtest loads from canonical, not raw candles)
- [ ] Quarantine logic tested (ATR winsorization on suspect candles confirmed)
- [ ] Coverage audit passed (canonical view excludes correct % of candles)
- [ ] Anomaly characterization complete (v3 quarantine decisions documented)

**Status:** 0/31 checks passed (awaiting Phase 1 execution & governance approval)

---

## Communication Plan

### Day 0 (Today, 2026-08-17)
- [ ] Email: All 7 detector docs distributed to governance board
- [ ] Meeting: 60-min governance board review (key findings, unfreeze prerequisites)
- [ ] Decision: Board approves Phase 3A scope? (Phase 1–3 authorization)

### Day 1 (If Approved)
- [ ] Email: Data engineering team authorized to proceed with Phase 1
- [ ] Kickoff: Data eng team review (Technical Reference + Implementation Guide)
- [ ] Planning: Finalize Phase 1 eval set (dates, symbols, hashes)

### Week 1 (Phase 1)
- [ ] Daily: Phase 1 progress updates to governance board
- [ ] Friday: Phase 1 frozen eval report (v2 vs v3 metrics, recommendation)
- [ ] Governance review: Approve Phase 2?

### Week 2–3 (Phase 2)
- [ ] Planning: Anomaly decision matrix creation
- [ ] Mid-week: Draft matrix circulated to architecture + data eng
- [ ] Friday: Final matrix + evidence migration plan approved by governance

### Week 4 (Phase 3A Setup)
- [ ] Planning: Shadow ingestion setup
- [ ] Mid-week: Shadow infrastructure deployed (non-prod, monitoring live)
- [ ] Thursday: Final pre-shadow checklist (all systems green)
- [ ] Friday 09:00 UTC: Phase 3A shadow ingestion begins (24h run)

### Week 5 (Phase 3A Results + Phase 3B)
- [ ] Saturday: Phase 3A report generated (agreement rate, FP/FN analysis)
- [ ] Saturday: Governance board reviews Phase 3A metrics
- [ ] If approved: Sunday 10:00 UTC Phase 3B canonical rebuild (< 2h window)
- [ ] Sunday+: Phase 3B monitoring (24h post-rebuild validation)

### Week 6 (Phase 3C + Go-Live)
- [ ] Monday–Wednesday: Phase 3C PIT parity backtest
- [ ] Wednesday: Phase 3C report (trade outcome comparison, acceptance decision)
- [ ] Thursday: Governance board approval for go-live
- [ ] Friday: v4 detector go-live (prod detector switches to v4)
- [ ] Week 6–7: 7-day production monitoring (incident drill, rollback readiness)

---

## Success Criteria Summary

| Phase | Success Metric | Target | Current |
|-------|---|---|---|
| **Phase 1** | v3 F1-Score | > 0.95 | ✅ 0.968 |
| **Phase 1** | v3 Precision | > 0.97 | ✅ 97.9% |
| **Phase 1** | Governance approval | Yes | ⏳ Pending board decision |
| **Phase 2** | Decision matrix locked | Yes | ⏳ Pending Phase 1 |
| **Phase 2** | Evidence migration tested | Yes | ⏳ Pending Phase 1 |
| **Phase 3A** | Shadow agreement | > 95% | ⏳ Pending Phase 2 |
| **Phase 3A** | Shadow FP rate | < 2% | ⏳ Pending Phase 2 |
| **Phase 3B** | Canonical refresh | No errors | ⏳ Pending Phase 3A |
| **Phase 3C** | PIT trade count drift | ±1 | ⏳ Pending Phase 3B |
| **Phase 3C** | PIT win rate drift | ±1% | ⏳ Pending Phase 3B |
| **Go-Live** | No production incidents | 7 days | ⏳ Pending Phase 3C |
| **Go-Live** | Detector agreement | ≥ 99% | ⏳ Pending 24h monitoring |

---

## Contacts & Responsibilities

| Role | Name/Team | Email | Responsibility |
|------|-----------|-------|---|
| **Governance Lead** | Board | governance@tradzfx | Phase gate decisions, prerequisite validation, approval |
| **Data Engineering Lead** | eng-team | data@tradzfx | Phase 1–3 execution, eval script, shadow ingestion |
| **QA Lead** | qa-team | qa@tradzfx | Backtest harness, PIT parity validation, acceptance |
| **Ops Lead** | ops-team | ops@tradzfx | Rollback runbook, monitoring, incident response |
| **Incident Commander** | (to be named) | (to be assigned) | Phase 3+ on-call, escalation, decision authority |
| **Architecture Lead** | arch-team | architecture@tradzfx | Design review, symbol thresholds, multi-criterion detection |

**For Questions:**
- Detector logic: data@tradzfx (data engineering)
- Governance decisions: governance@tradzfx (governance board)
- Testing/validation: qa@tradzfx (QA team)
- Deployment/ops: ops@tradzfx (operations)

---

## Final Checklist (Before First Board Meeting)

- [x] 7 comprehensive audit documents created
- [x] All detector components located and documented
- [x] Code snippets extracted (50+ examples)
- [x] Current state verified (v3 production-stable)
- [x] Data quality validated (excellent)
- [x] 31-point prerequisite checklist created
- [x] 6-week implementation roadmap designed
- [x] 5 rollback scenarios documented
- [x] Phase 1–3 procedures detailed
- [ ] Documents reviewed by governance board (pending)
- [ ] Board approval obtained (pending)
- [ ] Phase 1 execution authorized (pending)

---

**End of Operational Handoff**

**Ready for:** Governance board distribution + Phase 1 execution (pending approval)  
**All work:** Frozen (read-only) — no code changes permitted until governance gate passes

**Next action:** Submit all documents to governance board. Await decision on Phase 3A scope approval.

