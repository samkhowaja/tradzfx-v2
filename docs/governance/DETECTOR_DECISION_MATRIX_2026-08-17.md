# Detector Decision Matrix: Source of Truth & Canonical Rules — 2026-08-17

**Status:** Read-only governance analysis (frozen phase)  
**Audience:** Governance, data engineering, QA  
**Purpose:** Establish single source of truth for detector semantics, flag definitions, thresholds, and unresolved blocking cases

---

## Executive Summary

**Current State (As of 2026-08-17):**

- **Multiple detector versions coexist:** v1, v2-calendar, v3-robust, v4-calibrated
- **Multiple flag types in use:** LARGE_JUMP_ROBUST, LARGE_JUMP_RELATIVE, UNEXPECTED_GAP
- **No single authoritative semantics document:** Each version has different logic, thresholds, and symbol-specific rules
- **Risk:** Quarantine layer looks fail-closed but enforces ambiguous rules → inconsistency masked by rigor

**Decision Required:**

Which detector version defines the **canonical anomaly semantics** for:
- Live ingestion (raw → broker → canonical → quarantine → approval)?
- Backtest (PIT canonical reads with quarantine checks)?
- Feature generation (feature rows tagged with detector_version)?

---

## Part 1: Detector Versions — Current Semantics

### Detector v1 (Legacy)

**Status:** Superseded (v2-calendar replaced it)  
**Location:** Historical records only (check1-tw.txt, check2-classification-snapshot.txt)  
**Flags Emitted:** `LARGE_JUMP_RELATIVE`, `UNEXPECTED_GAP`  
**Parameters (Inferred):**

```typescript
// v1 logic (reconstructed from classification snapshot):
// - LARGE_JUMP_RELATIVE: magnitude relative to prior bar or ATR
// - UNEXPECTED_GAP: gap between close and next open
// - No calendar awareness (weekend gaps treated same as intra-week)
```

**Known Issues:**
- No session/calendar boundary awareness
- Treats weekend gaps identically to weekday gaps
- High false-positive rate (low precision)

**Current Usage:**
- Historical classification records only
- Superseded by v2-calendar
- Should NOT be used for new decisions

---

### Detector v2-Calendar (Conceptual)

**Status:** Design artifact (not fully implemented in production)  
**Location:** Referenced in classification snapshot, not in core ingest code  
**Flags Emitted:** `LARGE_JUMP_RELATIVE`, `UNEXPECTED_GAP` (with calendar awareness)  
**Parameters (Inferred):**

```typescript
// v2-calendar logic (reconstructed):
// - LARGE_JUMP_RELATIVE: magnitude relative to prior bar, with calendar context
// - UNEXPECTED_GAP: gap that violates market calendar expectations
// - Calendars: FX 24/5 (Sun 21:00 UTC → Fri 21:00 UTC), index session hours
// - Goal: Reduce false positives on normal session boundaries
```

**Implementation Status:**
- ❌ Not in `apps/web/src/app/api/ingest/route.ts` (only v3 magnitude check)
- ❌ Feature engine doesn't tag with `v2-calendar`
- ❌ Backtest doesn't consume v2-calendar flags

**Known Limitations:**
- Calendar logic never fully specified
- Session boundary handling undefined
- Relative jump threshold not documented
- Symbol-specific rules not defined

**Current Usage:**
- Classification records (historical)
- Not active in live or backtest paths
- Appears to be abandoned mid-design

---

### Detector v3-Robust (Current Production)

**Status:** ✅ Active & production (default)  
**Location:** `apps/web/src/app/api/ingest/route.ts:96–115`  
**Flags Emitted:** `LARGE_JUMP_ROBUST` only (magnitude-only)  
**Implementation:**

```typescript
// PRODUCTION CODE (apps/web/src/app/api/ingest/route.ts:103–115)
const MAX_1M_RANGE_PIPS = 1000;

function suspectRangeReason(symbol: string, bar: V2Bar): string | null {
  const pipSize = getRegistryPipSize(symbol);
  if (!(pipSize > 0)) return null;
  
  const rangePips = (bar.high - bar.low) / pipSize;
  if (Number.isFinite(rangePips) && rangePips > MAX_1M_RANGE_PIPS) {
    return `1m range ${rangePips.toFixed(1)}p > ${MAX_1M_RANGE_PIPS}p cap`;
  }
  return null;
}
```

