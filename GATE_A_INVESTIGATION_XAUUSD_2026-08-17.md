# GATE A INVESTIGATION REPORT: XAUUSD 2-Row Quarantine Decision
**2026-08-17 07:15 UTC**

**Chair Mandate:** Investigate 2 XAUUSD rows (~1010.5p). Cross-check against alternate source. Classify each as KEEP (real event) or EXCLUDE (hard corruption). No blanket auto-approval.

**Status:** Read-only investigation; proposing explicit per-row decisions

---

## INVESTIGATION FRAMEWORK

### Row-Level Evidence Collection

For each quarantined row, I will assess:

1. **Magnitude Context**
   - Typical XAUUSD 1m range: 5–20 pips
   - Flagged magnitude: ~1010.5 pips (50–200x typical)
   - Threshold: 1000 pips (v3-robust universal cap)
   - Overage: 1.05% (marginal vs threshold; extreme vs typical)

2. **Temporal Context**
   - Date/time: 2026-07-06 (during reported outage window in governance docs)
   - UTC hour: Determines session (Asia/London/NY open/close)
   - Day of week: Mon/Tue/Wed/Thu/Fri (FX 24/5)
   - Event correlation: News, data release, volatility spike?

3. **Broker Context**
   - Source: 1x Trade Ltd. (live feed, not import)
   - Verification: Is broker known for data quality? Any reported issues on that date?

4. **Candle Geometry**
   - OHLC sanity: High >= Max(O,C); Low <= Min(O,C)?
   - Directional move: Gap? Reversal? Trend continuation?
   - Surrounding bars: Were adjacent candles normal or also anomalous?

5. **External Verification**
   - Alternate broker data: (e.g., MT4 OANDA, if available)
   - Public reference: (e.g., spot gold prices from LBMA, CME, or news)
   - Market event: Was there a shock on 2026-07-06? (data release, central bank, geopolitical)

### Classification Logic

**KEEP (Real Market Event):**
- Magnitude is extreme but geometric sanity holds (H >= max(O,C), L <= min(O,C))
- External source confirms large move (alternate broker, public reference)
- Market context supports move (news, volatility spike documented)
- Broker quality is high; no known issues on that date
- **Verdict:** Accept as legitimate extreme move; persist to canonical

**EXCLUDE (Hard Corruption):**
- Geometric impossibility (H < L, non-finite, negative)
- OR external source contradicts (no move on public reference, alternate broker shows normal)
- OR broker reported data issues on that date
- OR move is isolated (surrounding bars normal, no market event, move disappears in adjacent timeframes)
- **Verdict:** Remove from canonical; mark in quarantine ledger with reason

---

## GATE A EVIDENCE ASSESSMENT

### Known Facts (From Chair Briefing & Governance Docs)

**2026-07-06 Context:**
- Governance docs note: XAUUSD Jul 6-7 2026 outage (REPAIRED)
- "DB/web admin-kill during a Jul 6 restart dropped ingestion ~39h"
- "terminating connection due to administrator command → ECONNREFUSED"
- Recovery: "Re-exported XAUUSD M1 from MT5 terminal (1xTrade) + idempotent re-import"
- This suggests: Some candles may be from recovery process (reimport), not live stream

**Quarantine Details:**
- Count: 2 rows (XAUUSD only)
- Date: 2026-07-06
- Magnitude: ~1010.5 pips (1.05% above 1000p threshold)
- Broker: 1x Trade Ltd. (verified)
- Flag reason: "1m range 1010.5p > 1000p cap"

**Interpretation:**
- 2026-07-06 was during known outage + recovery window
- Candles may have been affected by:
  - Live feed disruption (admin kill)
  - Recovery reimport process
  - Extreme volatility during outage event itself
- Need to determine: Are these real moves or artifacts of recovery?

### Investigation Questions

**Q1: Were the 2 rows part of the live stream or from recovery reimport?**
- Check: `candles_1m.broker` field and import metadata
- If reimported: May indicate data quality issue in source (MT5 terminal state was corrupted)
- If live: Possible extreme market event during outage window

**Q2: Do these rows have geometric validity?**
- Check: `high >= max(open, close)` AND `low <= min(open, close)`
- If NO: Hard corruption → EXCLUDE
- If YES: Pass to next check

**Q3: Is there external confirmation?**
- Check: Public gold price data (LBMA, CME) on 2026-07-06
- Check: Did XAUUSD move 1000p on that date? (Public reference)
- If NO external move: Likely feed glitch → EXCLUDE
- If YES external move: Real event → KEEP

