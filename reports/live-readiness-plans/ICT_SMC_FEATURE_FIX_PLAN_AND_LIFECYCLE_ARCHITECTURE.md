# ICT/SMC Feature Fix Plan And Lifecycle Architecture

Date: 2026-07-05  
Scope: SMC/ICT feature computation, database persistence, lifecycle handling, setup selection, and regression prevention. Security is intentionally out of scope except where it affects live-trading safety.

## Executive Verdict

The biggest issue is not that one SMC feature is slightly miscalculated. The larger architectural problem is that the system stores too many repeated zone-like objects, too few true liquidity/sweep/FVG objects, and does not make lifecycle state a first-class contract across every setup.

The fix is to move from "feature rows as raw detector output" to "market objects with lifecycle":

`Candles -> Feature Detectors -> Market Object Store -> Lifecycle Engine -> Feature Readiness Matrix -> Strategy Specs -> Analyzer Enrichment -> Portfolio Risk -> Execution -> Decision Journal`

In this architecture:

- The analyzer scores and enriches. It should not silently veto strategy-valid setups unless the reason is hard-invalid.
- Strategy specs are playbooks. They decide which lifecycle state is acceptable for each setup type.
- Every SMC object must carry lifecycle state: `formed`, `fresh`, `touched`, `mitigated`, `retested`, `invalidated`, `expired`.
- A mitigated zone is not automatically "bad" globally. It is bad for fresh-zone entries, but can be valid for mitigation-block, breaker, retest, or continuation playbooks if the strategy explicitly allows it.
- Live and backtest must read the same point-in-time market-object state.

## Research-Informed Design Notes

Established trading engines separate signal generation, portfolio/risk, execution, and analytics instead of letting one analyzer own the whole decision. QuantConnect/LEAN documents a framework with universe selection, alpha creation, portfolio construction, execution, and risk management modules. Freqtrade separates backtesting, dry-run, and live operation, and explicitly recommends comparing dry-run with backtest behavior before trusting live. Backtrader keeps broker execution concerns such as slippage separate from strategy/analyzer concepts, and its analyzers observe outcomes rather than define core trade eligibility.

Useful references:

- QuantConnect Algorithm Framework overview: https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview
- QuantConnect v1 framework module summary: https://www.quantconnect.com/docs/v1/algorithm-framework/overview
- Freqtrade strategy/backtest and dry-run guidance: https://www.freqtrade.io/en/stable/strategy-101/
- Freqtrade bot basics and fee/live-vs-backtest notes: https://www.freqtrade.io/en/stable/bot-basics/
- Backtrader slippage model: https://www.backtrader.com/docu/slippage/slippage/
- Backtrader analyzers: https://www.backtrader.com/docu/analyzers/analyzers/

The practical lesson for this app: treat ICT/SMC features as stateful alpha evidence, not as final trade decisions. Then run strategy specs, risk, and execution as separate layers.

## Current Failure Pattern

Database evidence from the latest audit showed:

| Area | Current Evidence | Problem |
| --- | --- | --- |
| Zones | `features_zone` has about 25M rows | Severe over-persistence and duplicate/near-duplicate zone objects |
| Zone retests | `features_zone_retest` has about 5M rows | Retest explosion caused by over-generated zones |
| XAUUSD 5m zones | About 2.96M rows, about 291 zone rows per timestamp | Too many competing levels around the same area |
| XAUUSD active/open zones | Hundreds of thousands still open | Lifecycle and selection are not reducing the tradable universe enough |
| Sweeps | Only 6 rows total, all EURUSD 5m | SMC sweep logic is effectively absent for XAUUSD and most symbols |
| `features_fvg` | 0 rows | FVG detector exists but is not populated as its own canonical feature |
| IFVG | XAUUSD only on 5m and stale by many hours | Coverage/freshness problem and lifecycle semantics mismatch |
| Equal liquidity | 28 rows total, only EURUSD 5m | Important ICT liquidity shelves are under-detected |
| Liquidity pools | Only EURUSD 5m | PDH/PDL/PWH/PWL/session liquidity is missing for live XAUUSD |
| Feature freshness | Several XAUUSD features lag latest candle by 100+ to 2000+ minutes | Live setup decisions can be based on stale feature state |

