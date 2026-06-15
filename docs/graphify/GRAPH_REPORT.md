# Graph Report - tradzfx-v2  (2026-06-15)

## Corpus Check
- 174 files · ~63,375 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 938 nodes · 1545 edges · 90 communities (80 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `90644bdd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]

## God Nodes (most connected - your core abstractions)
1. `getPool()` - 59 edges
2. `Candle` - 48 edges
3. `FeatureDefinition` - 32 edges
4. `sha256()` - 23 edges
5. `compilerOptions` - 16 edges
6. `compilerOptions` - 15 edges
7. `compilerOptions` - 15 edges
8. `compilerOptions` - 15 edges
9. `compilerOptions` - 15 edges
10. `DAGRunner` - 14 edges

## Surprising Connections (you probably didn't know these)
- `AtrInput` --references--> `Candle`  [EXTRACTED]
  apps/engine/src/features/atr.ts → packages/shared/src/types/feature.ts
- `BollingerInput` --references--> `Candle`  [EXTRACTED]
  apps/engine/src/features/bollinger.ts → packages/shared/src/types/feature.ts
- `CandlePatternInput` --references--> `Candle`  [EXTRACTED]
  apps/engine/src/features/candlePattern.ts → packages/shared/src/types/feature.ts
- `CorrelationInput` --references--> `Candle`  [EXTRACTED]
  apps/engine/src/features/correlation.ts → packages/shared/src/types/feature.ts
- `DisplacementInput` --references--> `Candle`  [EXTRACTED]
  apps/engine/src/features/displacement.ts → packages/shared/src/types/feature.ts

## Import Cycles
- 1-file cycle: `apps/engine/src/index.ts -> apps/engine/src/index.ts`

## Communities (90 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (21): GET(), GET(), GET(), GET(), GET(), GET(), closeOrder(), computePaperPnl() (+13 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (31): applyGates(), buildEntryPriceSql(), buildEntryPriceSqlBase(), buildEntryTypeColumn(), buildGateEvaluators(), buildPITSignalSelect(), buildSlSql(), buildTpSql() (+23 more)

### Community 2 - "Community 2"
Cohesion: 0.20
Nodes (23): RunOptions, buildBaseEntryPriceSql(), buildEmaCrossSignalSelect(), buildEntryPriceSql(), buildEntryTypeColumn(), buildIndicatorSignalSelect(), buildMovingAverageSignalSelect(), buildOrbSignalSelect() (+15 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (25): dependencies, klinecharts, next, pg, react, react-dom, @tm/engine, @tm/shared (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (21): runLiveExecution(), checkAndTriggerAllActive(), checkAndTriggerPipeline(), compiledCache, get15mBucket(), getCompiledStrategy(), lastProcessed, runFeatureEngine() (+13 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (22): description, devDependencies, tsx, @types/node, typescript, engines, node, name (+14 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (6): FeatureCache, LRUCache, memoryCache, DAGRunner, CacheEntry, FeatureOutputs

### Community 7 - "Community 7"
Cohesion: 0.20
Nodes (11): Position, Signal, SignalStream(), PageShell(), sideTone(), textForOutcome(), toneForOutcome(), formatCurrency() (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.20
Nodes (11): AnalyticsPage(), Tab, EquityChart(), EquityPoint, PerformanceSummary(), Summary, Strategy, StrategyStatus() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.20
Nodes (14): GET(), POST(), validateApiKey(), createOrder(), CreateOrderInput, expireStaleOrders(), getPendingOrders(), markOrderFilled() (+6 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (17): dependencies, redis, @tm/shared, devDependencies, tsx, typescript, vitest, main (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (13): pivotFeature, PivotInput, StructureInput, sweepFeature, SweepInput, classifyFormation(), computeZoneQuality(), detectZones() (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (12): backtestSpec(), computeStats(), formatR(), fs, { loadStrategyFromYaml, compileStrategy }, main(), path, { Pool } (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (16): computeAggregate(), formatSkip(), fs, loadSpec(), main(), mergeGateSkips(), nowIso(), path (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+9 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+9 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (10): FeatureSnapshot(), Candle, ChartSignal, KlineChart(), StructureEvent, TIMEFRAMES, Badge(), BadgeTone (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (12): CandleGrade, detectDisplacement(), displacementFeature, DisplacementInput, gradeCandle(), gradeRank(), ifvgFeature, IfvgInput (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (16): dependencies, pg, redis, devDependencies, @types/pg, typescript, vitest, main (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (12): Family, FamilyStrategy, Family, FamilyStrategy, StrategyFamilyAccordion(), StrategyFamilyRow(), StrategyRow, Button() (+4 more)

### Community 23 - "Community 23"
Cohesion: 0.16
Nodes (9): pricingFeature, PricingInput, SESSION_WINDOWS, sessionFeature, SessionInput, structureFeature, main(), PricingOutput (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (15): dependencies, @tm/shared, yaml, devDependencies, typescript, vitest, main, name (+7 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (14): dependencies, @tm/shared, devDependencies, typescript, vitest, main, name, private (+6 more)

### Community 26 - "Community 26"
Cohesion: 0.24
Nodes (12): createDailyLossGate(), DailyLossGateConfig, checkFeatureFreshness(), fetchLatestFeatures(), fetchLatestSignal(), insertLiveOrder(), insertLiveSignal(), LiveRunResult (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (13): backfillJob(), { DAGRunner, globalDAG }, ensureLogDir(), fs, getBarTimestamps(), getSymbols(), main(), parseArgs() (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (11): formatDate(), fs, loadSpec(), main(), path, { Pool }, RUNNER, { spawn } (+3 more)

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (4): FeatureDAG, globalDAG, FeatureDefinition, FeatureGraph

### Community 30 - "Community 30"
Cohesion: 0.23
Nodes (7): RejectionAnalytics(), RejectionData, formatPercent(), Column, DataTable(), ProgressBar(), Sparkline()

### Community 31 - "Community 31"
Cohesion: 0.21
Nodes (10): fs, loadSpec(), main(), path, RUNNER, simulatePortfolio(), { spawn }, SPECS (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.24
Nodes (7): DecisionGraph, GateFunction, GateNode, GraphNode, StrategyNode, DecisionTrace, MarketContext

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (7): alignCandles(), computeCorrelation(), correlationFeature, CorrelationInput, pearson(), slope(), CorrelationOutput

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (8): candleIntersectsZone(), detectRetests(), isBearishEngulfing(), isBullishEngulfing(), zoneRetestFeature, ZoneRetestInput, ZoneOutput, ZoneRetestOutput

### Community 35 - "Community 35"
Cohesion: 0.18
Nodes (6): createDailyWinGate(), DailyWinGateConfig, createFamilyPositionGate(), FamilyPositionConfig, createRateLimitGate(), RateLimitGateConfig

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (10): BacktestOptions, BacktestResult, BacktestStats, DecisionNode, DecisionTraceEntry, EntryConfig, GateConfig, RiskRules (+2 more)

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (4): getDotColor(), PairData, PairRowItem(), PairSidebar()

### Community 38 - "Community 38"
Cohesion: 0.27
Nodes (8): POST(), VALID_CLOSE_REASONS, validateApiKey(), markOrderAcked(), markOrderClosed(), POST(), SignalAckPayload, validateApiKey()

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (5): computeEMA(), computeMACD(), indicatorFeature, IndicatorInput, IndicatorOutput

### Community 40 - "Community 40"
Cohesion: 0.24
Nodes (6): computeCrosses(), computeSMA(), PAIRS, smaCrossFeature, SmaCrossInput, SmaCrossOutput

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (9): RunLiveOptions, CompiledStrategy, LiveRunOptions, buildOrderInput(), computeLotSize(), DEFAULT_LIVE, OrderExecutorConfig, LiveExecutionConfig (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (4): DashboardData, ActivityEvent, ActivityLog(), PositionsTable()

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (7): biasFeature, BiasInput, computeEMA(), detectBias(), BiasOutput, CandlePatternOutput, StructureOutput

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (8): computeAllOpeningRanges(), computeOpeningRange(), openingRangeFeature, OpeningRangeInput, SESSION_START_HOUR, SessionKey, TF_TO_RANGE_MINUTES, OpeningRangeOutput

### Community 45 - "Community 45"
Cohesion: 0.28
Nodes (8): BarPayload, isV1Bar(), normalizeBars(), POST(), V1Bar, V1Payload, V2Bar, V2Payload

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (6): GlossaryEntry, KeyLevels, MarketNarrative(), NarrativeData, NarrativeSection, VERDICT_STYLES

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (5): atrFeature, AtrInput, AtrOutput, hashObject(), sha256()

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (4): bollingerFeature, BollingerInput, CONFIGS, BollingerOutput

### Community 50 - "Community 50"
Cohesion: 0.39
Nodes (7): bodySize(), candlePatternFeature, CandlePatternInput, detectPatterns(), isBearish(), isBullish(), totalRange()

### Community 51 - "Community 51"
Cohesion: 0.29
Nodes (6): computeCrosses(), computeEMA(), emaCrossFeature, EmaCrossInput, PAIRS, EmaCrossOutput

### Community 52 - "Community 52"
Cohesion: 0.25
Nodes (4): CONFIGS, keltnerFeature, KeltnerInput, KeltnerOutput

### Community 53 - "Community 53"
Cohesion: 0.25
Nodes (4): movingAverageFeature, MovingAverageInput, PERIODS, MovingAverageOutput

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (7): computeSessionHL(), getSessionKey(), SESSION_HOURS, sessionHlFeature, SessionHlInput, SessionKey, SessionHlOutput

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (7): fs, main(), path, { Pool }, seedSpec(), SPECS_DIR, YAML

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (6): AGENTS.md — tradzfx-v2, Backtest data, Graphify, Project conventions, Strategy specs, What not to commit

### Community 57 - "Community 57"
Cohesion: 0.38
Nodes (6): aggregateCandles(), buildNarrative(), GET(), TF_CANDLE_LIMIT, TF_MS, VALID_TFS

### Community 58 - "Community 58"
Cohesion: 0.33
Nodes (3): metadata, navItems, TopNav()

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (6): Apps & packages, Knowledge graph, Quick start, Running in production, Stack, tradzfx-v2

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (6): LIVE_SPECS, main(), path, { Pool }, runSeed(), { spawn }

### Community 61 - "Community 61"
Cohesion: 0.50
Nodes (4): createSessionGate(), isInWindow(), parseWindow(), SessionGateConfig

### Community 62 - "Community 62"
Cohesion: 0.50
Nodes (4): { DAGRunner, globalDAG }, getBarTimestamps(), main(), { Pool }

### Community 63 - "Community 63"
Cohesion: 0.50
Nodes (4): { DAGRunner, globalDAG }, getBarTimestamps(), main(), { Pool }

### Community 64 - "Community 64"
Cohesion: 0.40
Nodes (3): fs, path, { Pool }

### Community 65 - "Community 65"
Cohesion: 0.83
Nodes (3): auth(), GET(), POST()

## Knowledge Gaps
- **334 isolated node(s):** `name`, `version`, `private`, `main`, `types` (+329 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getPool()` connect `Community 0` to `Community 32`, `Community 4`, `Community 68`, `Community 38`, `Community 10`, `Community 45`, `Community 23`, `Community 57`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `Candle` connect `Community 13` to `Community 33`, `Community 34`, `Community 6`, `Community 39`, `Community 40`, `Community 43`, `Community 44`, `Community 48`, `Community 49`, `Community 50`, `Community 51`, `Community 20`, `Community 52`, `Community 53`, `Community 23`, `Community 54`, `Community 29`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `StrategySpec` connect `Community 41` to `Community 2`, `Community 36`, `Community 4`, `Community 10`, `Community 46`, `Community 14`, `Community 26`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `getPool()` (e.g. with `GET()` and `GET()`) actually correct?**
  _`getPool()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _334 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07823613086770982 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.10252100840336134 - nodes in this community are weakly interconnected._