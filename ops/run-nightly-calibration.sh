#!/usr/bin/env bash
# Nightly analyzer backtest calibration runner.
set -euo pipefail

cd "$(dirname "$0")/.."

export BACKTEST_DAYS="${BACKTEST_DAYS:-90}"
export BACKTEST_SYMBOLS="${BACKTEST_SYMBOLS:-}"
export BACKTEST_TFS="${BACKTEST_TFS:-15m,1h,4h}"

echo "[nightly-calibration] Starting calibration: days=$BACKTEST_DAYS symbols=$BACKTEST_SYMBOLS tfs=$BACKTEST_TFS"

pnpm exec tsx packages/analyzerBacktest/scripts/nightlyCalibration.ts

echo "[nightly-calibration] completed"