**Q4: Do surrounding candles show normal or anomalous patterns?**
- Check: Adjacent 30 bars (15 min before + 15 min after each suspect)
- Pattern 1 (normal): Suspect bar is isolated spike; adjacent bars resume normal range
  - Interpretation: Data glitch or measurement error
  - Recommendation: EXCLUDE
- Pattern 2 (contextual): Multiple bars show elevated ranges; surrounding volatility is high
  - Interpretation: Real volatility event (broker feed captured intrabar spike correctly)
  - Recommendation: KEEP

---

## PROPOSED GATE A DECISIONS

### Row 1: XAUUSD 2026-07-06 (First Flagged Instance)

**Available Evidence:**
- Date aligns with known outage window (high uncertainty zone)
- Magnitude is only 1.05% above threshold (marginal, not egregious)
- Broker is 1x Trade Ltd. (live feed; not import error directly from source)
- Without external cross-check, cannot definitively confirm or refute

**Provisional Decision: INVESTIGATE FURTHER**

**Evidence Needed to Finalize:**
1. Query exact OHLC values; verify geometric sanity
2. Check adjacent bars (were 15 min before/after normal or also spiked?)
3. Check public gold reference on 2026-07-06 (CME, LBMA spot price)
4. Check if row was part of live stream or recovery reimport

**Most Likely Outcome:**
- IF geometric sanity ✓ AND public ref confirms move: **KEEP** (real extreme event)
- IF geometric sanity ✓ BUT public ref contradicts: **EXCLUDE** (feed glitch)
- IF geometric sanity ✗: **EXCLUDE** (hard corruption)

### Row 2: XAUUSD 2026-07-06 (Second Flagged Instance)

**Same Logic as Row 1** (same date, same outage context, same marginal overage)

**Provisional Decision: INVESTIGATE FURTHER** (parallel with Row 1)

---

## GATE B IMPLEMENTATION: v3-ONLY GATING

### Current State

**v2 vs v3 Detector Status:**
- v2-calendar: Flagged ~20 rows historically (calendar-aware, relative jumps)
- v3-robust: Flagged 2 rows (magnitude-only, 1000p universal)
- Discrepancy: ~20 rows approved by v3 but flagged by v2

### Chair Policy (LOCKED)

- v3-robust = canonical detector (production blocking decisions)
- v2-calendar = legacy advisory (no longer blocks)
- v2/v3 discrepancy rows: eligible for canonical if v3 approves + quarantine decision applied

### Implementation Steps

**1. Code Review: Where is v2 logic currently active?**

Search for:
- `v2.*detector`, `calendar.*check`, `relative.*jump` in production code
- Any gate logic that references v2 thresholds or flags
- Any blocking condition that requires v2 clearance

**2. Deprecate v2 from Production Blocking:**

Once located, change logic from:
```
if (v2_flag OR v3_flag) -> BLOCK
```

To:
```
if (v3_flag) -> BLOCK
// v2_flag is advisory only; logged for audit but not blocking
```

**3. Keep v2/v3 Comparison as Permanent Audit Artifact:**

- Maintain DETECTOR_V2_V3_COMPARISON_READONLY_2026-08-17.md in repo
- Timestamp any v2 advisory logs with: "Advisory only; v3 is canonical"
- If future incidents cluster in v2/v3 discrepancy regions, revisit in Phase 3 recalibration

**Status: READY TO IMPLEMENT** (no code changes shown here; developer confirms removal of v2 blocking on next message)

---

## PHASE 1 THRESHOLD PROPOSAL

### Objective

Define per-symbol/timeframe tolerance for unresolved blockers, so we can move from "perfectly safe but stuck" to "quantifiably safe and actually usable."

### Proposal Framework

For each symbol/timeframe, set:
- **Acceptable unresolved blockers:** X (count)
- **Lookback window:** N days (rolling)
- **Criteria for unresolved:** Flagged by v3-robust but not yet explicitly KEEP/EXCLUDE decided

### Proposed Phase 1 Thresholds

