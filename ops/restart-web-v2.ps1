#requires -Version 5.1
<#
.SYNOPSIS
  Build and restart the tradzfx-v2 web app under PM2 on port 3003.

.DESCRIPTION
  Restart ordering (learned from the Jul 6-7 ~39h ingest outage):
    1. GATE: PostgreSQL must be reachable on 127.0.0.1:5432. ABORT if not.
       Repo scripts must NEVER restart/terminate Postgres (native Windows
       service, managed out-of-repo) - a prior out-of-repo admin-kill during
       a web restart dropped ingestion for ~39h.
    2. GATE: the standalone ingestion server (tz-ingestion, port 3004) must be
       online and DB-connected BEFORE the web app is touched, so EA bar posts
       keep flowing throughout the web restart.
    3. Build the workspace, then restart ONLY tz-web-v2.
    4. GATE: poll /api/health until 200 + database.connected (fail loud on
       timeout) instead of declaring success blindly.
  nginx needs no reload: its upstream to 3003 reconnects automatically.
  Restart the MT5/MT4 terminals LAST (ops/restart_mt5.ps1) and reload the EA.

  Run after code or migration changes. Total build time is several minutes,
  so consider running it in a background task during quiet hours.
#>

$ErrorActionPreference = 'Stop'

$V2Root = 'C:\tradzfx-v2'

function Test-TcpPort([int]$Port, [int]$TimeoutMs = 2000) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-JsonEvenOnError([string]$Url) {
    # Invoke-RestMethod throws on non-2xx, but /api/health intentionally returns
    # 503 when 'degraded' (e.g. stale weekend candles) with a valid JSON body.
    # Read the body from the exception so callers can still inspect fields
    # like database.connected.
    try {
        return Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec 10
    } catch {
        $webResp = $_.Exception.Response
        if ($webResp -eq $null) { return $null }
        try {
            $stream = $webResp.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            if ([string]::IsNullOrWhiteSpace($body)) { return $null }
            return ($body | ConvertFrom-Json)
        } catch {
            return $null
        }
    }
}

function Wait-ForHealthy([string]$Url, [scriptblock]$Ok, [int]$TimeoutSec, [string]$What) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $resp = Get-JsonEvenOnError -Url $Url
        if ($resp -ne $null -and (& $Ok $resp)) {
            Write-Host "  OK: $What" -ForegroundColor Green
            return
        }
        Start-Sleep -Seconds 3
    }
    throw "Timed out after ${TimeoutSec}s waiting for $What ($Url)"
}

# Ensure log directory exists
$LogsDir = Join-Path $V2Root 'logs'
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

cd $V2Root

# Load environment variables from .env.local so PM2 inherits DB credentials.
$EnvFile = Join-Path $V2Root '.env.local'
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}

# -- GATE 1: PostgreSQL reachable --------------------------------------------
Write-Host "Gate 1/4: checking PostgreSQL on 127.0.0.1:5432..." -ForegroundColor Cyan
if (-not (Test-TcpPort -Port 5432)) {
    throw "PostgreSQL is not reachable on 127.0.0.1:5432. Aborting - fix the DB first. (This script never restarts Postgres.)"
}
Write-Host "  OK: PostgreSQL reachable" -ForegroundColor Green

# -- GATE 2: ingestion server online + DB-connected --------------------------
Write-Host "Gate 2/4: ensuring tz-ingestion (port 3004) is online and DB-connected..." -ForegroundColor Cyan
$ingestPid = (& pm2 pid tz-ingestion 2>$null | Select-Object -First 1)
$ingestOnline = $ingestPid -match '^\d+$' -and [int]$ingestPid -gt 0
if (-not $ingestOnline) {
    Write-Host "  tz-ingestion not online; starting it..." -ForegroundColor Yellow
    & pm2 start ecosystem.config.js --only tz-ingestion
    if ($LASTEXITCODE -ne 0) { throw "pm2 start tz-ingestion failed" }
}
Wait-ForHealthy -Url 'http://127.0.0.1:3004/health' -TimeoutSec 60 -What 'tz-ingestion db-connected' -Ok { param($r) $r.db -eq $true }

# -- Build --------------------------------------------------------------------
Write-Host "Building V2 workspace..." -ForegroundColor Cyan
& pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

& pnpm -r build
if ($LASTEXITCODE -ne 0) { throw "pnpm -r build failed" }

# -- Restart ONLY the web app -------------------------------------------------
Write-Host "Restarting canonical web app under PM2..." -ForegroundColor Cyan
@('tm-web-v2', 'tz-web-v2') | ForEach-Object {
    $name = $_
    $pidValue = (& pm2 pid $name 2>$null | Select-Object -First 1)
    if ($pidValue -match '^\d+$' -and [int]$pidValue -gt 0) {
        & pm2 delete $name
        if ($LASTEXITCODE -ne 0) { throw "pm2 delete $name failed" }
    }
}

& pm2 start ecosystem.config.js --only tz-web-v2
if ($LASTEXITCODE -ne 0) { throw "pm2 start failed" }

& pm2 save

# -- GATE 3: web app up + DB-connected ----------------------------------------
# NOTE: we gate on database.connected, NOT status=='ok': /api/health returns
# 'degraded' whenever candles are >15m old, which is EXPECTED on weekends /
# holidays when markets are closed. Requiring 'ok' would false-fail every
# Saturday. The monitor (ops/monitor-v2-health.ps1) owns freshness alerting.
Write-Host "Gate 3/4: waiting for tz-web-v2 to come up DB-connected..." -ForegroundColor Cyan
Wait-ForHealthy -Url 'http://127.0.0.1:3003/api/health' -TimeoutSec 180 -What 'tz-web-v2 /api/health database.connected' -Ok {
    param($r) $r.database.connected -eq $true
}

# -- GATE 4: ingestion still healthy after the web restart --------------------
Write-Host "Gate 4/4: re-checking tz-ingestion after web restart..." -ForegroundColor Cyan
Wait-ForHealthy -Url 'http://127.0.0.1:3004/health' -TimeoutSec 30 -What 'tz-ingestion still db-connected' -Ok { param($r) $r.db -eq $true }

Write-Host "tz-web-v2 restarted and verified healthy on port 3003." -ForegroundColor Green
Write-Host "Reminder: if terminals also need a restart, do them LAST (ops/restart_mt5.ps1) and reload the EA." -ForegroundColor DarkGray
