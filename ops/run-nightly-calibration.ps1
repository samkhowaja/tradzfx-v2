# Nightly analyzer backtest calibration runner.
# Intended to be scheduled via Windows Task Scheduler or cron.
#
# Optional env overrides:
#   $env:BACKTEST_DAYS = "90"
#   $env:BACKTEST_SYMBOLS = "EURUSD,XAUUSD"
#   $env:BACKTEST_TFS = "15m,1h,4h"

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$days = $env:BACKTEST_DAYS ?? "90"
$symbols = $env:BACKTEST_SYMBOLS ?? ""
$tfs = $env:BACKTEST_TFS ?? "15m,1h,4h"

$env:BACKTEST_DAYS = $days
$env:BACKTEST_SYMBOLS = $symbols
$env:BACKTEST_TFS = $tfs

Write-Host "[nightly-calibration] Starting calibration: days=$days symbols=$symbols tfs=$tfs"

& pnpm exec tsx packages/analyzerBacktest/scripts/nightlyCalibration.ts

if ($LASTEXITCODE -ne 0) {
    Write-Error "[nightly-calibration] failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "[nightly-calibration] completed"
