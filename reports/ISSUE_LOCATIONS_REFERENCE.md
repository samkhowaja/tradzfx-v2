# Strategy Specs Audit — Issue Locations Reference
**For:** Quick lookup of every issue by file and line

---

## 🔴 CRITICAL ISSUES

### Issue 1: Missing minRR Field
**File:** `packages/strategies/src/specs/keylevel_bounce_v8c_min3.yaml`  
**Location:** Line ~35-40 (risk section)  
**Current:**
```yaml
risk:
  sl: 50 pips
  tp: nearest_profit_pivot
  tpOffsetPips: -2
  timeoutBars: 480
  maxFillBars: 120
  # ← MISSING: minRR field here
```
**Fix:** Add `minRR: 3` after `tpOffsetPips: -2`  
**Severity:** 🔴 Critical (validation blocking)  
**Effort:** 1 minute

---

### Issue 2: Contradictory TP vs MinRR Rules (10 variants)

#### Variant 2a: keylevel_bounce_v8_levels
**File:** `packages/strategies/src/specs/keylevel_bounce_v8_levels.yaml`  
**Location:** Lines 45-55 (risk section)  
**Problem:**
```yaml
risk:
  tp: nearest_profit_pivot      # ← Dynamic (market-dependent)
  minRR: 1.5                    # ← Fixed floor
  tpOffsetPips: -2
  # Question: What if pivot is 40 pips from SL?
  # 50-pip SL → 40-pip TP = 0.8R < 1.5R minRR
  # Conflict: Does trade reject or minRR get ignored?
```
**Severity:** 🔴 Critical (engine behavior undefined)  
**Resolution Required:** Document priority rules before deployment

#### Variant 2b: keylevel_bounce_v8b_zone_tp
**File:** `packages/strategies/src/specs/keylevel_bounce_v8b_zone_tp.yaml`  
**Location:** Lines 45-55 (risk section)  
**Same Problem:** `tp: opposing_zone_profit` vs `minRR: 1.5`

#### Variant 2c-2j: Smart Risk Sniper Variants (8 files)
**Files:**
- `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_ob_tp.yaml` (Line 60-65)
- `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_profit.yaml` (Line 60-65)
- 6 other sniper pivot/zone TP variants

**Problem:** All have `minRR: 10` but TP is formula-based (pivot/zone dependent)

**Severity:** 🔴 Critical × 8 variants (all inactive, but problematic if activated)

---

### Issue 3: Unrealistic SL/TP Assumptions (8 variants)

**All in:** `smart_risk_ob_ifvg_1m_sniper_10r*` family  
**Problem:** 10-pip SL with minRR=10 (requires 100-pip TP)  
**Risk Level:** Impossible to achieve on 5m timeframe consistently

**Affected Files:**
```
1. smart_risk_ob_ifvg_1m_sniper_10r.yaml
   Line 55-60: sl: 10 pips | tp: sl * 10 | minRR: 10

2. smart_risk_ob_ifvg_1m_sniper_10r_demand_supply.yaml
   Line 60-65: Same risk config

3. smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_15m_tp.yaml
   Line 60-65: sl: 10 pips | tp: 15m pivot | minRR: 10

4. smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_1h_tp.yaml
   Line 60-65: sl: 10 pips | tp: 1h pivot | minRR: 10

5. smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_5m_tp.yaml
   Line 60-65: sl: 10 pips | tp: 5m pivot | minRR: 10

6. smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp.yaml
   Line 55-60: sl: 10 pips | tp: zone_beyond_minRR | minRR: 10

7. smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_1h.yaml
   Line 60-65: Same

8. smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_5m.yaml
   Line 60-65: Same
```

**Status:** All 8 are `active: false`  
**Severity:** 🔴 Critical (delete all 8)  
**Effort:** 5 minutes (rm command)

---

## 🟡 HIGH PRIORITY ISSUES

### Issue 4: Dead Code (12 inactive variants)

#### 4a: Deprecated Base Variants (2 files)

**File 1:** `packages/strategies/src/specs/keylevel_bounce.yaml`  
**Status:** `active: false` (Line 4)  
**Note:** Superseded by `keylevel_bounce_v1.yaml`  
**Lines:** ~80 lines of duplicated setup logic  
**Action:** DELETE

**File 2:** `packages/strategies/src/specs/watukushay.yaml`  
**Status:** `active: false` (Line 4)  
**Note:** Superseded by `watukushay_fe.yaml` (identical entry logic)  
**Lines:** ~100 lines of duplicated RSI logic  
**Action:** DELETE

#### 4b: Inactive Smart Risk Variants (10 files)

**All in:** `smart_risk_ob_ifvg_1m_*` family, marked `active: false`

