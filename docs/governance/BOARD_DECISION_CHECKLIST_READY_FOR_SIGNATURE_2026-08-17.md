# Board Decision Checklist: Governance Preconditions Unfreeze Authorization
**Document ID:** BOARD_DECISION_CHECKLIST_2026-08-17  
**Prepared by:** Governance Documentation Phase  
**Status:** Ready for Board Signature  
**Timeline:** 16 decisions, ~5 minutes to complete, +1 to execute Phase 1  

---

## How to Use This Checklist
- **Audience:** Governance board members
- **Format:** 16 explicit yes/no decisions organized by category
- **Decision Sequence:** Left to right, top to bottom (no dependencies)
- **Execution:** All decisions must be YES to authorize conditional unfreeze
- **Signature:** Board chair signature + timestamp at completion
- **Effect:** Triggers Phase 1 eval rollout within 4 hours

---

## ✅ DETECTOR GOVERNANCE (4 Decisions)

### Decision 1: Canonical Detector Approval
**Question:** Approve v3-robust (magnitude-only, 1000p cap) as canonical detector for all future ingest?

**Evidence:**
- Deep audit: 12 files, 5,900 lines, comprehensive detector analysis
- Data quality: 0.0000026% error rate (2 suspect candles in 7.7M, USDSEK only, approved KEEP)
- v3-robust semantics: Pure magnitude, no calendar logic, stateless, deterministic
- v4-calibrated: Symbol-specific thresholds, frozen pending future governance

**Board Vote:**
- [ ] **YES** — Approve v3-robust as canonical (ingest uses v3 going forward)
- [ ] **NO** — Request modifications or further analysis

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 2: v4-Calibrated Freeze Approval
**Question:** Approve v4-calibrated (symbol-specific thresholds) as frozen pending future governance review?

**Evidence:**
- v4 exists in codebase but disabled
- Symbol-specific approach requires per-pair calibration window (3–6 months of market data)
- Future decision: Migrate v3 → v4 or maintain v3 as permanent canonical
- This decision preserves v4 option without activating it

**Board Vote:**
- [ ] **YES** — Freeze v4, allow future unfreeze with separate board approval
- [ ] **NO** — Request alternative freeze strategy

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 3: Detector Audit Sufficiency
**Question:** Is the detector audit evidence (12 files, 5,900 lines) sufficient for board confidence in canonical v3-robust?

**Evidence:**
- `DETECTOR_v3_MAGNITUDE_AUDIT_2026-08-17.md` — 1,200 lines: v3 semantics, logic flow, test coverage
- `DETECTOR_v4_CALIBRATION_AUDIT_2026-08-17.md` — 850 lines: v4 symbol-specific thresholds, calibration window analysis
- `DETECTOR_DECISION_MATRIX_2026-08-17.md` — 450 lines: source-of-truth canonical declaration, version justification
- 9 additional audit files covering data quality, edge cases, regression evidence, parity validation
- All audit files committed and pushed to remote

**Board Vote:**
- [ ] **YES** — Audit evidence is sufficient; proceed with canonical v3-robust
- [ ] **NO** — Request additional analysis before approval

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 4: Migration Path Approval
**Question:** Approve the detector migration strategy (v3 canonical now, v4 future optional) as safe and sustainable?

**Evidence:**
- Ingest route uses detector-v3-robust (immutable at write time)
- Feature worker rejects non-CLEAN rows (no exposure to detector bias)
- Backtest framework uses canonical-only reads (detector frozen at ingestion)
- Detector change requires board approval (freeze enforced organizationally)
- Future v3→v4 migration: Backfill only (no live impact until backtest approved)

**Board Vote:**
- [ ] **YES** — Migration path is safe; approve canonical v3-robust with v4 as future option
- [ ] **NO** — Request alternative migration strategy

**Rationale (if NO):** ___________________________________________________________________________

---

## ✅ CANONICAL PATH GOVERNANCE (4 Decisions)

### Decision 5: Fail-Closed Contract Enforcement
**Question:** Approve the three-layer fail-closed contract as proven and enforceable end-to-end?

**Evidence:**
- `CANONICAL_PATH_TRACE_END_TO_END_2026-08-17.md` — 900+ lines proving 3-layer enforcement
- **Layer 1 (Database):** Canonical READ-ONLY VIEW, features INSERT-only versioned, quarantine append-only
- **Layer 2 (Application):** Ingest gate (COUNT state ≠ CLEAN → block), feature worker check (state ≠ CLEAN → exit), backtest preflight (BLOCKED_SYSTEM_QUALITY → exit 1)
- **Layer 3 (PIT):** Canonical-only reads, producer age gate (status='done' + engine_ver ≥ min), lifecycle recomputation
- All three layers documented with code references and execution paths

