# TradzFX-v2 Codebase Exploration Report
**Date**: 2026-07-07 | **Thoroughness**: Medium

---

## 1. PROJECT LAYOUT & ARCHITECTURE

### Monorepo Structure (pnpm workspace)
```
tradzfx-v2/
├── apps/
│   ├── engine/              # Live trading engine + feature computation
│   │   ├── src/
│   │   │   ├── features/    # 40+ feature generators (zone, structure, bias, etc.)
│   │   │   ├── dag/         # Directed acyclic graph for execution
│   │   │   ├── worker/      # Background task workers
│   │   │   ├── ingest/      # MT5 candle ingestion
│   │   │   └── lifecycleUpdater.ts  # Feature state tracking
│   │   ├── dist/            # Compiled output
│   │   └── vitest.config.ts
│   │
│   └── web/                 # Next.js 15 App Router dashboard
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/         # Backend routes (analytics, signals, strategies, etc.)
│       │   │   ├── strategies/  # Strategy detail views
│       │   │   ├── signals/     # Signal monitoring
│       │   │   ├── analyze/     # Trade analysis
│       │   │   ├── journal/     # Trading journal
│       │   │   └── analytics/   # Metrics dashboards
│       │   ├── components/      # React components
│       │   └── lib/             # Utilities
│       ├── next.config.ts
│       └── public/
│
├── packages/                # Shared libraries
│   ├── analyzerBacktest/   # Monte Carlo, walk-forward, outcome tracking
│   │   └── src/
│   │       ├── monteCarlo.ts
│   │       ├── walkForward.ts
│   │       ├── outcomeTracker.ts
│   │       └── reportGenerator.ts
│   │
│   ├── levels/            # Entry zone & risk computation
│   │   └── src/
│   │       ├── computeEntryZone.ts
│   │       ├── computeStopLoss.ts
│   │       ├── computeTarget.ts
│   │       └── types.ts
│   │
│   ├── setupEngine/       # Setup evaluation & signal generation
│   │   └── src/
│   │       ├── rules/      # Hard/soft rule evaluators
│   │       ├── graders/    # Entry/risk quality scorers
│   │       ├── evaluateSetup.ts
│   │       ├── contextBuilder.ts
│   │       ├── calibrationTuning.ts
│   │       └── types.ts
│   │
│   ├── shared/           # Common types & utilities
│   │   └── src/
│   │       ├── types/    # feature.ts, strategy.ts
│   │       ├── utils/    # Session, pair lookups, utilities
│   │       ├── pairs/    # Pair definitions
│   │       └── lifecycle.ts
│   │
│   ├── strategies/       # Strategy compiler & spec loader
│   │   ├── src/
│   │   │   ├── compiler.ts      # YAML → compiled rules
│   │   │   ├── compiler.test.ts
│   │   │   ├── loader.ts        # DB spec loader
│   │   │   ├── dbLoader.ts
│   │   │   ├── riskCompiler.ts  # TP/SL generation
│   │   │   └── specs/           # 48 YAML strategy definitions
│   │   ├── dist/
│   │   └── vitest.config.ts
│   │
│   └── tradePipeline/    # Live order flow, gates, decisions
│       ├── src/
│       │   ├── gates/           # Risk gates (session, spread, heat, etc.)
│       │   ├── decisionGraph.ts # Order-flow decisions
│       │   ├── liveRunner.ts    # Execute signals → orders
│       │   ├── orderExecutor.ts
│       │   ├── qualityEngine.ts
│       │   ├── postFill.ts      # Position management
│       │   └── notify.ts        # Alerts
│       └── dist/
│
├── infra/
│   ├── migrations/      # 97 SQL files (001_schema → 097_risk_state)
│   ├── docker-compose.yml
│   └── nginx.conf
│
├── scripts/            # 100+ utility & execution scripts
│   ├── Core:
│   │   ├── seed-strategy-specs.js       # Load YAML specs → DB families/variants
│   │   ├── backtest-pit-v2.js           # PIT backtester main runner
│   │   ├── promote-top3-live.js         # Activate live variants
│   │   └── run-pit-*.js / run-pit-*.js
│   │
│   ├── Backfill:
│   │   ├── backfill-historical-features.js  # Compute features for past candles
│   │   ├── backfill-candles-from-mt5-csv.js
│   │   ├── backfill-htf-bias.js
│   │   ├── backfill-correlation.js
│   │   └── backfill-*.js (20+ variants)
│   │
│   ├── Debug/Analyze:
│   │   ├── pipeline-investigate*.js (10+ versions)
│   │   ├── debug-gate.js
│   │   ├── dry-run-live.ts
│   │   └── analyze-*.js
│   │
│   └── Misc: migrate.ts, check-db-time.js, compare-mt5-*.js, etc.
│
├── data/
│   ├── backtest-seed/    # Historical PIT reports
│   │   ├── historical-pit-90d/
│   │   └── walkforward-30d-15d/
│   └── video-strategy-*/  # Video analysis snapshots
│
├── reports/            # Trade analysis reports, variant performance
├── mt5-ea/             # MT5 EAs (execution bridge, sync, manager)
├── ops/                # Operational scripts (health checks, restarts, calibration)
└── docs/
    ├── ui-redesign*.md
    ├── graphify/       # Codebase knowledge graph snapshots
    └── proposals/
```