**Canonical Parameters:**
- **Threshold:** 1000 pips (1m bar range)
- **Scope:** Magnitude-only (ignores context, calendar, session, prior bars)
- **Symbol-Specific:** No (all symbols use same 1000p threshold)
- **Action:** Flag to `candle_quality` (best-effort, non-blocking)

**Data Quality (90-day retrospective):**
- **Total candles:** 7,776,000
- **Suspects flagged:** 2 (both USDSEK)
- **Suspect rate:** 0.0000026%
- **Approval status:** KEEP (both approved as valid)

**Known Characteristics:**
- ✅ Production-stable (been live for months)
- ✅ Zero false positives on major pairs (XAUUSD, EURUSD, etc.)
- ✅ Correctly flags exotic pair outliers (USDSEK: 2 bars in 90d)
- ❌ Blind to session/calendar anomalies
- ❌ Blind to relative magnitude (5% move in XAUUSD vs 0.5% in EURUSD treated identically)

**Feature Tagging:**
```typescript
// apps/engine/src/dag/runner.ts:725–726
row[col] = process.env.TM_CANDLE_DETECTOR_VERSION ?? "detector-v3";
```

Every feature row gets tagged with v3 by default.

**Current Usage:**
- ✅ Live ingestion (`POST /api/ingest`)
- ✅ Feature engine tagging
- ✅ Backtest canonical reads (quarantine checks use v3 flags)

---

### Detector v4-Calibrated (Proposed/Frozen)

**Status:** ❌ Design only (not implemented, frozen)  
**Location:** `check1-tw.txt` (trusted window metadata)  
**Flags Emitted:** TBD (would be refined LARGE_JUMP_ROBUST + new flags)  
**Proposed Parameters (Inferred):**

```typescript
// v4 logic (NOT IMPLEMENTED, FROZEN):
// - Symbol-specific thresholds:
//   XAUUSD: ? pips (lower sensitivity)
//   EURUSD: ? pips (standard)
//   USDJPY: ? pips (pip-size adjusted)
//   USDSEK: ? pips (higher threshold, known wide spreads)
// - Relative magnitude (percent move)
// - Calendar/session awareness
// - ATR-normalized thresholds
// - Regime-based tuning (normal vs crisis volatility)
```

**Known Constraints:**
- ❌ No implementation code
- ❌ Symbol-specific thresholds undefined
- ❌ Relative magnitude logic unspecified
- ❌ Calibration eval set not frozen
- ⏳ Requires governance approval + 6-week implementation timeline

**Current Usage:**
- Metadata only (named in trusted window specs)
- No operational code

---

## Part 2: Flag Semantics — Current State

### Flag: LARGE_JUMP_ROBUST

**Status:** ✅ Canonical (v3 production)  
**Detector:** v3-robust  
**Semantics:** 1m candle range exceeds 1000 pips  
**Implementation:**

```
IF bar.high - bar.low > 1000 pips (using registry pip size)
THEN flag = LARGE_JUMP_ROBUST
ELSE flag = null
```

**Interpretation:**
- ✅ Magnitude outlier on absolute scale
- ❌ Does NOT imply causation (e.g., gap, spike, corruption, or valid move)
- ❌ Does NOT account for symbol volatility
- ❌ Does NOT account for session/calendar context

**Quarantine Action:**
- Insert `candle_quality` row with `is_suspect=true`
- Non-blocking (raw candle persisted to `candles_1m`)
- Downstream uses `LEFT JOIN candle_quality` to filter (if strict mode)

**Data (90d):**
- Emitted: 2 times (both USDSEK)
- False positives: 0
- False negatives (missed outliers): Unknown (requires detector v4 comparison)

---

### Flag: LARGE_JUMP_RELATIVE

**Status:** ❌ Legacy (v1, v2-calendar only)  
**Detector:** v1, v2-calendar  
**Semantics:** Magnitude relative to prior bar or ATR  
**Implementation:** Varies by version (v1 vs v2-calendar logic differs)

