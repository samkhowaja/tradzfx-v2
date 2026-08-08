# PIT Backtester Audit — Complete Index

**Date:** July 7, 2026  
**Comprehensive Audit Package:** 3 reports + this index  

---

## 📋 Report Navigation

### 1. **START HERE** → Executive Summary (5 min read)
📄 **File:** `PIT_BACKTESTER_AUDIT_SUMMARY_2026-07-07.md`

- 5 critical findings
- Risk assessment
- Live variants reality check (are they really that good?)
- 4-week implementation roadmap
- Bottom line recommendation

**Read this if:** You have 5 minutes and want the headlines.

---

### 2. **COMPLETE AUDIT** → Technical Deep Dive (45 min read)
📄 **File:** `PIT_BACKTESTER_AUDIT_2026-07-07.md`

**Sections:**
1. **Executive Summary** — Strengths & critical issues
2. **Architecture & Code Flow** — How the backtester works (runBacktest, buildContext, trackOutcome)
3. **Lookahead Bias Check** — Same-candle ambiguity, feature staleness, data integrity
4. **Same-Candle Handling** — Intrabar resolution modes (pessimistic vs proportion vs midpoint)
5. **TP/SL Testing** — High/low touch ordering, slippage, spread modeling
6. **Warmup Period** — Feature dependencies (pivot needs 500 bars, MA250 needs 250 bars)
7. **Metrics Validation** — Win rate, profit factor, Sharpe, Sortino, Calmar, drawdown (3 bugs found!)
8. **Results Quality** — 90-day backtest analysis, walk-forward stability, overfitting signals
9. **Historical vs Walk-Forward** — Comparison, train/test separation, data leakage analysis
10. **Live Variants Analysis** — Why doyle_sd, orb_classic, watukushay_no1 selected
11. **Issues Summary** — 15 issues ranked by severity
12. **Production Recommendations** — 4-phase rollout plan
13. **Code Audit Checklist** — 30-point walkthrough
14. **Appendix** — Intrabar mode comparison table

**Read this if:** You're a developer or need to understand the full system.

---

### 3. **FIXES & CODE** → Technical Deep Dive (30 min read)
📄 **File:** `PIT_BACKTESTER_ISSUES_TECHNICAL_DEEP_DIVE_2026-07-07.md`

**Issues Covered:**
- **Issue #1:** Sortino ratio 2–5x inflated (code example + fix)
- **Issue #2:** Short exit spread adjustment missing (real scenario + fix)
- **Issue #3:** Intrabar asymmetry (long vs short bias, detection method)
- **Issue #4:** No warmup buffer (code template)
- **Issue #5:** Feature freshness not validated (fix with maxAgeMinutes)
- **Issue #6:** Timeout trades look-ahead bias (detection + options)
- **Issue #7:** Portfolio heat cascading (position lifecycle simulation)
- **Issue #8:** Win/loss variance too uniform (why suspicious)
- **Issue #9:** Walk-forward missing optimization (optional calibration hook)

Each issue includes:
- Location in codebase
- Root cause explanation
- Real-world scenario/impact
- Code fix template
- Test case for validation

**Read this if:** You need to implement fixes or understand the issues deeply.

---

## 🎯 Quick Reference by Role

### 👨‍💼 **Non-Technical Manager**
1. Read: **Executive Summary** (5 min)
2. Know: 3 live variants are statistically good but results likely 5–15% optimistic
3. Action: Approve Phase 1 fixes (1 week, 11 hours)

