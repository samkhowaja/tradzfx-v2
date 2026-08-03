# AI Strategy Spec Reference

> Standard reference so AI (Chat) generates correct strategy specs — no fantasy tables, columns, or functions.

---

## 1. Spec Structure (Top-Level Keys)

Every strategy spec is a YAML file in `packages/strategies/src/specs/*.yaml`. The canonical TypeScript type is `StrategySpec` in `packages/shared/src/types/strategy.ts`.

```yaml
id: my_strategy              # Required. Unique kebab-case identifier.
familyId: my_family          # Required. Groups related variants. Standalone specs set equal to id.
active: true                 # Optional. If omitted, defaults to true.
name: "My Strategy"          # Required. Human-readable name.
version: "1.0.0"             # Required. Semver string.
description: >               # Optional. Multi-line description.
category: smc                # Optional. UI tag.
setupFamily: zone_reversal   # Optional. Controls setup-engine hard rules. See §Setup Families.
warmupBars: 200              # Optional. Bars of signal-tf history skipped in backtests (default 200, min 50).

filters:                     # Required.
  symbols: [EURUSD, XAUUSD]  # Optional. Restrict to symbol list.
  sessions: [LONDON, NY]     # Optional. Session filter.
  timeWindows:               # Optional. UTC windows.
    - { utcStart: "08:00", utcEnd: "16:00" }

setup:                       # Required. Array of StrategyCondition. Pre-entry bias/context.
  - id: my_condition
    feature: features_bias
    tf: 15m
    predicate: "direction = 'bullish'"
    required: true
    # weight: 8              # Optional. Used by setup-engine for scoring.
    # groupBy: []            # Optional. Override default equality dimensions.
    # lookbackBars: 48       # Optional. Override registry default.
    # ignoreLifecycle: false # Optional. Skip lifecycle check for level features.
    # session: london        # REQUIRED for features_opening_range (session-scoped features).

entry:                       # Required. Array of StrategyCondition. Entry-trigger events.
  - id: ltf_signal
    feature: features_structure
    tf: 5m
    predicate: "event_type = 'bos'"
    required: true

# signalSource: zone          # Optional. Defaults to "zone". Controls entry/SL/TP derivation.

risk:                        # Required.
  sl: "atr(15m) * 1.2"       # Stop-loss expression or price token.
  tp: "sl * 3.0"             # Take-profit expression or price token.
  minRR: 3.0                 # Minimum risk-reward ratio.
  timeoutBars: 120           # Max bars trade stays open.
  maxFillBars: 30            # Optional. Max bars to wait for fill.
  minSlDistancePips: 1.5     # Optional. Min distance between entry and SL in pips.
  tpOffsetPips: 0            # Optional. TP offset in pips.

gates:                       # Required. Array of gate configs.
  - name: session
    params: { allowed: [LONDON, OVERLAP, NY] }
```

---

## 2. Feature Registry (Complete)

Source of truth: `packages/strategies/src/featureRegistry.ts`. Each feature table has a contract defining its join policy, lookback defaults, and predicate-able columns.

### Join Policies

| Policy | Meaning | Feature Types |
|--------|---------|---------------|
| `latest_as_of` | Latest row at or before anchor timestamp | State features (bias, ATR, session, spread, MA, indicator, time_of_day, direction_state) |
| `active_window` | Row inside a lifecycle validity window | Level features (zone, order_block, ifvg, pivot, liquidity_pools) |
| `candidate_set` | Best matching row inside bounded lookback | Event features (structure, sweep, displacement, zone_retest, candle_pattern, time_of_day_edge) & pricing (`sample_distribution` for distribution) |
| `session_scoped` | Pinned to same UTC date + session | Opening range only |
| `sample_distribution` | Statistical sample over lookback | Correlation |

### Complete Feature List

#### State Features (`latest_as_of`)

| Table | Key Columns | Predicate-able | Notes |
|-------|-------------|----------------|-------|
| `features_bias` | `symbol, ts, tf, direction, confidence` | `direction`, `confidence` | Bias direction is the primary anchor for all signal derivation. `direction` values: `'bullish'`, `'bearish'`, `'neutral'`. |
| `features_htf_bias` | `symbol, ts, tf, direction, confidence, by_time_frame` | `direction`, `confidence`, `by_time_frame` | Higher-timeframe bias. `by_time_frame` indicates which tf the bias came from. |
| `features_direction_state` | `symbol, ts, tf, direction, regime, state, agreement, score` | `direction`, `regime`, `state`, `agreement`, `score` | Reconciled direction + regime classifier. `regime`: `'trending'`/`'ranging'`/`'volatile'`. `state`: `'bullish'`/`'bearish'`/`'neutral'`. `agreement`: boolean (bias == htf_bias). |
| `features_atr` | `symbol, ts, tf, period, value` | `period`, `value` | ATR values. Can predicate on period (e.g. `period = 5`). |
| `features_session` | `symbol, ts, session` | `session` | Current trading session. Values: `'ASIA'`, `'LONDON'`, `'OVERLAP'`, `'NY'`, `'OFF_HOURS'`. |
| `features_spread` | `symbol, ts, tf, spread` | `spread` | Spread in pips. Read `@1m` only. |
| `features_pricing` | `symbol, ts, tf, position` | `position` | Position relative to market structure. Values: `'premium'`, `'deep_premium'`, `'equilibrium'`, `'discount'`, `'deep_discount'`. |
| `features_moving_average` | `symbol, ts, tf, ma_type, period, value` | `ma_type`, `period`, `value` | `ma_type`: `'sma'`, `'ema'`. |
| `features_indicator` | `symbol, ts, tf, indicator_name, period, value` | `indicator_name`, `period`, `value` | Generic indicator table. |
| `features_time_of_day` | `symbol, ts, value` | `value` | Numeric time-of-day encoding (0-1). |

#### Level Features (`active_window` — lifecycle-managed)

