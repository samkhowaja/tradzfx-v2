#!/usr/bin/env bash
# Remaining targeted backfill (skip lifecycle; lifecycle will be refreshed separately).
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
source .env.local
set +a

export ZONE_BACKFILL_SKIP_OUTCOMES=1

SYMS="EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD"
DAYS=90

echo "[backfill-pit-missing-remaining] Starting"

echo "[backfill-pit-missing-remaining] XAUUSD 15m displacement"
node scripts/backfill-features.js XAUUSD 15m "$DAYS" --features=features_displacement --lookback=100 --skip-lifecycle

echo "[backfill-pit-missing-remaining] session + opening_range 15m"
for sym in $SYMS; do
  node scripts/backfill-features.js "$sym" 15m "$DAYS" --features=features_session,features_opening_range --lookback=100 --skip-lifecycle
done

echo "[backfill-pit-missing-remaining] session + opening_range 5m"
for sym in $SYMS; do
  node scripts/backfill-features.js "$sym" 5m "$DAYS" --features=features_session,features_opening_range --lookback=100 --skip-lifecycle
done

echo "[backfill-pit-missing-remaining] moving_average 1h"
for sym in $SYMS; do
  node scripts/backfill-features.js "$sym" 1h "$DAYS" --features=features_moving_average --lookback=300 --skip-lifecycle
done

echo "[backfill-pit-missing-remaining] XAUUSD 5m iFVG"
node scripts/backfill-features.js XAUUSD 5m "$DAYS" --features=features_ifvg --lookback=100 --skip-lifecycle

echo "[backfill-pit-missing-remaining] XAUUSD order_block 5m/15m"
node scripts/backfill-features.js XAUUSD 5m "$DAYS" --features=features_order_block --lookback=100 --skip-lifecycle
node scripts/backfill-features.js XAUUSD 15m "$DAYS" --features=features_order_block --lookback=100 --skip-lifecycle

echo "[backfill-pit-missing-remaining] Done"