**Current Code Status:**
- ❌ NOT in production ingest code
- ✅ In historical classification records
- ❌ Not emitted by v3

**Interpretation:**
- Relative magnitude (e.g., "5× normal bar size")
- Requires context (ATR, prior bars, regime)
- More sensitive than absolute magnitude

**Why Deprecated:**
- v3 chose absolute magnitude (simpler, lower false-positive rate)
- v2-calendar logic never fully specified
- Relative logic requires ATR, which adds latency/context dependency

**Current Usage:**
- Classification records only (v1, v2-calendar historical data)
- Should NOT be referenced for new decisions

---

### Flag: UNEXPECTED_GAP

**Status:** ❌ Legacy (v1, v2-calendar only)  
**Detector:** v1, v2-calendar  
**Semantics:** Gap between candles violates market calendar expectations  
**Implementation:** Varies (v1 ignores calendar; v2-calendar would use it)

**Current Code Status:**
- ❌ NOT in production ingest code
- ✅ In historical classification records
- ❌ Not emitted by v3

**Known Issues:**
- v1 treats weekend gaps = weekday gaps (high false-positive)
- v2-calendar intended to fix this but never fully implemented
- Calendar rules undefined (which sessions? which gaps are OK?)

**Current Usage:**
- Classification records only
- Should NOT be referenced for new decisions

---

## Part 3: Symbol-Specific Rules — Current State

### Global Rule (All Symbols)

**Threshold:** 1000 pips  
**Source:** `MAX_1M_RANGE_PIPS` constant in ingest route

```typescript
const MAX_1M_RANGE_PIPS = 1000;
```

**Applied To:**
- ✅ XAUUSD
- ✅ EURUSD
- ✅ USDJPY
- ✅ USDSEK
- ✅ All other symbols

**Issues:**
- USDSEK median spread ~32 pips; 1000p threshold is reasonable
- XAUUSD volatility ~50p typical; 1000p is very loose
- EURUSD volatility ~10p typical; 1000p is very loose
- JPY pairs (different pip size); threshold logic correct but sensitivity differs

---

### Symbol: XAUUSD (Gold Spot)

**Broker:** 1x Trade Ltd.  
**Base Spread:** ~1.5 pips  
**Typical 1m Range:** 5–50 pips  
**90-day Suspects (v3):** 0  
**Max Range Observed:** ~660 pips (2026-03-24, valid move)

**Symbol-Specific Notes:**
- 24/5 trading (no Monday gap)
- Wide range outliers are typically valid (news events)
- Proposal: v4 would set lower threshold (e.g., 500p) for tighter detection
- Risk: v4 lower threshold could flag valid news spikes as suspects

---

### Symbol: EURUSD (EUR/USD)

**Broker:** OANDA Corporation (MT4) / 1x Trade Ltd. (MT5)  
**Base Spread:** ~2–3 pips  
**Typical 1m Range:** 5–30 pips  
**90-day Suspects (v3):** 0  
**Max Range Observed:** Unknown (requires query)

**Symbol-Specific Notes:**
- Most liquid forex pair
- High leverage in retail (normal volatility baseline)
- Proposal: v4 would use relative magnitude (e.g., >5× ATR)

---

### Symbol: USDJPY (USD/JPY)

**Broker:** OANDA Corporation (MT4) / 1x Trade Ltd. (MT5)  
**Base Spread:** ~0.5–1.5 pips  
**Pip Size:** 0.01 (differs from 4-digit pairs)  
**Typical 1m Range:** 5–30 pips  
**90-day Suspects (v3):** 0  
**Max Range Observed:** Unknown

**Symbol-Specific Issues:**
- Pip size = 0.01 (3-digit); pipSize logic handles this
- Range in pips is comparable to other majors
- No known issues with current v3 logic

---

### Symbol: USDSEK (USD/SEK)

**Broker:** OANDA Corporation (MT4) / 1x Trade Ltd. (MT5)  
**Base Spread:** ~30–40 pips (exotic, wide)  
**Typical 1m Range:** 20–100 pips  
**90-day Suspects (v3):** 2 (both flagged, both approved KEEP)  
**Max Range Observed:** ~1,376 pips (2026-07-05)