| Table | Key Columns | Predicate-able | Lifecycle |
|-------|-------------|----------------|-----------|
| `features_zone` | `symbol, ts, tf, zone_kind, top, bottom, fill_pct, direction, grade` | `zone_kind`, `direction`, `fill_pct`, `is_fresh`, `grade` | `zone_kind`: `'supply'`, `'demand'`, `'fvg'`. `is_fresh` checks lifecycle. `fill_pct` is 0-1. `grade`: `'MAJOR'`, `'MEDIUM'`, `'MINOR'`. |
| `features_order_block` | `symbol, ts, tf, ob_kind, top, bottom, degree` | `ob_kind`, `degree` | `ob_kind`: `'bullish'`, `'bearish'`. `degree`: `'major'`, `'swing'`, `'minor'`. |
| `features_ifvg` | `symbol, ts, tf, direction, top, bottom, fill_pct` | `direction`, `fill_pct`, `is_fresh` | Inverse FVG. `is_fresh` checks lifecycle invalidated_at. |
| `features_pivot` | `symbol, ts, tf, kind, price, confidence` | `kind`, `price`, `confidence` | `kind`: `'high'`, `'low'`. Point-in-time (no lifecycle columns). |
| `features_liquidity_pools` | `symbol, ts, tf, price, strength, recent_sweep_matched` | `recent_sweep_matched`, `strength` | No `direction` column. `recent_sweep_matched`: boolean. |

#### Event Features (`candidate_set` — bounded lookback)

| Table | Key Columns | Predicate-able | Notes |
|-------|-------------|----------------|-------|
| `features_structure` | `symbol, ts, tf, event_type, direction` | `event_type`, `direction` | `event_type`: `'choch'`, `'mss'`, `'bos'`. |
| `features_sweep` | `symbol, ts, tf, direction, kind` | `direction`, `kind` | `kind`: `'swing_high'`, `'swing_low'`, `'double_top'`, `'double_bottom'`, `'trendline'`. |
| `features_displacement` | `symbol, ts, tf, direction, grade, strength_score` | `direction`, `grade`, `strength_score` | `grade`: `'LOW'`, `'MEDIUM'`, `'HIGH'`. |
| `features_zone_retest` | `symbol, ts, tf, zone_kind, direction, wick_into_zone, close_inside_zone` | `zone_kind`, `direction`, `wick_into_zone`, `close_inside_zone` | Retest events. `wick_into_zone`/`close_inside_zone`: boolean. |
| `features_candle_pattern` | `symbol, ts, tf, pattern_name, direction, confidence` | `pattern_name`, `direction`, `confidence` | Candle pattern recognition. |
| `features_time_of_day_edge` | `symbol, ts, tf, edge, session, score` | `edge`, `session`, `score` | Time-of-day edge statistics. |

#### Session-Scoped Feature

| Table | Key Columns | Predicate-able | Notes |
|-------|-------------|----------------|-------|
| `features_opening_range` | `symbol, ts, tf, date, range_minutes, session, high, low, midpoint` | `high`, `low`, `midpoint` | **MUST declare `session: asia|london|ny`** on the condition. Default range_minutes determined by signal tf. |

#### Distribution Features

| Table | Key Columns | Predicate-able | Notes |
|-------|-------------|----------------|-------|
| `features_correlation` | `symbol, ts, tf, reference_symbol, correlation_1h, correlation_4h, correlation_1d` | `correlation_1h`, `correlation_4h`, `correlation_1d`, `reference_symbol` | Statistical correlation. |

### Freshness Windows (State Features)

Default per-timeframe freshness in minutes:

| TF | Minutes |
|----|---------|
| 1m | 3 |
| 5m | 7 |
| 15m | 20 |
| 1h | 70 |
| 4h | 280 |
| 1d | 1440 |

---

## 3. Predicate Language

Specs use SQL-like predicate strings. The compiler translates them into SQL WHERE clauses.

### Operators

| Operator | Example | Meaning |
|----------|---------|---------|
| `=` | `direction = 'bullish'` | Equality |
| `!=` / `<>` | `direction != 'neutral'` | Inequality |
| `IN` | `event_type IN ('bos', 'mss')` | Set membership |
| `NOT IN` | `zone_kind NOT IN ('fvg')` | Set exclusion |
| `AND` | `fill_pct < 0.8 AND is_fresh = true` | Conjunction |
| `OR` | `position = 'premium' OR position = 'discount'` | Disjunction |
| `<`, `>`, `<=`, `>=` | `fill_pct >= 0.5`, `value > 0` | Comparison |

### Cross-Table References

Conditions can reference values from other conditions using the `feature_table.column` syntax:

```yaml
# features_zone condition referencing features_bias direction:
predicate: "zone_kind = features_bias.direction"

# features_ifvg condition referencing features_bias:
predicate: "direction = features_bias.direction"
```

**Available cross-references:** Only works for earlier conditions' `direction` column (specifically `features_bias.direction`, `features_htf_bias.direction`). The anchor bias condition is always the first bias condition in the `setup` array.

### Valid Values by Column

| Column | Valid Values |
|--------|--------------|
| `direction` | `'bullish'`, `'bearish'`, `'neutral'` |
| `zone_kind` | `'supply'`, `'demand'`, `'fvg'` |
| `ob_kind` | `'bullish'`, `'bearish'` |
| `event_type` | `'choch'`, `'mss'`, `'bos'` |
| `position` (pricing) | `'premium'`, `'deep_premium'`, `'equilibrium'`, `'discount'`, `'deep_discount'` |
| `grade` (displacement/zone) | `'LOW'`, `'MEDIUM'`, `'HIGH'`, `'MAJOR'` |
| `degree` (order_block) | `'major'`, `'swing'`, `'minor'` |
| `session` (features_session) | `'ASIA'`, `'LONDON'`, `'OVERLAP'`, `'NY'`, `'OFF_HOURS'` |
| `session` (time_of_day_edge) | Same as above |
| `edge` (time_of_day_edge) | Strategy-defined edge label |
| `kind` (sweep) | `'swing_high'`, `'swing_low'`, `'double_top'`, `'double_bottom'`, `'trendline'` |
| `kind` (pivot) | `'high'`, `'low'` |
| `ma_type` | `'sma'`, `'ema'` |
| `regime` (direction_state) | `'trending'`, `'ranging'`, `'volatile'` |
| `state` (direction_state) | `'bullish'`, `'bearish'`, `'neutral'` |
| `agreement` (direction_state) | `true`, `false` |
| `is_fresh` | `true`, `false` (level features only — checks lifecycle) |
| `recent_sweep_matched` (liquidity_pools) | `true`, `false` |
| `wick_into_zone` (zone_retest) | `true`, `false` |
| `close_inside_zone` (zone_retest) | `true`, `false` |
| `pattern_name` (candle_pattern) | Strategy-defined pattern name |
| `fill_pct` | Float 0.0–1.0 |

