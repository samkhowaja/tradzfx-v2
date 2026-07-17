# System Remediation Plan — tradzfx-v2

Compiled 2026-07-13 from `docs/system-failures-analysis.md`. Addresses 16 findings across 3 phases. Informed by industry best practices from TensorFlow TFX/ExampleValidator (pre-pipeline data validation), QuantConnect/LEAN (unified backtest+live execution), Azure Well-Architected Framework (health monitoring, anti-pattern elimination), and GitHub Actions (explicit quality gates).

---

## Phase 0 — Immediate Hotfixes (1-2 days)
*Stop the bleeding. No architectural changes.*

| Issue | Action | Effort | Dependencies |
|-------|--------|--------|-------------|
| **F-01** structure lookback | ✅ Already done in YAML; registry fix deferred to Phase 1 | 0d | None |
| F-03 iFVG sparseness | Backfill iFVG for XAUUSD Jul 1-3 window + expand producer sensitivity | 0.5d | Script access |
| F-16 silent fallback | Add console.warn at seed-time when required condition uses registry default | 0.25d | None |

### F-03 backfill
```bash
# Check iFVG gaps
SELECT date_trunc('day', ts), count(*) FROM features_ifvg
WHERE symbol='XAUUSD' AND ts>='2026-06-01' GROUP BY 1 ORDER BY 1;

# Re-run iFVG producer for sparse periods with wider detection
node scripts/backfill-historical-features.js XAUUSD 15m,5m --features=features_ifvg --start=2026-06-13 --end=2026-07-13
```

---

## Phase 1 — Core Architecture Fixes (1-2 weeks)
*Eliminate the root causes. TF-aware registry, explainer, unified SQL.*

### P1-A: TF-Aware Registry Defaults (F-01, F-05)

Replace scalar `defaultLookbackBars: number` with per-TF map:

```typescript
// Proposed defaults — each value = time window this feature needs at that TF
// Calculated as: min(lookbackBars × tfMinutes[tf]) ≥ maxSessionGap[tf]
export const REGISTRY_DEFAULTS: Record<string, Partial<Record<TimeFrame, number>>> = {
  features_structure: {
    "1m": 96,   // 96min — covers 1.5h intra-session gap
    "5m": 24,   // 2h
    "15m": 16,  // 4h
    "1h": 24,   // **24h — covers overnight gap** ← WAS 8 (FIXED)
    "4h": 12,   // 48h — covers weekend
    "1d": 5,    // 5 days
  },
  features_zone: {
    "1m": 240,  // 4h
    "5m": 96,   // 8h
    "15m": 96,  // 24h
    "1h": 48,   // 48h
    "4h": 24,   // 96h
    "1d": 10,   // 10 days
  },
  features_bias: {
    "1m": 12,   // 12 min (state feature, needs fresh)
    // ... all TFs
  },
  features_ifvg: {
    "1m": 96,   // 96 min
    "5m": 48,   // 4h
    "15m": 96,  // **24h** ← keeps current
    "1h": 96,   // 96h
  },
  // ... every entry in registry gets TF map
};
```

**Files affected**: `packages/strategies/src/featureRegistry.ts`, `packages/strategies/src/sqlBuilder.ts`, `scripts/backtest-pit-v2.js`, `packages/tradePipeline/src/liveRunner.ts`

**Migration path**: 
1. Change type, update all registry entries
2. Update `buildLookbackInterval()` in sqlBuilder to read from TF map
3. Update backtester + liveRunner lookback resolution
4. Run seed-time validation: explicit spec `lookbackBars` overrides, missing → registry TF map → if neither → ERROR

### P1-B: Temporal-Gap Validation in validateSpec() (F-02)

Add to `packages/strategies/src/validate.ts`:

