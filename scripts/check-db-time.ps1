#requires -Version 5.1
<#
.SYNOPSIS
  Check the latest candle timestamp in tradzfx_v2 against the current
  system UTC clock.

.EXAMPLE
  .\scripts\check-db-time.ps1
  .\scripts\check-db-time.ps1 -Symbol EURUSD
#>

param(
    [string]$Symbol = 'XAUUSD'
)

$ErrorActionPreference = 'Stop'

$query = @"
SELECT
  '$Symbol' AS symbol,
  MAX(ts) AS last_bar,
  NOW() AS db_now,
  EXTRACT(EPOCH FROM (NOW() - MAX(ts))) / 60.0 AS minutes_behind_now
FROM candles_1m
WHERE symbol = '$Symbol';
"@

# Prefer psql if available.
$psql = Get-Command psql.exe -ErrorAction SilentlyContinue
if ($psql) {
    if (-not $env:TM_DB_PASSWORD) { throw "TM_DB_PASSWORD is not set" }
    $env:PGPASSWORD = $env:TM_DB_PASSWORD
    $dbName = $env:TM_DB_NAME ?? 'tradzfx_v2'
    $result = & psql.exe -h localhost -p 5432 -U postgres -d $dbName -t -A -F ',' -c $query
    Write-Host "Result (symbol,last_bar,db_now,minutes_behind_now):" -ForegroundColor Cyan
    Write-Host $result
} else {
    Write-Host "psql not found; run instead: node scripts/check-db-time.js $Symbol" -ForegroundColor Yellow
}

$systemUtc = (Get-Date).ToUniversalTime()
Write-Host "System UTC now: $($systemUtc.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan
Write-Host ""
Write-Host "Interpretation:" -ForegroundColor Green
Write-Host "  - DB last_bar is the open time of the most recent M1 candle as reported by MT5."
Write-Host "  - MT5 reports bar times in BROKER/SERVER time, not necessarily UTC."
Write-Host "  - If minutes_behind_now is > 5, the feed is stale on the server."
Write-Host "  - If DB last_bar is ahead of UTC, the broker server is east of UTC (e.g. UTC+2/+3)."