---

## 4. Signal Sources

Controls how entry price, SL, and TP are derived. Default: `"zone"`.

| Signal Source | setupFamily Required | Feature Required | Entry Price Derivation |
|---------------|---------------------|------------------|----------------------|
| `zone` (default) | — | — | Zone bottom (bullish) or top (bearish) from `features_zone` |
| `orb` | `orb_breakout` | `features_opening_range` in setup/entry | ORB high (bullish) or low (bearish) |
| `fvg` | `fvg_continuation` | — | FVG midpoint `(top + bottom) / 2` |
| `indicator` | — | — | OTE low/high from `features_pricing` |
| `moving_average` | — | `features_moving_average` | fast MA value |

### signalSourceConfig (for `moving_average`)

```yaml
signalSource: moving_average
signalSourceConfig:
  maType: sma          # 'sma' | 'ema'
  fastPeriod: 15
  slowPeriod: 250
```

### signalSourceConfig (for `fvg`)

Controls FVG filtering. All fields optional. Defaults are engine-level.

```yaml
signalSource: fvg
signalSourceConfig:
  minFvgWidthPips: 2            # Minimum FVG width in pips. FX≥2, XAUUSD≥5 recommended.
  requireFvgStructureBreak: true  # Require BOS/CHOCH/MSS near FVG (engine default true).
  fvgStructureLookback: 4h       # Lookback for structure EXISTS join. Auto-calc from TF:
                                 # 1m→2h, 5m→4h, 15m→8h, 1h→24h. Override for custom window.
```

**Behavior:**
- `minFvgWidthPips` — filters FVGs narrower than threshold. Applied in compiler LATERAL WHERE clause. Mandatory for `signalSource: fvg` (validator enforces).
- `requireFvgStructureBreak` — default `true` adds `EXISTS(SELECT 1 FROM features_structure WHERE event_type IN ('bos','choch','mss') AND direction = f.direction AND ts BETWEEN f.ts - INTERVAL '{lookback}' AND f.ts)`. Set `false` to disable (consolidation breakouts, pre-structure FVGs). Warns on seed if disabled.
- `fvgStructureLookback` — overrides auto-calculated lookback. Format: `"4 hours"`, `"12 hours"`, `"24 hours"`. PostgreSQL interval syntax.

**Why structure-break filter:** FVGs without a nearby BOS/CHOCH/MSS are random gaps, not tradeable imbalances. Data shows structure-nearby FVGs are 5.5× wider (EURUSD 1h: 24.6 pips vs 4.4 pips without structure).

### entryConfig

```yaml
entryConfig:
  type: market          # 'market' | 'limit' | 'stop'
  zonePips: 0           # Price offset in pips from base entry level
```

---

## 5. Setup Families

Defined in `validate.ts` (`SETUP_FAMILIES`). Controls setup-engine evaluation rules.

| Value | When to Use |
|-------|-------------|
| `zone_reversal` | Zone-based SMC/Demand-Supply strategies |
| `orb_breakout` | Opening range breakout strategies. **Requires** `signalSource: orb`. |
| `fvg_continuation` | Fair value gap continuation strategies. **Requires** `signalSource: fvg`. |
| `trend_pullback` | Trend pullback / retracement strategies |
| `liquidity_sweep` | Liquidity sweep strategies |
| `indicator` | Pure indicator-based strategies |

**Validation rules:**
- `signalSource = "orb"` → `setupFamily` must be `"orb_breakout"` AND must have a `features_opening_range` condition.
- `signalSource = "fvg"` → `setupFamily` must be `"fvg_continuation"`.
- Unknown `setupFamily` values are rejected at seed time.

---

## 6. SL/TP Tokens

Used in `risk.sl` and `risk.tp`. Defined in `packages/strategies/src/riskCompiler.ts`.

### Price Tokens (resolve to a subquery)

| Token | What It Selects | Optional TF Suffix |
|-------|----------------|-------------------|
| `nearest_swing_high` | Nearest swing high above entry from `features_pivot` | `_1m`, `_5m`, `_15m`, `_1h`, `_4h`, `_1d` |
| `nearest_swing_low` | Nearest swing low below entry from `features_pivot` | Same |
| `nearest_supply_top` | Nearest supply zone top above entry | Same |
| `nearest_demand_bottom` | Nearest demand zone bottom below entry | Same |
| `nearest_supply_top_beyond_min_rr` | Supply top at minRR distance | Same |
| `nearest_demand_bottom_beyond_min_rr` | Demand bottom at minRR distance | Same |
| `nearest_bearish_ob_bottom_beyond_min_rr` | Bearish OB bottom at minRR distance | Same |
| `nearest_bullish_ob_top_beyond_min_rr` | Bullish OB top at minRR distance | Same |

### Composite Tokens (direction-aware)

| Token | Bullish Resolves To | Bearish Resolves To |
|-------|--------------------|--------------------|
| `nearest_profit_pivot` | `nearest_swing_high` | `nearest_swing_low` |
| `nearest_loss_pivot` | `nearest_swing_low` | `nearest_swing_high` |
| `opposing_zone_profit` | `nearest_supply_top` | `nearest_demand_bottom` |
| `opposing_zone_profit_beyond_min_rr` | Supply top at minRR | Demand bottom at minRR |
| `opposing_order_block_beyond_min_rr` | Bearish OB bottom at minRR | Bullish OB top at minRR |