## Target Lifecycle Model

Every SMC/ICT object should be stored with a durable identity and lifecycle timeline.

### Market Object Identity

Use one canonical identity per detected object:

```ts
type MarketObjectId = {
  symbol: string;
  timeframe: string;
  objectType: "zone" | "order_block" | "fvg" | "ifvg" | "liquidity_pool" | "equal_liquidity" | "sweep" | "breaker" | "bpr";
  direction: "bullish" | "bearish" | "neutral";
  formationTs: string;
  sourceTs?: string;
  topRounded?: number;
  bottomRounded?: number;
  anchorHash: string;
};
```

The key fix is `anchorHash`: it must be derived from stable anchors, not floating-point values that shift on every rolling-window recomputation.

Suggested anchor inputs:

- `symbol`
- `timeframe`
- `objectType`
- `direction`
- `formationTs`
- `anchor candle ts`
- `pivot id` or `structure event id`
- pip-normalized top/bottom
- detector version

### Lifecycle State

```ts
type MarketObjectLifecycle = {
  state: "formed" | "fresh" | "touched" | "mitigated" | "retested" | "invalidated" | "expired";
  formedAt: string;
  firstTouchAt?: string;
  mitigatedAt?: string;
  retestCount: number;
  invalidatedAt?: string;
  expiredAt?: string;
  lastSeenAt: string;
  tradability: "eligible" | "strategy_dependent" | "blocked";
  blockingReason?: string;
};
```

Important: `mitigated` should not mean globally unusable. It means a fresh imbalance/OB entry is no longer valid unless the strategy spec allows a retest/mitigation play.

## Strategy-Specific Lifecycle Rules

Different playbooks should consume different object states.

| Setup Type | Good Zone State | Bad Zone State | Architecture Rule |
| --- | --- | --- | --- |
| Fresh OB/FVG entry | `fresh`, sometimes first `touched` if wick-only | `mitigated`, `invalidated`, `expired` | Spec requires `zone.lifecycle.state in fresh_allowed_states` |
| IFVG continuation | Confirmed inversion, not invalidated | Original FVG still fresh without inversion | Spec reads IFVG object, not raw FVG |
| Breaker block | Prior OB failed, price reclaimed with structure shift | OB never failed or no reclaim | Spec requires linked failed OB + breaker confirmation |
| Retest entry | `mitigated` or `retested`, still structurally valid | Hard invalidated | Spec allows retest lifecycle and needs reaction evidence |
| Liquidity sweep reversal | Sweep + MSS/CHoCH + displacement | Sweep without structure shift | Spec requires ordered sequence |
| Inducement run | External liquidity still intact, internal liquidity swept | External target already taken | Spec uses liquidity hierarchy |

## Before / After Architecture

| Layer | Before | After | Expected Result |
| --- | --- | --- | --- |
| Feature detector output | Rolling-window detectors emit many historical rows each run | Detectors emit candidate objects with stable object identity | No repeated historical object spam |
| Zone persistence | PK includes floating top/bottom, allowing near-duplicates | Store `object_id`/`anchor_hash` and pip-rounded bounds | Duplicate zones collapse into one object |
| Lifecycle | Computed inconsistently in TS and SQL | Single lifecycle contract shared by backtest/live/SQL refresh | Same state in live and backtest |
| Zone eligibility | Analyzer/spec can see too many stale/tapped zones | Strategy specs explicitly request allowed lifecycle states | Good setups no longer hidden inside zone clutter |
| Retests | Retest feature scans every over-generated zone | Retest attaches to canonical objects and increments `retest_count` | Retest table becomes useful instead of noisy |
| FVG | Separate FVG table exists but is empty | Either populate canonical FVG objects or remove table and make zone FVG canonical | No blind spot for FVG-driven strategies |
| Sweeps | Very restrictive detector produces only 6 rows | Store `raw_sweep`, then promote to `confirmed_sweep` after MSS/CHoCH/displacement | More realistic ICT sequencing |
| Liquidity | Pools/EQH/EQL under-covered | All live symbols/timeframes get PDH/PDL/PWH/PWL/session/round/equal liquidity | Sweep and inducement strategies get usable inputs |
| Feature freshness | No hard readiness gate | Feature readiness matrix blocks stale or missing features before strategy eval | No stale live decision |
| Backtest/live parity | Feature state may differ by mode | PIT market-object snapshot consumed by both modes | Trustworthy live readiness |

