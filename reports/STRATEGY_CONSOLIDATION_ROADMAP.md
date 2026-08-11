# Strategy Consolidation Roadmap
**Date:** 2026-07-07 | **Target:** Reduce 49 → 35 active specs (28% consolidation)

---

## Phase 1: Immediate Cleanup (Now)

### Delete 12 Dead/Deprecated Files
**Effort:** 5 min | **Impact:** Remove 625 lines dead code

**Deprecated Base Variants (2 files):**
```bash
rm packages/strategies/src/specs/keylevel_bounce.yaml
rm packages/strategies/src/specs/watukushay.yaml
```

**Inactive Smart Risk Variants (10 files):**
```bash
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
```

**After Phase 1:** 49 → 37 active specs

### Fix 1 Missing Field
**Effort:** 1 min | **Impact:** Unblock keylevel_bounce_v8c_min3

**File:** `packages/strategies/src/specs/keylevel_bounce_v8c_min3.yaml`
```yaml
# ADD to risk section:
risk:
  sl: 50 pips
  tp: nearest_profit_pivot
  tpOffsetPips: -2
  minRR: 3                    # ← ADD THIS LINE
  timeoutBars: 480
  maxFillBars: 120
```

---

## Phase 2: Smart Risk Consolidation (Sprint 1)

### Target: 27 variants → 4 base specs

**Keep (rename for clarity):**
1. ✓ `smart_risk_ob_ifvg_1m` (base) → Keep as-is
2. ✓ `smart_risk_ob_ifvg_1m_runon_15r` → Rename to `smart_risk_ob_ifvg_1m_pivot_tp`
3. ✓ `smart_risk_ob_ifvg_1m_runon_15r_ob_tp` → Rename to `smart_risk_ob_ifvg_1m_level_tp`
4. ✓ `smart_risk_ob_ifvg_1m_runon_15r_zone_tp` → Rename to `smart_risk_ob_ifvg_1m_zone_tp`

**Remove additional variants:**
```bash
# Remove FX variant (can use config instead)
rm packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx.yaml

# Total deletion: 23 more files (already removed in Phase 1: 10, keeping 4)
```

**After Phase 2:** 37 → 14 active specs in core families

---

## Phase 3: Keylevel Bounce Consolidation (Sprint 1)

### Target: 13 variants → 5 base specs

**Current Structure:**
```
v1, v1_4r, v1_fx, v1_limit, v1_wider  (entry config variants)
v2, v3, v4                            (incremental feature additions)
v5_longs, v5_shorts                   (directional locking)
v6_ny_overlap_shorts                  (session filtering)
v7_shorts_time                        (time window filtering)
v8_levels, v8b_zone_tp, v8c_min3     (TP method variants)
```

**Proposed Template Structure:**

1. **`keylevel_bounce_base.yaml`** (consolidates v1-v4 logic)
   - Setup: cumulative (bias, pricing, HTF zone)
   - Entry: structure break + zone retest
   - Parameters: configurable
   - Covers: v1, v2, v3, v4 logic levels
   ```yaml
   id: keylevel_bounce_base
   familyId: keylevel_bounce
   active: true
   overrides:
     # Variant configs via top-level flags
     setup:
       - id: trend_bias
         tf: 1h
         predicate: direction != 'neutral'
         required: true
       - id: quality_check
         predicate: tapped = true AND quality_score > 0.05
         required: false  # Optional: v3+ only
       - id: htf_alignment
         tf: 4h
         required: false  # Optional: v4+ only
   ```

2. **`keylevel_bounce_directional.yaml`** (consolidates v5, v6)
   - Entry: locked direction (bullish/bearish/shorts_only)
   - Sessions: configurable (all or NY/OVERLAP)
   - Covers: v5_longs, v5_shorts, v6_ny_overlap_shorts
   ```yaml
   id: keylevel_bounce_directional
   familyId: keylevel_bounce
   overrides:
     setup:
       - id: direction_lock
         predicate: direction = 'bearish'  # Config: bullish/bearish/null
   ```

3. **`keylevel_bounce_timed.yaml`** (consolidates v7)
   - Entry: same as directional, but with time windows
   - Covers: v7_shorts_time
   ```yaml
   id: keylevel_bounce_timed
   familyId: keylevel_bounce
   overrides:
     filters:
       sessions:
         - OVERLAP
         - NY
       timeWindows:  # Config: array of UTC windows
         - { utcStart: "12:00", utcEnd: "12:59" }
         - { utcStart: "14:00", utcEnd: "14:59" }
   ```

