#!/usr/bin/env pwsh
# Solid deployment script for tradzfx-v2.
# Builds the monorepo from C:\tradzfx-v2, applies pending DB migrations,
# and switches PM2 to run the canonical codebase.

$ErrorActionPreference = "Stop"
Set-Location C:\tradzfx-v2

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
    # /api/health intentionally returns 503 when 'degraded' (e.g. stale weekend
    # candles) with a valid JSON body; Invoke-RestMethod throws on non-2xx, so
    # read the body from the exception to still see database.connected.
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
        if ($resp -ne $null -and (& $Ok $resp)) { Write-Host "  OK: $What" -ForegroundColor Green; return }
        Start-Sleep -Seconds 3
    }
    throw "Timed out after ${TimeoutSec}s waiting for $What ($Url)"
}

# GATE: PostgreSQL must be up before we touch anything. Deploy scripts must
# NEVER restart/terminate Postgres (native service, managed out-of-repo).
Write-Host "[deploy] Gate: checking PostgreSQL on 127.0.0.1:5432..." -ForegroundColor Cyan
if (-not (Test-TcpPort -Port 5432)) {
    throw "PostgreSQL is not reachable on 127.0.0.1:5432. Aborting deploy - fix the DB first."
}

# Load environment variables from .env.local so PM2 inherits DB credentials.
$EnvFile = Join-Path (Get-Location) '.env.local'
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}

Write-Host "[deploy] Installing dependencies..." -ForegroundColor Cyan
pnpm install

Write-Host "[deploy] Running test suite..." -ForegroundColor Cyan
pnpm -w run test

Write-Host "[deploy] Building packages and web app..." -ForegroundColor Cyan
pnpm -r build

Write-Host "[deploy] Applying DB migrations..." -ForegroundColor Cyan
pnpm db:migrate

Write-Host "[deploy] Stopping any previous tradzfx-v2 PM2 services..." -ForegroundColor Cyan
@("tm-web-v2", "tm-web-v2-ninja-trail", "tz-web-v2", "tz-dxy-synthetic") | ForEach-Object {
    $name = $_
    $proc = pm2 show $name 2>$null | Out-String
    if ($proc -match "status") {
        pm2 delete $name 2>$null | Out-Null
        Write-Host "  - stopped $name" -ForegroundColor DarkGray
    }
}

Write-Host "[deploy] Starting services from C:\tradzfx-v2\ecosystem.config.js..." -ForegroundColor Cyan
pm2 start C:/tradzfx-v2/ecosystem.config.js
pm2 save

Write-Host "[deploy] Waiting for services to come up (gated)..." -ForegroundColor Cyan
Wait-ForHealthy -Url 'http://127.0.0.1:3004/health' -TimeoutSec 90 -What 'tz-ingestion db-connected' -Ok { param($r) $r.db -eq $true }
# Gate on database.connected, not status=='ok': /api/health is 'degraded' when
# candles are >15m old, which is EXPECTED on weekends/holidays (markets closed).
Wait-ForHealthy -Url 'http://127.0.0.1:3003/api/health' -TimeoutSec 240 -What 'tz-web-v2 /api/health database.connected' -Ok {
    param($r) $r.database.connected -eq $true
}

Write-Host "[deploy] Done. Reload the MT5 EA so it registers with the new build." -ForegroundColor Green