## Fix Plan By Finding

### 1. Zone Explosion And Duplicate Persistence

Current state:

- `features_zone` stores millions of rows.
- Same XAUUSD zone timestamp and rounded bounds can appear repeatedly.
- Floating-point top/bottom values are part of uniqueness, so equivalent zones can bypass `ON CONFLICT`.
- Detector serializes all zones inside the lookback window, so the same past objects are re-emitted.

Fix:

1. Add canonical `market_objects` or `smc_objects` table.
2. Use `object_id` / `anchor_hash` as the primary identity.
3. Normalize top/bottom to pip precision before persistence.
4. Change zone detector output to emit only newly formed objects or object updates.
5. Store lifecycle updates separately from formation rows.
6. Rebuild `features_zone` and `features_zone_retest` after the identity fix.

Before:

```text
zone detector -> many window rows -> features_zone(symbol, tf, ts, zone_kind, top, bottom)
```

After:

```text
zone detector -> canonical object upsert -> lifecycle refresh -> strategy-readable active object view
```

Expected result:

- Reduce `features_zone` row count by more than 95%.
- Reduce retest explosion by more than 95%.
- Faster analyzer queries.
- Fewer duplicate XAUUSD entries around the same zone.

Regression prevention:

- Add a test that the same candle window run 10 times does not increase object count.
- Add a DB check: duplicate objects by `symbol/timeframe/type/direction/formation_ts/rounded bounds` must be zero.
- Add daily report: `zone_rows_per_timestamp` must stay below a defined threshold.

### 2. Zone Lifecycle Must Be Strategy-Aware

Current state:

- A touched/mitigated zone can still appear as broadly available.
- Some code treats first touch as mitigation for compatibility.
- Strategy specs do not have a consistent way to say "fresh only" versus "retest allowed".

Fix:

1. Add lifecycle state to every zone-like object.
2. Add strategy spec fields:

```yaml
zoneLifecycle:
  allowedStates: ["fresh"]
  maxRetests: 0
  requireReactionAfterTouch: false
  invalidStates: ["invalidated", "expired"]
```

3. For retest/mitigation strategies:

```yaml
zoneLifecycle:
  allowedStates: ["mitigated", "retested"]
  minRetests: 1
  requireReactionAfterTouch: true
  invalidStates: ["invalidated", "expired"]
```

Before:

```text
zone exists -> analyzer/spec may consider it
```

After:

```text
zone exists -> lifecycle state -> strategy-specific eligibility -> analyzer scoring
```

Expected result:

- Fresh-zone strategies stop using tapped zones.
- Retest strategies can still use mitigated zones intentionally.
- "Why skipped?" becomes explainable.

### 3. Zone Retest Explosion

Current state:

- Retest logic loops over over-generated zones.
- Retest rows are inflated by duplicate zone rows.
- Retests are not attached to one durable zone identity.

Fix:

1. Retest should update `market_object_lifecycle.retest_count`.
2. Keep a small `market_object_events` table:

```sql
object_id
event_type -- touch | mitigation | retest | invalidation | expiry
event_ts
price
candle_ts
evidence_json
```

3. Derive `features_zone_retest` as a view or compact event table, not a giant feature table.

Expected result:

- Retest becomes a meaningful history of how price interacted with the object.
- Setup logic can distinguish first touch, second retest, and invalidation.