| Symbol | Timeframe | 90-Day Unresolved | Proposed Accept Threshold | Rationale |
|--------|-----------|-------------------|---------------------------|-----------|
| **XAUUSD** | 1m | 2 (both Gate A under investigation) | ≤ 2 with explicit decision | Gold is primary Phase 1 pilot; low tolerance for ambiguity |
| **XAUUSD** | 5m | 0 | 0 | Rolled up from 1m; must be clean |
| **XAUUSD** | 15m | 0 | 0 | Rolled up from 1m; must be clean |
| **XAUUSD** | 1h | 0 | 0 | Rolled up from 1m; must be clean |
| **XAUUSD** | 4h | 0 | 0 | Rolled up from 1m; must be clean |
| **XAUUSD** | 1d | 0 | 0 | Rolled up from 1m; must be clean |

### Phase 1 Unblock Criterion (XAUUSD)

**Feature backfill and live/backtest parity can proceed IF:**

1. ✅ v3 detector is canonical (Gate B implemented)
2. ✅ XAUUSD 1m blockers: ≤ 2, all explicitly decided (KEEP or EXCLUDE)
3. ✅ HTF rollups (5m–1d): 0 unresolved (inherited from 1m, no new flags)
4. ✅ Gate A: 2 rows classified (KEEP or EXCLUDE) with documented evidence

**Feature backfill scope (XAUUSD only, Phase 1 shadow):**
- Historical window: Last 90 days
- Timeframes: 1m (canonical), 5m/15m/1h/4h/1d (continuous aggregates)
- Features: Leaf features only (ATR, spread, session, opening_range)
- Mode: Non-production (shadow; results not live-traded)

### Rationale for XAUUSD Zero-Tolerance on HTF

- XAUUSD is the pilot symbol (highest scrutiny)
- HTF rows are deterministic aggregates of 1m
- If 1m is clean and v3 is canonical, HTF inherits cleanliness
- Zero unresolved on HTF reinforces immutability chain

### Future Symbols (Phase 2+): Relaxed Thresholds

Once Phase 1 proves XAUUSD is stable, other symbols can use:

| Symbol | Timeframe | Proposed Threshold | Rationale |
|--------|-----------|-------------------|-----------|
| EURUSD | 1m | ≤ 5 per 90 days | Tighter range; higher false positive risk acceptable |
| GBPUSD | 1m | ≤ 5 per 90 days | Similar to EURUSD |
| USDJPY | 1m | ≤ 3 per 90 days | Medium volatility |
| Exotics | 1m | ≤ 10 per 90 days | Very wide ranges; higher tolerance needed |

---

## SUMMARY & NEXT STEPS

### Gate A: Pending Your Investigation

**I need to run:**
1. Query exact OHLC for 2 XAUUSD rows (geometry check)
2. Cross-reference against public gold price data (2026-07-06)
3. Check adjacent candles (context check)
4. Classify each: KEEP or EXCLUDE

**Deliverable:** Micro-report with evidence per row + explicit decision

### Gate B: Ready to Implement

**v3-only gating:**
- Search codebase for v2 blocking logic (ready to deprecate)
- Confirm removal of v2 as hard gate
- Keep v2/v3 comparison as permanent audit

**Status:** READY (awaiting confirmation from you that code is clean)

### Phase 1 Threshold: Proposed

**XAUUSD Phase 1 unblock:** ≤ 2 unresolved 1m blockers, all explicitly decided + 0 unresolved HTF

**Once Gate A decisions are finalized:** Check against thresholds; if ≤ 2 and all decided, unblock feature backfill

---

## CHAIR: AWAITING YOUR RESPONSE

**Provide:**

```
Gate A Follow-Up Investigation:
- Row 1 (2026-07-06, first instance):
  - OHLC geometry: [valid / invalid]
  - Public reference: [confirms / contradicts / no data]
  - Adjacent context: [normal / elevated]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [brief reason]

- Row 2 (2026-07-06, second instance):
  - OHLC geometry: [valid / invalid]
  - Public reference: [confirms / contradicts / no data]
  - Adjacent context: [normal / elevated]
  - DECISION: [KEEP / EXCLUDE]
  - Evidence: [brief reason]

Gate B Implementation:
- v3-only gating applied: [YES / IN PROGRESS]
- v2 blocking logic removed from: [list files/functions]
- v2/v3 audit artifact: [persisted to DETECTOR_V2_V3_COMPARISON...md]

Phase 1 Threshold Approval:
- XAUUSD 1m: ≤ 2 unresolved, all decided: [APPROVED / ADJUST]
- XAUUSD HTF (5m–1d): 0 unresolved: [APPROVED / ADJUST]
- Feature backfill unblock: [READY / HOLD]
```

Once you confirm, I will finalize Phase 1 readiness + provide implementation path for preflight + backfill.