**Board Vote:**
- [ ] **YES** — Three-layer fail-closed contract is proven; approve end-to-end enforcement
- [ ] **NO** — Request clarification or additional evidence

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 6: Broker Identity Immutability
**Question:** Approve broker identity normalization as immutable at write time (MT5 → "1x Trade Ltd.", MT4 → "OANDA Corporation")?

**Evidence:**
- Ingest route: `normalizeBrokerName()` sets broker identity at write time, immutable thereafter
- Raw candles: `candles_1m.broker` never updated or deleted (audit trail preserved)
- Historical rows: Legacy `broker='MT5'` remains immutable, `raw.effective_broker_identity()` maps to canonical
- Migration 182: Broker identity corrections logged as immutable evidence ledger
- Canonical path: Broker identity frozen before canonical view and feature producer

**Board Vote:**
- [ ] **YES** — Broker identity immutability is proven; approve as permanent enforcement
- [ ] **NO** — Request alternative broker identity strategy

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 7: Canonical Quarantine Semantics
**Question:** Approve the canonical quarantine semantics (approved EXCLUDE removes verified corrupt rows from canonical)?

**Evidence:**
- `candle_eligibility` table: `(symbol, broker, ts, state)` with state machine (PERSISTED → CLEAN | EXCLUDE | SUSPECT)
- Canonical view: `NOT EXISTS (SELECT 1 FROM approved_exclude WHERE …)` filters approved EXCLUDE rows
- Fail-closed rule: UNKNOWN rows NOT filtered in canonical; instead blocked downstream (ingest gate, feature worker, backtest preflight)
- Immutability: Exclusion decision recorded in `candle_quarantine` (approved_by, approved_at) never deleted
- Evidence preservation: Raw candles always available for future review/audit

**Board Vote:**
- [ ] **YES** — Canonical quarantine semantics are safe and correct; approve fail-closed filtering
- [ ] **NO** — Request alternative quarantine strategy

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 8: Canonical Path Documentation Sufficiency
**Question:** Is the canonical path trace evidence (900+ lines) sufficient for board confidence in fail-closed enforcement end-to-end?

**Evidence:**
- `CANONICAL_PATH_TRACE_END_TO_END_2026-08-17.md` — Complete trace from raw ingestion through broker normalization, quarantine, canonical view, feature producer, to backtest consumption
- Code references: Ingest route, eligibility gate, canonical view definition, feature worker check, backtest preflight (all documented with line numbers)
- Execution paths: Three-layer enforcement proven with both happy-path and fail-closed paths traced
- Immutability proof: Raw evidence, broker identity, eligibility decisions all preserved immutably
- Evidence flow: Complete audit trail from ingest through canonical promotion to downstream consumption

**Board Vote:**
- [ ] **YES** — Canonical path documentation is sufficient; proceed with confidence
- [ ] **NO** — Request additional analysis or clarification

**Rationale (if NO):** ___________________________________________________________________________

---

## ✅ FEATURE LINEAGE GOVERNANCE (4 Decisions)

### Decision 9: Feature Dependency DAG Completeness
**Question:** Approve the 6-tier feature dependency DAG as complete and correct?

**Evidence:**
- `FEATURE_LINEAGE_MAP_END_TO_END_2026-08-17.md` — 1,000+ lines mapping complete dependency chain
- **Tier 1:** Canonical 1m (immutable root, never deleted)
- **Tier 2:** Leaf features (ATR, spread, session) — canonical-only reads, immutable
- **Tier 3:** HTF aggregates (5m/15m/1h/4h) — deterministic from tier 2, continuous aggregates
- **Tier 4:** State features (bias, direction, pricing) — immutable given upstream, version-tagged
- **Tier 5:** Level features (zone, order_block, iFVG) — formation immutable, lifecycle mutable
- **Tier 6:** Event features (sweep, displacement, structure, opening_range) — immutable once recorded
- **Tier 7:** Distribution (correlation) — immutable
- Feature registry: 20+ features with contracts, join policies, freshness windows, dependencies documented

**Board Vote:**
- [ ] **YES** — Feature DAG is complete and correct; approve as governance baseline
- [ ] **NO** — Request DAG modifications or additional features

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 10: Feature Immutability Per Class
**Question:** Approve the immutability guarantees per feature class as proven and enforceable?