```typescript
function validateTemporalCoverage(spec: Spec): string[] {
  const warnings: string[] = [];
  const sessions = spec.filters.sessions;
  const timeWindows = spec.filters.timeWindows;
  const maxGapMinutes = computeMaxSessionGapMinutes(sessions, timeWindows);

  for (const condition of [...spec.setup, ...spec.entry]) {
    const tf = condition.tf;
    const tfMinutes = TF_MINUTES[tf]; // e.g., { "1h": 60, "5m": 5 }
    const lookbackBars = condition.lookbackBars
      ?? getRegistryDefault(condition.feature, tf)
      ?? 0;
    const lookbackMinutes = lookbackBars * tfMinutes;

    if (lookbackMinutes < maxGapMinutes) {
      warnings.push(
        `${condition.id}: lookback ${lookbackMinutes}min < max session gap ${maxGapMinutes}min. ` +
        `Events outside trading sessions invisible at this TF. Set lookbackBars >= ${Math.ceil(maxGapMinutes / tfMinutes)}`
      );
    }

    // Weekend check
    const weekendMinutes = WEEKEND_GAP_MINUTES; // 48h = 2880min
    if (lookbackMinutes < weekendMinutes) {
      warnings.push(
        `${condition.id}: lookback ${lookbackMinutes}min < weekend gap ${weekendMinutes}min. ` +
        `Monday morning events miss Friday structure breaks.`
      );
    }
  }
  return warnings;
}
```

**Also add preflight gate**: `node scripts/backtest-pit-v2.js --preflight-temporal` checks each condition's lookback adequacy BEFORE running backtest. Exits non-zero on failures.

### P1-C: Compiler Explain Mode (F-04)

Add `--explain` flag to compiler that generates per-condition match counts:

```typescript
interface ExplainResult {
  stage: "setup" | "entry";
  conditionId: string;
  totalRows: number;      // before this condition
  matchedRows: number;    // after this condition
  filteredRows: number;   // difference
  filter: string;         // human: "no structure BOS in 8h window"
}
```

Implementation approach:
1. Wrap each LATERAL join in a CTE with a `matched` boolean
2. Output `SELECT condition_id, count(*), count(*) FILTER (WHERE matched)` per CTE
3. Render as ASCII table or JSON for programmatic consumption

**Alternative (simpler)**: Add `--dry-run` that outputs the generated SQL + row counts inline without executing. User can inspect the SQL to understand join logic.

### P1-D: Unify Backtester with Compiler SQL (F-07)

**This is the highest-impact architectural fix.**

Current state:
```
Compiled SQL ──────→ Live signals
         ↘
Backtester SQL (fork) ──→ PIT signals
```

**Problem**: `backtest-pit-v2.js` has its own `buildLookbackInterval()`, its own LATERAL generation, its own tiebreaker logic. All slightly different from `packages/strategies/src/sqlBuilder.ts`.

**Fix**: 
1. Export `buildSetupJoin(spec, setupNode, anchorTs)` and `buildEntryJoin(spec, entryNode, anchorTs)` from `sqlBuilder.ts` 
2. Backtester calls these with PIT timestamps instead of current wall clock
3. Remove backtester's SQL generation — it becomes a thin loop that iterates timestamps and calls shared SQL functions
4. `liveRunner.ts` already imports from featureRegistry; extend to also import sqlBuilder

**Files**: `packages/strategies/src/sqlBuilder.ts` (add exports), `scripts/backtest-pit-v2.js` (refactor), `packages/tradePipeline/src/liveRunner.ts` (add import)

### P1-E: iFVG Producer Comprehensiveness (F-03)

Audit `apps/engine/src/features/ifvg.ts`:
- Does it detect ALL displaced moves or only a subset?
- Does it have a minimum displacement threshold that's too strict?
- Can it detect FVGs across multiple TFs simultaneously?

Fix: widen detection logic, add configurable sensitivity, add `--force` mode for backfill.

---

## Phase 2 — Observability, Monitoring, Tooling (2-4 weeks)
*See problems before they cause 0-trade days.*

### P2-A: Temporal Alignment Visualization (F-06)

Build `scripts/debug-temporal-alignment.js`:

```bash
node scripts/debug-temporal-alignment.js XAUUSD 1h 2026-07-01 2026-07-13
```

