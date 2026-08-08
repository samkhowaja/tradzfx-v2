# Data Integrity Audit Report Suite
**Generated:** 2026-07-07  
**Project:** tradzfx-v2 Data Pipeline

---

## Overview

This audit suite provides a comprehensive analysis of data integrity risks in the tradzfx-v2 data pipeline, from MT5 CSV import through PIT backtest feature computation.

**Key Finding:** 5 critical data integrity issues identified, all remediable within 15-20 hours of development work.

---

## Report Files

### 1. **DATA_INTEGRITY_AUDIT_2026-07-07.md** (Main Report)
**Length:** ~45 KB  
**Best For:** Comprehensive understanding, detailed findings, evidence review

**Contents:**
- Complete pipeline architecture (5 stages)
- Issue analysis by severity (5 critical, 5 high, 2 informational)
- Root cause analysis with code snippets
- Remediation guidance
- Testing procedures
- Post-fix verification

**Key Sections:**
- Section 1: Candle Import & Storage
- Section 2: Higher-Timeframe Aggregation  
- Section 3: Feature Generation (lookahead analysis)
- Section 4: Historical Feature Backfill
- Section 5: PIT Backtest Feature Generation
- Section 6: Data Quality Checks (implemented vs. missing)
- Section 7: Identified Issues & Severity Assessment
- Section 8: Verification Procedures
- Section 9: Recommendations (prioritized)

**Read This If:** You need to understand the root causes, make architectural decisions, or audit the audit itself.

---

### 2. **DATA_INTEGRITY_REMEDIATION_CHECKLIST.md** (Action Items)
**Length:** ~30 KB  
**Best For:** Implementation, task assignment, progress tracking

**Contents:**
- 5 Priority 1 tasks (this week)
- 4 Priority 2 tasks (next week)
- 2 Priority 3 tasks (week after)
- Complete code snippets for each task
- Testing procedures
- Risk assessment per task
- Success criteria

**Key Tasks:**
1. Add endTs alignment validation to DAGRunner
2. Add OHLC validation on CSV import
3. Fix spread conversion for all symbol types
4. Validate feature timestamps before insert
5. Create post-import validation script
6. Add cross-TF alignment check
7. Implement candle gap detection
8. Standardize lookback windows

**Read This If:** You need to assign work, estimate effort, or track implementation progress.

---

### 3. **DATA_INTEGRITY_VISUAL_SUMMARY.md** (Quick Reference)
**Length:** ~15 KB  
**Best For:** Executive overview, team briefings, problem visualization

**Contents:**
- Data pipeline flow diagram (with issues marked)
- Visual breakdown of each critical issue
- Issue severity heatmap
- Fix priority matrix (impact vs. effort)
- Testing plan summary
- File-by-file change checklist

**Key Diagrams:**
- Pipeline flow with embedded issues
- Intra-bar lookahead bias visualization
- Spread precision error calculation
- OHLC corruption example
- Timestamp misalignment diagram
- Priority matrix (high impact/low effort → do first)

**Read This If:** You need a 5-minute briefing or want to understand the issues visually.

---

## Quick Start

### For Project Managers
1. Read **Visual Summary** (15 min)
2. Review **Remediation Checklist** task estimates (10 min)
3. Use checklist to assign work and track progress

### For Engineers
1. Read **Remediation Checklist** for your assigned task (15 min)
2. Read relevant section of **Main Audit Report** for context (30 min)
3. Implement code from checklist
4. Run testing procedures from checklist

### For QA/Testers
1. Read **Visual Summary** (15 min)
2. Review **Post-Import Validation Script** in checklist (10 min)
3. Run validation script against test data
4. Verify test cases pass for each fix

### For Architects
1. Read **Main Audit Report** sections 3, 5, 7-9 (1 hour)
2. Review visual diagrams in **Visual Summary** (20 min)
3. Make recommendations for priority/sequencing

---

## Critical Issues at a Glance

| ID | Issue | Severity | Root Cause | Fix Effort | Impact |
|:--:|:------|:--------:|:-----------|:----------:|:------:|
| **C1** | No intra-bar time validation | 🔴 HIGH | endTs not validated before feature computation | 2h | Lookahead bias in backtests |
| **C2** | Decimal precision loss | 🔴 HIGH | Decimal places inferred from CSV string | 2h | Wrong pip/point conversions |
| **C3** | Spread conversion assumes std digits | 🔴 HIGH | Only handles 4/5-digit, not gold/commodities | 3h | Gold spreads 10x too large |
| **C4** | No OHLC validation on import | 🔴 HIGH | CSV import doesn't validate h>=l | 1h | Corrupted candles silent persist |
| **C5** | Feature TS alignment not checked | 🔴 HIGH | Features stored with arbitrary timestamps | 2h | PIT backtest misalignment |

**Total Effort to Fix Critical Issues:** ~10 hours  
**Total Effort Including High Priority:** ~20 hours

---

## File Locations Reference

### Code Files to Modify
- `scripts/backfill-candles-from-mt5-csv.js` — CSV import (C2, C3, C4)
- `apps/engine/src/dag/runner.ts` — Feature computation (C1, C5)
- `scripts/validate-candles-post-import.js` — NEW validation script (Task 2.1)
- `scripts/regenerate-higher-timeframes.js` — Add gap detection (Task 5.1)

