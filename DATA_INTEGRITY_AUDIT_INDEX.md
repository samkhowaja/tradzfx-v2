# Data Integrity Audit Index
**Generated:** 2026-07-07  
**Location:** `c:\tradzfx-v2\reports\`

---

## 📋 Audit Report Files

### Main Documents (Read in This Order)

#### 1️⃣ START HERE: README_DATA_INTEGRITY_AUDIT.md
**Time to Read:** 10-15 minutes  
**Audience:** Everyone (executive summary + navigation)  
**Contains:**
- Overview of findings
- Document navigation guide
- Critical issues at a glance
- Implementation roadmap
- Success metrics

**Use This To:** Understand the scope and decide which document to read next

---

#### 2️⃣ DATA_INTEGRITY_VISUAL_SUMMARY.md
**Time to Read:** 15-20 minutes  
**Audience:** Non-technical stakeholders, team leads, architects  
**Contains:**
- Pipeline flow diagram with issues marked
- Visual breakdown of each critical issue
- Severity heatmap and priority matrix
- Testing plan overview
- Quick reference diagrams

**Use This To:** Understand issues visually, brief the team, decide priorities

---

#### 3️⃣ DATA_INTEGRITY_AUDIT_2026-07-07.md
**Time to Read:** 1-2 hours  
**Audience:** Engineers, architects, code reviewers  
**Contains:**
- Complete pipeline analysis (5 stages)
- Detailed code reviews with evidence
- 12 issues (5 critical, 5 high, 2 informational)
- Root cause analysis
- Verification procedures
- Recommendations by priority

**Use This To:** Understand root causes, review code, make architectural decisions

---

#### 4️⃣ DATA_INTEGRITY_REMEDIATION_CHECKLIST.md
**Time to Read:** 1-2 hours (or per task)  
**Audience:** Implementing engineers  
**Contains:**
- 13 specific tasks with effort estimates
- Complete code snippets for each fix
- Testing procedures for each task
- Risk assessment per task
- PR checklist for code review

**Use This To:** Implement fixes, assign work, track progress

---

## 🎯 Quick Navigation

### "I have 5 minutes"
→ Read: **README_DATA_INTEGRITY_AUDIT.md** (first half)

### "I need to brief my team"
→ Read: **DATA_INTEGRITY_VISUAL_SUMMARY.md**

### "I need to understand the issues"
→ Read: **DATA_INTEGRITY_AUDIT_2026-07-07.md** (Sections 1-7)

### "I need to implement fixes"
→ Read: **DATA_INTEGRITY_REMEDIATION_CHECKLIST.md**

### "I'm reviewing code changes"
→ Read: **DATA_INTEGRITY_AUDIT_2026-07-07.md** (Section 7) + **Remediation Checklist** (relevant task)

### "I'm testing the fixes"
→ Read: **Remediation Checklist** (Testing sections) + **Visual Summary** (Testing Plan)

---

## 🔴 Critical Issues Summary

| Issue | What | Where | Fix Time | Impact |
|:-----:|:-----|:------|:--------:|:------:|
| **C1** | No intra-bar time validation | `dag/runner.ts` | 2h | Lookahead bias |
| **C2** | Decimal precision loss | `backfill-candles.js` | 2h | Wrong pips |
| **C3** | Spread assumes 4/5-digit only | `backfill-candles.js` | 3h | Gold 10x wrong |
| **C4** | No OHLC validation | `backfill-candles.js` | 1h | Corrupted data |
| **C5** | Feature TS not validated | `dag/runner.ts` | 2h | Misalignment |

**Total to fix all critical:** ~10 hours

---

## 📂 File Structure

```
c:\tradzfx-v2\
├── reports/
│   ├── README_DATA_INTEGRITY_AUDIT.md           ← Start here
│   ├── DATA_INTEGRITY_VISUAL_SUMMARY.md         ← Visual overview
│   ├── DATA_INTEGRITY_AUDIT_2026-07-07.md       ← Main report
│   └── DATA_INTEGRITY_REMEDIATION_CHECKLIST.md  ← Implementation guide
│
├── apps/engine/src/dag/
│   └── runner.ts                                 ← Fix C1, C5
│
├── scripts/
│   ├── backfill-candles-from-mt5-csv.js         ← Fix C2, C3, C4
│   ├── regenerate-higher-timeframes.js          ← Add gap detection
│   ├── backfill-historical-features.js          ← Review
│   ├── backtest-pit-v2.js                       ← Review
│   └── validate-candles-post-import.js          ← NEW (Task 2.1)
│
└── DATA_INTEGRITY_AUDIT_INDEX.md                ← This file
```

---

## 🚀 Implementation Sequence

### Week 1: Critical Fixes
```
Task 1.1: endTs validation (2h)
  → File: apps/engine/src/dag/runner.ts
  → Impact: Prevents lookahead bias
  → Status: HIGH PRIORITY
  
