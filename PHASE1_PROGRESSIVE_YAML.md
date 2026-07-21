# Phase 1: Progressive YAML Format

## Goal

Replace flat `setup[]` condition lists with sequential `steps[]` where each step declares `dependsOn`, `ttl`, and `rank`. Steps execute in order; downstream steps only see rows from upstream steps. This eliminates stale-zone contamination, ensures PIT correctness, and enables the live/backtest parity architecture.

## Status: IN PROGRESS (Week 2 of 5)

---

## Task Breakdown

### 1.1 Add `ProgressiveStep` type to shared types

**File:** `packages/shared/src/types/strategy.ts`

Add alongside `StrategyCondition`:

```typescript
export interface ProgressiveStep {
  id: string;
  feature: string;
  tf: TimeFrame;
  predicate: string;
  required: boolean;
  /** IDs of prior steps this step depends on. Empty array = root step (bias anchor). */
  dependsOn?: string[];
  /** Bars of step-tf after parent.ts to bound the lookback window. */
  lookbackBars?: number;
  /** Columns for DISTINCT ON grouping (e.g. ["direction", "zone_kind"]). */
  groupBy?: string[];
  /** Max age of this step's output in minutes. Rows older than this are discarded. */
  ttlMinutes?: number;
  /** Top-N per (symbol, groupBy) by this step's rank column. 0 = no rank limit. */
  rankLimit?: number;
  /** Rank column for ORDER BY (e.g. "rank_score DESC NULLS LAST, ts DESC"). */
  rankOrderBy?: string;
  /** Override auto-direction alignment. Default: auto-align when parent has direction. */
  autoAlignDirection?: boolean;
  /** Skip lifecycle validity window (like ignoreLifecycle in StrategyCondition). */
  ignoreLifecycle?: boolean;
}
```

Update `StrategySpec`:

```typescript
export interface StrategySpec {
  // ... existing fields ...

  /** Progressive steps replace flat setup[] for new specs. Legacy setup[] still supported. */
  steps?: ProgressiveStep[];

  /** LEGACY: flat condition list. Kept for backward compat. New specs use steps[]. */
  setup: StrategyCondition[];
  entry: StrategyCondition[];
}
```

**Definition of done:**
- `ProgressiveStep` type exported from `@tm/shared`
- `StrategySpec` has optional `steps` field
- Union type `StrategySpecVersion = "v1" | "v2"` or auto-detect `steps` presence

### 1.2 Add DAG validation to validateSpec()

**File:** `packages/strategies/src/validate.ts`

Add new validators:

1. **Cycle detection**: Walk `dependsOn` graph, reject if cycle found
2. **Dangling reference**: Reject if `dependsOn` references unknown step ID
3. **Root step check**: At least 1 step must have `dependsOn: []` or `dependsOn: undefined`
4. **Entry step check**: If `steps` present, `entry` conditions must also use `dependsOn` referencing a step ID
5. **TTL check**: `ttlMinutes` must be a positive integer if set
6. **Rank limit check**: If `rankLimit` set, `rankOrderBy` is required

Signature:

```typescript
export function validateProgressiveSpec(spec: StrategySpec): string[] {
  if (!spec.steps || spec.steps.length === 0) return []; // legacy
  const errors: string[] = [];
  // ... cycle detection via DFS ...
  // ... ref checking ...
  return errors;
}
```

**Definition of done:**
- DAG cycle detection catches `A→B→C→A`
- Dangling ref catches `dependsOn: [nonexistent]`
- Missing root step caught
- All existing legacy specs pass (0 errors)
- Test cases in `validate.test.ts`

### 1.3 Add compileProgressiveSQL() to compiler

**File:** `packages/strategies/src/compiler.ts`

New function that generates sequential CTE chain from `steps[]`:

```typescript
export function compileProgressiveSQL(
  spec: StrategySpec,
  opts: CompileOptions = {}
): string
```

**Logic:**