Output: HTML Gantt chart with:
- Feature events as horizontal bars (colored by type)
- Trading sessions shaded regions
- Lookback windows as brackets
- Gap markers for missed opportunities
- Highlighted intersections (bias ∩ structure ∩ zone ∩ iFVG)

Tech: Query features, output HTML with embedded D3.js or Canvas rendering. Open in browser.

### P2-B: Data Clock Health Endpoint (F-15)

Add `/api/health/data-clock`:

```json
{
  "symbols": {
    "XAUUSD": {
      "candles_1m_latest": "2026-07-13T14:30:00Z",
      "candles_1m_lag_minutes": 5,
      "features_structure_latest": "2026-07-13T14:00:00Z",
      "features_structure_lag_minutes": 35,
      "features_ifvg_latest": "2026-07-13T14:15:00Z",
      "features_ifvg_lag_minutes": 20,
      "status": "healthy"
    },
    "EURUSD": {
      "candles_1m_latest": "2026-07-13T12:00:00Z",
      "candles_1m_lag_minutes": 155,
      "status": "stale"
    }
  }
}
```

Add alerts: if any critical symbol > 30min stale → PagerDuty/webhook.

### P2-C: Compile-Time Temporal Gate (F-06 extension)

Add `--check-temporal-alignment` flag to backtest preflight:
- For each condition, compute actual max gap between consecutive matching rows
- If gap > lookback window × 2 → WARNING (events likely missed)
- If any required condition has median gap > lookback window → FAIL

---

## Phase 3 — Long-Term Resilience (on-going)
*Prevent recurrence.*

### P3-A: Strategy Compilation Test Suite

Add CI pipeline:
1. Every YAML spec → compile → extract SQL → execute against snapshot DB → assert row counts > 0
2. Every spec → temporal validation → assert no warnings
3. Every registry default → per-TF cross-check → assert coverage ≥ min thresholds

```yaml
# .github/workflows/strategy-validation.yml
jobs:
  validate:
    steps:
      - run: pnpm build
      - run: node scripts/validate-all-specs.js
      - run: node scripts/backtest-pit-v2.js ALL 10 --preflight
      - run: node scripts/check-temporal-alignment.js --all-specs
```

### P3-B: Anti-Pattern Catalog

Document known anti-patterns in `docs/anti-patterns.md`:
1. **TF-Blind Registry Defaults** — flat lookbackBars that don't scale by TF
2. **Divergent Execution Paths** — separate SQL generation for backtest vs live
3. **Silent Starvation** — conditions that produce 0 matches without diagnostic output
4. **Loose Session Gaps** — lookback windows smaller than session gaps
5. **Unvalidated Defaults** — cond.lookbackBars fallback to registry default without warning
6. **Producer Ledger Over-Optimism** — recording "success" when rows were rejected
7. **Cache Key Amnesia** — omitting version from cache keys

Each anti-pattern gets: description, symptoms, detection method, fix procedure.

### P3-C: Temporal Alignment as a Compiler Primitive

Longest-term: make the compiler **automatically extend lookback windows** when it detects temporal gaps, rather than requiring manual `lookbackBars` in YAML.

```
Instead of:  "lookbackBars: 24 -> 24h at 1h"
The compiler computes:  "need 24h to cover [17:00 BOS -> 09:00 bias] gap"
```

This requires the compiler to:
1. Know spec's trading sessions
2. Know market calendar (FX 24/5, metals daily breaks)
3. Know max gap between consecutive session windows
4. Auto-extend each condition's lookback to cover the max gap

Effectively: `lookbackBars` becomes optional. Compiler computes the minimum safe value based on sessions + TF.

---

## Before vs. After