**Evidence:**
- Leaf features: Immutable (canonical-only reads, deterministic)
- HTF aggregates: Immutable (continuous aggregates, deterministic)
- State features: Immutable given upstream (version-tagged, DAG dependencies)
- Level features: Formation immutable, lifecycle mutable (zone touch/retest updates)
- Event features: Immutable once recorded (append-only)
- Version tagging: `engine_ver + input_hash` on every row enables replay/validation
- Dependency closure: Topological sort backfill ensures immutable dependencies before dependents

**Board Vote:**
- [ ] **YES** — Immutability per feature class is proven; approve as enforcement guarantee
- [ ] **NO** — Request immutability modifications or clarification

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 11: Feature Backfill Procedures
**Question:** Approve the feature backfill procedures (topological sort, frozen ordering) as safe and complete?

**Evidence:**
- Topological sort: Leaf → HTF → state → level → event → distribution (correct dependency ordering)
- Backfill scripts: `backfill-historical-features.js` with frozen procedure (no dynamic reordering)
- Immutability preservation: Topological sort ensures upstream rows complete before downstream consume
- Cache invalidation: `skipCache:true` for detector changes, leaf-feature code changes
- PIT validation: Backfill procedures frozen; changes require board approval to prevent silent invalidation
- Procedure documentation: Each backfill step documented with expected row counts and validation gates

**Board Vote:**
- [ ] **YES** — Backfill procedures are safe and complete; approve frozen procedures
- [ ] **NO** — Request backfill procedure modifications

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 12: Feature Lineage Documentation Sufficiency
**Question:** Is the feature lineage documentation (1,000+ lines) sufficient for board confidence in immutability end-to-end?

**Evidence:**
- `FEATURE_LINEAGE_MAP_END_TO_END_2026-08-17.md` — Complete DAG, immutability proofs, backfill procedures, PIT enforcement
- Feature registry: 20+ features documented with contracts, dependencies, freshness windows
- Immutability proof: Version tagging, producer run ledger, lifecycle enforcement, backtest preflight validation
- PIT enforcement: Canonical-only reads, producer age gate, lifecycle recomputation, abort on data gaps
- Evidence preservation: All producer runs logged immutably; all backfill procedures logged

**Board Vote:**
- [ ] **YES** — Feature lineage documentation is sufficient; proceed with confidence
- [ ] **NO** — Request additional analysis or clarification

**Rationale (if NO):** ___________________________________________________________________________

---

## ✅ UNFREEZE AUTHORIZATION (4 Decisions)

### Decision 13: Governance Preconditions Sufficiency
**Question:** Are the governance preconditions (detector, canonical path, feature lineage) collectively sufficient to authorize conditional unfreeze?

**Evidence:**
- All three governance pillars documented and committed (19 files, 10,600+ lines)
- Three-layer fail-closed contract proven and enforceable
- Detector governance established (v3-robust canonical, v4 frozen)
- Canonical path traced end-to-end (ingestion → canonical → features → backtest)
- Feature lineage complete (6-tier DAG, immutability proof, backfill procedures)
- All evidence committed to remote GitHub repository
- Zero writes to production state (all work read-only governance documentation)

**Board Vote:**
- [ ] **YES** — Governance preconditions are sufficient; authorize conditional unfreeze
- [ ] **NO** — Request additional governance work or analysis

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 14: Conditional Unfreeze Phase Authorization
**Question:** Approve the conditional unfreeze phase (Phase 1: eval single symbol, Phase 2: expand to 2–3 symbols, Phase 3: full rollout)?

**Evidence:**
- Phase 1 (Eval): Enable feature worker on single oldest symbol only
  - Preflight: `backtest-pit-v2.js SYMBOL --preflight` → verify HEALTHY (not BLOCKED_SYSTEM_QUALITY)
  - Backfill: `backfill-historical-features.js SYMBOL 1d,4h,1h,15m,5m` → verify rows_inserted > 0
  - Shadow features: Collect features (eval only, no live impact)
  - Decision: Pass (proceed Phase 2) or Fail (maintain freeze)
- Phase 2 (Conditional): Expand to 2–3 symbols if Phase 1 passes
  - Same preflight + backfill per symbol
  - Collect shadow features per symbol
  - Decision: Pass (proceed Phase 3) or Fail (maintain Phase 1 only)
- Phase 3 (Full): All symbols, live signal emission (if Phase 2 passes)
  - Enable live ingestion and signal pipeline
  - Monitor producer freshness, feature quality, signal emission
  - Decision: Maintain or rollback to Phase 2

**Board Vote:**
- [ ] **YES** — Conditional unfreeze phase is safe and well-defined; authorize Phase 1 eval
- [ ] **NO** — Request alternative unfreeze strategy or phasing

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 15: Governance Board Oversight
**Question:** Approve governance board as the decision authority for Phase 1 → Phase 2 → Phase 3 progression, with specific go/no-go gates per phase?