### Named Tokens (resolve to column references)

| Token | Resolves To |
|-------|-------------|
| `orb_midpoint` | `o.midpoint` |
| `orb_high` | `o.high` |
| `orb_low` | `o.low` |
| `fvg_midpoint` | `(f.top + f.bottom) / 2.0` |
| `fvg_top` | `f.top` |
| `fvg_bottom` | `f.bottom` |
| `fvg_c1_high` | `fvg_c1.h` |
| `fvg_c1_low` | `fvg_c1.l` |
| `fvg_c1_stop` | Direction-aware candle-1 stop |
| `zone_top` | `z.top` |
| `zone_bottom` | `z.bottom` |
| `ema_fast` | `ema.fast_value` |
| `ema_slow` | `ema.slow_value` |
| `ma_fast` | `fast_ma.value` |
| `ma_slow` | `slow_ma.value` |
| `ote_low` | `p.ote_low` |
| `ote_high` | `p.ote_high` |
| `entry` | The computed entry price |

### Formula Expressions

SL/TP can be arithmetic expressions combining tokens, ATR calls, pips, and multipliers:

```yaml
sl: "atr(15m) * 1.2"           # ATR-based
sl: "10 pips"                   # Fixed pip distance
sl: "nearest_swing_high_1m"     # Price level token
tp: "sl * 3.0"                  # Multiple of SL distance
tp: "opposing_zone_profit"      # Composite level token
tp: "nearest_demand_bottom_15m" # Specific level with TF
```

**ATR syntax:** `atr(<tf>)` where `<tf>` is `1m`, `5m`, `15m`, `1h`, `4h`, or `1d`.

**Pip syntax:** `<number> pips` — auto-converts to price units using the symbol's pip size.

**SL distance:** `sl * <number>` resolves to SL distance × multiplier for TP calculation.

---

## 7. Gates

Defined in `packages/tradePipeline/src/gates/`. Each gate is listed by `name` with its `params`.

### session

```yaml
name: session
params:
  allowed: [LONDON, OVERLAP, NY]    # Required. Session labels.
  # windows: ["07:00-21:00"]        # Optional. Explicit UTC windows override.
```
Valid session labels: `ASIA`, `LONDON`, `OVERLAP`, `NY`.

### spread

```yaml
name: spread
params:
  maxSpreadPips: 3.0                # Required. Max spread in pips.
  # spreadBufferMultiple: 1.2       # Optional. Buffer on base spread (default 1.2).
```

### volatility

```yaml
name: volatility
params:
  # Mode 1 — Absolute pips:
  maxAtr5Pips: 500                   # Max ATR in pips
  minAtr5Pips: 0                     # Min ATR in pips
  sessionMaxAtr5Pips: { NY: 350 }   # Per-session max
  sessionMinAtr5Pips: { ASIA: 5 }   # Per-session min

  # Mode 2 — Percentile (asset-class-safe, recommended):
  maxAtrPercentile: 0.95             # Resolves from market_volatility_profile
  minAtrPercentile: 0.05
  sessionMaxAtrPercentile: { NY: 0.95 }
  sessionMinAtrPercentile: { ASIA: 0.05 }

  # Regime-aware relaxation:
  regimeRelax:
    enabled: true
    tf: "1h"
    agreement: true
    regimeIn: ["trending"]
    mode: "bypass"                   # 'percentile' | 'bypass'
    relaxToPercentile: 0.99          # For 'percentile' mode
```

**Valid percentiles:** `0.05`, `0.25`, `0.5`, `0.75`, `0.95`, `0.99`. Unknown values throw at load (SK-62).

### portfolioHeat

```yaml
name: portfolioHeat
params:
  maxConcurrentPerSymbol: 1          # Max positions per symbol
  maxConcurrentTotal: 3              # Max positions total
```

### rateLimit

```yaml
name: rateLimit
params:
  maxSignalsPerHour: 2               # Max signal count per hour
  maxSignalsPerDay: 5                # Max signal count per day
```

### dailyLoss

```yaml
name: dailyLoss
params:
  maxLossesPerDay: 3                 # Max losing trades per day
```

### dailyWin

```yaml
name: dailyWin
params:
  maxWinsPerDay: 5                   # Max winning trades per day
```

### familyPosition

```yaml
name: familyPosition
params:
  maxPerFamilyPerSymbol: 1           # Max active setups from same family
```

### producerFreshness (advanced)

```yaml
name: producerFreshness
params:
  action: warn                       # 'warn' | 'block' (default warn)
```

---

## 8. Session Boundaries (UTC)

From `packages/shared/src/utils/time.ts` (`DEFAULT_SESSION_WINDOWS`):

| Session | UTC Start (inclusive) | UTC End (exclusive) |
|---------|----------------------|---------------------|
| `ASIA` | 0 (midnight) | 6 |
| `LONDON` | 7 | 11 |
| `OVERLAP` | 12 | 15 |
| `NY` | 16 | 20 |
| `OFF_HOURS` | 21–23, 6–7 (between sessions) | — |

### Opening Range Session Start Hours

Used by `features_opening_range` and ORB strategies:

| Session Key (lowercase) | Start UTC Hour |
|------------------------|----------------|
| `asia` | 0 |
| `london` | 7 |
| `ny` | 16 |

---

## 9. Conditions Deep-Dive

### StrategyCondition Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique condition ID within the spec |
| `feature` | string | Yes | Feature table name (e.g. `features_bias`) |
| `tf` | TimeFrame | Yes | Timeframe: `1m`, `5m`, `15m`, `1h`, `4h`, `1d` |
| `predicate` | string | Yes | SQL-like predicate on the feature's columns |
| `required` | boolean | Yes | If `true`, condition must be satisfied for a signal |
| `weight` | number | No | Relative importance (used by setup-engine) |
| `groupBy` | string[] | No | Override default equality dimensions for DISTINCT ON |
| `lookbackBars` | number | No | Override registry default lookback in bars |
| `ignoreLifecycle` | boolean | No | Skip lifecycle check for level features |
| `session` | string | **Required for session-scoped features** | `'asia'`/`'london'`/`'ny'` (lowercase) |