### 👨‍💻 **Developer/Quant**
1. Read: **Complete Audit** (Section 3: Lookahead Bias)
2. Scan: **Technical Deep Dive** (Issue #1, #2, #4, #5)
3. Action: Implement 4 critical fixes this week
4. Test: Run sensitivity analysis on intrabar modes
5. Validate: Compare old vs new backtest on live variants

### 🔬 **Data Scientist**
1. Read: **Complete Audit** (Section 8: Results Quality)
2. Study: **Technical Deep Dive** (Issue #3, #6, #7, #9)
3. Run: Monte Carlo on all 49 specs to assess selection bias
4. Investigate: Why all losses exactly -1R, all wins exactly 2.5R?
5. Analyze: Walk-forward degradation (ORB classic WR 73% → 58%)

### 🚀 **Trading Team**
1. Read: **Executive Summary** (full)
2. Know: Actual performance likely 5–15% worse than backtest
3. Plan: Start with 50–100% account size for proof-of-concept
4. Monitor: Live vs backtest divergence closely
5. Calibrate: After 30 days, adjust sizing based on correlation

---

## 📊 By Issue Severity

### 🔴 CRITICAL (Fix This Week)
| # | Issue | Severity | File | Section |
|---|-------|----------|------|---------|
| 1 | Sortino ratio inflated | HIGH | Issues_Deep_Dive | Issue #1 |
| 2 | Short exit spread missing | HIGH | Issues_Deep_Dive | Issue #2 |
| 3 | No warmup buffer | MEDIUM | Issues_Deep_Dive | Issue #4 |
| 4 | Feature staleness unchecked | MEDIUM | Issues_Deep_Dive | Issue #5 |
| 5 | Intrabar asymmetric | MEDIUM | Complete_Audit | Section 3 |

### 🟠 HIGH PRIORITY (Investigate)
| # | Issue | Severity | File | Section |
|---|-------|----------|------|---------|
| 6 | Portfolio heat cascading | MEDIUM | Issues_Deep_Dive | Issue #7 |
| 7 | Timeout trades look-ahead | MEDIUM | Issues_Deep_Dive | Issue #6 |
| 8 | Win/loss variance suspicious | MEDIUM | Issues_Deep_Dive | Issue #8 |
| 9 | Walk-forward no optimization | MEDIUM | Issues_Deep_Dive | Issue #9 |

### 🟡 MEDIUM PRIORITY (Document)
| # | Issue | Severity | File | Section |
|---|-------|----------|------|---------|
| 10 | Multiple comparison bias | LOW | Complete_Audit | Section 10 |
| 11 | Slippage uniformity | LOW | Complete_Audit | Section 4 |
| 12 | Market gap handling implicit | LOW | Complete_Audit | Section 2 |

---

## 📈 Key Metrics

### Live Variant Rankings

**By Win Rate:**
1. watukushay_no1: 69.2%
2. orb_classic: 66.7%
3. doyle_sd: 53.8%

**By Total R (90 days):**
1. doyle_sd: 457.30 R
2. orb_classic: 412.55 R
3. watukushay_no1: 337.84 R

**By Profit Factor:**
1. orb_classic: 4.25
2. doyle_sd: 3.42
3. watukushay_no1: 2.98

**By Trade Volume:**
1. watukushay_no1: 949 trades
2. doyle_sd: 541 trades
3. orb_classic: 416 trades

**By Win Rate Stability (across 5 walk-forward windows):**
1. watukushay_no1: std dev ~2.8% (most stable)
2. doyle_sd: std dev ~3.2%
3. orb_classic: std dev ~6.1% (shows degradation)

---

## 🔧 Implementation Checklist

### Week 1: Critical Fixes (11 hours total)
```
[ ] Fix Sortino denominator (1 hour)
    - File: reportGenerator.ts line 370
    - Change: negativeTrades.length instead of completed.length

[ ] Fix short exit spread (1 hour)
    - File: outcomeTracker.ts lines 226, 217
    - Change: Apply full exitAdjustment both directions

[ ] Add warmup buffer (2 hours)
    - File: runBacktest.ts
    - Add: warmupDays parameter
    - Adjust: sample generation to skip warmup period

[ ] Add feature freshness check (3 hours)
    - File: contextBuilder.ts, all fetch* functions
    - Add: maxFeatureAgeMins validation
    - Log: stale feature warnings
```

### Week 2: Sensitivity Analysis (4 hours)
```
[ ] Test intrabar modes
    - Run backtest with: pessimistic, optimistic, proportion, midpoint
    - Compare: win rate, avg R, Sharpe
    - Decision: adopt proportion if >5% difference

[ ] Investigate uniform R
    - Check: TP/SL configurations in all specs
    - Run: histogram of actual R outcomes
    - Confirm: whether 1:1 and 2.5:1 are hardcoded
```

### Week 3: Validation (8 hours)
```
[ ] Monte Carlo on 49 specs
    - Generate: top-N distribution by profit factor
    - Compare: historical top 3 vs random distribution
    - Assess: selection bias confidence

[ ] Portfolio heat simulation
    - Implement: position lifecycle tracking
    - Compare: unlimited capital vs constrained
    - Report: X% of signals skipped due to heat
```

### Week 4: Go-Live (ongoing)
```
[ ] Deploy fixed backtester
[ ] Paper trade on 3 live variants
[ ] Monitor: live vs backtest divergence
[ ] A/B test: intrabar modes
[ ] Scale up: based on live correlation
```

---

## 🔍 Cross-References

### Related Audits in `/reports/`
- **DATA_INTEGRITY_AUDIT_2026-07-07.md** — Data quality (5 critical issues)
- **STRATEGY_SPECS_AUDIT_2026-07-07.md** — Strategy consolidation
- **COMPREHENSIVE_AUDIT_REPORT.md** — Cross-system findings

### Codebase Structure
- **Entry:** `packages/analyzerBacktest/src/runBacktest.ts`
- **Features:** `packages/setupEngine/src/contextBuilder.ts`
- **Outcomes:** `packages/analyzerBacktest/src/outcomeTracker.ts`
- **Metrics:** `packages/analyzerBacktest/src/reportGenerator.ts`
- **Walk-Forward:** `packages/analyzerBacktest/src/walkForward.ts`
- **Tests:** `packages/analyzerBacktest/src/*.test.ts`

### Configuration
- **AGENTS.md** — Strategy specs, backtest commands, live variants
- **promote-top3-live.js** — Live variant selection (hardcoded list)
- **backfill-historical-features.js** — Feature backfill parameters

---

## 📞 Questions & Support

### FAQ

**Q: Are the live variants safe to trade?**  
A: Statistically yes (p<0.001), but expect 5–15% worse live performance. Deploy Phase 1 fixes first.

**Q: Will the fixes break existing backtest results?**  
A: Yes, intentionally. Results will be 5–15% lower but more realistic.

**Q: How often should we re-backtest?**  
A: Monthly with new data. After Phase 1 fixes, compare to baseline.

**Q: What if Monte Carlo shows selection bias?**  
A: Re-evaluate selection criteria. Consider: (a) random rotation of specs, (b) equal weighting, (c) higher bar for significance.

**Q: Why is watukushay_no1 having lowest total R?**  
A: Highest volume (949 trades) with 1:1 TP/SL = many small wins. doyle_sd has 2.5:1 ratio = fewer but bigger wins.

---

## 📄 Document Metadata

| Property | Value |
|----------|-------|
| **Generated** | 2026-07-07 |
| **Audited System** | PIT Backtester (packages/analyzerBacktest/) |
| **Status** | ✅ Complete |
| **Issues Found** | 15 (2 critical, 5 high, 8 medium) |
| **Reports** | 3 files (35 KB total) |
| **Estimated Fix Time** | 11 hours (Week 1) + 12 hours (Weeks 2–3) |
| **Recommendation** | Deploy Phase 1 fixes immediately |

---

**Index Complete ✅**  
Start with **Executive Summary**, then dive into specific reports based on your role.