1. **Topological sort**: Order steps by `dependsOn` (Kahn's algorithm). Root steps (no deps) first.
2. **Root step CTE**: `SELECT DISTINCT ON (symbol) ... FROM feature WHERE tf='X' AND predicate ... ORDER BY symbol, ts DESC`
3. **Dependent step CTE**: `SELECT DISTINCT ON (child.symbol, child.groupBy) ... FROM feature child JOIN parent_step parent ON child.symbol = parent.symbol WHERE child.ts >= parent.ts AND child.ts <= parent.ts + lookback AND child.direction = parent.direction (auto-align) AND lifecycle_validity ... ORDER BY ...`
4. **Chain propagation**: Each step's output columns get aliased (`stepId_columnName`) for downstream reference.
5. **Entry CTE**: Generated from existing `entry[]` conditions but pinned to the last step's timestamp.
6. **Signal SELECT**: Same as today — pricing + ATR + risk formulas.

**Direction auto-alignment:**
- If parent step outputs `direction` (or `bias_direction`), and child step has a `direction` column, auto-add `child.direction = parent.direction` to WHERE.
- Unless `autoAlignDirection: false` on child.

**Lifecycle freshness:**
- Use same `buildFreshnessPredicate()` from `sqlBuilder.ts`.
- For level features (zones, iFVGs, OBs), add `(invalidated_at IS NULL OR invalidated_at > parent.ts)`.

**TTL enforcement:**
- If `ttlMinutes` set on a step, add `AND step.ts >= NOW() - INTERVAL 'X minutes'` in live mode.
- In PIT mode, TTL is implicit (the backtest window bounds it).

**Rank limiting (future):**
- If `rankLimit` set, wrap CTE in a subquery with `ROW_NUMBER() OVER (PARTITION BY symbol, groupBy ORDER BY rankOrderBy) AS rn WHERE rn <= rankLimit`.

**Dispatch:**

```typescript
export function compileStrategy(spec: StrategySpec, opts: CompileOptions = {}): CompiledStrategy {
  if (spec.steps && spec.steps.length > 0) {
    return compileProgressiveStrategy(spec, opts);
  }
  // legacy path unchanged
  return compileLegacyStrategy(spec, opts);
}
```

**Definition of done:**
- `compileProgressiveSQL()` generates valid PostgreSQL for a 2-step chain (e.g. `htf_bias → supply_zone`)
- No syntax errors when EXPLAIN'd
- Direction auto-alignment works (bearish bias → bearish zone only)
- Entry conditions pin correctly to last step's timestamp

### 1.4 Wire progressive into PIT backtester

**File:** `scripts/backtest-pit-v2.js`

1. Detect if spec has `steps` → use progressive compilation path
2. Pass `opts.mode = "pit"` for PIT-correct SQL generation
3. Validate progressive output against legacy output for `five_one_scalp_staged_v1` (which has both `staged` and legacy `setup/entry` — not the same but can compare row counts)

**Definition of done:**
- `backtest-pit-v2.js XAUUSD 90 watukushay_no1 --mode=shadow` runs with progressive compilation
- Results table created with `executed > 0` (signals found)
- No crash or SQL error

### 1.5 Convert lewis_kelly_smc_ny_shorts.yaml to progressive

**File:** `packages/strategies/src/specs/lewis_kelly_smc_ny_shorts.yaml`

Current spec (read it first). Add `steps:` replacing flat setup with sequential:

```yaml
steps:
  - id: bias
    feature: features_bias
    tf: 15m
    predicate: "direction = 'bearish'"
    required: true
    # root step — no dependsOn

  - id: htf_bias_agreement
    feature: features_htf_bias
    tf: 1h
    predicate: "direction = 'bearish' AND state = 'active'"
    dependsOn: [bias]
    required: true

  - id: supply_zone
    feature: features_zone
    tf: 15m
    predicate: "zone_kind = 'supply' AND direction = 'bearish'"
    dependsOn: [bias]
    lookbackBars: 48
    required: true
    # Auto-align: supply_zone.direction = bias.direction (= 'bearish')
    # Lifecycle: invalidated_at > bias.ts

  - id: sweep_confirm
    feature: features_sweep
    tf: 5m
    predicate: "direction = 'bearish'"
    dependsOn: [supply_zone]
    lookbackBars: 12
    required: true
    # sweep_confirm.ts >= supply_zone.ts
    # sweep_confirm.ts <= supply_zone.ts + 12*5min = 60min

entry:
  - id: ltf_bos
    feature: features_structure
    tf: 1m
    predicate: "event_type = 'bos' AND direction = 'bearish'"
    dependsOn: [sweep_confirm]
    required: true
```

Keep legacy `setup/entry` lists for backward compat during transition.

**Definition of done:**
- `validateSpec(lewis_kelly_smc_ny_shorts)` passes (0 errors)
- Progressive SQL compiles and returns rows
- Backtest produces at least 1 trade

### 1.6 Convert keylevel_bounce_v1 to progressive

**File:** `packages/strategies/src/specs/keylevel_bounce_v1.yaml`

This spec was truncated when I read it. Need to read the full file first and check current content. Based on what was visible:

```yaml
steps:
  - id: bias
    feature: features_bias
    tf: 15m
    predicate: "direction != 'neutral'"
    required: true

  - id: key_zone
    feature: features_zone
    tf: 15m
    predicate: "zone_kind IN ('demand', 'supply') AND fill_pct < 0.8"
    dependsOn: [bias]
    lookbackBars: 48
    required: true

  - id: structure_break
    feature: features_structure
    tf: 15m
    predicate: "event_type IN ('bos', 'mss')"
    dependsOn: [bias]
    lookbackBars: 24
    required: true
```

Keep legacy setup/entry for backward compat.

### 1.7 Create spec migration guide

**File:** `docs/spec-migration-guide.md`

Document:

1. **When to migrate**: New specs MUST use progressive format. Legacy specs SHOULD migrate when actively maintained.
2. **Rules**:
   - `dependsOn: []` for root steps (bias, context)
   - `dependsOn: [parentId]` for dependent steps (zones after bias, sweeps after zone)
   - `lookbackBars` bounds how far after parent.ts to search
   - Direction auto-aligns when both parent and child have direction
   - Lifecycle freshness auto-applied for level features
3. **Migration checklist**:
   - Copy `setup[]` conditions to `steps[]`
   - Identify root step (usually bias or direction_state)
   - Add `dependsOn` to each non-root step
   - Add `lookbackBars` for temporal bounds
   - Keep legacy `setup[]` and `entry[]` until progressive path is verified
   - Remove legacy lists after parity confirmed
4. **Validation**:
   - `validateSpec()` catches cycle errors
   - `pnpm db:seed:check` validates before DB insertion
   - Parity verify: compare backtest results

### 1.8 Test all 13 active specs for regressions

| Spec | Active? | Type |
|------|---------|------|
| lewis_kelly_smc_ny_shorts | Yes | SMC |
| keylevel_bounce_v1 | Yes | Zone reversal |
| keylevel_bounce_v1_4r | Yes | Zone reversal |
| watukushay_no1 | Yes | MA cross |
| orb_classic | Yes | ORB |
| orb_scalper_1m | Yes | ORB |
| gold_9sma_scalper_1m | Yes | Scalper |
| gold_anti_bias_sniper_v1 | Yes | Sniper |
| smart_risk_ob_ifvg_1m | Yes | OB/iFVG |
| smart_risk_ob_ifvg_1m_runon_15r | Yes | OB/iFVG |
| smart_risk_ob_ifvg_1m_runon_15r_ob_tp | Yes | OB/iFVG |
| smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp | Yes | OB/iFVG |
| gold_mssnr_scalper_1m | Yes | Scalper |

Run `pnpm db:seed:check` after each conversion → must pass.

---

## Timeline

| Day | Task | Owner |
|-----|------|-------|
| Mon | 1.1 Add `ProgressiveStep` type | Code |
| Mon | 1.2 DAG validation in `validateSpec()` + tests | Code |
| Tue | 1.3 `compileProgressiveSQL()` — root step only | Code |
| Tue | 1.3 `compileProgressiveSQL()` — 2-step chain | Code |
| Wed | 1.3 `compileProgressiveSQL()` — n-step + entry + signal | Code |
| Wed | 1.3 Wire `compileStrategy()` dispatch (auto-detect) | Code |
| Wed | 1.4 Wire into PIT backtester | Code |
| Thu | 1.5 Convert lewis_kelly_smc_ny_shorts | Spec |
| Thu | 1.6 Convert keylevel_bounce_v1 | Spec |
| Fri | 1.7 Write migration guide | Docs |
| Fri | 1.8 Test all active specs for regressions | Test |
| Fri | Run `pnpm verify:parity` on first converted specs | Test |

---

## Success Criteria

1. **SQL compiles**: `SELECT * from compileProgressiveSQL(spec)` produces valid PostgreSQL
2. **Signals found**: Backtest on lewis_kelly_smc produces >0 trades (was 0)
3. **No regressions**: All existing legacy specs still compile and pass seed validation
4. **Backward compat**: `steps` optional — any spec without `steps` falls through to legacy path
5. **DAG safety**: Cycle in `dependsOn` caught at seed time, never reaches DB

## Rollback

- Delete `steps` field from YAML → spec uses legacy path immediately
- `git checkout` any converted spec file
- `compileStrategy()` checks `spec.steps?.length` — empty = legacy
