# Killzone + Session Liquidity Architecture Plan

Date: 2026-07-23  
Status: proposed; no live activation

## 1. Decision

Killzone is a time window. Liquidity is a price level. Keep these separate, then join them causally.

Global engine owns calendar resolution, session ranges, typed liquidity levels, and liquidity events. Each strategy owns which levels, windows, timeframes, confirmations, and targets it trades.

Do not silently change existing strategy behavior. Preserve current specs and progressive plan hashes as controls. Add new inactive variants.

## 2. Existing-system findings

Reusable:

- `packages/shared/src/utils/time.ts`: `KillzoneId`, `KILLZONE_WINDOWS`, `getActiveKillzone()`.
- `packages/shared/src/pairs/pairCharacteristics.ts`: per-symbol `preferredKillzones`.
- `apps/engine/src/features/session.ts`: broad session classification.
- `apps/engine/src/features/sessionHl.ts`: session OHLC/range computation.
- `apps/engine/src/features/openingRange.ts`: completed-at semantics already suitable for PIT.
- `apps/engine/src/features/liquidityPools.ts`: generic clustered levels.
- `apps/engine/src/features/sweep.ts`: sweep/reclaim events.
- `packages/tradePipeline/src/gates/sessionGate.ts`: entry-time session gate.
- `packages/strategies/src/featureRegistry.ts` and `sqlBuilder.ts`: registry-driven PIT joins.

Defects to remove:

- Killzones use fixed UTC hours and therefore drift against London/New York local opens during DST.
- Hour-only windows cannot model minute boundaries.
- Session constants are duplicated and boundary semantics differ.
- `features_session_hl` has ambiguous knowledge time for incomplete sessions.
- Setup engine guesses killzone status through session-name regex.
- `getActiveKillzone()` discards overlapping windows.
- `liquidity: HIGH|MODERATE|LOW` is activity expectation, not price liquidity.
- Strategy sweep selection ignores explicit internal/external hierarchy.

## 3. Canonical terminology

### Trading session

Broad market phase used for reporting and range formation:

- `asia`
- `london`
- `new_york`
- optional product-specific sessions

### Killzone

Dated, timezone-resolved execution window:

- `asia_open`
- `london_open`
- `new_york_open`
- `london_close`
- `new_york_afternoon`

Names describe policy, not universal trading truth. Exact schedules must be versioned and testable.

### Liquidity scope

- `internal`: small swing inside active parent leg.
- `external`: boundary capable of ending or materially repricing parent leg.

Scope is relative. Store `context_tf` and `parent_leg_id`; do not infer scope only from timeframe.

### Liquidity class

- `swing`
- `equal`
- `session_high`
- `session_low`
- `opening_range_high`
- `opening_range_low`
- `previous_day_high`
- `previous_day_low`
- `previous_week_high`
- `previous_week_low`

### Liquidity event

- `sweep`: penetration followed by reclaim within policy window.
- `raid`: penetration without confirmed reclaim yet.
- `break`: accepted close beyond level.
- `retest`: later return to broken level.
- `mitigation`: level no longer considered fresh under its lifecycle policy.

## 4. Canonical calendar service

Create `packages/shared/src/marketSessions/`:

- `types.ts`
- `policies.ts`
- `resolver.ts`
- `calendar.test.ts`

Policy fields:

```ts
interface MarketWindowPolicy {
  id: KillzoneId;
  version: string;
  timezone: "America/New_York" | "Europe/London" | "Asia/Tokyo" | "UTC";
  localStart: string; // HH:mm
  localEnd: string;   // HH:mm, exclusive
  daysOfWeek: number[];
  symbolClasses: SymbolClass[];
  effectiveFrom: string;
  effectiveTo?: string;
}
```

Resolver API:

```ts
resolveMarketWindows(ts: Date, symbol: string): ResolvedMarketWindow[]
resolveWindowOccurrence(id: KillzoneId, tradingDate: string, symbol: string): ResolvedMarketWindow
```

Resolved occurrence fields:

- `window_id`
- `policy_version`
- `trading_date`
- `starts_at`
- `ends_at`
- `timezone`
- `local_start`
- `local_end`
- `symbol_class`
- `preferred_for_symbol`

Rules:

- Use IANA timezone conversion; never manually offset DST.
- Intervals are `[starts_at, ends_at)` everywhere.
- Return all active overlapping windows.
- Resolve by canonical data timestamp, never wall clock during PIT replay.
- Pin policy version in produced evidence.

## 5. Database model

### `market_window_occurrences`

Materialized deterministic calendar occurrences.

Primary key:

`(window_id, policy_version, trading_date, symbol_class)`

Columns:

- `starts_at timestamptz not null`
- `ends_at timestamptz not null`
- `timezone text not null`
- `preferred boolean not null`
- check `ends_at > starts_at`

This table is optional for runtime speed but valuable for audits and reproducibility.

### `features_session_range_v2`

One versioned range state per symbol, session occurrence, and range kind.

Key:

`(symbol, session_id, trading_date, range_kind, as_of_ts)`

Columns:

- `session_id`
- `policy_version`
- `trading_date`
- `range_kind`: `full_session | opening_5m | opening_15m | opening_30m | pre_killzone`
- `starts_at`
- `scheduled_ends_at`
- `as_of_ts`
- `completed_at nullable`
- `is_complete`
- `open`, `high`, `low`, `close`
- `high_formed_at`, `low_formed_at`
- `bar_count`, `expected_bar_count`, `coverage_ratio`
- `engine_ver`, `input_hash`

Knowledge contract:

- Evolving state row: `as_of_ts` equals completion of latest included candle.
- Final state: `completed_at = scheduled_ends_at`; knowable only at/after that time.
- Consumers must explicitly choose `evolving` or `complete_only`.

### `features_liquidity_level_v2`

Canonical typed level inventory.

Key:

`level_id` deterministic hash of source lineage.

Columns:

- `symbol`
- `price`
- `side`: `buy_side | sell_side`
- `scope`: `internal | external`
- `class`
- `source_tf`
- `context_tf`
- `source_ref`
- `parent_leg_id nullable`
- `formed_at`
- `known_at`
- `valid_from`
- `valid_to nullable`
- `swept_at nullable`
- `broken_at nullable`
- `mitigated_at nullable`
- `session_id nullable`
- `trading_date nullable`
- quality fields: touches, equal-count, ATR distance, age, strength
- `engine_ver`, `input_hash`

No mutable wall-clock truth in PIT queries. Lifecycle must be reconstructed from timestamp columns as of anchor.

### `features_liquidity_event_v2`

Immutable event stream.

Key:

`event_id` deterministic hash.

Columns:

- `level_id`
- `symbol`
- `event_type`
- `direction`
- `source_tf`
- `occurred_at`
- `known_at`
- `penetration_atr`
- `close_back_bars`
- `extreme`
- `close`
- `displacement_atr`
- `structure_score`
- `killzone_ids text[]`
- `policy_versions jsonb`
- `evidence jsonb`

This replaces strategy dependence on ambiguous `target_type` while old `features_sweep` remains compatibility control.

## 6. Producer DAG

Order:

1. Canonical candles.
2. Window resolver.
3. Session/opening-range state.
4. Pivots and equal-level clusters.
5. Typed liquidity-level projection.
6. Liquidity event detector.
7. Structure/displacement confirmation.
8. Strategy selectors.

Producer rules:

- Compute internal levels on 1m/5m.
- Compute parent legs on 15m/1h.
- Compute external levels from parent-leg boundaries, session ranges, daily/weekly levels.
- A 5m pivot is not automatically internal; classify relative to selected parent leg.
- Same raw level may have multiple semantic projections only when lineage differs; dedupe exact lineage.
- Session high/low becomes final external liquidity only after session completes. During session, expose it as evolving range boundary, not completed session liquidity.
- Sweep detector receives exact `level_id`; no nearest-price reconstruction.
- Event `known_at` uses close-back candle completion, not candle start.

## 7. Feature registry and PIT joins

Add registry policies:

- `calendar_scoped`
- `range_state_asof`
- `level_lifecycle_asof`
- `immutable_event_known_at`

Compiler requirements:

- Strategy condition on session range must declare `sessionId`, `rangeKind`, and `stateMode`.
- Liquidity condition must declare allowed `scope`, `class`, and `sourceTf`.
- Event joins use `known_at <= anchor`.
- Level joins use `known_at <= anchor`, `valid_from <= anchor`, and PIT lifecycle end columns.
- Killzone filters resolve anchor against occurrence `[start,end)` and symbol policy.
- Fail closed on invalid IDs, timeframes, scope, or class.

## 8. Strategy schema

Add explicit policy, not global behavior:

```yaml
marketWindows:
  allowed: [london_open, new_york_open]
  requirePreferredForSymbol: true

liquidity:
  context:
    parentTfs: [15m, 1h]
    externalClasses: [session_high, session_low, previous_day_high, previous_day_low, swing]
  trigger:
    scopes: [internal]
    classes: [swing, equal, opening_range_high, opening_range_low]
    sourceTfs: [1m, 5m]
    maxAgeMinutes: 120
  confirmation:
    eventTypes: [mss, choch, bos]
    tfs: [1m, 5m]
    maxDelayMinutes: 30
  execution:
    retestTfs: [1m, 5m]
    stopAnchor: sweep_extreme
    targetPolicy: next_internal_then_external
```