### How Conditions Compile

1. **First bias condition** (`features_bias` or `features_direction_state`) becomes the **anchor** — drives the signal timestamp.
2. **All other setup conditions** become PIT LATERAL joins against the anchor timestamp.
3. **Entry conditions** become PIT LATERAL joins against the signal timestamp.
4. **Level features** (zone, order_block, ifvg) get lifecycle-freshness predicates unless `ignoreLifecycle: true`.
5. **Session-scoped features** get `date = <anchor_date>` and `session = <declared>` join conditions.
6. **State features** get freshness predicates.
7. **Event features** get bounded lookback windows.

---

## 10. Lookback Defaults by Feature

When a condition doesn't set explicit `lookbackBars`, the registry default applies:

| Feature | 1m | 5m | 15m | 1h | 4h | 1d |
|---------|----|----|-----|-----|------|------|
| `features_bias` | 24 | 12 | 8 | 8 | 6 | 4 |
| `features_htf_bias` | 24 | 12 | 8 | 8 | 6 | 4 |
| `features_direction_state` | 24 | 12 | 8 | 8 | 6 | 4 |
| `features_pricing` | 480 | 192 | 96 | 48 | 24 | 10 |
| `features_atr` | 84 | 42 | 28 | 28 | 14 | 10 |
| `features_session` | 1 | 1 | 1 | 1 | 1 | 1 |
| `features_spread` | 1 | 1 | 1 | 1 | 1 | 1 |
| `features_zone` | 480 | 192 | 96 | 48 | 24 | 10 |
| `features_order_block` | 240 | 96 | 48 | 24 | 12 | 10 |
| `features_ifvg` | 96 | 48 | 24 | 12 | 12 | 10 |
| `features_pivot` | 240 | 96 | 96 | 48 | 24 | 10 |
| `features_liquidity_pools` | 480 | 192 | 96 | 48 | 24 | 10 |
| `features_structure` | 96 | 48 | 24 | 12 | 12 | 10 |
| `features_sweep` | 96 | 48 | 32 | 16 | 12 | 10 |
| `features_displacement` | 96 | 48 | 24 | 12 | 12 | 10 |
| `features_zone_retest` | 96 | 48 | 32 | 24 | 12 | 10 |
| `features_candle_pattern` | 48 | 24 | 16 | 24 | 12 | 10 |
| `features_time_of_day_edge` | 48 | 24 | 16 | 24 | 12 | 10 |
| `features_opening_range` | 1 | 1 | 1 | 1 | 1 | 1 |
| `features_indicator` | 2 | 2 | 2 | 2 | 2 | 2 |
| `features_moving_average` | 2 | 2 | 2 | 2 | 2 | 2 |
| `features_correlation` | 480 | 192 | 96 | 96 | 48 | 20 |

---

## 11. Complete Spec Examples

### Zone-Based SMC (Lewis Kelly)

```yaml
id: lewis_kelly_smc_ny_shorts
familyId: lewis_kelly_smc
active: true
name: Lewis Kelly SMC NY Shorts
version: 1.0.0
description: "Bearish-only SMC: 15m structure sets bias, price rotates into supply, 1m CHoCH confirms."

setupFamily: zone_reversal

filters:
  symbols: [EURUSD, GBPUSD]
  sessions: [LONDON, OVERLAP, NY]

setup:
  - id: mtf_bias
    feature: features_bias
    tf: 15m
    predicate: direction = 'bearish'
    required: true

  - id: htf_bias
    feature: features_htf_bias
    tf: 4h
    predicate: direction = 'bearish'
    required: true

  - id: premium_pricing
    feature: features_pricing
    tf: 15m
    predicate: position IN ('premium', 'deep_premium')
    required: true

  - id: supply_retest
    feature: features_zone_retest
    tf: 15m
    groupBy: [zone_kind]
    predicate: zone_kind = 'supply' AND wick_into_zone = true
    required: true

entry:
  - id: ltf_choch
    feature: features_structure
    tf: 1m
    predicate: event_type IN ('choch', 'mss', 'bos') AND direction = 'bearish'
    required: true

risk:
  sl: nearest_swing_high_1m
  tp: nearest_demand_bottom_15m
  minRR: 3
  timeoutBars: 480
  maxFillBars: 60
  minSlDistancePips: 1.5

gates:
  - name: session
    params: { allowed: [LONDON, OVERLAP, NY] }
  - name: spread
    params: { maxSpreadPips: 2.0 }
  - name: volatility
    params: {}
```

### ORB Breakout

```yaml
id: orb_classic
familyId: orb_classic
setupFamily: orb_breakout
name: "ORB Classic"
version: "1.1.0"

signalSource: orb

filters:
  symbols: [EURUSD, GBPUSD, XAUUSD]
  sessions: [LONDON, NY]
  timeWindows:
    - { utcStart: "13:30", utcEnd: "15:00" }

setup:
  - id: bias
    feature: features_bias
    tf: 15m
    predicate: "direction != 'neutral'"
    required: true

  - id: session
    feature: features_session
    tf: 15m
    predicate: "session IN ('LONDON', 'OVERLAP', 'NY')"
    required: true

  - id: orb
    feature: features_opening_range
    tf: 15m
    session: london                          # REQUIRED for session-scoped!
    predicate: "1 = 1"
    required: true

entry:
  - id: displacement
    feature: features_displacement
    tf: 15m
    predicate: "grade IN ('MEDIUM', 'HIGH')"
    required: true

risk:
  sl: "orb_midpoint"
  tp: "sl * 2.0"
  minRR: 2.0
  timeoutBars: 16
  maxFillBars: 4

gates:
  - name: volatility
    params:
      maxAtrPercentile: 0.95
      sessionMaxAtrPercentile: { NY: 0.95 }
      maxAtr5Pips: 500
  - name: spread
    params: { maxSpreadPips: 3.0 }
  - name: portfolioHeat
    params: { maxConcurrentPerSymbol: 1 }
```