### 4. FVG Table Is Empty

Current state:

- `features_fvg` exists but has 0 rows.
- FVGs appear inside `features_zone`, but not as a separate canonical object.
- Strategies that require FVG/imbalance can miss setups or read inconsistent sources.

Fix options:

Option A, preferred:

- Promote FVG to a first-class market object.
- Populate `features_fvg` or replace it with `smc_objects(type='fvg')`.
- Track lifecycle: `fresh`, `partially_filled`, `filled`, `inverted`, `invalidated`.

Option B:

- Remove/deprecate `features_fvg` and explicitly document that `features_zone(zone_kind='fvg')` is canonical.

Expected result:

- No hidden FVG blind spot.
- IFVG logic can link back to original FVG identity.

### 5. IFVG Lifecycle Semantics Mismatch

Current state:

- TypeScript and SQL refresh logic do not express identical mitigation/invalidation meaning.
- IFVG rows are stale and mostly isolated to XAUUSD 5m.

Fix:

1. Define IFVG lifecycle in one contract:

```text
raw_fvg -> filled/inverted -> confirmed_ifvg -> retested -> invalidated
```

2. Store both original FVG identity and IFVG identity.
3. Use same lifecycle function in live, backfill, and SQL refresh, or generate SQL from the same rule spec.
4. Add tests for bullish and bearish IFVG inversion and invalidation.

Expected result:

- IFVG strategies stop receiving contradictory state.
- Backtest/live parity improves.

### 6. Sweep Detector Under-Generates

Current state:

- Only 6 sweep rows exist, all EURUSD 5m.
- No XAUUSD sweeps exist despite XAUUSD being a core live symbol.
- The detector depends heavily on sparse structure events.

Fix:

1. Split sweep detection into stages:

```text
raw liquidity raid -> close-back confirmation -> displacement -> MSS/CHoCH confirmation -> tradable sweep setup
```

2. Store `raw_sweep` even if structure confirmation has not arrived yet.
3. Promote to `confirmed_sweep` once sequence completes within a configured bar window.
4. Add liquidity source link: equal highs/lows, PDH/PDL, session high/low, round number, prior swing.
5. Add golden fixtures for XAUUSD sweep examples.

Expected result:

- Sweep data becomes available for missed-setup research.
- Strategy specs can choose conservative confirmed sweeps or aggressive early sweeps.

### 7. Equal Liquidity Bug And Under-Coverage

Current state:

- Equal liquidity rows exist only for EURUSD 5m.
- Clustering average has a likely double-counting bug.
- EQH/EQL objects have no swept lifecycle.

Fix:

1. Fix cluster average calculation.
2. Persist EQH/EQL as market objects with `level`, `tolerance`, `touch_count`, and `swept_at`.
3. Backfill all live symbols and core timeframes.
4. Link sweep objects to the liquidity object they raided.

Expected result:

- Better inducement and sweep sequencing.
- Fewer missed ICT liquidity setups.

### 8. Liquidity Pool Coverage Is Too Narrow

Current state:

- Liquidity pools exist only for EURUSD 5m.
- Sessions are hardcoded UTC Asia/London.
- Missing NY AM, NY PM, midnight open, daily open, weekly open, killzones, and DST/broker timezone handling.

Fix:

1. Add session calendar service:

```text
broker time -> UTC -> New York time -> killzone/session labels
```

2. Persist:

- PDH / PDL
- PWH / PWL
- PMH / PML if monthly data is available
- Asian high/low
- London high/low
- NY AM high/low
- NY PM high/low
- midnight open
- daily open
- weekly open
- round numbers

3. Make liquidity pool generation symbol/timeframe complete.

Expected result:

- Sweep and Judas/PO3 logic can use the correct liquidity targets.
- XAUUSD no longer trades without session-liquidity context.

### 9. Structure And CISD Are Incomplete

Current state:

- BOS/CHoCH/MSS logic is simple and pivot-dependent.
- `isCisd` is effectively false.
- Structure degree is limited.
- MSS can use a fallback pivot cast as a candle, creating weak event evidence.

Fix:

1. Add explicit internal, swing, and external structure degrees.
2. Implement CISD as its own event type:

```text
displacement candle -> close through opposing candle body/open -> confirms delivery shift
```

3. Store structure events with evidence:

- broken pivot id
- break candle id
- close confirmation
- displacement score
- session label
- linked liquidity event

4. Do not cast pivots as candles. If the break candle is missing, mark the event invalid/incomplete.

Expected result:

- Sweep-to-MSS sequences become reliable.
- Fewer false CHoCH/MSS signals.

### 10. Order Block Selection Is Too Broad

Current state:

- OB detection selects the last opposing candle before a structure break.
- Uses full candle range and lacks enough quality filters.
- No breaker/rejection/propulsion block family.

Fix:

1. Store OB subtype:

- classic OB
- mitigation block
- breaker block
- rejection block
- propulsion block

2. Require quality evidence:

- displacement away from OB
- FVG adjacency or imbalance
- structure break source
- liquidity sweep before displacement
- HTF alignment
- session context

3. Track lifecycle exactly like zones.

Expected result:

- Fewer low-quality OBs.
- More strategy-specific OB behavior.

### 11. Bias, HTF Bias, And PD Arrays Need Stronger Anchors

Current state:

- HTF bias is based on simple recent highs/lows and close break checks.
- Pricing OTE defaults are not true HTF dealing-range anchors.
- Premium/discount arrays are weak or optional.

Fix:

1. Build `dealing_ranges` as first-class objects from HTF swing structure.
2. For each symbol/timeframe, store:

- active HTF swing high/low
- equilibrium
- premium/discount zone
- OTE band
- current PD array alignment
- nearest external liquidity

3. HTF bias should consume structure tree + dealing range + liquidity context.

Expected result:

- Strategies stop treating every local zone equally.
- XAUUSD short/long edge can be modeled against HTF location.

### 12. Feature Freshness And Readiness Gate

Current state:

- Some features lag latest candle by hours or days.
- Missing features are not always visible before strategy evaluation.

Fix:

Add `FeatureReadinessMatrix`:

```ts
type FeatureReadinessMatrix = {
  strategyId: string;
  symbol: string;
  timeframe: string;
  feature: string;
  required: boolean;
  latestTs: string | null;
  latestCandleTs: string;
  freshnessStatus: "fresh" | "stale" | "missing";
  rowCount: number;
  blockingReason?: string;
};
```

Rules:

- Required feature missing = strategy blocked with explicit reason.
- Required feature stale beyond allowed candles = strategy blocked.
- Optional feature stale = warning, not silent failure.

Expected result:

- No live setup is evaluated with invisible missing context.
- Monday readiness can be measured instead of guessed.

## Proposed Schema Direction

### `smc_objects`