4. **`keylevel_bounce_level_tp.yaml`** (consolidates v8, v8c)
   - Entry: same, TP method: level-based (swing pivot)
   - Covers: v8_levels, v8c_min3
   ```yaml
   id: keylevel_bounce_level_tp
   familyId: keylevel_bounce
   overrides:
     risk:
       tp: nearest_profit_pivot
       tpOffsetPips: -2
       minRR: 1.5
   ```

5. **`keylevel_bounce_zone_tp.yaml`** (v8b)
   - Entry: same, TP method: zone-based
   - Standalone (minimal changes from level_tp)
   ```yaml
   id: keylevel_bounce_zone_tp
   familyId: keylevel_bounce
   overrides:
     risk:
       tp: opposing_zone_profit
       tpOffsetPips: -2
       minRR: 1.5
   ```

**Delete after template migration:**
```bash
# Will be in template variants via config
rm packages/strategies/src/specs/keylevel_bounce_v1_4r.yaml
rm packages/strategies/src/specs/keylevel_bounce_v1_fx.yaml
rm packages/strategies/src/specs/keylevel_bounce_v1_limit.yaml
rm packages/strategies/src/specs/keylevel_bounce_v1_wider.yaml
rm packages/strategies/src/specs/keylevel_bounce_v2.yaml
rm packages/strategies/src/specs/keylevel_bounce_v3.yaml
rm packages/strategies/src/specs/keylevel_bounce_v4.yaml
rm packages/strategies/src/specs/keylevel_bounce_v5_longs.yaml
rm packages/strategies/src/specs/keylevel_bounce_v5_shorts.yaml
rm packages/strategies/src/specs/keylevel_bounce_v6_ny_overlap_shorts.yaml
rm packages/strategies/src/specs/keylevel_bounce_v7_shorts_time.yaml
rm packages/strategies/src/specs/keylevel_bounce_v8_levels.yaml
rm packages/strategies/src/specs/keylevel_bounce_v8b_zone_tp.yaml

# Keep:
# keylevel_bounce_v1.yaml (renamed to keylevel_bounce_base.yaml)
# keylevel_bounce_v8c_min3.yaml (fix minRR, keep as-is or rename to keylevel_bounce_level_tp_strict.yaml)
```

**After Phase 3:** 14 → 9 active specs (61% reduction in family size)

---

## Phase 4: Watukushay Consolidation (Sprint 2)

### Target: 3 variants → 2 base specs

**Current:**
- `watukushay_fe` (RSI-based, active)
- `watukushay_no1` (MA cross-based, active)

**Action:** 
1. Rename `watukushay_fe` → `watukushay_rsi` (for consistency)
2. Rename `watukushay_no1` → `watukushay_ma_cross` (for consistency)
3. Both have same risk config (SL=ATR*0.5, TP=1R) — clarify if this is intentional

**After Phase 4:** 9 → 8 active specs

---

## Final State (After All Phases)

**Before:** 49 total (37 active)
**After:** 35 total (35 active, all deprecated removed)

### Active Specs by Family:

| **Family** | **Before** | **After** | **Reduction** |
|---|---|---|---|
| keylevel_bounce | 13 | 5 | 62% |
| smart_risk_ob_ifvg_1m | 27 | 4 | 85% |
| watukushay | 3 | 2 | 33% |
| orb_classic | 1 | 1 | 0% |
| scarface_5m_orb | 1 | 1 | 0% |
| doyle_sd | 1 | 1 | 0% |
| forex_strategy_orb | 1 | 1 | 0% |
| waqar_v2 | 1 | 1 | 0% |
| xauusd_v1 | 1 | 1 | 0% |
| **TOTAL** | **49** | **35** | **28%** |

**After cleanup + consolidation: 49 → 35 specs = 14 fewer files maintained**

---

## Implementation Checklist

### Phase 1 (Now) ✓
- [ ] Delete 12 inactive/deprecated files
- [ ] Add `minRR: 3` to `keylevel_bounce_v8c_min3.yaml`
- [ ] Commit with message: "chore: cleanup dead strategy variants"