### iFVG Scalp (Smart Risk)

```yaml
id: smart_risk_ob_ifvg_1m
familyId: smart_risk_ob_ifvg_1m
name: "Smart Risk Scalp 1 — OB + iFVG"
version: "1.0.1"

setupFamily: zone_reversal

filters:
  symbols: [XAUUSD]
  sessions: [LONDON, OVERLAP, NY]
  timeWindows:
    - { utcStart: "08:00", utcEnd: "11:30" }
    - { utcStart: "13:30", utcEnd: "16:30" }

setup:
  - id: bias
    feature: features_bias
    tf: 15m
    predicate: "direction != 'neutral'"
    required: true
    weight: 8

  - id: htf_zone
    feature: features_zone
    tf: 15m
    predicate: "zone_kind IN ('demand', 'supply', 'fvg') AND fill_pct < 0.8 AND is_fresh = true"
    required: true
    weight: 8

  - id: htf_ob
    feature: features_order_block
    tf: 15m
    predicate: "ob_kind = features_bias.direction"
    required: false
    weight: 5

  - id: htf_sweep
    feature: features_sweep
    tf: 15m
    predicate: "direction = features_bias.direction"
    required: false
    weight: 3

  - id: pricing_filter
    feature: features_pricing
    tf: 5m
    predicate: "position IN ('premium', 'deep_premium', 'equilibrium', 'discount', 'deep_discount')"
    required: true
    weight: 1

entry:
  - id: ltf_ifvg
    feature: features_ifvg
    tf: 5m
    predicate: "direction = features_bias.direction AND fill_pct >= 0.5 AND is_fresh = true"
    required: true
    weight: 10

  - id: ltf_structure
    feature: features_structure
    tf: 5m
    predicate: "event_type IN ('bos', 'mss') AND direction = features_bias.direction"
    required: false
    weight: 5

entryConfig:
  type: market

risk:
  sl: "atr(5m) * 1.5"
  tp: "sl * 2.0"
  minRR: 2.0
  timeoutBars: 120
  maxFillBars: 30

gates:
  - name: session
    params: { allowed: [LONDON, OVERLAP, NY] }
  - name: spread
    params: { maxSpreadPips: 5.0 }
```

### Watukushay (Moving Average)

```yaml
id: watukushay_no1
familyId: watukushay
name: Watukushay No.1
version: 1.2.0

signalSource: moving_average
signalSourceConfig:
  maType: sma
  fastPeriod: 15
  slowPeriod: 250

setup:
  - id: bias
    feature: features_bias
    tf: 1h
    predicate: direction != 'neutral'
    required: true

  - id: ma_fast
    feature: features_moving_average
    tf: 1h
    predicate: ma_type = 'sma' AND period = 15 AND value > 0
    required: true

  - id: ma_slow
    feature: features_moving_average
    tf: 1h
    predicate: ma_type = 'sma' AND period = 250 AND value > 0
    required: true

entry: []

risk:
  sl: "atr(1h) * 1.5"
  tp: "sl * 2.0"
  minRR: 2.0
  timeoutBars: 48

gates:
  - name: volatility
    params:
      maxAtrPercentile: 0.95
      sessionMaxAtrPercentile: { NY: 0.95 }
      maxAtr5Pips: 500
      regimeRelax:
        enabled: true
        tf: "1h"
        agreement: true
        regimeIn: ["trending"]
        mode: "bypass"
  - name: spread
    params: { maxSpreadPips: 3 }
  - name: portfolioHeat
    params: { maxConcurrentPerSymbol: 1, maxConcurrentTotal: 3 }
  - name: session
    params: { allowed: [LONDON, OVERLAP, NY] }
  - name: rateLimit
    params: { maxSignalsPerHour: 2, maxSignalsPerDay: 5 }
```

---

## 12. Spec Variant Overrides (Base + Overrides Pattern)

Family-based variants share a base spec. Override files in `specs/` apply `overrides:` on top:

```yaml
id: smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp
familyId: smart_risk_ob_ifvg_1m          # Same family as parent
name: "Smart Risk Sniper 10R"
version: 1.0.0
overrides:                                 # Override key
  filters:
    timeWindows:
      - { utcStart: "08:00", utcEnd: "09:59" }
  setup: [...]                             # Full replacement of setup conditions
  entry: [...]                             # Full replacement of entry conditions
  entryConfig:
    type: limit
    zonePips: 0
  risk:
    sl: 10 pips
    tp: opposing_zone_profit_beyond_min_rr
    minRR: 10
    timeoutBars: 480
  gates: [...]                             # Full replacement of gates
  live:
    maxSpreadPips: 2
    maxSlippagePoints: 10
```

**Rules:**
- `overrides` replaces the parent's entire section for each key (not a deep merge).
- The `familyId` links the override to its base spec.
- The base spec is resolved by the deployment/runner; overrides only need their own `id`/`familyId`/`name`/`version`/`overrides`.

---

## 13. Common Mistakes to Avoid

### ❌ Fantasy Tables / Columns

| Don't Use | Why |
|-----------|-----|
| `features_market_regime` | Doesn't exist. Use `features_direction_state` (columns: `direction`, `regime`, `state`, `agreement`, `score`). |
| `features_volume` | Doesn't exist. |
| `features_support_resistance` | Doesn't exist. Use `features_zone` + `features_pivot`. |
| `features_trend` | Doesn't exist. Use `features_bias` + `features_htf_bias` + `features_direction_state`. |
| `features_orderflow` | Doesn't exist. |
| `features_market_structure` | Doesn't exist. Use `features_structure` (events: choch/mss/bos) + `features_bias` (state). |
| `.strength_score` on `features_candle_pattern` | Column doesn't exist in that table. |
| `.value` on `features_bias` | Column doesn't exist. Use `direction`, `confidence`. |
| `.period` on `features_correlation` | Column doesn't exist. |
| `.direction` on `features_liquidity_pools` | Column doesn't exist. Use `recent_sweep_matched`, `strength`. |

