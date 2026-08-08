# Chart And Strategy Visualization Redesign Plan

Date: 2026-07-05  
Scope: Analyze page chart, strategy page visual setup review, KLineCharts overlay architecture, SMC/ICT feature visualization, and setup clarity.

## Executive Verdict

The current chart is trying to draw raw feature tables directly. That is why the screen becomes messy: zones, structure, liquidity, order blocks, iFVGs, signals, and setup boxes are all converted into loose KLineCharts overlays inside one large React component.

The chart should be redesigned around a visual scene model:

`Database Features -> Setup/Feature Selection -> Visual Scene API -> Overlay Planner -> KLineCharts Renderers -> Inspector Panel`

The chart should not decide which 25M zone rows matter. The backend should send a small, ranked, lifecycle-aware visual scene. The frontend should render that scene with stable overlay types, z-levels, labels, interaction states, and clean layer presets.

## Current Problems In The Code

Main files reviewed:

- `apps/web/src/components/analyze/KlineChart.tsx`
- `apps/web/src/components/analyze/overlays/rectZone.ts`
- `apps/web/src/components/analyze/overlays/tradePlan.ts`
- `apps/web/src/components/chart/ChartLayerToggles.tsx`
- `apps/web/src/lib/analyzeSnapshot.ts`
- `apps/web/src/app/analyze/page.tsx`
- `apps/web/src/components/strategies/command-center/StrategyDetailView.tsx`

| Problem | Current State | Effect |
| --- | --- | --- |
| Mixed responsibilities | `KlineChart.tsx` handles data normalization, overlay selection, deduping, colors, labels, lifecycle filtering, and rendering | Hard to reason about and easy to break |
| Raw feature drawing | Chart draws latest rows from feature tables, not ranked visual objects | Setup view is noisy and often inaccurate |
| Arbitrary API slices | `analyzeSnapshot.ts` queries `LIMIT 10` zones, `LIMIT 5` structure, etc. | The most recent rows are not necessarily the most relevant setup objects |
| Weak lifecycle awareness | Mitigated/tapped/invalidated states are only partially reflected | Old or already-used zones can appear as active evidence |
| No visual hierarchy | All overlays compete on same candle pane | Important setup path gets buried |
| Labels collide | Tags and rectangle labels are placed without collision rules | Text overlaps price action and other features |
| Lines overused | MA/Bollinger/Keltner/liquidity/structure all become lines | Nothing tells the eye what matters now |
| No active setup focus | Setup box stretches from first candle to last candle | It hides context instead of explaining the trade |
| Strategy page lacks chart evidence | Strategy detail page shows stats/spec/screenshots, not replayable examples | Hard to judge whether a variant’s setups are clean |
| KLineCharts features underused | Current code uses custom overlays but not group ids, z-levels, lock/visibility conventions, or pane strategy consistently | Overlay management stays fragile |

## KLineCharts Design Direction

KLineCharts 9.8.12 is a good fit if we use it as a rendering engine, not as the place where business logic lives.

Official KLineCharts docs support:

- Custom overlays through `registerOverlay`
- Built-in overlays such as `priceLine`, `segment`, `simpleTag`, and rays
- `createOverlay` with `id`, `groupId`, `paneId`, `lock`, `visible`, and `zLevel`
- Custom figure generation with `createPointFigures`
- Indicator panes and candle-pane indicators

References:

- https://klinecharts.com/en-US/guide/overlay
- https://klinecharts.com/en-US/api/chart/registerOverlay
- https://klinecharts.com/en-US/api/instance/createOverlay
- https://klinecharts.com/en-US/guide/indicator

## Target User Experience

The chart should have three clear modes:

| Mode | Purpose | Default Layers |
| --- | --- | --- |
| Clean Setup | Decide if the current setup is tradable | Entry/SL/TP, source zone, sweep/liquidity, MSS/CHoCH, HTF bias badge |
| Research | Study why setup happened or failed | Setup plus all ranked evidence, rejected reasons, outcome path |
| Feature Debug | Audit detectors and DB feature quality | Raw features, duplicate clusters, lifecycle states, freshness |

The default view should be `Clean Setup`. It should never show every line. It should show the story:

1. Liquidity target or sweep.
2. Displacement / MSS / CHoCH.
3. Source zone or imbalance.
4. Entry, SL, TP, RR.
5. Lifecycle state of the object used.
6. Result or current status.

## Proposed Visual Scene Contract

Create a backend DTO returned from `/api/analyze` and later reused by strategy pages:

```ts
type ChartVisualScene = {
  symbol: string;
  timeframe: string;
  asOf: string;
  candlesFrom: string;
  candlesTo: string;
  activeSetupId?: string;
  mode: "clean_setup" | "research" | "feature_debug";
  viewportHint: {
    fromTs: string;
    toTs: string;
    minPrice?: number;
    maxPrice?: number;
    focusTs?: string;
    focusPrice?: number;
  };
  overlays: VisualOverlay[];
  panels: VisualPanel[];
  diagnostics: VisualDiagnostic[];
};
```

