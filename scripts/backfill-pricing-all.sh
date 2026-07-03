#!/usr/bin/env bash
# Backfill features_pricing for all major symbols/timeframes used by PIT specs.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env.local
set +a

SYMBOLS=(EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD)
TFS=(5m 15m 1h)

for sym in "${SYMBOLS[@]}"; do
  for tf in "${TFS[@]}"; do
    echo "[backfill-pricing] $sym $tf"
    node scripts/backfill-features.js "$sym" "$tf" 95 --features=features_pricing --lookback=200 --skip-lifecycle
  done
done

echo "[backfill-pricing] Done"