Task 1.2: OHLC validation (1h)
  → File: scripts/backfill-candles-from-mt5-csv.js
  → Impact: Prevents data corruption
  → Status: HIGH PRIORITY
  
Task 1.4: Feature TS validation (2h)
  → File: apps/engine/src/dag/runner.ts
  → Impact: Ensures alignment
  → Status: HIGH PRIORITY
  
Week 1 Total: ~5 hours coding + 2 hours testing = 7 hours
```

### Week 2: High-Impact Fixes
```
Task 1.3: Spread conversion fix (3h)
  → File: scripts/backfill-candles-from-mt5-csv.js
  → Impact: Fixes gold/commodities spreads
  → Status: CRITICAL FOR XAUUSD
  
Task 1.2 (follow-up): Decimal precision fix (2h)
  → File: scripts/backfill-candles-from-mt5-csv.js
  → Impact: Fixes pip calculations
  → Status: IMPORTANT
  
Week 2 Total: ~5 hours coding + 2 hours testing = 7 hours
```

### Week 3: Infrastructure
```
Task 2.1: Post-import validation script (3h)
  → File: NEW scripts/validate-candles-post-import.js
  → Impact: Catches future data issues
  → Status: PREVENTIVE
  
Task 5.1: Gap detection (2h)
  → File: scripts/regenerate-higher-timeframes.js
  → Impact: Detects weekend/closure gaps
  → Status: NICE-TO-HAVE
  
Week 3 Total: ~5 hours coding + 1 hour testing = 6 hours

Total Project: ~20 hours (3 weeks)
```

---

## ✅ Acceptance Criteria

After all fixes are deployed, verify:

- [ ] endTs validation throws error for intra-bar times
- [ ] OHLC validation skips corrupted candles with warning
- [ ] Spread for XAUUSD = 15 pips (not 1.5)
- [ ] Feature timestamps are valid candle closes
- [ ] Post-import validation script passes 100%
- [ ] Cross-TF features validate alignment
- [ ] Backtest results reproducible
- [ ] No gaps detected in normal market hours
- [ ] Existing backtest suite passes without changes

---

## 🔍 Testing Checklist

### Before Deploying to Production
```bash
# 1. Unit tests for each fix pass
pnpm test apps/engine/src/dag/runner.ts
pnpm test scripts/backfill-candles-from-mt5-csv.js

# 2. Integration tests pass
pnpm test scripts/backfill-historical-features.js

# 3. Existing backtest suite still passes
pnpm test backtest-pit-v2.test.js

# 4. Post-import validation on test data
node scripts/validate-candles-post-import.js

# 5. Spot-check backtest results
node scripts/backtest-pit-v2.js EURUSD 7 keylevel_bounce_v1 --json > /tmp/test.json
# Compare against baseline from before fixes
```

### Production Rollout
```bash
# 1. Run on staging database
TM_DB_NAME=tradzfx_v2_staging \
TM_DB_PASSWORD=$STAGING_PW \
node scripts/validate-candles-post-import.js