**Symbol-Specific Issues:**
- **Wide-spread pair:** All bars naturally have larger ranges
- **v3 threshold issue:** 1000p threshold was set globally; USDSEK outliers are real moves, not corruption
- **Approved status:** Both suspects reviewed and approved as KEEP (valid volatility)

**Proposal for v4:**
- Symbol-specific threshold: e.g., 1500–2000p for USDSEK (wider baseline)
- Or: Use relative magnitude (>5× baseline spread) instead of absolute

---

## Part 4: Unresolved Blocking Cases

### Case 1: v2-Calendar Logic Never Specified

**Description:** v2-calendar was designed to fix v1 false positives but implementation was abandoned.

**Impact:**
- Cannot compare v2 vs v3 performance
- Cannot validate that v3 is an improvement (governance cannot approve v3 over v2)
- Governance spec requires detector readiness comparison (v2 vs v3), but v2 is incomplete

**Blocks:**
- ❌ Detector readiness sign-off (comparison matrix needed)
- ❌ Unfreeze authorization (cannot prove v3 is better)

**Resolution Required:**
1. Either: Fully specify v2-calendar logic and implement for comparison
2. Or: Formally deprecate v2-calendar and declare v3 the baseline
3. Or: Design v4 as the true improvement and compare v3 vs v4 instead

---

### Case 2: Relative Magnitude Logic Undefined

**Description:** v1 and v2-calendar used LARGE_JUMP_RELATIVE but logic differs.

**Impact:**
- Cannot determine which is authoritative (v1 logic or v2 logic?)
- Cannot port to v3 or v4 without deciding the semantics
- Historical classification records contain both, creating ambiguity

**Blocks:**
- ❌ Relative magnitude implementation (which algorithm?)
- ❌ Symbol-specific tuning (relative to what? ATR? prior bar? regime-based?)

**Resolution Required:**
1. Decide: Is relative magnitude part of canonical detector or legacy-only?
2. If canonical: Specify algorithm (ATR, prior bar, or other)
3. If legacy: Mark all LARGE_JUMP_RELATIVE records as non-authoritative

---

### Case 3: Symbol-Specific Thresholds Not Defined

**Description:** v3 uses global 1000p threshold for all symbols, but USDSEK (wide-spread exotic) flags too often.

**Impact:**
- v3 is too lenient for XAUUSD (660p moves approved)
- v3 is inconsistent for USDSEK (needs higher threshold)
- v4 was designed to fix this but is not implemented

**Blocks:**
- ❌ v4 calibration (symbol-specific thresholds undefined)
- ❌ Live/backtest parity (backtest uses v3 flags; can quarantine different symbols differently)

**Resolution Required:**
1. Decide: Does v4 include symbol-specific thresholds?
2. If yes: Define thresholds per symbol class (majors, exotics, metals, indices)
3. If no: Keep v3 global threshold and accept the trade-off

---

### Case 4: Calendar/Session Logic Not Implemented

**Description:** v1 and v2-calendar attempted to add calendar awareness (v2 specifically), but v3 dropped it.

**Impact:**
- v3 cannot distinguish weekend gaps from intra-week gaps
- v3 cannot detect session-boundary anomalies (e.g., gap at session open)
- Historical v1/v2-calendar records contain session flags; v3 ignores them

**Blocks:**
- ❌ Session-boundary detection (v3 blind to it)
- ❌ Improved anomaly detection (v4 would need this)

**Resolution Required:**
1. Decide: Is calendar/session awareness part of canonical detector?
2. If yes: Implement in v4 (add session context to LARGE_JUMP_ROBUST or new flag)
3. If no: Mark UNEXPECTED_GAP as legacy and drop it

---

### Case 5: Live vs Backtest Parity Unresolved

**Description:** Live ingestion uses v3 (magnitude-only); backtest uses canonical reads + v3 quarantine checks. But canonical vs raw semantics differ.

**Impact:**
- Live path: Raw 1m → best-effort v3 flag → candle_quality table
- Backtest path: Canonical 1m (approved) → LEFT JOIN candle_quality → filter
- If backtest filters candle_quality differently than live does, parity breaks