| Phase | Aspect | Before (broken) | After (fixed) |
|-------|--------|----------------|----------------|
| **P1-A** | Registry defaults | Flat `defaultLookbackBars: 8` applies same to 1m/1h/1d. 1h structure BOS 8h window misses overnight gaps. | Per-TF map `{ "1m": 96, "1h": 24, "4h": 12 }` — each TF gets coverage ≥ max session gap. |
| **P1-B** | Seed-time validation | validateSpec() checks YAML structure only. No temporal coverage analysis. 0-entry specs seed silently. | `validateTemporalCoverage()` computes lookbackMinutes vs maxGapMinutes per condition. WARN/FAIL on undersized windows. |
| **P1-C** | 0-trade postmortem | Manual SQL spelunking. Check each condition's row count by hand. | `--explain` outputs per-condition match/filter counts with human labels. Shows exactly where pipeline starves. |
| **P1-D** | SQL generation | Two code paths: compiler (live) and backtester (PIT). Differences in lookback, tiebreaker, LATERAL logic — produce different results. | Single shared `buildSetupJoin()` / `buildEntryJoin()`. Backtester calls same functions with PIT timestamps. Results match exactly. |
| **P2-A** | Debugging | `SELECT count(*)` queries per table, manual cross-referencing. | `debug-temporal-alignment.js` renders Gantt chart: events × sessions × gaps × intersections at a glance. |
| **P2-B** | Data freshness | Manual `SELECT MAX(ts)` queries per table. No alerting. | `/api/health/data-clock` endpoint per-symbol lag (candles + each feature). Auto-alert on stale >30min. |
| **P3-C** | Lookback config | Developer must manually compute `lookbackBars` per condition. Wrong default = silent 0-trade. | Compiler auto-extends lookback based on spec sessions + market calendar. `lookbackBars` becomes optional. |

---

## Priority Matrix

| ID | Issue | Severity | Phase | Effort | ROI | Order |
|----|-------|----------|-------|--------|-----|-------|
| F-01 | TF-blind defaults | Critical | P1-A | 2d | 🔥🔥🔥🔥🔥 | 1 |
| F-07 | Backtester divergence | High | P1-D | 3d | 🔥🔥🔥🔥🔥 | 2 |
| F-04 | Silent 0-entry | Medium | P1-C | 1d | 🔥🔥🔥🔥 | 3 |
| F-02 | No session-gap validation | High | P1-B | 1d | 🔥🔥🔥🔥 | 4 |
| F-03 | iFVG sparseness | High | P0/P1-E | 1d | 🔥🔥🔥 | 5 |
| F-15 | Stale data clock | Medium | P2-B | 2d | 🔥🔥🔥 | 6 |
| F-06 | Temporal viz | Medium | P2-A | 2d | 🔥🔥 | 7 |
| F-05 | Registry TF-scale | Medium | Merged | 0d | - | - |
| F-08 | session_scoped monitor | Low | P2-C | 0.5d | 🔥 | 8 |
| F-16 | Silent fallback | Low | P0/P1-A | 0.25d | 🔥 | 9 |

**Effort total**: ~13 days across all phases. Phase 0: 1d, Phase 1: 7d, Phase 2: 4.5d.

---

## Key Metrics

After remediation, each strategy compile should produce:
```
Setup stage:
  htf_bias_reversal:  → 250/250 (100% pass)
  htf_choch:          →  12/250 (4.8% pass; filter: 238 no struct BOS 24h)
  htf_fvg_zone:       →   8/12  (66.7% pass; filter: 4 outside zone)
Entry stage:
  ltf_ifvg_reversal:  →   3/8  (37.5% pass; 5 no iFVG 24h)
  ltf_bos:            →   2/3  (66.7% pass; 1 no BOS)
```

Every filter shows count and reason. No silent starvations.

---

## References

| Source | Pattern Used |
|--------|-------------|
| [TFX ExampleValidator](https://www.tensorflow.org/tfx/guide/exampleval) | Pre-pipeline schema + temporal validation |
| [QuantConnect LEAN](https://www.quantconnect.com/docs/v2/writing-algorithms/) | Unified backtest+live engine |
| [Azure Health Endpoint](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring) | Data clock health monitoring |
| [Azure Anti-Patterns](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/) | Anti-pattern catalog |
| [GitHub Actions](https://github.com/features/actions) | Quality gates in CI/CD |