Validation:

- Scalping variants may choose internal triggers; not mandatory globally.
- Swing/ORB/breakout variants retain their own trigger models.
- `sourceTfs` must be no higher than confirmation context where policy requires.
- `maxDelayMinutes` must fit feature temporal availability.
- No implicit fallback from missing 5m data to 15m.

## 9. Gates versus evidence

Killzone gate answers: “May entry occur now?”

Liquidity evidence answers: “What level was attacked, and when was that known?”

Do not use entry gate to filter producer history. Produce evidence continuously; strategies select it. Otherwise events formed outside killzone but swept inside killzone disappear.

Replace setup-engine regex with resolved typed fields:

```ts
sessionProfile: {
  activeWindowIds: KillzoneId[];
  preferred: boolean;
  policyVersions: Record<string,string>;
}
```

## 10. Migration sequence

1. Add calendar resolver and exhaustive DST/boundary tests.
2. Add non-destructive occurrence and v2 feature tables.
3. Implement session-range-v2 producer and compare against opening-range/session-HL controls.
4. Implement typed liquidity-level producer.
5. Implement exact-level liquidity-event producer.
6. Add registry contracts, SQL builders, validators, and PIT tests.
7. Add setup-engine typed killzone context; retain old path behind kill switch.
8. Backfill 120 days for XAUUSD 1m/5m/15m/1h.
9. Run parity and causality audits.
10. Add inactive internal-wave progressive comparator.
11. Run zero-cost PIT research, then realistic-cost sensitivity.
12. Shadow live for at least two DST boundaries before considering activation.

## 11. Required tests

Calendar:

- London and New York DST transitions.
- Weeks where US and UK DST switch on different dates.
- Exact start included; exact end excluded.
- Midnight wrapping.
- Overlapping windows returned together.
- Symbol preference resolution.

Session range:

- No future candle included.
- Evolving high/low only changes at completed candles.
- Final level unavailable before session end.
- Missing bars reduce coverage and can fail quality.
- Trading-date assignment near midnight and DST.

Liquidity:

- Exact source lineage and stable `level_id`.
- Internal/external classification against parent leg.
- Equal-level clustering without future pivots.
- Sweep, raid, break, reclaim distinction.
- `known_at` after close-back completion.
- Lifecycle PIT replay unaffected by present-day state.

Strategy:

- Live compiler and PIT compiler produce equivalent selectors.
- Missing policy field fails validation.
- Current strategy specs compile unchanged.
- Inactive variants cannot reach order execution.

## 12. Acceptance gates

Architecture gate:

- One calendar source of truth.
- Zero regex killzone inference.
- Zero duplicated session-hour constants.
- All intervals use `[start,end)`.

Data gate:

- 99%+ expected-bar coverage inside tested windows.
- No `known_at < occurred_at`.
- No completed session range visible before scheduled end.
- Exact event-to-level lineage for 100% events.

Research gate:

- At least 100 causal trades per comparator or explicit low-sample verdict.
- Report by window, level class, scope, source TF, symbol, and regime.
- Compare against current immutable control.
- Include spread/slippage sensitivity before promotion.

Operational gate:

- Producer freshness ledger wired.
- Backfill and live output parity sampled.
- Shadow only; no order path.
- Rollback is disabling new variant and producer consumers, not destructive table rollback.

## 13. First comparator

For XAUUSD scalp continuation:

- Context: 1h direction plus active 15m parent leg.
- Window: London open or New York open, symbol-preferred.
- Trigger: aligned 5m internal swing/equal-level sweep.
- Confirmation: 1m/5m displacement plus MSS/CHOCH within 30 minutes.
- Entry: first causal retest.
- Stop: beyond sweep extreme with minimum ATR floor.
- TP1: next internal opposing liquidity.
- TP2: external draw on liquidity.
- Timeout: end of killzone or fixed 120 minutes, whichever comes first.

Keep external reversal comparator separate. Mixing continuation and reversal samples hides edge.

## 14. Explicit non-goals

- No universal requirement that every scalp touch 4h/1h OB/FVG.
- No universal internal-liquidity trigger for every strategy.
- No in-place mutation of live specs.
- No fixed-offset approximation for DST.
- No use of current lifecycle flags in PIT research.
- No promotion based only on chart appearance.