```
1. smart_risk_ob_ifvg_1m_3r.yaml
   Reason: Deprecated 3R fixed target (superseded by runon variants)
   Status: active: false (Line 3)

2. smart_risk_ob_ifvg_1m_runon.yaml
   Reason: Deprecated run-on variant base (superseded by _runon_15r)
   Status: active: false (Line 3)

3. smart_risk_ob_ifvg_1m_runon_15r_age15.yaml
   Reason: Experimental age filter variant (never validated)
   Status: active: false (Line 3)
   Note: Only difference = iFVG predicate age_bars <= 15

4. smart_risk_ob_ifvg_1m_runon_15r_notight.yaml
   Reason: Experimental filter tweak (never validated)
   Status: active: false (Line 3)
   Note: Only difference = remove fill_pct >= 0.5 filter

5. smart_risk_ob_ifvg_1m_runon_15r_notight_origwindow.yaml
   Reason: Experimental window override (never validated)
   Status: active: false (Line 3)
   Note: Only difference = timeWindows override

6-13. smart_risk_ob_ifvg_1m_sniper_10r*.yaml (8 files)
      Reason: Unrealistic 10-pip SL assumptions (see Issue 3)
      Status: All active: false
      Note: All have 100-pip+ TP targets
```

**Total Dead Code:** ~625 lines  
**Action:** DELETE all 12 files  
**Effort:** 5 minutes

---

### Issue 5: Parameter Tweaks as Separate Files (7 variants)

These should be config overrides, not separate YAML files:

#### 5a: Entry Config Tweaks (4 variants)
```
1. keylevel_bounce_v1_limit
   File: packages/strategies/src/specs/keylevel_bounce_v1_limit.yaml
   Change: entryConfig.type: market → limit
   Action: DELETE, use override instead

2. keylevel_bounce_v1_4r
   File: packages/strategies/src/specs/keylevel_bounce_v1_4r.yaml
   Change: Only TP ratio change (3R → 4R)
   Action: DELETE or merge into base template

3. keylevel_bounce_v1_wider
   File: packages/strategies/src/specs/keylevel_bounce_v1_wider.yaml
   Change: Only SL change (50 → 80 pips)
   Action: DELETE or use parameter

4. keylevel_bounce_v1_fx
   File: packages/strategies/src/specs/keylevel_bounce_v1_fx.yaml
   Change: Only symbols override (XAUUSD → EURUSD/GBPUSD)
   Action: DELETE or use config flags
```

#### 5b: Filter Tweaks (3 variants)
```
1. smart_risk_ob_ifvg_1m_runon_15r_age15.yaml
   Change: Add age_bars <= 15 filter to iFVG
   Action: DELETE (experimental, never validated)

2. smart_risk_ob_ifvg_1m_runon_15r_notight.yaml
   Change: Remove fill_pct >= 0.5 filter
   Action: DELETE (experimental, never validated)

3. smart_risk_ob_ifvg_1m_runon_15r_notight_origwindow.yaml
   Change: Revert timeWindows to original
   Action: DELETE (experimental, never validated)
```

**Pattern:** All are minor parameter variations without entry logic changes  
**Severity:** 🟡 High (maintainability issue)  
**Action:** Establish policy: use overrides, not new files

---

## 🟠 MEDIUM PRIORITY ISSUES

### Issue 6: Unrealistic Break-Even TP/SL (Watukushay variants)

**File 1:** `packages/strategies/src/specs/watukushay_fe.yaml`  
**Location:** Line 45 (risk section)  
**Problem:**
```yaml
risk:
  sl: atr(1h) * 0.5          # ← ATR-based stop
  tp: sl * 1.0               # ← 1:1 reward (BREAK-EVEN target)
  minRR: 1.0
```
**Issue:** 1:1 RR = break-even target (no edge)  
**Severity:** 🟠 Medium (edge validation needed)  
**Action:** Verify backtest Sharpe > 0.8 before live trading

**File 2:** `packages/strategies/src/specs/watukushay_no1.yaml`  
**Location:** Line 40+ (inherits from watukushay base)  
**Same Problem:** 1:1 RR with MA cross strategy

---

### Issue 7: Unknown Feature Data Availability (6 filters)

#### 7a: State Enum Filter
**Files:** `keylevel_bounce_v1_4r.yaml` (Line 15)  
**Predicate:**
```yaml
predicate: "state IN ('READY', 'SOFT_WARN')"
```
**Question:** Does `features_htf_bias.state` column exist?  
**Data Status:** Unknown  
**Severity:** 🟠 Medium (may silently exclude all trades)

#### 7b: Tapped Flag
**Files:** `keylevel_bounce_v3.yaml` (Line 20), `keylevel_bounce_v8_levels.yaml` (Line 15)  
**Predicate:**
```yaml
predicate: "tapped = true"
```
**Question:** Does `features_zone.tapped` column exist?  
**Status:** Unknown (recent feature?)

#### 7c: Liquidity Pool Sweep
**File:** `xauusd_v1.yaml` (Line 35)  
**Predicate:**
```yaml
predicate: "recent_sweep_matched = true"
```
**Question:** Does `features_liquidity_pools.recent_sweep_matched` exist?  
**Status:** Unknown (engine-specific feature)

