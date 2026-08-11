# Ordered Staged Strategy Audit — 2026-07-19

## Inventory

Only explicit staged YAML found:

| Variant | Family | Active | Experimental | Mode | Context | Setup | Entry | Result status |
|---|---|---:|---:|---|---|---|---|---|
| `five_one_scalp_staged_v1` | `five_one_scalp` | false | true | compare | direction, 5m | exact zone + 5m BOS/MSS | post-touch 1m BOS | UNVALIDATED_SHADOW |

`five_one_scalp_v1` and `five_one_scalp_v10` are conventional variants. Their results must not be mixed with staged evidence.

## Ordered mechanism

Implemented chronology:

1. Accept direction context.
2. Create isolated state for each exact zone.
3. Require same-side 5m setup structure.
4. Require later closed 1m candle intersecting exact zone geometry.
5. Require later same-side 1m entry structure.
6. Emit one signal for shared entry event across overlapping zones.
7. Cancel on bias flip, exact-zone invalidation, context/setup/zone/entry expiry.

State phases:

`waiting_context`, `waiting_setup`, `waiting_touch`, `waiting_entry`, `ready`, `entered`, `cancelled`.

## Causality findings

| Control | Status | Evidence |
|---|---|---|
| Event order | PASS | Reducer rejects timestamps older than `lastEventTs`. |
| Touch after zone formation | PASS | Requires `candle.ts > zoneTs`. |
| Touch after setup structure | PASS | Requires `candle.ts > setupTs`. |
| Entry after touch | PASS | Requires `entry.ts > touchTs`. |
| Exact zone identity | PASS | Coordinator owns one reducer state per `zoneId`. |
| Zone invalidation identity | PASS | Cancellation applies only to matching zone. |
| Bias flip cancellation | PASS | Same state cancelled when side changes. |
| Event-clock expiry | PASS | Expiry uses event timestamp, not wall clock. |
| Duplicate event protection | PASS | Last 256 processed IDs retained per state. |
| Overlapping-zone duplicate signal | PASS | One market event emits one signal. |
| PIT feature reading | PARTIAL | Raw queries are bounded by requested end and sorted by `ts`; lifecycle interpretation still needs parity proof. |
| Market-calendar expiry | DEGRADED | Bar expiry uses elapsed milliseconds, so weekend/closure time can expire setups despite no tradable bars. |

## Test evidence

Command: `pnpm --filter @tm/strategies exec vitest run src/staged`

- Planner: 4 passed.
- Reducer: 8 passed.
- Coordinator: 4 passed.
- Total: 16/16 passed.

Tests prove state-machine invariants. They do not prove economic backtest parity.

## Economic-runner blockers

### `scripts/backtest-staged-compare.js`

Strengths:

- Uses governed `market.candles_1m_canonical`.
- Reads raw context, structure, and zone events.
- Applies exact-zone chronology through coordinator.
- Supplies pair pip size, base spread, and commission to `simulateTrade()`.
- Blocks empty required inputs.

Gaps:

1. Uses `intrabarMode: "sl_first"`, not repository deterministic preset `close`.
2. Does not apply complete strategy gate stack. Session filter exists, but spread, volatility, and portfolio-heat gates are not evaluated with conventional runner parity.
3. ATR query hardcodes period 14 while spec expression only says `atr(5m)`; risk-expression/compiler parity is not demonstrated.
4. Stop logic adds structural zone boundary behavior beyond literal YAML ATR formula. This may be intentional research behavior, but changes strategy definition.
5. Coverage check tests non-empty tables, not full capability matrix, governed density, producer freshness, lifecycle state, or candle-gap verdict.
6. No setup-engine evaluation or explicit proof setup-engine risk cannot override compiler/staged risk.
7. No persisted run identity/cache contract comparable to canonical PIT runner.
8. No current result artifact exists for this explicit staged variant.

### `scripts/backtest-zone-entry-staged-all.js`

Classification: research diagnostic, not authoritative staged backtester.

Reasons:

- Derives causal candidates by text-removing compiler mitigation guard.
- Does not run reducer/coordinator state machine.
- Uses `sl_first` simulation.
- Simulation call omits explicit pair spread, commission, slippage, and pip contract.
- Applies generic planner to active zone strategies, not only explicit `staged:` specs.
- Cannot provide economic parity with conventional repaired runner.

## Configuration concerns

| Setting | Finding |
|---|---|
| `active: false` | Correct. Keep disabled. |
| `experimental: true` | Correct. Evidence remains shadow-only. |
| `mode: compare` | Correct intent; no complete baseline-vs-staged parity artifact yet. |
| `oneTradePerSetup: true` | Coordinator deduplicates shared entry events, but option itself is not explicitly read. Entered-state lifecycle is not exercised by backtest because no `execution_accepted` event is generated. |
| `maxSpreadPips: 5.0` | Declared but staged compare runner does not execute spread gate. |
| volatility gate | Declared but staged compare runner does not execute it. |
| portfolio heat | Declared but staged compare runner does not execute it. |

## Verdict

- Ordered chronology engine: `TRUSTED_UNIT_LEVEL`.
- PIT data integration: `DEGRADED`.
- Economic simulation parity: `BLOCKED`.
- Strategy performance: `UNTESTED`.
- Live eligibility: `BLOCKED`.

No staged win rate or net R should enter strategy ranking yet.

## Required promotion sequence

1. Reuse canonical strict preflight and capability verdict.
2. Replace elapsed-millisecond expiry with tradable-bar-aware expiry or prove intended wall-time semantics.
3. Compile risk from YAML through same risk authority used by conventional PIT runner.
4. Apply same spread, slippage, commission, session, volatility, setup, and portfolio-heat policies.
5. Use deterministic `close` intrabar resolution for parity run.
6. Generate `execution_accepted` events and prove one-trade-per-setup terminal behavior.
7. Persist input hash, code revision, spec hash, mode, data window, quality verdict, transitions, signals, and trades.
8. Run baseline conventional and staged mechanisms on identical window/data clock.
9. Explain every signal-set difference by stage transition/rejection reason.
10. Only then run disjoint OOS or prospective shadow validation.