```sql
CREATE TABLE smc_objects (
  object_id text PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  object_type text NOT NULL,
  direction text NOT NULL,
  formation_ts timestamptz NOT NULL,
  source_ts timestamptz,
  top numeric,
  bottom numeric,
  level numeric,
  quality_score numeric NOT NULL DEFAULT 0,
  strength_score numeric NOT NULL DEFAULT 0,
  detector_version text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `smc_object_lifecycle`

```sql
CREATE TABLE smc_object_lifecycle (
  object_id text PRIMARY KEY REFERENCES smc_objects(object_id),
  state text NOT NULL,
  formed_at timestamptz NOT NULL,
  first_touch_at timestamptz,
  mitigated_at timestamptz,
  retest_count integer NOT NULL DEFAULT 0,
  invalidated_at timestamptz,
  expired_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  blocking_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `smc_object_events`

```sql
CREATE TABLE smc_object_events (
  id bigserial PRIMARY KEY,
  object_id text NOT NULL REFERENCES smc_objects(object_id),
  event_type text NOT NULL,
  event_ts timestamptz NOT NULL,
  candle_ts timestamptz NOT NULL,
  price numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

## Implementation Roadmap

### Monday Critical

| Fix | Why It Matters | Acceptance Criteria |
| --- | --- | --- |
| Add feature readiness gate | Prevent stale/missing feature decisions | Every live strategy reports required features fresh/missing/stale |
| Add lifecycle eligibility to strategy specs | Stop fresh setups from using mitigated zones | Each live spec declares allowed zone states |
| Stop zone duplicate persistence | Prevent analyzer/backtest overload | Re-running same window does not increase canonical zone count |
| Live allowlist for trusted variants | Avoid trading variants dependent on missing sweep/FVG/liquidity features | Live list only includes strategies with complete required features |
| Conservative paper/shadow mode | Validate Monday behavior before real execution | Paper decisions journal accepted/rejected with reasons |
| Kill switch based on feature health | Avoid live trading during stale data | If required features stale, execution disabled |

### Week 2

| Fix | Why It Matters | Acceptance Criteria |
| --- | --- | --- |
| Rebuild zone/retest tables after canonical identity | Remove historical noise | Row counts drop materially and duplicate object check passes |
| Populate or deprecate `features_fvg` | Remove FVG blind spot | FVG readiness is either present or explicitly not required |
| Sweep staged detector | Recover missed ICT setups | Raw and confirmed sweeps appear across XAUUSD and majors |
| Equal liquidity fix | Support liquidity raids and inducement | EQH/EQL rows exist for live symbols and have lifecycle |
| Liquidity pool expansion | Add session/PDH/PDL/PWH/PWL context | XAUUSD has current session liquidity objects |
| Decision/rejection journal | Explain every skip | Each skipped setup has strategy, lifecycle, feature, and risk reason |

### Month 1

| Fix | Why It Matters | Acceptance Criteria |
| --- | --- | --- |
| Full SMC object store | Durable architecture | Strategies consume object views, not raw detector tables |
| Structure tree and CISD | Better ICT sequencing | Golden fixtures pass BOS/CHoCH/MSS/CISD cases |
| OB subtype model | Better zone quality | OBs classified as classic/mitigation/breaker/rejection/propulsion |
| HTF dealing ranges / PD arrays | Better location filtering | Each setup has HTF premium/discount context |
| PIT market-object backtest | Live/backtest parity | PIT vs paper R gap target below 10-15% |
| Research warehouse | Improve setups from missed trades | Missed good setups become labeled training/research cases |

## Regression Test Suite Needed

Add focused fixtures instead of only end-to-end backtests.

| Test | Protects Against |
| --- | --- |
| Zone idempotency test | Duplicate rows from repeated backfills |
| Zone lifecycle test | Mitigated/invalidated zones still appearing as fresh |
| Retest count test | Retest explosion and duplicate event generation |
| FVG fill/inversion test | Empty or incorrectly aged FVGs |
| IFVG lifecycle parity test | SQL/TS lifecycle mismatch |
| Sweep sequence test | Missing XAUUSD sweeps and wrong confirmation order |
| EQH/EQL clustering test | Average calculation bug and missing shelves |
| Liquidity session test | Wrong Asia/London/NY killzone boundaries |
| HTF bias fixture | Local 5m signal trading against HTF structure |
| Feature readiness test | Missing/stale feature silently passing |

## Final Target State

The desired system should answer these questions for every trade candidate:

1. Which market object created the setup?
2. Is that object fresh, touched, mitigated, invalidated, or expired?
3. Does this strategy allow that lifecycle state?
4. Which liquidity event or structure shift confirms the idea?
5. Are all required features present and fresh?
6. Is this idea a duplicate of another open idea?
7. What exact rule accepted or rejected the trade?

When the answer to those questions is stored in the journal, the app becomes much harder to fool. A bad zone cannot quietly pass as fresh, a good retest zone is not thrown away just because it was mitigated, and a missing sweep/FVG feature cannot silently cause the analyzer to overlook a great setup.