---

## 2. STRATEGY SPECS: YAML STRUCTURE & FAMILIES

### Location
```
packages/strategies/src/specs/
├── *.yaml                       # 48 canonical strategy definitions
```

### Strategy Families & Variants (48 Total)

#### **Family: keylevel_bounce** (13 variants)
Core bounce strategy targeting key levels. Variants test price position, time filters, and TP methods.

| ID | familyId | Description |
|----|----------|-------------|
| `keylevel_bounce` | keylevel_bounce | Base (v0) |
| `keylevel_bounce_v1` | keylevel_bounce | Short-only, fixed 50 pips SL |
| `keylevel_bounce_v1_4r` | keylevel_bounce | 4:1 risk-reward min |
| `keylevel_bounce_v1_limit` | keylevel_bounce | Limit entry variant |
| `keylevel_bounce_v1_wider` | keylevel_bounce | Wider entry zone |
| `keylevel_bounce_v1_fx` | keylevel_bounce | FX-optimized |
| `keylevel_bounce_v2` | keylevel_bounce | Trend filter added |
| `keylevel_bounce_v3` | keylevel_bounce | Structure break entry |
| `keylevel_bounce_v4` | keylevel_bounce | HTF bias enhanced |
| `keylevel_bounce_v5_longs` | keylevel_bounce | Long-only directional |
| `keylevel_bounce_v5_shorts` | keylevel_bounce | Short-only directional |
| `keylevel_bounce_v6_ny_overlap_shorts` | keylevel_bounce | NY/London hours, shorts |
| `keylevel_bounce_v7_shorts_time` | keylevel_bounce | Time-based session filter |
| `keylevel_bounce_v8_levels` | keylevel_bounce | Pivot TP method (nearest_profit_pivot) |
| `keylevel_bounce_v8b_zone_tp` | keylevel_bounce | Zone-based TP |
| `keylevel_bounce_v8c_min3` | keylevel_bounce | Min 3-bar confirmation |

#### **Family: smart_risk_ob_ifvg_1m** (24 variants) ⭐ LARGEST FAMILY
Order block + IFVG confluence with extreme risk/reward testing. Focus: 1m timeframe, sniper 10R configs.

| ID | familyId | Description |
|----|----------|-------------|
| `smart_risk_ob_ifvg_1m` | smart_risk_ob_ifvg_1m | Base |
| `smart_risk_ob_ifvg_1m_3r` | smart_risk_ob_ifvg_1m | 3:1 min RR |
| `smart_risk_ob_ifvg_1m_runon` | smart_risk_ob_ifvg_1m | Run-on candle entry |
| `smart_risk_ob_ifvg_1m_runon_15r` | smart_risk_ob_ifvg_1m | 15:1 extreme RR |
| `smart_risk_ob_ifvg_1m_runon_15r_age15` | smart_risk_ob_ifvg_1m | +age filter (15 bars) |
| `smart_risk_ob_ifvg_1m_runon_15r_notight` | smart_risk_ob_ifvg_1m | Relaxed entry |
| `smart_risk_ob_ifvg_1m_runon_15r_notight_origwindow` | smart_risk_ob_ifvg_1m | Orig window retest |
| `smart_risk_ob_ifvg_1m_runon_15r_ob_tp` | smart_risk_ob_ifvg_1m | OB body TP |
| `smart_risk_ob_ifvg_1m_runon_15r_zone_tp` | smart_risk_ob_ifvg_1m | Zone TP (nearest) |
| `smart_risk_ob_ifvg_1m_sniper_10r` | smart_risk_ob_ifvg_1m | Sniper 10:1 variant |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply` | smart_risk_ob_ifvg_1m | +demand/supply filter |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_ob_tp` | smart_risk_ob_ifvg_1m | demand + OB TP |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_15m_tp` | smart_risk_ob_ifvg_1m | +15m pivot TP |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_1h_tp` | smart_risk_ob_ifvg_1m | +1h pivot TP |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_pivot_5m_tp` | smart_risk_ob_ifvg_1m | +5m pivot TP |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_profit` | smart_risk_ob_ifvg_1m | Zone profit target |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp` | smart_risk_ob_ifvg_1m | Zone TP (nearest) |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_1h` | smart_risk_ob_ifvg_1m | +1h context |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_5m` | smart_risk_ob_ifvg_1m | +5m context |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx` | smart_risk_ob_ifvg_1m | FX pair optimized |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_ifvgfilter` | smart_risk_ob_ifvg_1m | IFVG strict filter |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_ifvgfilter_loose` | smart_risk_ob_ifvg_1m | IFVG loose filter |
| `smart_risk_ob_ifvg_1m_sniper_10r_zone_tp` | smart_risk_ob_ifvg_1m | Zone TP (min RR) |