#### 7d: Age Bars Filter
**Files:** `smart_risk_ob_ifvg_1m_runon_15r_age15.yaml` (Line 20)  
**Predicate:**
```yaml
predicate: "age_bars <= 15"
```
**Question:** Does `features_ifvg.age_bars` column exist?  
**Status:** Unknown (new feature added in v1.0.2?)

#### 7e: DXY Divergence
**File:** `xauusd_v1.yaml` (Line 50, optional filter)  
**Predicate:**
```yaml
predicate: "divergence_detected = false"
```
**Question:** Does `features_correlation.divergence_detected` exist?  
**Status:** Unknown (correlation features new)

**Action:** Audit database schema + feature backfill status  
**Severity:** 🟠 Medium (may cause runtime failures)

---

### Issue 8: Unclear TP Formula Descriptions (3 variants)

**Files:**
- `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_15m_tp.yaml` (Line 55)
- `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_1h_tp.yaml` (Line 55)
- `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_5m_tp.yaml` (Line 55)

**Problem:**
```yaml
risk:
  tp: 15m swing pivot        # ← Which direction?
  minRR: 10                  # ← How to enforce?
```

**Questions:**
- Is it the nearest pivot (closest proximity)?
- Or the next pivot in direction of trade?
- How are ties handled?
- What if no pivot exists within X bars?

**Severity:** 🟠 Medium (engine must interpret)

---

## ✅ COMPLIANT ITEMS (No Issues)

### FamilyId Compliance (49/49 = 100%)

All specs correctly follow rule: "Standalone specs have `familyId == id`"

**Verified:**
- ✓ Standalones: orb_classic, scarface_5m_orb, doyle_sd, forex_strategy_orb, waqar_v2, xauusd_v1
- ✓ Families: All variants have correct familyId matching parent (keylevel_bounce, smart_risk_ob_ifvg_1m, watukushay)

---

## 📋 QUICK GREP COMMANDS

### Find All Contradictory minRR Rules
```bash
grep -l "nearest_profit_pivot\|opposing_zone\|opposing_order_block" \
  packages/strategies/src/specs/*.yaml | \
  xargs grep -l "minRR:"
```

### Find All 10-Pip SL Variants
```bash
grep -l "sl: 10 pips" packages/strategies/src/specs/*.yaml
```

### Find All Inactive Variants
```bash
grep -l "active: false" packages/strategies/src/specs/*.yaml
```

### Find Missing minRR Fields
```bash
# In v8c_min3, look for risk section WITHOUT minRR
grep -A 5 "^risk:" packages/strategies/src/specs/keylevel_bounce_v8c_min3.yaml | \
  grep -c "minRR:"
# Returns 0 = MISSING
```

### Find Unknown Feature Filters
```bash
grep -E "state IN|tapped = true|age_bars|divergence_detected|recent_sweep" \
  packages/strategies/src/specs/*.yaml
```

---

## 🔧 BATCH FIX COMMANDS

### Delete All Dead Code (12 files)
```bash
# Phase 1: Delete 12 inactive variants
rm packages/strategies/src/specs/keylevel_bounce.yaml
rm packages/strategies/src/specs/watukushay.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_3r.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_runon.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_runon_15r_age15.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_runon_15r_notight.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_runon_15r_notight_origwindow.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_ob_tp.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_15m_tp.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_1h_tp.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_5m_tp.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_profit.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_1h.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_5m.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_ifvgfilter.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_ifvgfilter_loose.yaml
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_zone_tp.yaml

echo "Phase 1 cleanup complete: 12 files deleted"
git add -A && git commit -m "chore: cleanup dead strategy variants (phase 1)"
```

### Fix Missing minRR (1 file, 1 line)
```bash
# Edit keylevel_bounce_v8c_min3.yaml, add after line 40:
#   minRR: 3

# Or use sed:
sed -i '40a\  minRR: 3' packages/strategies/src/specs/keylevel_bounce_v8c_min3.yaml
```

---

## 📞 ISSUE REPORTING FORMAT

**For future audits, report issues as:**

```
ISSUE: [Name]
SEVERITY: [Critical/High/Medium]
FILES: [List]
LOCATION: [File:Line]
PROBLEM: [Description]
ACTION: [Fix or investigation needed]
EFFORT: [Time estimate]
```

**Example:**
```
ISSUE: Contradictory TP vs MinRR
SEVERITY: Critical
FILES: keylevel_bounce_v8_levels.yaml, keylevel_bounce_v8b_zone_tp.yaml
LOCATION: Risk sections (lines 45-55 in each)
PROBLEM: TP formula dynamic but minRR fixed floor — conflict resolution undefined
ACTION: Document priority rules before deployment
EFFORT: 30 minutes
```

---

**Generated:** 2026-07-07  
**Purpose:** Code location reference for audit findings  
**Next Step:** Use grep commands to validate findings programmatically