### Test Data Locations
- `data/backtest-seed/` — Use for validation testing
- `reports/` — This audit report suite

### Database Tables Affected
- `candles_1m` — CSV import target (C2, C3, C4)
- `candles_5m` through `candles_1d_ny` — Aggregation validation
- `features_*` (20+ tables) — Feature TS alignment (C5)

---

## Implementation Roadmap

### Week 1 (Critical Issues)
- **Day 1-2:** Implement C1 (endTs validation)
- **Day 2-3:** Implement C4 (OHLC validation)
- **Day 3-4:** Implement C5 (Feature TS validation)
- **Day 4-5:** Test all three, fix any bugs

### Week 2 (High-Impact Issues)
- **Day 1-2:** Implement C3 (Spread conversion)
- **Day 2-3:** Implement C2 (Decimal precision)
- **Day 3-4:** Deploy and validate

### Week 3 (Supporting Infrastructure)
- **Day 1-2:** Implement post-import validation script
- **Day 2-3:** Add gap detection
- **Day 3-4:** Hook into monitoring/CI-CD

### After (Continuous)
- Run post-import validation hourly
- Monitor for new data quality issues
- Review audit recommendations for future enhancements

---

## Validation Timeline

### Pre-Implementation
- [ ] Review all 3 audit documents (4 hours)
- [ ] Identify responsible engineer for each task
- [ ] Schedule implementation work
- [ ] Prepare test data sets

### During Implementation
- [ ] Code review for each fix (30 min per fix)
- [ ] Run unit tests for each fix (15 min per fix)
- [ ] Integration test on staging (1 hour total)

### Post-Implementation
- [ ] Run full validation suite on production candles (2 hours)
- [ ] Re-run on live trading data (2 hours)
- [ ] Create monitoring dashboard for future issues (2 hours)

**Total Timeline:** 3 weeks to full remediation, ~40-50 hours total effort

---

## Success Metrics

After fixes are deployed, the following should be measurable:

```
Data Integrity Metrics:
  ✓ 100% of feature timestamps are valid candle closes
  ✓ 0% OHLC ordering violations in import
  ✓ 0% lookahead bias detected in feature computation
  ✓ Backtest results reproducible across runs
  ✓ Spread costs match actual market data per symbol
  
Data Quality Metrics:
  ✓ Post-import validation script passes 100% of checks
  ✓ <0.1% candle gaps during market hours
  ✓ <1% missing candles per month
  
System Health:
  ✓ Feature computation latency unchanged
  ✓ DB query performance unchanged
  ✓ No test failures in existing backtest suite
```

---

## Document Navigation

```
START HERE (15 minutes)
    ↓
    └─→ DATA_INTEGRITY_VISUAL_SUMMARY.md
        - Visual diagrams
        - Issue severity matrix
        - Quick problem summary
        ↓
        Decision: "Want to dive deeper?"
        
        YES → Go to MAIN REPORT
        NO  → Go to REMEDIATION CHECKLIST
        
MAIN REPORT (1-2 hours)
    └─→ DATA_INTEGRITY_AUDIT_2026-07-07.md
        - Complete analysis
        - Root cause deep dive
        - Code evidence
        - Testing procedures
        ↓
        Ready to implement?
        
        YES → Go to REMEDIATION CHECKLIST
        NO  → Re-read specific sections
        
REMEDIATION CHECKLIST (2-4 hours per task)
    └─→ DATA_INTEGRITY_REMEDIATION_CHECKLIST.md
        - Task breakdown
        - Code snippets
        - Testing procedures
        - Risk assessment
        ↓
        Ready to commit?
        
        YES → Implement task
        NO  → Review related sections in MAIN REPORT
```

---

## Contact / Questions

**Report Generated By:** Copilot Data Integrity Audit System  
**Audit Date:** 2026-07-07  
**Scope:** Complete tradzfx-v2 data pipeline  
**Methodology:** Static code analysis + schema review + cross-reference validation

**For Questions On:**
- **Architecture/Design:** See Sections 1-5 of Main Report
- **Specific Code Issues:** See Section 7 of Main Report
- **Implementation Tasks:** See Remediation Checklist
- **Visual Overview:** See Visual Summary

---

## Summary

The tradzfx-v2 data pipeline is **architecturally sound** but has **5 critical data integrity risks** that compromise backtest reliability and live trading safety:

1. ✅ **No intra-bar time validation** → Lookahead bias in features
2. ✅ **Decimal precision loss** → Wrong pip/point calculations
3. ✅ **Spread conversion assumes std digits** → Gold spreads 10x too large
4. ✅ **No OHLC validation** → Corrupted candles persist
5. ✅ **Feature TS alignment unchecked** → Features at wrong times

**Remediation is straightforward** (10 hours for critical issues, 20 hours total) and will make the pipeline **production-safe** for backtesting and live trading.

**Next Step:** Assign Task 1.1 (endTs validation) and begin implementation.

---

**Report Status:** ✅ Complete and Ready for Implementation
