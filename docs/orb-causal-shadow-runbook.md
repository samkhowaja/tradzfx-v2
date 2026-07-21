# ORB causal shadow runbook

## Contract

- Strategy ID: `orb_scalper_1m_causal_shadow`.
- Comparison strategy `orb_scalper_1m` remains unchanged.
- Evaluator creates no orders and writes no trading tables.
- Candidate and outcome records spool to `logs/candidate-spool/` for existing resilient DB drain.
- Local idempotent state lives at `logs/orb-causal-shadow-state.json`.
- Signal order: completed London range, bias-aligned close breakout, later same-direction 15m displacement, confirmation-time bias alignment.
- Resolution uses `sl_first`, normal spread/commission, no forced 8-bar close.
- Observation safety boundary is 240 one-minute bars. Unresolved candidates become `open_at_safety_boundary`; they are not wins or losses.

## Validate without scheduler

Run `node --test scripts/backtest-orb-causal-all.test.js scripts/orb-causal-shadow.test.js`, then `node scripts/orb-causal-shadow.js`.

Expected output contains `signals=<n> tracked=<n>`. No row may appear in `live_order`, `orders`, or `position_commands` because evaluator has no order code or deployment.

## Collection status

PM2 app `tz-orb-causal-shadow` is defined in `ecosystem.config.js` with `ORB_CAUSAL_SHADOW_ENABLED=true`. Keep it separate from live deployment and order execution. Do not create a `live_deployment` for shadow strategy.

## Monitor

- PM2 status and active logs: `pm2 describe tz-orb-causal-shadow` and `pm2 logs tz-orb-causal-shadow --lines 100 --nostream`. PM2 may suffix configured log filenames with process ID.
- Candidate spool stages: `shadow_candidate`, `shadow_resolved`, `shadow_open_boundary`.
- DB audit after spool drain: query `strategy_signal_candidates` where `strategy_id = 'orb_scalper_1m_causal_shadow'`.
- Compare timestamps and outcomes against unchanged `orb_scalper_1m` records.

## Promotion gate

Do not promote from historical result. Require unseen shadow sample, zero chronology violations, stable producer freshness, realistic costs, and reviewed setup charts. Promotion needs separate reviewed production implementation; changing this shadow runner is insufficient.