Each overlay should already be ranked and lifecycle-aware:

```ts
type VisualOverlay = {
  id: string;
  groupId: string;
  layer:
    | "setup"
    | "risk"
    | "source_zone"
    | "structure"
    | "liquidity"
    | "lifecycle"
    | "indicator"
    | "debug";
  kind:
    | "trade_plan"
    | "zone_box"
    | "order_block"
    | "fvg"
    | "ifvg"
    | "sweep_marker"
    | "structure_break"
    | "liquidity_level"
    | "session_box"
    | "outcome_path"
    | "debug_marker";
  priority: number;
  zLevel: number;
  visibleByDefault: boolean;
  lifecycleState?: "fresh" | "touched" | "mitigated" | "retested" | "invalidated" | "expired";
  points: Array<{ ts: string; price: number }>;
  label?: string;
  tooltip?: string;
  styleToken: string;
  source: {
    table?: string;
    objectId?: string;
    strategyId?: string;
    reason?: string;
  };
};
```

This prevents the chart from asking, "Which zones should I draw?" The backend answers, "Draw these three objects because they explain this setup."

## Before / After Architecture

| Layer | Before | After | Expected Result |
| --- | --- | --- | --- |
| API data | Raw feature arrays with arbitrary limits | `ChartVisualScene` with ranked visual objects | Chart always receives a clean story |
| Feature selection | Frontend slices latest rows | Backend ranks by setup relevance, distance, freshness, lifecycle | Better accuracy |
| Overlay rendering | One component creates every overlay manually | Overlay registry maps `VisualOverlay.kind` to renderer | Maintainable drawing system |
| Lifecycle display | Partial `tapped/mitigated/invalidated` filtering | Every drawable object has lifecycle state | No stale/tapped zone confusion |
| Layer toggles | Flat list of feature names | Mode presets + advanced layer groups | Less visual overload |
| Setup drawing | Huge rectangle from first candle to last candle | Compact setup lens around decision area | Cleaner chart |
| Labels | Every overlay may create text | Label budget and collision rules | Fewer overlaps |
| Strategy page | Stats and spec only | Replayable setup examples with same scene renderer | Better strategy review |
| Debugging | Visual mess on main chart | Separate Feature Debug mode | Raw feature inspection without polluting trade view |

## Overlay System Redesign

### New Frontend Modules

```text
apps/web/src/components/chart/
  KlineSceneChart.tsx
  sceneTypes.ts
  sceneAdapter.ts
  overlayRegistry.ts
  overlayPlanner.ts
  layerPresets.ts
  overlays/
    setupPlan.ts
    lifecycleZone.ts
    structureBreak.ts
    liquidityLevel.ts
    sweepMarker.ts
    sessionRange.ts
    outcomePath.ts
    debugDot.ts
  inspector/
    OverlayInspector.tsx
    SetupTimeline.tsx
    LayerLegend.tsx
```

### Responsibilities

| Module | Responsibility |
| --- | --- |
| `KlineSceneChart.tsx` | Owns KLineCharts instance, data updates, overlay lifecycle |
| `sceneTypes.ts` | Shared visual scene types |
| `sceneAdapter.ts` | Converts legacy `/api/analyze` response during migration |
| `overlayPlanner.ts` | Sorts, limits, assigns z-levels, applies label budget |
| `overlayRegistry.ts` | Maps `kind` to KLineCharts overlay config |
| Custom overlays | Draw one thing well: zone, sweep, structure, trade plan |
| Inspector | Shows details for selected overlay/setup |

## Visual Rules For Clean Setup Mode

Clean Setup mode should use a strict visual budget.

| Object Type | Max Visible | Rule |
| --- | --- | --- |
| Active setup | 1 | Always draw selected setup first |
| Source zone/OB/FVG/IFVG | 1-2 | Only objects linked to the setup |
| Nearby liquidity | 2 buy-side + 2 sell-side | Prefer swept level and next external target |
| Structure events | 2 | Only the confirming MSS/CHoCH/BOS and parent HTF level |
| Sweeps | 1-2 | Draw sweep that triggered the idea, not every historical sweep |
| Retest markers | 1-3 | Only for the selected source object |
| Indicators | 0 by default | Hidden unless strategy requires them |
| Labels | 4-6 total | Everything else goes to tooltip/inspector |

## Z-Level And Style Hierarchy

