# Progressive SQL Migration Guide

## Overview

Progressive SQL replaces the flat `setup[]` array with `steps[]` — a DAG-chained CTE pipeline. Each step fetches one feature table, anchored to the previous step's output via LATERAL JOIN. Direction flows through the chain.

## Schema: `setup[]` → `steps[]`

### Flat (old)

```yaml
setup:
  - id: trend_bias
    feature: features_bias
    tf: 1h
    predicate: direction != 'neutral'
    required: true
  - id: htf_zone
    feature: features_zone
    tf: 15m
    predicate: zone_kind IN ('demand', 'supply') AND fill_pct < 0.95
    required: true
  - id: ifvg_confirmation
    feature: features_ifvg
    tf: 15m
    predicate: fvg_status = 'active'
    required: true
```

### Progressive (new)

```yaml
steps:
  - id: trend_bias          # Root step — no dependsOn
    feature: features_bias
    tf: 1h
    predicate: direction != 'neutral'
    required: true

  - id: htf_zone            # Child step — anchored to trend_bias
    feature: features_zone
    tf: 15m
    predicate: zone_kind IN ('demand', 'supply') AND fill_pct < 0.95
    required: true
    dependsOn: [trend_bias]
    ttlMinutes: 240

  - id: ifvg_confirmation   # Child step — DAG fan-out from same parent
    feature: features_ifvg
    tf: 15m
    predicate: fvg_status = 'active'
    required: true
    dependsOn: [trend_bias]
    autoAlignDirection: true
    ttlMinutes: 120
```

### Key differences

| Aspect | Flat `setup[]` | Progressive `steps[]` |
|--------|---------------|----------------------|
| Semantics | All conditions are independent LATERALs anchored to the same bias anchor | Linear chain — each step filters rows from previous step's output |
| Direction | Cross-referenced via `features_bias.direction` in predicates | Inherited via `autoAlignDirection` (default: true) |
| TTL | Implicit (lookback interval) | Explicit `ttlMinutes` per step |
| Cross-condition refs | `features_bias.direction` allowed | NOT allowed — use `autoAlignDirection` instead |
| Fan-out | N/A | Multiple children can depend on same parent |
| Backtester | `compileFullSQL()` | `compileProgressiveSQL()` (auto-detected via `spec.steps?.length`) |

## Conversion Rules

### Rule 1: Root step has no `dependsOn`

First step is always the bias/root. Example: `features_bias@1h`.

```yaml
- id: trend_bias
  feature: features_bias
  tf: 1h
  predicate: direction != 'neutral'
  required: true
```

### Rule 2: Remove cross-table references in predicates

Flat predicates often reference `features_bias.direction`:

```yaml
# FLAT — DO NOT USE IN PROGRESSIVE
predicate: |
  (features_bias.direction = 'bullish' AND position IN ('discount', 'deep_discount'))
```

In progressive, the compiler doesn't resolve `features_bias.direction` (no `features_bias` alias in scope). Instead:

```yaml
# PROGRESSIVE — all valid positions, direction handled by chain
predicate: position IN ('discount', 'deep_discount', 'equilibrium', 'premium', 'deep_premium')
autoAlignDirection: false    # pricing has no direction column
```

### Rule 3: `autoAlignDirection` behavior

| Feature | Has `direction` column? | `autoAlignDirection` |
|---------|------------------------|---------------------|
| `features_bias` | Yes | true (default) |
| `features_zone` | Yes | true |
| `features_structure` | Yes | true |
| `features_pricing` | No | false — must set explicitly |
| `features_moving_average` | No | false — must set explicitly |
| `features_ifvg` | Yes | true |
| `features_indicator` | No | false — must set explicitly |
| `features_opening_range` | Yes | true |

### Rule 4: Entry predicates can't cross-reference

Entry conditions previously used `direction = features_bias.direction`:

```yaml
# FLAT — DO NOT USE
predicate: event_type IN ('bos', 'mss') AND direction = features_bias.direction
```

Progressive chain guarantees direction alignment. Simplify:

```yaml
# PROGRESSIVE — direction guaranteed by chain
predicate: event_type IN ('bos', 'mss')
```

For direction-specific entries (shorts-only, longs-only), keep the direction literal:

```yaml
predicate: event_type IN ('bos', 'mss') AND direction = 'bearish'
```

### Rule 5: Use `ttlMinutes` for temporal decay

Flat compiler used implicit lookback intervals. Progressive steps have explicit TTL:

- 15m feature steps: `ttlMinutes: 30` (2 bars of tolerance)
- 1h feature steps: `ttlMinutes: 120` (2 bars)
- Zone steps: `ttlMinutes: 240` (4 hours — zones persist longer)

TTL is relative to the parent step's timestamp. A row in the child step must have `ts >= parent.ts - ttlMinutes`.

### Rule 6: Entry conditions stay flat

The `entry[]` array format is unchanged. Entry conditions anchor to the last step in the chain.

```yaml
entry:
  - id: structure_break
    feature: features_structure
    tf: 15m
    predicate: event_type IN ('bos', 'mss')
    required: true
```

## Converted Specs Reference

| Spec | Steps Chain | TTLs |
|------|------------|------|
| `lewis_kelly_smc_ny_shorts` v2.0.0 | mtf_bias(15m) → htf_bias(4h,480m) → premium_pricing(30m) → supply_retest(240m) | 30/240/480 |
| `keylevel_bounce` v2.0.0 (base) | trend_bias(1h) → directional_zone(15m,30m,no-dir) → htf_zone(15m,240m) | 30/240 |
| `keylevel_bounce_v4` v5.0.0 | trend_bias(1h) → htf_bias(4h) → directional_zone(15m,30m,no-dir) → htf_zone(15m,240m) | 30/240 |
| `keylevel_bounce_v5_shorts` v6.0.0 | trend_bias(bearish,1h) → directional_zone(30m,no-dir) → htf_zone(240m) | 30/240 |
| `keylevel_bounce_v5_longs` v6.0.0 | trend_bias(bullish,1h) → directional_zone(30m,no-dir) → htf_zone(240m) | 30/240 |
| `watukushay_no1` v2.0.0 | bias(1h) → ma_fast(1h,no-dir) → ma_slow(1h,no-dir) | (none) |

## Variant Inheritance

Variants that DON'T override `setup[]` automatically inherit `steps[]` from the base:

```yaml
# keylevel_bounce_v1.yaml — NO setup override, inherits base steps
id: keylevel_bounce_v1
familyId: keylevel_bounce
overrides:
  risk:
    sl: 40 pips
```

Variants that DO override `setup[]` must override `steps[]` instead:

```yaml
# keylevel_bounce_v1_4r.yaml — overrides steps + entry
overrides:
  steps:
    - id: trend_bias
      ...
  entry:
    - id: structure_break
      ...
```

## Backtester Compatibility

No backtester changes needed. `compileStrategy()` auto-detects progressive vs flat:

```typescript
// compiler.ts line 133
const sql = spec.steps?.length ? compileProgressiveSQL(spec, opts) : compileFullSQL(spec, opts);
```

The backtester calls `compileStrategy(spec, { mode: "pit", ... })` — same API. Resulting SQL has different CTE structure but same signal SELECT contract.

## Validation

Progressive specs go through `validateProgressiveSpec()` which checks:

1. Exactly one root step (no `dependsOn`)
2. All `dependsOn` references point to valid step IDs (no dangling)
3. No cycles (3-color DFS)
4. `ttlMinutes >= 1` (if set)
5. `rankLimit` requires `rankOrderBy`
6. Feature exists in registry
7. Session-scoped features require `session` field