# 2. Run on production with read-only flag
TM_DB_NAME=tradzfx_v2 \
TM_DB_PASSWORD=$PROD_PW \
node scripts/validate-candles-post-import.js --dry-run

# 3. If all pass, run real fixes
TM_DB_NAME=tradzfx_v2 \
TM_DB_PASSWORD=$PROD_PW \
node scripts/backfill-candles-from-mt5-csv.js ./new-data/ \
  --tz-offset-minutes=180 \
  --broker=MT5
```

---

## 📊 Metrics & Monitoring

### Immediate Metrics (After Fixes)
```
Data Integrity:
  - Feature timestamp validity: should be 100%
  - OHLC violation rate: should be 0%
  - Lookahead bias detected: should be 0
  
Data Quality:
  - Import validation pass rate: should be 100%
  - Candle gap detection: should be < 0.1% during market hours
  - Spread range sanity: EURUSD 0.5-2 pips, XAUUSD 0.1-0.5 pips
```

### Ongoing Monitoring
```
Add to production cron job (hourly):
  0 * * * * node scripts/validate-candles-post-import.js >> /var/log/candle-validation.log 2>&1

Add to CI/CD (on every commit):
  - pnpm test
  - pnpm lint
  - Custom data integrity checks
```

---

## 📞 Support & Questions

### If you have questions about...

**Architecture & Design:**
→ Read Main Report, Section 1-5 (pipeline stages)

**Why a specific issue occurs:**
→ Read Main Report, Section 7 (issue details + code evidence)

**How to implement a fix:**
→ Read Remediation Checklist (code snippets + testing)

**How to test a fix:**
→ Read Remediation Checklist (testing sections) or Visual Summary

**Overall context:**
→ Read README + Visual Summary

---

## 🎓 Learning Resources

### Understanding the Data Pipeline
- **Quick:** DATA_INTEGRITY_VISUAL_SUMMARY.md (pipeline diagram)
- **Deep:** DATA_INTEGRITY_AUDIT_2026-07-07.md (Section 1-5)

### Understanding Each Issue
- **Visual:** DATA_INTEGRITY_VISUAL_SUMMARY.md (issue diagrams)
- **Technical:** DATA_INTEGRITY_AUDIT_2026-07-07.md (Section 7)

### Implementing Fixes
- **Code:** DATA_INTEGRITY_REMEDIATION_CHECKLIST.md (code snippets)
- **Testing:** DATA_INTEGRITY_REMEDIATION_CHECKLIST.md (testing sections)

---

## 📅 Recommended Reading Schedule

**Day 1: Planning & Understanding (2 hours)**
- Read: README_DATA_INTEGRITY_AUDIT.md (30 min)
- Read: DATA_INTEGRITY_VISUAL_SUMMARY.md (30 min)
- Read: DATA_INTEGRITY_AUDIT_2026-07-07.md sections 1-2 (60 min)

**Day 2: Deep Dive (1.5 hours)**
- Read: DATA_INTEGRITY_AUDIT_2026-07-07.md sections 3-5 (90 min)

**Day 3: Implementation Planning (2 hours)**
- Read: DATA_INTEGRITY_AUDIT_2026-07-07.md sections 7-9 (90 min)
- Read: DATA_INTEGRITY_REMEDIATION_CHECKLIST.md (first half) (30 min)

**Week 1-3: Implementation (20 hours)**
- Implementation tasks from Remediation Checklist
- Testing and code review per task
- Deployment to staging then production

---

## 🏁 Success Definition

**Project is complete when:**
1. All 5 critical issues are fixed and tested
2. All high-priority issues are addressed
3. Post-import validation script is running hourly
4. Backtest suite passes with no changes needed
5. Monitoring dashboard shows 0 data integrity violations
6. Team has been trained on new validation procedures
7. Documentation is updated with new CSV format spec

**Estimated Time to Success:** 3 weeks

---

**Report Generated:** 2026-07-07  
**Status:** ✅ Complete and Ready for Implementation  
**Next Step:** Start with Task 1.1 (endTs validation) from Remediation Checklist