| Layer | Z-Level | Style |
| --- | ---: | --- |
| Session/time windows | 5 | Very faint background bands |
| HTF zones/liquidity | 10 | Muted boxes/rays |
| Source zone / OB / FVG | 20 | Clear border, low fill |
| Structure path | 30 | Solid/dashed event line with small marker |
| Sweep/liquidity event | 40 | Icon marker, not a big label |
| Trade plan | 50 | Entry/SL/TP box, crisp labels |
| Selected overlay | 60 | Strong border/glow, inspector active |
| Debug overlays | 70 | Only in Feature Debug mode |

Use KLineCharts `zLevel`, `groupId`, and `lock: true` for programmatic overlays so scrolling/zooming stays smooth.

## Specific Drawing Improvements

### 1. Setup Plan Overlay

Current:

- Current setup entry zone stretches across the whole chart.
- SL/TP are global price lines.

Fix:

- Use a compact trade-plan box anchored from setup decision candle to N future bars.
- Show entry zone, SL, TP, and RR in one overlay.
- Use side-aware risk/reward shading.
- Put the setup grade in the inspector/header, not as a giant chart label.

Expected:

- Setup is readable even when zoomed out.
- Price action is not hidden by a giant rectangle.

### 2. Lifecycle Zone Overlay

Current:

- `rectZone` only knows label/color/fill.
- It does not know fresh/touched/mitigated/invalidated/retested.

Fix:

- Replace/extend `rectZone` with `lifecycleZone`.
- Draw lifecycle state visually:

| State | Visual |
| --- | --- |
| Fresh | Solid border, faint fill |
| Touched | Solid border, small touch marker |
| Mitigated | Dashed border, muted fill |
| Retested | Dashed border plus retest count badge |
| Invalidated | Thin muted outline or hidden in clean mode |
| Expired | Hidden outside debug mode |

Expected:

- A mitigated zone is no longer mistaken for a fresh setup zone.

### 3. Structure Path Overlay

Current:

- Structure is drawn as flat horizontal segments and labels.

Fix:

- Draw a compact event path:

```text
sweep -> displacement candle -> MSS/CHoCH break level -> source zone retest
```

- Use one overlay group per setup evidence chain.
- Show BOS/MSS/CHoCH label only on the selected event.

Expected:

- SMC/ICT sequence becomes visually understandable.

### 4. Liquidity Overlay

Current:

- Liquidity levels are short rays with text labels.
- Equal highs/lows and pools are separate toggles.

Fix:

- Unify liquidity into one layer:

```text
Liquidity: PDH, PDL, PWH, PWL, session high/low, EQH/EQL, round number
```

- Use different marker shapes/icons by kind.
- Show only nearest/swept/target liquidity in clean mode.
- Show full liquidity map in research/debug mode.

Expected:

- Cleaner target selection and easier sweep validation.

### 5. Session And Killzone Context

Current:

- No session boxes on the chart.

Fix:

- Add faint background bands for Asia, London, NY AM, NY PM when strategy requires session logic.
- Do not label every band; use hover/inspector.

Expected:

- ORB, Judas, London/NY sweep setups become easier to validate.

### 6. Outcome Path Overlay

Current:

- Signals can show trade plan, but historical outcome path is not clear.

Fix:

- Draw entry-to-exit path for selected historical setup:

```text
signal candle -> fill -> MFE/MAE -> TP/SL/close
```

- Show R outcome and duration in inspector.

Expected:

- Backtest trades become visually auditable.

## API Redesign

### New Endpoint

Add:

```text
GET /api/chart-scene?symbol=XAUUSD&tf=5m&mode=clean_setup&setupId=...
```

or integrate into `/api/analyze` as:

```ts
{
  candles,
  setup,
  features,
  chartScene
}
```

### Scene Builder Responsibilities

The backend should:

1. Select candles and viewport.
2. Load current setup or selected historical trade.
3. Load only linked market objects where possible.
4. Rank nearby unlinked evidence by relevance.
5. Apply lifecycle filtering.
6. Assign `priority`, `groupId`, `zLevel`, `styleToken`.
7. Return diagnostics when important evidence is missing or stale.

### Ranking Rules

For each object:

```text
visual_score =
  setup_link_bonus
  + lifecycle_score
  + distance_to_entry_score
  + recency_score
  + quality_score
  + strategy_required_bonus
  - clutter_penalty
```

Objects with low visual score should be hidden in Clean Setup mode but available in Feature Debug mode.

## Strategy Page Redesign

The strategy page should gain a `Visual Examples` tab.

### New Strategy Detail Tabs

| Tab | Purpose |
| --- | --- |
| Overview | KPIs and variant summary |
| Variants | Existing variant table |
| Visual Examples | Replay top winners, worst losers, recent paper trades, missed setups |
| Spec DNA | Existing spec details |

### Visual Examples Panel

For each strategy/variant show:

- Best 5 wins by R.
- Worst 5 losses by R.
- Most recent 10 signals.
- Blocked/missed examples once rejection/missed-setup journal is available.