### ❌ Wrong Join Policy

- **Level features** (`features_zone`, `features_order_block`, `features_ifvg`, `features_pivot`, `features_liquidity_pools`): Predicate on `is_fresh = true` to check lifecycle validity. In PIT mode the compiler strips `is_fresh` and uses as-of lifecycle windows.
- **State features** (`features_bias`, `features_atr`, etc.): Do NOT predicate on `is_fresh`. They use freshness windows, not lifecycle.
- **Event features** (`features_structure`, `features_sweep`, etc.): Do NOT use `is_fresh`. They use bounded lookback windows.

### ❌ Missing Session for Opening Range

Every condition on `features_opening_range` **MUST** declare `session: asia|london|ny` (lowercase). Without it, the validation fails and the seed script rejects the spec.

### ❌ Wrong Session Casing

- Feature conditions' `session` field: `asia`, `london`, `ny` (lowercase — matches producer case).
- Gate `allowed` values: `ASIA`, `LONDON`, `OVERLAP`, `NY` (uppercase — matches `features_session` values).
- Spec-level `filters.sessions`: `ASIA`, `LONDON`, `OVERLAP`, `NY` (uppercase).

### ❌ ATR in Predicates

ATR values are accessed via the `sl`/`tp` expression syntax (`atr(15m) * 1.5`), not as a predicate on `features_atr`. If you need an ATR-based filter, use the `volatility` gate with percentiles.

### ❌ Cross-Table References Beyond `direction`

Only `features_bias.direction` (or `features_htf_bias.direction` / `features_direction_state.direction`) can be cross-referenced in predicates. You cannot reference arbitrary columns from other conditions.

### ❌ Invalid Percentiles in Volatility Gate

Only `0.05`, `0.25`, `0.5`, `0.75`, `0.95`, `0.99` are valid. A typo like `0.98` or `0.93` will throw at load time (SK-62 fix).

---

## 14. Validation Rules (Seed Time)

From `packages/strategies/src/validate.ts`:

| Rule | Error | When |
|------|-------|------|
| Session-scoped feature without `session:` | Error | Any condition on `features_opening_range` |
| Invalid `setupFamily` | Error | Not in `{zone_reversal, orb_breakout, fvg_continuation, trend_pullback, liquidity_sweep, indicator}` |
| `signalSource=orb` without `setupFamily=orb_breakout` | Error | Mismatch |
| `signalSource=fvg` without `setupFamily=fvg_continuation` | Error | Mismatch |
| `signalSource=orb` without `features_opening_range` condition | Error | Missing required feature |
| `warmupBars < 50` | Error | Early-window signal distortion |
| Missing `lookbackBars` | Warning | Falls back to registry default (may be narrow) |

---

## 15. Live Execution Config (Per-Spec)

The optional `live:` block at spec top level controls runtime execution parameters.
**These are per-spec, not global** — each YAML declares its own values. There is no
global `structureFreshnessMinutes` or global max positions setting.

```yaml
live:
  maxPositionsPerSymbol: 2          # Max concurrent positions per symbol (default 1)
  maxPositionsTotal: 6              # Max concurrent positions total (default 3)
  maxSpreadPips: 2                  # Overrides spread gate max for this spec only
  maxSlippagePoints: 10             # Max slippage in points (default 5)
  structureFreshnessMinutes: 30     # Max age of structure events (default 30, 0=disabled)
  profitLotBaseSize: 0.01           # Base lot for profit-based sizing (default 0.01)
  profitLotStepUsd: 100             # Profit increment that adds one more base lot
  thesisDedup:                      # See §15.2 below
    enabled: true
    conditionId: htf_zone
    maxAgeMinutes: 1440
  executionProfile:                 # See §15.3 below
    maxSlippagePoints: 15
    maxRetries: 3
```

### 15.1 `structureFreshnessMinutes` — Detail

| Property | Type | Default | Scope |
|----------|------|---------|-------|
| `structureFreshnessMinutes` | number (minutes) | 30 | Per-spec `live:` block |

**What it does:** Applies an additional WHERE clause on entry-level `features_structure`
conditions: `pit_<id>.ts >= anchor.ts - 'N minutes'`. This prevents stale structure
events (BOS/MSS/CHOCH) that happened too long before the anchor from triggering entries.
A value of `0` disables the filter entirely.

**Interaction with `ttlDirection: forward`:**

When an entry condition (either in `entry[]` or a `steps[]` step that feeds into entry)
has `ttlDirection: forward` set, the compiler **automatically skips** the
`structureFreshnessMinutes` filter for that condition. Forward TTL already bounds
the event window (events must occur after the anchor, within the TTL), so adding
`structureFreshnessMinutes` would create an unintended `MIN(ttlMinutes, structureFreshnessMinutes)`
— e.g. a 120-minute forward TTL would be silently capped to 30 minutes, destroying
valid forward-looking signals.

**Usage guidance:**

| Spec Type | `structureFreshnessMinutes` | Why |
|-----------|---------------------------|-----|
| Scalper (1m/5m entry, backward TTL or no TTL) | 15–30 | Structure events older than 15-30m are probably stale for a 1m scalper |
| Intraday (15m anchor, backward TTL) | 30–60 | Room for structure events within the same session |
| Swing (1h/4h anchor) | 60–120 or 0 | Wider windows; 0 = rely on lookbackBars alone |
| Any with `ttlDirection: forward` on entry structure | **Ignored** | Forward TTL is the sole freshness bound |
| Multiple entry structure conditions (some forward, some backward) | **Applies only to backward ones** | The compiler checks per-condition `ttlDirection` |

**Migration note (SK-24):** Existing specs that set `structureFreshnessMinutes: 30`
and have entry structure conditions without `ttlDirection: forward` retain the
30-minute cap. If you add `ttlDirection: forward` to an entry condition, the cap
is automatically removed — no need to change `structureFreshnessMinutes`.