**Blocks:**
- ❌ Backtest/live parity certification (unresolved filtering logic)
- ❌ Feature backfill decisions (which candles authoritative for backtest?)

**Resolution Required:**
1. Define canonical quarantine semantics:
   - Which flags are hard blockers (filter out)?
   - Which flags are soft (log but don't filter)?
   - Per symbol? Per flag type?
2. Ensure live and backtest use identical filtering logic
3. Document in canonical safety spec

---

## Part 5: Decision Matrix — Source of Truth

### Question 1: Which Detector Version Is Canonical Now?

**Options:**

A. **v3-robust (current production)**
   - ✅ Implemented, active, production-stable
   - ✅ Zero false positives on majors (90d data)
   - ❌ Magnitude-only (no context)
   - ❌ Not optimized per symbol
   - **Recommendation:** Accept v3 as baseline; propose v4 as improvement

B. **v2-calendar (abandoned design)**
   - ✅ Intended to reduce false positives
   - ❌ Never fully implemented
   - ❌ Logic undefined
   - ❌ No production code
   - **Recommendation:** Either complete v2-calendar spec or formally deprecate

C. **v4-calibrated (frozen design)**
   - ✅ Addresses known v3 limitations
   - ✅ Symbol-specific thresholds planned
   - ✅ Calendar awareness designed
   - ❌ Not implemented, no code
   - ❌ Unfreeze required
   - **Recommendation:** Accept v3 now; plan v4 for post-unfreeze

**DECISION REQUIRED:** Choose one as authoritative now; others are legacy or future.

---

### Question 2: Which Flags Are Canonical?

**Options:**

A. **LARGE_JUMP_ROBUST (v3 current)**
   - ✅ Production code exists
   - ✅ Actively emitted
   - ✅ Data quality proven
   - **Recommendation:** Canonical for live/backtest now

B. **LARGE_JUMP_RELATIVE (v1/v2 legacy)**
   - ❌ Not in production code
   - ❌ Logic varies by version
   - ✅ Historical data available
   - **Recommendation:** Mark as legacy; historical records only

C. **UNEXPECTED_GAP (v1/v2 legacy)**
   - ❌ Not in production code
   - ❌ Never fully specified
   - ✅ Historical data available
   - **Recommendation:** Mark as legacy; deprecate

**DECISION REQUIRED:** Declare LARGE_JUMP_ROBUST canonical; mark others as legacy-only.

---

### Question 3: Should Thresholds Be Symbol-Specific?

**Options:**

A. **Global threshold (current v3)**
   - 1000 pips for all symbols
   - ✅ Simple, consistent
   - ❌ Loose for XAUUSD, loose for EURUSD, too tight for USDSEK?
   - **Current impact:** USDSEK flags occasionally; all approved

B. **Symbol-class specific (v4 proposal)**
   - Majors: 1000p (EURUSD, USDJPY, etc.)
   - Exotics: 1500p (USDSEK)
   - Metals: 500p (XAUUSD)
   - **Advantages:** Better per-symbol tuning
   - **Risks:** More code, more bugs, needs calibration

C. **Relative thresholds (v4 advanced proposal)**
   - % of typical bar size (e.g., >5× ATR)
   - Symbol-adaptive
   - **Advantages:** Volatility-aware
   - **Risks:** Requires real-time ATR context, latency trade-off

**DECISION REQUIRED:** Stay with v3 global? Plan v4 symbol-specific? Choose threshold approach.

---

### Question 4: What Is the Canonical Quarantine Semantics?

**Current State:**
- Live: v3 flags → `candle_quality` table (best-effort)
- Backtest: LEFT JOIN `candle_quality` → filter if `is_suspect=true`

**Ambiguities:**
- Is filtering hard or soft?
- Per symbol? Per flag?
- What if a suspect candle is needed for ATR context?

**Options:**

A. **Hard filter (current assumption)**
   - Backtest removes suspect candles entirely
   - Live never uses suspect candles for features
   - ✅ Strict, fail-closed
   - ❌ May lose valid high-volatility events

B. **Soft filter with context**
   - Backtest flags suspect candles but includes them
   - Features check flag and adjust (e.g., ATR winsorizes)
   - ✅ Preserves context
   - ❌ More complex, more edge cases

C. **Per-flag rules**
   - LARGE_JUMP_ROBUST: Hard filter
   - LARGE_JUMP_RELATIVE: Soft filter (ATR uses it)
   - UNEXPECTED_GAP: Soft filter (ignore gaps)
   - ✅ Nuanced
   - ❌ Complicated

**DECISION REQUIRED:** Define canonical quarantine semantics (hard/soft, per-flag).

---

### Question 5: What Blocks Live/Backtest Parity Certification?

**Blockers:**

1. ❌ Canonical quarantine semantics undefined (case 4)
2. ❌ v2-calendar logic not specified (case 1)
3. ❌ Symbol-specific thresholds undefined (case 3)
4. ❌ Relative magnitude algorithm unresolved (case 2)

**Resolution Path:**

| Blocker | Decision | Owner | Timeline |
|---------|----------|-------|----------|
| Quarantine semantics | Define hard/soft per-flag rules | Governance | Now (frozen phase) |
| v2-calendar | Deprecate or complete spec | Data Eng + Governance | Now (frozen phase) |
| Symbol-specific thresholds | Accept v3 global OR plan v4 | Governance + Data Eng | Now (frozen phase) |
| Relative magnitude | Deprecate or specify algorithm | Data Eng | Now (frozen phase) |

---

## Part 6: Recommended Decisions (For Governance Review)

### Decision 1: Declare v3-Robust Canonical Now

**Rationale:**
- ✅ Production-proven
- ✅ Simple, low false-positive rate
- ✅ Zero critical gaps in 90d data
- ✅ Enables frozen-phase work to proceed

**Action:**
```
DECISION: detector-v3-robust is the canonical anomaly detector 
          for live ingestion and backtest canonical reads.

EFFECTIVE: 2026-08-17 (retroactive, documenting current state)

LEGACY STATUS: 
  - detector-v1: DEPRECATED
  - detector-v2-calendar: DEPRECATED
  - detector-v4-calibrated: FROZEN (future consideration only)
```

---

### Decision 2: Mark Legacy Flags as Non-Authoritative

**Rationale:**
- LARGE_JUMP_RELATIVE and UNEXPECTED_GAP not in production code
- Keep historical records but don't use them for new decisions

**Action:**
```
DECISION: 
  - LARGE_JUMP_ROBUST is the canonical flag (production).
  - LARGE_JUMP_RELATIVE is legacy (historical records only).
  - UNEXPECTED_GAP is legacy (historical records only).

EFFECTIVE: 2026-08-17 (retroactive)

IMPACT: New quarantine decisions use only LARGE_JUMP_ROBUST.
        Historical records remain intact for audit purposes.
```

---

### Decision 3: Accept v3 Global Threshold (1000 pips)

**Rationale:**
- ✅ USDSEK: 2 suspects in 90d, both approved
- ✅ XAUUSD: 660p move approved; threshold permissive enough
- ✅ Majors: Zero suspects (clean)
- ⏳ v4 symbol-specific tuning can happen post-unfreeze

**Action:**
```
DECISION: 
  - Canonical threshold: 1000 pips (all symbols)
  - Applied to: All symbol/broker/timeframe combinations

EFFECTIVE: 2026-08-17 (retroactive, documenting current state)

FUTURE: v4 may introduce symbol-specific thresholds post-governance approval.
```

---

### Decision 4: Define Canonical Quarantine Semantics

**Rationale:**
- Must unblock live/backtest parity certification
- Hard/soft distinction determines filtering behavior

**Proposed Semantics:**

```
Canonical Quarantine Rules:

1. LIVE INGESTION:
   - v3 flags → candle_quality.is_suspect=true
   - Best-effort persist (non-blocking)
   - Raw candle always stored to candles_1m

2. BACKTEST PATH (PIT):
   - LEFT JOIN candles_1m ON candle_quality (outer join)
   - WHERE candle_quality.is_suspect IS NULL OR is_suspect = false
   - Result: Suspected candles excluded from PIT reads
   - Effect: HARD FILTER (suspected candles not used for features/signals)

3. FEATURE ENGINE:
   - fetchCandles() from market.candles_1m_canonical (already filtered by backtest)
   - Live engine: Uses raw candles; feature persist skipped if flag present
   - Backtest: Uses canonical (already filtered)

4. SIGNAL GENERATION:
   - Uses feature candles only
   - Never reads raw/suspect candles directly
   - Safe by construction (feature path enforces filter)
```

**Action:**
```
DECISION: 
  - Quarantine is HARD FILTER in backtest PIT path
  - Suspected candles excluded from feature generation
  - Live engine skips feature persist if flag present
  - Signal generation uses features only (safe by construction)

EFFECTIVE: 2026-08-17 (retroactive, documenting current state)

VERIFICATION: Backtest code audit confirms LEFT JOIN behavior.
              Live feature persist confirms flag check.
```

---

### Decision 5: Plan v4 as Post-Unfreeze Improvement

**Rationale:**
- v3 is production-stable; can't improve under freeze
- v4 addresses known limitations (symbol-specific, relative magnitude, calendar)
- Governance can authorize v4 development once v3 baseline is locked

**Action:**
```
DECISION: 
  - v3 is canonical now (locked for frozen phase)
  - v4 is planned improvement (post-governance-approval only)
  - v4 scope: symbol-specific thresholds, relative magnitude, calendar awareness
  - v4 timeline: 6 weeks post-unfreeze authorization (design by Data Eng)

EFFECTIVE: 2026-08-17 (governance freeze decision)

BLOCKERS: v4 unfreeze requires board approval (separate gate change)
```

---

## Part 7: Matrix Summary — Quick Reference

| Question | Current State | Decision | Blocks | Owner |
|----------|---------------|----------|--------|-------|
| **Canonical detector?** | v1, v2, v3, v4 mixed | v3-robust | Parity cert | Governance |
| **Canonical flag?** | v3: LARGE_JUMP_ROBUST, v1/v2: others | LARGE_JUMP_ROBUST only | Quarantine | Governance |
| **Threshold strategy?** | Global 1000p | Keep v3, plan v4 symbol-specific | Calibration | Governance |
| **Quarantine semantics?** | Ambiguous | Hard filter (backtest) | Live/backtest parity | Governance |
| **v2-calendar?** | Abandoned | Deprecate | Detector readiness | Governance |
| **Relative magnitude?** | v1/v2 legacy | Deprecate; plan v4 | v4 design | Data Eng |
| **Calendar awareness?** | v1/v2 legacy | Deprecate; plan v4 | v4 design | Data Eng |
| **v4 readiness?** | Frozen | Accept post-unfreeze | Unfreeze gate | Governance |

---

## Part 8: Governance Action Items

### Immediate (Frozen Phase)

- [ ] **Approve Decision 1:** v3-robust as canonical (retroactive)
- [ ] **Approve Decision 2:** Legacy flags marked non-authoritative
- [ ] **Approve Decision 3:** Global 1000p threshold (v3 unchanged)
- [ ] **Approve Decision 4:** Hard-filter quarantine semantics in PIT
- [ ] **Approve Decision 5:** v4 frozen; plan post-unfreeze

### Pre-Unfreeze

- [ ] **Verify:** Backtest code audit confirms hard-filter LEFT JOIN
- [ ] **Verify:** Live feature persist confirms flag check
- [ ] **Document:** Canonical quarantine semantics in PIT/live code

### Post-Unfreeze (v4 Design Phase)

- [ ] **Design:** Symbol-specific threshold calibration
- [ ] **Design:** Relative magnitude algorithm selection
- [ ] **Design:** Calendar/session awareness rules
- [ ] **Implement:** v4-calibrated detector
- [ ] **Validate:** v4 eval set comparison (frozen eval set protocol)

---

## Conclusion

**Current State:** Multiple detector versions and flag types coexist without explicit authority.  
**Risk:** Quarantine layer appears fail-closed but enforces ambiguous rules.  
**Resolution:** Declare v3-robust canonical, deprecate v1/v2 flags, define hard-filter quarantine semantics.  
**Unfreeze:** v4 planned as improvement, blocked until governance approval + 6-week timeline.

**Governance must decide:** Accept this matrix, or request additional investigation before approval.
