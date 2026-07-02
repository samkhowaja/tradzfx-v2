-- Fresh start for strategies: remove all families, variants, and linked execution/audit data.
-- Candles and feature tables are preserved.

BEGIN;

TRUNCATE TABLE strategy_families CASCADE;
TRUNCATE TABLE strategy_variants CASCADE;
TRUNCATE TABLE strategy_specs CASCADE;

TRUNCATE TABLE orders, setup_evaluations, backtest_results, backtest_runs,
              position_commands, decision_trace, live_signal_rejection,
              live_fill, live_order, live_signal, live_deployment
              CASCADE;

COMMIT;