### 15.2 `thesisDedup` — Thesis-Level Deduplication

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | false | Enable dedup |
| `conditionId` | string | — | Condition ID whose row identity forms the thesis key |
| `maxAgeMinutes` | number | 1440 (24h) | Max age of past thesis keys to check |

**What it does:** Ensures one trade per (symbol + UTC date + session window + direction +
exact feature row identity). The key is derived from the signal's `causal_lineage` at the
configured `conditionId`. Prevents the same market thesis from producing multiple trades
even if the exact price geometry differs slightly.

### 15.3 `executionProfile`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxSlippagePoints` | number | 10 | Max acceptable slippage in points |
| `maxRetries` | number | 3 | Max order retry attempts |
| `orderType` | 'market' \| 'limit' | 'market' | Preferred order type |

---

## 16. Condition-Level TTL: `ttlMinutes` + `ttlDirection`

These fields are per-condition (on `steps[]` or `entry[]`), not part of the `live:` block.
They control the lookback window for event features independently of the feature registry's
default `lookbackBars`.

```yaml
# On a ProgressiveStep:
steps:
  - id: weakness
    feature: features_structure
    tf: 5m
    ttlMinutes: 360
    ttlDirection: forward       # Default: 'backward'
    # ...

# On an entry StrategyCondition:
entry:
  - id: breakout
    feature: features_structure
    tf: 1m
    ttlMinutes: 120
    ttlDirection: forward
    # ...
```

### `ttlDirection: 'backward'` (default)

| Aspect | Behavior |
|--------|----------|
| **Window** | `pit_child.ts >= parent.ts - ttlMinutes` |
| **Use case** | Event occurred BEFORE the anchor. Standard causality: bias forms, then structure confirms. |
| **Interaction with `structureFreshnessMinutes`** | `structureFreshnessMinutes` **is applied** (further restricts the window). |

### `ttlDirection: 'forward'`

| Aspect | Behavior |
|--------|----------|
| **Window** | `pit_child.ts <= parent.ts + ttlMinutes` |
| **Use case** | Event occurs AFTER the anchor. Models "price weakness → wait for continuation" or "bias forms → wait for breakout within N minutes". |
| **Interaction with `structureFreshnessMinutes`** | `structureFreshnessMinutes` **is skipped** (forward TTL is the sole bound). |
| **Interaction with `sessionGapPaddingMinutes`** | `sessionGapPaddingMinutes` **is also skipped** (would incorrectly extend the forward window). |

### Choosing between TTL and `lookbackBars`

| Mechanism | What it bounds | Unit | When to use |
|-----------|---------------|------|-------------|
| `lookbackBars` | How far back to search (in bars of the condition's tf) | Bars | Default. Registry sets sensible values. Override when you need more/less history. |
| `ttlMinutes` | Absolute wall-clock age of the event relative to anchor | Minutes | Use when bars are misleading (low-volatility periods have fewer bars). Also required for `ttlDirection: forward`. |
| `structureFreshnessMinutes` | Absolute max age of structure events before anchor | Minutes | Additional safety cap on `features_structure`. Applied ON TOP of backward TTL/lookbackBars. **Skipped for forward TTL.** |

### `structureFreshnessMinutes` vs `ttlMinutes` — Quick Decision Guide

```
                     ┌─────────────────────────────────────┐
                     │  Entry uses features_structure?     │
                     │          (or entry step              │
                     │     depends on structure step)       │
                     └──────────┬──────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │ YES                   │ NO
                    ▼                       ▼
         ┌─────────────────────┐    No action needed.
         │ ttlDirection        │    structureFreshnessMinutes
         │ on the structure    │    does not apply.
         │ condition?          │
         └────────┬────────────┘
                  │
       ┌──────────┴──────────┐
       │ forward             │ backward or unset
       ▼                     ▼
  ┌──────────────┐    ┌──────────────────┐
  │ TTL is the   │    │ structureFresh-  │
  │ sole bound.  │    │ nessMinutes is   │
  │ structure-   │    │ APPLIED on top   │
  │ Freshness-   │    │ of lookback/TTL. │
  │ Minutes is   │    │                  │
  │ SKIPPED.     │    │ Set to 0 to      │
  │              │    │ disable, or to   │
  │ Make sure    │    │ N for max age.   │
  │ ttlMinutes   │    │                  │
  │ is correct.  │    │ Scalpers: 15-30  │
  └──────────────┘    │ Intraday: 30-60  │
                      │ Swing: 60-120/0  │
                      └──────────────────┘
```

### Real Example — CCT Rectangle Gold Scalper

```yaml
steps:
  - id: dir_structure
    feature: features_structure
    tf: 15m
    # No TTL — uses registry lookbackBars (24 bars = 6h at 15m).
    # This is the anchor step. structureFreshnessMinutes does not apply.

  - id: weakness
    dependsOn: [ dir_structure ]
    feature: features_structure
    tf: 5m
    ttlMinutes: 360
    ttlDirection: forward        # Weakness within 6h AFTER direction forms
    # structureFreshnessMinutes is SKIPPED because ttlDirection=forward

entry:
  - id: breakout
    dependsOn: [ weakness ]
    feature: features_structure
    tf: 1m
    ttlMinutes: 120
    ttlDirection: forward        # Breakout within 2h AFTER weakness forms
    # structureFreshnessMinutes is SKIPPED because ttlDirection=forward

live:
  structureFreshnessMinutes: 30  # Declared but irrelevant — both structure
                                 # conditions use forward TTL.
```

---

## 17. Timeframe Availability

| TimeFrame String | Use Case |
|-----------------|----------|
| `1m` | Entry timing, micro-structure, tight SL |
| `5m` | Entry confirmation, iFVG/structure alignment |
| `15m` | Primary bias, zone context (standard anchor) |
| `1h` | HTF bias, regime, direction_state |
| `4h` | Macro bias, HTF structure |
| `1d` | Daily range, macro direction |

The anchor bias timeframe (default `15m`) drives the signal timestamp. All other conditions are joined as PIT LATERALs.