**Evidence:**
- Phase 1 gate: Preflight HEALTHY + backfill success + shadow feature quality → Phase 2 approval required
- Phase 2 gate: 2–3 symbols HEALTHY + expanded feature quality + no anomalies → Phase 3 approval required
- Phase 3 gate: Full rollout + live signal emission + monitoring stable → Phase 3 confirmation
- Board authority: All phase progression decisions require explicit board vote (documented with timestamps)
- Rollback authority: Any phase may be rolled back to prior phase or to freeze with board approval

**Board Vote:**
- [ ] **YES** — Governance board approval required for all phase progressions; approve oversight model
- [ ] **NO** — Request alternative governance model

**Rationale (if NO):** ___________________________________________________________________________

---

### Decision 16: Unfreeze Timeline and Execution Authority
**Question:** Approve the unfreeze timeline (Phase 1 eval within 4 hours of approval, Phase 2/3 subject to phase gates)?

**Evidence:**
- Phase 1 shortlist: XAUUSD (oldest complete symbol, 7.7M candles, proven clean)
- Phase 1 execution: Preflight (10 min) + backfill (30–45 min) + shadow feature collection (15 min) = ~1 hour
- Phase 1 decision gate: Board evaluates results same day (within 4 hours)
- Phase 2/3: Timeline subject to phase gate decisions (2–3 days per phase if all gates pass)
- Execution authority: Engineering team authorized to execute Phase 1 preflight/backfill pending board approval
- Freeze maintenance: Freeze state maintained until board explicitly authorizes each phase progression

**Board Vote:**
- [ ] **YES** — Approve Phase 1 timeline (within 4 hours) and execution authority pending board approval
- [ ] **NO** — Request alternative timeline or execution authority

**Rationale (if NO):** ___________________________________________________________________________

---

## BOARD SIGNATURE BLOCK

**All 16 Decisions Approved (by signature below):**

Signature: _________________________________ | Date: _____________

Board Chair: _________________________________ | Title: _____________

Witnessed by: _________________________________ | Title: _____________

---

## Effect of Board Approval

Upon board signature above:

1. **Freeze state transitions:** `permission: INACTIVE` → `permission: CONDITIONAL`
2. **Phase 1 authorization:** Engineering team begins Phase 1 eval within 4 hours
3. **Execution timeline:** Preflight → backfill → shadow collection → board results review (same day)
4. **Documentation:** All phase progression decisions logged with timestamps
5. **Rollback authority:** Any phase may be rolled back with board approval

---

## Approval Checklist Summary

| # | Decision | Approval | Rationale |
|---|----------|----------|-----------|
| 1 | v3-robust canonical | ☐ YES | ___________________ |
| 2 | v4 freeze | ☐ YES | ___________________ |
| 3 | Detector audit sufficient | ☐ YES | ___________________ |
| 4 | Migration path safe | ☐ YES | ___________________ |
| 5 | Fail-closed contract proven | ☐ YES | ___________________ |
| 6 | Broker identity immutable | ☐ YES | ___________________ |
| 7 | Canonical quarantine correct | ☐ YES | ___________________ |
| 8 | Canonical path sufficient | ☐ YES | ___________________ |
| 9 | Feature DAG complete | ☐ YES | ___________________ |
| 10 | Immutability per class proven | ☐ YES | ___________________ |
| 11 | Backfill procedures safe | ☐ YES | ___________________ |
| 12 | Feature lineage sufficient | ☐ YES | ___________________ |
| 13 | Preconditions sufficient | ☐ YES | ___________________ |
| 14 | Conditional unfreeze authorized | ☐ YES | ___________________ |
| 15 | Board oversight approved | ☐ YES | ___________________ |
| 16 | Timeline + execution authority | ☐ YES | ___________________ |

**Status:** ☐ All 16 decisions approved → Conditional unfreeze authorization → Phase 1 begins within 4 hours

---

## How Board Uses This Document

1. **Before meeting:** Board members receive executive briefing (5 min) + this checklist
2. **During meeting:** Board discusses each decision (15–20 min total), marks YES/NO, captures rationale
3. **Decision:** If all 16 = YES, sign document; if any NO, document rationale and schedule follow-up
4. **After approval:** Engineering team receives signed checklist and begins Phase 1 within 4 hours
5. **Audit trail:** Signed checklist + timestamps logged as governance evidence

---

**Document prepared:** 2026-08-17  
**Status:** Ready for board signature and Phase 1 authorization  
**Next step:** Board review and approval of 16 decisions
