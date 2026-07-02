#requires -Version 5.1
<#
.SYNOPSIS
  Health monitor for the V2 web app.

.DESCRIPTION
  Verifies that the tm-web-v2 PM2 process is online and that the public
  /api/health endpoint and the MT5 ingest heartbeat are responding.
  Emits an alert and exits non-zero on any failure.
#>

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
. (Join-Path $scriptDir 'Alert-Common.ps1')

$HealthUrl     = 'http://127.0.0.1:3003/api/health'
$HeartbeatUrl  = 'http://127.0.0.1:3003/api/ingest/heartbeat'
$ApiKey        = $env:TM_MT5_API_KEY
if (-not $ApiKey) { throw "TM_MT5_API_KEY is not set" }
$ProcessName   = 'tm-web-v2'

$failures = @()

# 1. PM2 process status
$pm2Status = & pm2 status $ProcessName --no-color 2>&1
if ($LASTEXITCODE -ne 0 -or ($pm2Status -join '`n') -notmatch 'online') {
    $failures += "PM2 process '$ProcessName' is not online."
}

# 2. Public health endpoint
try {
    $health = Invoke-RestMethod -Uri $HealthUrl -Method GET -TimeoutSec 10
    if ($health.status -ne 'ok' -or $health.database.connected -ne $true) {
        $failures += "/api/health returned degraded status: $($health | ConvertTo-Json -Compress)"
    }
} catch {
    $failures += "/api/health request failed: $_"
}

# 3. Ingest heartbeat (requires API key)
try {
    $heartbeat = Invoke-RestMethod -Uri $HeartbeatUrl -Method POST -Headers @{'X-API-Key' = $ApiKey} -TimeoutSec 10
    if ($heartbeat.ok -ne $true) {
        $failures += "/api/ingest/heartbeat returned unexpected: $($heartbeat | ConvertTo-Json -Compress)"
    }
} catch {
    $failures += "/api/ingest/heartbeat request failed: $_"
}

if ($failures.Count -gt 0) {
    $message = "V2 health check failed:`n" + ($failures -join "`n")
    Send-OpsAlert -Message $message -Level Error
    exit 1
}

Send-OpsAlert -Message 'V2 health check passed.' -Level Info
exit 0