#### **Family: watukushay** (3 variants)
Custom strategy with FE and no-1 variants.

| ID | familyId | Description |
|----|----------|-------------|
| `watukushay` | watukushay | Base |
| `watukushay_fe` | watukushay | Front-end optimized |
| `watukushay_no1` | watukushay | **LIVE** |

#### **Other Single-Variant Families**
- `doyle_sd` — **LIVE**, Multi-timeframe SD zones + displacement
- `orb_classic` — **LIVE**, Opening Range Breakout
- `forex_strategy_orb` — ORB variant (1 variant)
- `scarface_5m_orb` — 5m ORB (1 variant)
- `xauusd_v1` — Gold-specific (1 variant)
- `waqar_v2` — Waqar's custom setup (1 variant)
- `smart_risk_ob_ifvg_1m_3r` — OB/IFVG 3R variant (exists as standalone)

### YAML Spec Format Example
```yaml
id: keylevel_bounce_v8_levels
familyId: keylevel_bounce
active: true
name: Key-Level Bounce V8 (level-based TP)
version: 8.0.0
description: Short-only key-level bounce...
overrides:
  filters:
    sessions: [OVERLAP, NY]
  setup:
    - id: trend_bias
      feature: features_bias
      tf: 1h
      predicate: "direction = 'bearish'"
      required: true
    - id: directional_zone
      feature: features_pricing
      tf: 15m
      predicate: "position IN ('premium', 'deep_premium', 'equilibrium')"
      required: true
  entry:
    - id: structure_break
      feature: features_structure
      tf: 15m
      predicate: "event_type IN ('bos', 'mss') AND direction = 'bearish'"
      required: true
  risk:
    tp: nearest_profit_pivot
    minRR: 1.5
    timeoutBars: 480
    tpOffsetPips: -2
  gates:
    - id: session_gate
      params: { allowedSessions: [NY, OVERLAP] }
```

---

## 3. DATABASE SCHEMA (97 Migrations)

### Schema Layers

#### **Raw Data**
| Table | Purpose | Key Columns |
|-------|---------|-----------|
| `candles_1m` | 1-min OHLCV | (symbol, ts) PK |
| `candles_*.* (higher TFs)` | Derived via aggregates | — |

