#!/usr/bin/env bash
# Backfill V2 features for all major forex pairs.
# Run: bash scripts/backfill-forex-all.sh
set -euo pipefail

PAIRS=(EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY)
TFS=(15m 5m 1h)
START="2026-02-11"
END="2026-06-19"

for sym in "${PAIRS[@]}"; do
  for tf in "${TFS[@]}"; do
    echo "[backfill-forex-all] === ${sym} ${tf} ==="
    node scripts/backfill-features.js "${sym}" "${tf}" 180 5 --start="${START}" --end="${END}" || true
  done
done

echo "[backfill-forex-all] All pairs backfilled."