### Phase 2 (Sprint 1, Est. 1 hour)
- [ ] Rename `smart_risk_ob_ifvg_1m_runon_15r.yaml` → `smart_risk_ob_ifvg_1m_pivot_tp.yaml`
- [ ] Rename `smart_risk_ob_ifvg_1m_runon_15r_ob_tp.yaml` → `smart_risk_ob_ifvg_1m_level_tp.yaml`
- [ ] Rename `smart_risk_ob_ifvg_1m_runon_15r_zone_tp.yaml` → `smart_risk_ob_ifvg_1m_zone_tp.yaml`
- [ ] Delete `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx.yaml` (FX variant)
- [ ] Update seeding script to use new names
- [ ] Commit with message: "refactor: consolidate smart_risk family (27→4 active)"

### Phase 3 (Sprint 1, Est. 2 hours)
- [ ] Create template `keylevel_bounce_base.yaml` (consolidate v1-v4)
- [ ] Create template `keylevel_bounce_directional.yaml` (consolidate v5-v6)
- [ ] Create template `keylevel_bounce_timed.yaml` (v7)
- [ ] Create template `keylevel_bounce_level_tp.yaml` (v8)
- [ ] Create template `keylevel_bounce_zone_tp.yaml` (v8b)
- [ ] Fix `keylevel_bounce_v1.yaml` to inherit from `_base` template
- [ ] Delete 13 variant files
- [ ] Update seeding script
- [ ] Run backtest validation on all 5 to confirm logic equivalence
- [ ] Commit with message: "refactor: consolidate keylevel_bounce family (13→5 via templates)"

### Phase 4 (Sprint 2, Est. 30 min)
- [ ] Rename `watukushay` → `watukushay_rsi`
- [ ] Rename `watukushay_no1` → `watukushay_ma_cross`
- [ ] Update seeding script
- [ ] Commit with message: "refactor: clarify watukushay variant naming"

### Validation (All Phases)
- [ ] Run `pnpm test` to verify no broken imports
- [ ] Re-seed DB: `node scripts/seed-strategy-specs.js`
- [ ] Verify UI renders all strategies correctly
- [ ] Run backtest on all 35 specs (validate logic equivalence with originals)

---

## File Count Summary

```
Phase 1 Deletions:  -12 files
Phase 1 Additions:   +0 files
Phase 1 Total:      37 active specs

Phase 2 Renames:     0 net (refactor)
Phase 2 Deletions:   -1 file (FX variant)
Phase 2 Total:      36 active specs

Phase 3 Additions:   +5 template files
Phase 3 Deletions:   -13 variant files
Phase 3 Net:         -8 files
Phase 3 Total:      35 active specs

Phase 4 Renames:     0 net (refactor)
Phase 4 Total:      35 active specs

FINAL: 35 active specs (-14 from start, -28% reduction)
```

---

## Testing Strategy

**After each phase:**

1. **Syntax Validation:**
   ```bash
   find packages/strategies/src/specs -name "*.yaml" -exec yamllint {} \;
   ```

2. **Schema Validation:**
   ```bash
   node scripts/validate-strategy-specs.js
   ```

3. **Database Sync:**
   ```bash
   node scripts/seed-strategy-specs.js --dry-run
   ```

4. **Spot-check Backtest (2-3 specs per phase):**
   - Run PIT backtest on old variant + new template variant
   - Compare trade counts, entry/exit logic, risk settings
   - Confirm identical results

5. **UI Rendering:**
   - Load strategy detail pages in browser
   - Verify all specs render without errors
   - Check filtering/search still works

---

## Documentation Updates

**Create/update after consolidation:**

1. **`docs/strategy-specs-structure.md`** — Explain family/variant model
2. **`docs/tp-enforcement-rules.md`** — Clarify minRR vs variable TP conflict
3. **`AGENTS.md` — Add versioning policy:**
   ```markdown
   - Parameter tweaks → same spec with config overrides (no new file)
   - Entry logic changes → new variant in same family (v_N naming)
   - Symbol/session-only changes → use `filters.symbols` / `filters.sessions` overrides
   - New strategy idea → new familyId (standalone)
   ```

---

## Estimated Effort

| **Phase** | **Time** | **Complexity** |
|---|---|---|
| Phase 1: Cleanup | 10 min | Trivial |
| Phase 2: Smart Risk | 1 hr | Low |
| Phase 3: Keylevel | 2-3 hr | Medium |
| Phase 4: Watukushay | 30 min | Trivial |
| Testing + Validation | 2-3 hr | Medium |
| **TOTAL** | **6-8 hr** | **Medium** |

**Recommendation:** Allocate 1 sprint (8 hours) across 2-3 days for full execution.

---

**Next Step:** Approve Phase 1 (immediate cleanup) — no risk, high value (instant 625-line cleanup)