#### **Feature Tables (20+)**
| Table | Purpose | Generator Location |
|-------|---------|---------|
| `features_atr` | ATR(14, 50, 200) | apps/engine/src/features/**atr.ts** |
| `features_pivot` | Swing highs/lows | apps/engine/src/features/**pivot.ts** |
| `features_structure` | BOS, MSS, CHoCH | apps/engine/src/features/**structure.ts** |
| `features_sweep` | Liquidity sweeps | apps/engine/src/features/**sweep.ts** |
| `features_zone` | Supply/demand zones | apps/engine/src/features/**zone.ts** |
| `features_ifvg` | Internal FVG zones | apps/engine/src/features/**ifvg.ts** |
| `features_order_block` | Order block patterns | apps/engine/src/features/**orderBlock.ts** |
| `features_pricing` | Premium/discount OTE | apps/engine/src/features/**pricing.ts** |
| `features_bias` | HTF trend direction | apps/engine/src/features/**bias.ts** |
| `features_htf_bias` | Multi-TF bias tree | apps/engine/src/features/**htfBias.ts** |
| `features_moving_average` | SMA/EMA/HMA | apps/engine/src/features/**movingAverage.ts** |
| `features_indicator` | Generic indicators | apps/engine/src/features/**indicator.ts** |
| `features_correlation` | Symbol correlation (DXY) | apps/engine/src/features/**correlation.ts** |
| `features_spread` | Bid-ask spread | apps/engine/src/features/**spread.ts** |
| `features_session` | Session state | apps/engine/src/features/**session.ts** |
| `features_time_of_day_edge` | Hour-of-day bias | apps/engine/src/features/**timeOfDayEdge.ts** |
| `features_liquidity_pools` | Liquidity clusters | apps/engine/src/features/**liquidityPools.ts** |
| `features_displacement` | Candle displacement | apps/engine/src/features/**displacement.ts** |
| `features_opening_range` | OR high/low | apps/engine/src/features/**openingRange.ts** |
| `features_bollinger` | Bollinger bands | apps/engine/src/features/**bollinger.ts** |
| `features_keltner` | Keltner channels | apps/engine/src/features/**keltner.ts** |
| `features_candle_pattern` | Pinbar, engulfing, etc. | apps/engine/src/features/**candlePattern.ts** |
| `features_fvg` | **Retired** — consolidated into `features_zone` (`zone_kind = 'fvg'`). Source module removed. | apps/engine/src/features/**zone.ts** |

#### **Lifecycle & State**
| Table | Purpose | Migration |
|-------|---------|-----------|
| `feature_lifecycle` | Tracks which features are stale | 027_feature_lifecycle.sql |
| `lifecycle_refresh_state` | Per-table computation checkpoint | 043_lifecycle_per_table_checkpoint.sql |
| `pit_freshness` | PIT dataset freshness | 031_pit_freshness.sql |

#### **Strategy Admin**
| Table | Purpose | Migration |
|-------|---------|-----------|
| `strategy_families` | Top-level strategy group | 075_strategy_families_and_variants.sql |
| `strategy_variants` | Strategy variant (delta from family) | 075_strategy_families_and_variants.sql |

#### **Live Trading**
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `orders` | All orders (live & backtest) | (variant_id, symbol, ts) |
| `setup_evaluations` | Signal evaluations | (variant_id, symbol, ts) |
| `position_commands` | Close/scale commands | (order_id, command_type) |
| `live_signal` | Streamed signals | (variant_id, symbol, signal_ts) |
| `live_signal_rejection` | Gate rejections | (signal_id, gate_name, reason) |
| `live_fill` | Execution fills | (order_id, fill_price, fill_ts) |
| `decision_trace` | Debug audit trail | (order_id, decision_point, context_json) |

#### **Backtest**
| Table | Purpose | Migration |
|-------|---------|-----------|
| `backtest_runs` | PIT run metadata | 058_backtest_results.sql |
| `backtest_results` | Trade results (PIT output) | 058_backtest_results.sql |
| `backtest_results_excursions` | Intra-trade peak/trough | 078_backtest_results_excursions.sql |
| `backtest_variant_linkage` | Which variant ID generated result | 082_backtest_variant_linkage.sql |
| `backtest_results_source` | PIT vs live | 084_backtest_results_source.sql |
| `backtest_results_heat` | Daily/weekly heat tracking | 089_backtest_results_heat.sql |

#### **Market Levels**
| Table | Purpose | Migration |
|-------|---------|-----------|
| `market_levels` | Canonical support/resistance | 068_market_levels.sql |
| `market_levels_view` | Denormalized query view | 086_market_levels_view.sql |

#### **Risk & Zones**
| Table | Purpose | Migration |
|-------|---------|-----------|
| `zone_outcomes` | Historical zone outcome stats | 053_zone_outcomes.sql |
| `zone_quality_rank` | Zone quality scores | 054_zone_quality_rank.sql |
| `zone_touch_retest_counts` | Zone touch statistics | 093_zone_touch_retest_counts.sql |

### Critical Migrations
```
001_schema.sql                    # Core tables (candles, features)
075_strategy_families_and_variants.sql  # New strategy admin model
080_lifecycle_pk_fix.sql          # Lifecycle table PK fix
082_backtest_variant_linkage.sql  # Link backtest runs to variants
097_risk_state.sql                # Latest risk state tracking
```

---

## 4. FEATURE GENERATION (Apps/Engine)

### Entry Point
```
apps/engine/src/features/
├── <40+ feature generators>
├── index.ts                # Export orchestrator
└── types.ts               # Feature output types
```

### Key Generators

| Generator | Purpose | Input | Output | Complexity |
|-----------|---------|-------|--------|------------|
| **zone.ts** | Supply/demand zones + quality scoring | Candles, pivots, HTF bias | zone_kind, top, bottom, fill_pct, quality_score | ⭐⭐⭐⭐⭐ |
| **structure.ts** | Break of structure, MSS, CHoCH | Candles, pivots | event_type, direction, level | ⭐⭐⭐⭐ |
| **sweep.ts** | Liquidity sweeps (HTF extreme touch) | Candles, pivots, HTF | direction, level, extreme, close | ⭐⭐⭐⭐ |
| **ifvg.ts** | Internal FVG detection | Candles | zone_kind, top, bottom | ⭐⭐⭐ |
| **orderBlock.ts** | Order block patterns | Candles, structure | ob_type, top, bottom | ⭐⭐⭐ |
| **pivot.ts** | Swing highs/lows (zigzag) | Candles | kind, price, confidence | ⭐⭐ |
| **bias.ts** | Trend direction (bullish/bearish/choppy) | Moving averages (EMA200, SMA50) | direction, strength | ⭐⭐ |
| **htfBias.ts** | Multi-timeframe bias tree (1d→5m) | Candles (all TFs) | bias_per_tf, consensus | ⭐⭐⭐⭐ |
| **pricing.ts** | Premium/discount/equilibrium/OTE | Candles, HTF levels | position, overbought, oversold | ⭐⭐⭐ |
| **atr.ts** | Average True Range (14, 50, 200) | Candles | value (per period) | ⭐ |
| **movingAverage.ts** | SMA, EMA, HMA | Candles | value (per period) | ⭐ |
| **openingRange.ts** | OR high/low + breakout | Candles | open_high, open_low, is_breakout | ⭐⭐ |
| **liquidityPools.ts** | High-volume clusters | Candles, volume | pool_center, pool_size | ⭐⭐⭐ |
| **timeOfDayEdge.ts** | Session-hour bias | Candles, session info | edge_per_hour, is_favorable | ⭐⭐ |
| **correlation.ts** | DXY correlation | Candles, DXY | corr_value | ⭐ |
| **spread.ts** | Bid-ask spread (from orders) | Orders | spread_pips | ⭐ |
| **displacement.ts** | High-displacement candles | Candles | displacement_pct | ⭐ |
| **fvg.ts** | Fair value gap detection | Candles | fvg_zone | ⭐⭐ |
| **session.ts** | Current session label | Time, pair | session_name, session_ts | ⭐ |

### Execution Model
- **DAG-based**: `apps/engine/src/dag/` orchestrates dependencies
- **Lifecycle tracking**: `lifecycleUpdater.ts` marks features as fresh/stale
- **Incremental**: Only recompute stale features per symbol/timeframe
- **Worker pool**: Background processes in `apps/engine/src/worker/`

---

## 5. SIGNAL & SETUP GENERATION

### Entry Point: `packages/setupEngine/`

#### Modules
```
setupEngine/src/
├── evaluateSetup.ts           # Main signal evaluation logic
├── contextBuilder.ts          # Build context from features + candles
├── calibrationTuning.ts       # A/B testing parameter tuning
├── types.ts                   # Signal, Setup types
├── rules/
│   ├── hardRules.ts          # Must-pass conditions (e.g., trending)
│   └── softRules.ts          # Probabilistic filters (e.g., session bias)
└── graders/
    ├── entryQuality.ts       # Entry point score
    ├── riskQuality.ts        # TP/SL validity
    ├── trendAlignment.ts     # Trend confluence
    └── confirmation.ts       # Multi-candle confirmation
```

#### Flow
1. **contextBuilder.ts** loads:
   - Strategy spec (filters, setup, entry, gates)
   - Current candles
   - All relevant features (bias, zone, structure, etc.)

2. **evaluateSetup.ts** checks:
   - Hard rules (must-pass)
   - Soft rules (weighted)
   - Graders (quality scores)

3. **Output**: Signal with:
   - Entry price, SL, TP
   - Quality score (0–100)
   - Confidence flags

### Signal Execution: `packages/tradePipeline/`

```
tradePipeline/src/
├── gates/                     # Risk control gates
│   ├── sessionGate.ts        # Session filtering
│   ├── spreadGate.ts         # Spread tolerance
│   ├── volatilityGate.ts     # ATR-based gate
│   ├── dailyLossGate.ts      # Daily loss limit
│   ├── dailyWinGate.ts       # Daily win limit (scale down)
│   ├── rateLimitGate.ts      # Max trades/hour
│   ├── familyPositionGate.ts # Family max concurrent
│   └── portfolioHeatGate.ts  # Total heat limit
├── liveRunner.ts             # Streaming signal processor
├── orderExecutor.ts          # Send orders to MT5 EA
├── qualityEngine.ts          # Validate signal quality pre-execution
├── postFill.ts               # Position management post-entry
└── decisionGraph.ts          # State machine for order flow
```

#### Gates Check
Signals pass through 8+ gates; rejection recorded to `live_signal_rejection`.

---

## 6. BACKTEST SYSTEM (PIT — Point-in-Time)

### Entry Point: `scripts/backtest-pit-v2.js`

#### Usage
```bash
# Test single variant on EURUSD, past 7 days
node backtest-pit-v2.js EURUSD 7 doyle_sd

# With debug output, JSON export
node backtest-pit-v2.js EURUSD 90 smart_risk_ob_ifvg_1m --json --debug

# Custom date range
node backtest-pit-v2.js EURUSD 0 keylevel_bounce_v8_levels --start=2026-06-01 --end=2026-07-07
```

#### Implementation
1. **Load variant** from DB via `loadStrategyFromDB(variantId)`
2. **For each 1m candle** (LATERAL lookup):
   - Load all features available **at that timestamp**
   - Evaluate setup rules
   - Generate signal if conditions met
   - Find entry price, SL, TP via compiled SQL
   - Simulate fill & P&L
   - Track trade lifecycle (open→close→outcome)
3. **Output**:
   - Trade-level: entry, exit, P&L, duration, RR achieved
   - Run-level: win%, avg RR, Sharpe, DD, profit factor
   - Optional `--json` for programmatic analysis

#### Key Scripts
| Script | Purpose |
|--------|---------|
| **backtest-pit-v2.js** | Main PIT runner |
| **run-pit-historical.js** | Backtest 90d historical, save to `backtest-seed/` |
| **run-pit-walkforward.js** | Walk-forward 30/15 (train/test), save outputs |
| **backtest-pit-compare.ts** | Compare 2+ variants |

#### Output Files
```
data/backtest-seed/
├── historical-pit-90d/
│   ├── <variantId>_90d_results.json      # Trade array
│   ├── <variantId>_90d_summary.json      # Stats
│   └── <variantId>_90d_equity.json       # Equity curve
└── walkforward-30d-15d/
    └── ...
```

---

## 7. API/WEB LAYER (Next.js 15)

### Web App: `apps/web/src/`

```
app/
├── api/
│   ├── strategies/
│   │   ├── [variantId]/
│   │   │   ├── backtest/          # Per-variant backtest report
│   │   │   └── stats/             # Live performance stats
│   │   └── index.ts               # All strategies list
│   ├── signals/
│   │   ├── current/               # Live signals
│   │   ├── rejected/              # Gate rejections
│   │   └── history/               # Signal archive
│   ├── orders/
│   │   ├── [orderId]/             # Order detail
│   │   └── analytics/             # Order analytics
│   ├── analytics/
│   │   ├── dashboard/             # KPI dashboard
│   │   ├── equity/                # Equity curve
│   │   └── heatmap/               # Time-of-day heatmap
│   ├── health/                    # Engine health, DB status
│   └── candles/
│       ├── [symbol]/              # Latest candles
│       └── features/              # Feature snapshots
├── strategies/
│   ├── page.tsx                   # Strategy list view
│   ├── [variantId]/
│   │   ├── page.tsx               # Strategy detail (chart, trades, stats)
│   │   └── backtest/              # Backtest report render
│   └── comparison/                # Multi-variant comparison
├── signals/
│   ├── page.tsx                   # Live signal board
│   ├── [signalId]/                # Signal detail + evaluation trace
│   └── rejected/                  # Rejection review
├── analyze/
│   ├── page.tsx                   # Trade analysis tools
│   ├── loss-analysis/             # Losing trade deep-dive
│   └── winner-stats/              # Winner pattern analysis
├── journal/
│   └── page.tsx                   # Trading journal UI
├── analytics/
│   ├── page.tsx                   # Dashboard
│   ├── equity/                    # Equity curve
│   └── performance/               # Monthly/weekly stats
├── layout.tsx                     # Root layout
├── page.tsx                       # Home
└── globals.css                    # Tailwind v4 + semantic tokens

lib/
├── db.ts                          # DB connection pool
├── feature-loader.ts              # Client-side feature data fetcher
└── chart-helpers.ts               # Chart rendering utils

components/
├── StrategyCard.tsx
├── SignalBoard.tsx
├── TradeTable.tsx
├── EquityChart.tsx
└── ...
```

### Key Routes
| Route | Purpose |
|-------|---------|
| `/strategies` | Strategy portfolio |
| `/strategies/[variantId]` | Variant detail + live chart |
| `/signals` | Live signal feed |
| `/analyze` | Trade loss/winner analysis |
| `/analytics` | Dashboard (equity, daily PnL, etc.) |
| `/api/strategies/[variantId]/backtest` | Backtest report JSON |

---

## 8. CRITICAL SCRIPTS & ENTRY POINTS

### Seed & Deployment
```bash
pnpm db:seed               # seed-strategy-specs.js
                           # Load all YAML specs → DB families/variants

pnpm promote-live          # promote-top3-live.js
                           # Activate 3 live variants (currently doyle_sd, orb_classic, watukushay_no1)
```

### Backfill & Feature Computation
```bash
# Import candles
node scripts/backfill-candles-from-mt5-csv.js <dir> --broker=MT5

# Compute features (all symbols, all TFs)
node scripts/backfill-historical-features.js

# HTF bias tree
node scripts/backfill-htf-bias.js

# Correlation (DXY)
node scripts/backfill-correlation.js

# Higher TF aggregates
node scripts/regenerate-higher-timeframes.js
```

### Backtest
```bash
# Single variant
node scripts/backtest-pit-v2.js EURUSD 90 keylevel_bounce_v8_levels

# Full suite (all variants, all pairs)
node scripts/run-all-strategies-all-pairs.js

# 90-day historical → data/backtest-seed/
node scripts/run-pit-historical.js 90 data/backtest-seed/historical-pit-90d

# Walk-forward 30/15
node scripts/run-pit-walkforward.js 30 15 data/backtest-seed/walkforward-30d-15d
```

### Debug & Analyze
```bash
# Dry-run pipeline (no actual orders)
node scripts/dry-run-live.ts --variant=doyle_sd

# Pipeline investigation (10 versions for different issues)
node scripts/pipeline-investigate.js
node scripts/pipeline-investigate2.js
... 
node scripts/pipeline-investigate12.js

# Trade analysis
node scripts/analyze-trades.js
node scripts/analyze-sniper-losers.js

# Debug specific gate
node scripts/debug-gate.js --gate=spread --symbol=EURUSD
```

---

## 9. DIRECTORY TREE (KEY FILES)

```
tradzfx-v2/
│
├── 📦 packages/
│   ├── 🔧 analyzerBacktest/
│   │   ├── src/
│   │   │   ├── monteCarlo.ts      # MC simulation runner
│   │   │   ├── walkForward.ts     # Walk-forward testing
│   │   │   ├── outcomeTracker.ts  # Outcome classification
│   │   │   ├── reportGenerator.ts # HTML/JSON report
│   │   │   └── runBacktest.ts     # Main orchestrator
│   │   └── dist/
│   │
│   ├── 🎯 levels/
│   │   ├── src/
│   │   │   ├── computeEntryZone.ts   # Zone calculation
│   │   │   ├── computeStopLoss.ts    # SL from ATR/zone
│   │   │   ├── computeTarget.ts      # TP from pivot/zone
│   │   │   └── types.ts
│   │   └── dist/
│   │
│   ├── 🛠️ setupEngine/
│   │   ├── src/
│   │   │   ├── rules/softRules.ts    # Probabilistic filters
│   │   │   ├── rules/hardRules.ts    # Must-pass conditions
│   │   │   ├── graders/entryQuality.ts
│   │   │   ├── graders/riskQuality.ts
│   │   │   ├── evaluateSetup.ts      # Main evaluator
│   │   │   ├── contextBuilder.ts     # Context preparation
│   │   │   └── calibrationTuning.ts
│   │   └── dist/
│   │
│   ├── 🔗 shared/
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── feature.ts        # FeatureDefinition, outputs
│   │   │   │   └── strategy.ts       # StrategySpec, Setup types
│   │   │   ├── utils/
│   │   │   │   ├── session.ts        # getSession(), TradingSession
│   │   │   │   ├── pairs.ts          # Pair metadata
│   │   │   │   └── lifecycle.ts      # Lifecycle utilities
│   │   │   └── pairs/
│   │   └── dist/
│   │
│   ├── 📋 strategies/
│   │   ├── src/
│   │   │   ├── compiler.ts           # YAML → compiled rules
│   │   │   ├── compiler.test.ts
│   │   │   ├── loader.ts             # Spec loader API
│   │   │   ├── dbLoader.ts           # DB family/variant loader
│   │   │   ├── riskCompiler.ts       # TP/SL SQL compiler
│   │   │   └── specs/                # 48 YAML files
│   │   │       ├── keylevel_bounce.yaml
│   │   │       ├── keylevel_bounce_v*.yaml (12 more)
│   │   │       ├── smart_risk_ob_ifvg_1m.yaml
│   │   │       ├── smart_risk_ob_ifvg_1m_*.yaml (23 more)
│   │   │       ├── doyle_sd.yaml
│   │   │       ├── orb_classic.yaml
│   │   │       ├── watukushay*.yaml (3)
│   │   │       ├── waqar_v2.yaml
│   │   │       ├── xauusd_v1.yaml
│   │   │       └── forex_strategy_orb.yaml
│   │   └── dist/
│   │
│   └── 🚀 tradePipeline/
│       ├── src/
│       │   ├── gates/
│       │   │   ├── sessionGate.ts
│       │   │   ├── spreadGate.ts
│       │   │   ├── volatilityGate.ts
│       │   │   ├── dailyLossGate.ts
│       │   │   ├── dailyWinGate.ts
│       │   │   ├── rateLimitGate.ts
│       │   │   ├── familyPositionGate.ts
│       │   │   └── portfolioHeatGate.ts
│       │   ├── liveRunner.ts      # Signal → order pipeline
│       │   ├── orderExecutor.ts   # Execute on MT5
│       │   ├── qualityEngine.ts   # Quality validation
│       │   ├── postFill.ts        # Position management
│       │   ├── decisionGraph.ts   # Order state machine
│       │   └── notify.ts          # Alerts
│       └── dist/
│
├── 🌐 apps/
│   ├── engine/                    # Feature computation + live engine
│   │   ├── src/
│   │   │   ├── features/          # 40+ feature generators
│   │   │   │   ├── atr.ts
│   │   │   │   ├── bias.ts
│   │   │   │   ├── fvg.ts
│   │   │   │   ├── htfBias.ts
│   │   │   │   ├── ifvg.ts
│   │   │   │   ├── liquidityPools.ts
│   │   │   │   ├── movingAverage.ts
│   │   │   │   ├── orderBlock.ts
│   │   │   │   ├── pivot.ts
│   │   │   │   ├── pricing.ts
│   │   │   │   ├── session.ts
│   │   │   │   ├── spread.ts
│   │   │   │   ├── structure.ts
│   │   │   │   ├── sweep.ts
│   │   │   │   ├── timeOfDayEdge.ts
│   │   │   │   ├── zone.ts
│   │   │   │   └── ... (20+ more)
│   │   │   ├── dag/               # DAG execution orchestrator
│   │   │   ├── worker/            # Background workers
│   │   │   ├── ingest/            # MT5 candle ingestion
│   │   │   ├── lifecycleUpdater.ts # Feature freshness tracking
│   │   │   └── index.ts
│   │   ├── dist/
│   │   ├── package.json
│   │   └── vitest.config.ts
│   │
│   └── web/                       # Next.js 15 dashboard
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/           # Backend routes
│       │   │   ├── strategies/    # Strategy UI
│       │   │   ├── signals/       # Signal board
│       │   │   ├── analyze/       # Trade analysis
│       │   │   ├── analytics/     # Dashboard
│       │   │   ├── journal/       # Trading journal
│       │   │   └── layout.tsx
│       │   ├── components/
│       │   ├── lib/
│       │   └── globals.css
│       ├── next.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── 🗄️ infra/
│   ├── migrations/               # 97 SQL files
│   │   ├── 001_schema.sql       # Core tables
│   │   ├── 027_feature_lifecycle.sql
│   │   ├── 075_strategy_families_and_variants.sql
│   │   ├── 080_lifecycle_pk_fix.sql
│   │   ├── 082_backtest_variant_linkage.sql
│   │   └── ... (92 more)
│   ├── docker-compose.yml
│   └── nginx.conf
│
├── 🔧 scripts/                  # 100+ utility scripts
│   ├── seed-strategy-specs.js     # ⭐ Load YAML → DB
│   ├── backtest-pit-v2.js         # ⭐ Main backtest runner
│   ├── promote-top3-live.js       # ⭐ Activate live variants
│   ├── backfill-historical-features.js
│   ├── backfill-candles-from-mt5-csv.js
│   ├── backfill-htf-bias.js
│   ├── run-pit-historical.js
│   ├── run-pit-walkforward.js
│   ├── pipeline-investigate*.js   # Debug pipeline (10 versions)
│   ├── debug-gate.js
│   ├── dry-run-live.ts
│   └── ... (80+ more)
│
├── 💾 data/
│   ├── backtest-seed/
│   │   ├── historical-pit-90d/
│   │   └── walkforward-30d-15d/
│   └── video-strategy-*/
│
├── 📊 reports/                  # Trade analysis reports
├── 🎮 mt5-ea/                   # MT5 EAs (execution bridge)
├── 🛠️ ops/                       # Operational scripts
├── 📚 docs/
│   ├── ui-redesign*.md
│   └── graphify/                # Codebase knowledge graphs
│
├── package.json               # Monorepo root
├── pnpm-workspace.yaml        # pnpm workspace config
├── AGENTS.md                  # ⭐ Project conventions (THIS FILE)
├── README.md
└── tradzfx-v2.code-workspace  # VS Code workspace config
```

---

## 10. KEY TAKEAWAYS

### Architecture Principles
1. **Modular monorepo**: Packages + apps with clear boundaries
2. **Feature-driven**: 40+ computed features feed into signal evaluation
3. **Spec-based**: YAML specs versioned in Git; variants track deltas
4. **PIT backtest**: Lateral SQL lookups for precise temporal evaluation
5. **Live gates**: 8+ risk gates filter signals pre-execution
6. **DB-centric**: All state lives in PostgreSQL; minimal in-memory cache

### Critical Paths
- **Seed**: `seed-strategy-specs.js` → Load YAML → strategy_families/variants
- **Backtest**: `backtest-pit-v2.js` → PIT runner → trades + equity curve
- **Live**: Feature engine → setupEngine → tradePipeline gates → MT5 EA
- **Web**: Next.js API routes query DB → React dashboard

### Dependencies
- **TypeScript** + **Vitest** for code quality
- **PostgreSQL** for schema (97 migrations, TimescaleDB for continuous aggregates)
- **Next.js 15** App Router for frontend
- **Tailwind CSS v4** for styling
- **pnpm** for package management

### Opportunities
- **Feature expansion**: Add custom indicators to `apps/engine/src/features/`
- **Gate tuning**: Modify thresholds in `packages/tradePipeline/src/gates/`
- **Variant testing**: Create new YAML specs in `packages/strategies/src/specs/`
- **Backtest analysis**: Extend `packages/analyzerBacktest/` for custom reporting

---

**Report Generated**: 2026-07-07 | **Explorer**: GitHub Copilot
