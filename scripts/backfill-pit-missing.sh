#!/usr/bin/env bash
# Targeted backfill for features that are missing for the 90-day PIT runner.
# Run with: bash scripts/backfill-pit-missing.sh
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
source .env.local
set +a

export ZONE_BACKFILL_SKIP_OUTCOMES=1

SYMS="EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD"
DAYS=90

echo "[backfill-pit-missing] Targeted features backfill starting"

# XAUUSD 15m zones are required by keylevel_bounce and smart_risk specs.
echo "[backfill-pit-missing] XAUUSD 15m zones"
node scripts/backfill-features.js XAUUSD 15m "$DAYS" --features=features_zone --lookback=100

# XAUUSD 15m structure/displacement for keylevel/orb specs.
echo "[backfill-pit-missing] XAUUSD 15m structure"
node scripts/backfill-features.js XAUUSD 15m "$DAYS" --features=features_structure --lookback=100

echo "[backfill-pit-missing] XAUUSD 15m displacement"
node scripts/backfill-features.js XAUUSD 15m "$DAYS" --features=features_displacement --lookback=100

# ORB specs need session and opening range.
echo "[backfill-pit-missing] session + opening_range 15m"
for sym in $SYMS; do
  node scripts/backfill-features.js "$sym" 15m "$DAYS" --features=features_session,features_opening_range --lookback=100
done

echo "[backfill-pit-missing] session + opening_range 5m"
for sym in $SYMS; do
  node scripts/backfill-features.js "$sym" 5m "$DAYS" --features=features_session,features_opening_range --lookback=100
done

# Watukushay No.1 needs hourly MAs.
echo "[backfill-pit-missing] moving_average 1h"
for sym in $SYMS; do
  node scripts/backfill-features.js "$sym" 1h "$DAYS" --features=features_moving_average --lookback=300
done

# Smart Risk XAUUSD needs iFVG and order blocks.
echo "[backfill-pit-missing] XAUUSD 5m iFVG"
node scripts/backfill-features.js XAUUSD 5m "$DAYS" --features=features_ifvg --lookback=100

echo "[backfill-pit-missing] XAUUSD order_block 5m/15m"
node scripts/backfill-features.js XAUUSD 5m "$DAYS" --features=features_order_block --lookback=100
node scripts/backfill-features.js XAUUSD 15m "$DAYS" --features=features_order_block --lookback=100

echo "[backfill-pit-missing] Done"