Each row opens the same `KlineSceneChart` with:

- candles around trade
- linked setup objects
- decision reasons
- lifecycle state
- outcome path

Expected:

- You can visually inspect whether a strategy is finding clean ICT/SMC setups or just coincidental backtest wins.

## Layer Controls Redesign

Replace the flat toggle list with presets plus advanced controls.

### Presets

| Preset | Included |
| --- | --- |
| Clean | Setup, source zone, confirming structure, nearest liquidity |
| Execution | Clean + spread/entry/fill/outcome path |
| Research | Clean + ranked OB/FVG/iFVG/liquidity/session |
| Debug | Raw detector output, duplicate clusters, stale features |

### Advanced Layer Groups

Use grouped toggles:

- Setup: plan, source object, outcome.
- SMC: structure, zones, OB, FVG, IFVG.
- Liquidity: sweeps, EQH/EQL, session levels, HTF levels.
- Context: sessions, HTF bias, premium/discount, OTE.
- Indicators: MA, Bollinger, Keltner, ATR/displacement pane.
- Debug: raw rows, stale markers, duplicate clusters.

## Inspector Panel

Add a right-side or bottom inspector for selected overlay.

Show:

- Object type.
- Lifecycle state.
- Formation time.
- Fresh/touched/mitigated/invalidated timestamps.
- Quality score.
- Strategy rule that used it.
- Whether it was required or optional.
- Source table/object id.
- Rejection or acceptance reason.

This keeps chart labels small while preserving detail.

## Migration Plan

### Phase 1: Stabilize Current Chart

1. Create `sceneTypes.ts` and legacy adapter from existing `/api/analyze` shape.
2. Move overlay creation out of `KlineChart.tsx`.
3. Add overlay groups and z-levels.
4. Replace full-width setup rectangle with compact setup plan.
5. Add lifecycle-aware zone styling.
6. Add layer presets.

Acceptance criteria:

- Clean mode shows no more than 10 overlays by default.
- Setup source zone and trade plan are obvious.
- Mitigated/invalidated zones do not look fresh.

### Phase 2: Backend Visual Scene

1. Add `chartScene` to `/api/analyze`.
2. Rank/select feature objects server-side.
3. Stop returning arbitrary latest rows as the only drawing source.
4. Include diagnostics for missing/stale features.

Acceptance criteria:

- Chart overlays are selected by setup relevance, not SQL `LIMIT`.
- Scene includes `groupId`, `priority`, `zLevel`, and lifecycle state.

### Phase 3: Strategy Visual Examples

1. Add Visual Examples tab to strategy detail.
2. Add endpoint to fetch trade-scene by order/backtest trade id.
3. Use same `KlineSceneChart`.
4. Add outcome path overlay.

Acceptance criteria:

- Every top win/loss can be replayed visually.
- A strategy variant can be judged from actual setup examples.

### Phase 4: Feature Debug Mode

1. Add duplicate cluster visualization.
2. Add stale/missing feature markers.
3. Add raw detector row table synchronized with chart hover/selection.

Acceptance criteria:

- Debug mode can explain why overlays look wrong without polluting Clean mode.

## Implementation Checklist

| Priority | Item |
| --- | --- |
| Monday | Compact setup/trade-plan overlay |
| Monday | Lifecycle zone visual states |
| Monday | Clean/Research/Debug presets |
| Monday | Cap default overlays and label budget |
| Week 2 | `ChartVisualScene` API contract |
| Week 2 | Overlay registry/planner refactor |
| Week 2 | Visual inspector panel |
| Week 2 | Strategy Visual Examples tab |
| Month 1 | Trade outcome path/replay scenes |
| Month 1 | Duplicate/stale feature debug overlays |
| Month 1 | Session/killzone and PD array visual context |

## What To Expect After Redesign

| Before | After |
| --- | --- |
| Chart looks like a pile of lines | Chart tells one setup story |
| Latest DB rows decide overlays | Setup-linked ranked scene decides overlays |
| Tapped zones look tradable | Lifecycle state is visible |
| Strategy page shows stats but not setup quality | Strategy page shows replayable visual examples |
| Labels collide everywhere | Labels are budgeted; detail moves to inspector |
| Debugging raw features ruins trading view | Debug mode is separate |
| KLineCharts used as ad hoc drawing API | KLineCharts used as a structured rendering engine |

## Final Recommendation

Keep KLineCharts. It is flexible enough for this app. The fix is to stop drawing raw feature rows directly and introduce a visual scene layer between the database and the chart.

The cleanest target is:

`analyzeSnapshot/buildChartScene -> ChartVisualScene -> KlineSceneChart -> overlayRegistry -> inspector`

Once that exists, every future feature can answer the same question before it reaches the chart:

`Is this object important to the selected setup, what lifecycle state is it in, and how should it be drawn without hiding price action?`

