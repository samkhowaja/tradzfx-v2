#requires -Version 5.1
<#
.SYNOPSIS
  Health monitor for the V2 web app + standalone ingestion server.

.DESCRIPTION
  Verifies that the tz-web-v2 and tz-ingestion PM2 processes are online, that
  the public /api/health endpoint and the MT5 ingest heartbeat respond, and
  that the ingestion server (port 3004) can reach PostgreSQL.

  SELF-HEAL (added after the Jul 6-7 39h outage): if PostgreSQL itself is
  reachable on 127.0.0.1:5432 but either app reports database.connected=false,
  the app pools are wedged on admin-killed sockets. We recycle
  `tz-ingestion` + `tz-web-v2` once, guarded by a 10-minute cooldown marker
  (logs/.last-auto-recycle) so a flapping DB cannot cause a restart loop.
  Repo scripts must NEVER restart/terminate Postgres itself (native Windows
  service, managed out-of-repo).

  Emits an alert and exits non-zero on any failure.
#>

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
. (Join-Path $scriptDir 'Alert-Common.ps1')

$V2Root           = 'C:\tradzfx-v2'
$HealthUrl        = 'http://127.0.0.1:3003/api/health'
$HeartbeatUrl     = 'http://127.0.0.1:3003/api/ingest/heartbeat'
$IngestionHealth  = 'http://127.0.0.1:3004/health'
$ApiKey           = $env:TM_MT5_API_KEY
if (-not $ApiKey) { throw "TM_MT5_API_KEY is not set" }
$CooldownFile     = Join-Path $V2Root 'logs\.last-auto-recycle'
$CooldownMinutes  = 10

$failures = @()
$notes    = @()

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

# 1. PM2 process status (web + ingestion + freshness monitor)
foreach ($proc in @('tz-web-v2', 'tz-ingestion', 'tz-feature-freshness')) {
    $pm2Status = & pm2 status $proc --no-color 2>&1
    if ($LASTEXITCODE -ne 0 -or ($pm2Status -join '`n') -notmatch 'online') {
        $failures += "PM2 process '$proc' is not online."
    }
}

function Get-JsonEvenOnError([string]$Url) {
    # /api/health returns 503 when 'degraded' (e.g. stale weekend candles) with
    # a valid JSON body; Invoke-RestMethod throws on non-2xx, so read the body
    # from the exception to still see database.connected.
    try {
        return Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec 10
    } catch {
        $webResp = $_.Exception.Response
        if ($null -eq $webResp) { return $null }
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

# 2. Public health endpoint
$dbConnected = $null
$health = Get-JsonEvenOnError -Url $HealthUrl
if ($null -eq $health) {
    $failures += "/api/health request failed or returned no body."
} else {
    $dbConnected = ($health.database.connected -eq $true)
    if ($health.status -ne 'ok' -or -not $dbConnected) {
        $failures += "/api/health returned degraded status: $($health | ConvertTo-Json -Compress)"
    }
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

# 4. Standalone ingestion server health (DB reachability + spool backlog)
$ingestionDb = $null
try {
    $ingest = Invoke-RestMethod -Uri $IngestionHealth -Method GET -TimeoutSec 10
    $ingestionDb = ($ingest.db -eq $true)
    if (-not $ingestionDb) {
        $failures += "ingestion :3004 cannot reach PostgreSQL (db=false)."
    }
    if ($ingest.spoolFiles -gt 0) {
        $notes += "ingest spool backlog: $($ingest.spoolFiles) file(s), $($ingest.spoolBytes) bytes pending drain."
    }
} catch {
    $failures += "ingestion :3004 /health request failed: $_"
}

# 5. Self-heal: DB port up but an app pool wedged -> recycle the apps once.
$dbPortUp = Test-TcpPort -Port 5432
$poolWedged = ($dbConnected -eq $false) -or ($ingestionDb -eq $false)
if ($dbPortUp -and $poolWedged) {
    $cooldownActive = $false
    if (Test-Path $CooldownFile) {
        $last = (Get-Item $CooldownFile).LastWriteTime
        if ($last -gt (Get-Date).AddMinutes(-$CooldownMinutes)) { $cooldownActive = $true }
    }
    if ($cooldownActive) {
        $notes += "self-heal recycle skipped (cooldown active; last recycle within ${CooldownMinutes}m)."
    } else {
        try {
            & pm2 restart tz-ingestion tz-web-v2 --no-color 2>&1 | Out-Null
            New-Item -ItemType File -Path $CooldownFile -Force | Out-Null
            $notes += "SELF-HEAL: PostgreSQL is up but app pool(s) were wedged; restarted tz-ingestion + tz-web-v2."
            # Give the recycled apps a moment, then re-probe the web health endpoint.
            Start-Sleep -Seconds 8
            try {
                $health2 = Invoke-RestMethod -Uri $HealthUrl -Method GET -TimeoutSec 15
                if ($health2.database.connected -eq $true) {
                    $notes += "post-recycle /api/health: database.connected=true."
                    # Clear the earlier degraded-status failures; the system recovered.
                    $failures = $failures | Where-Object { $_ -notmatch 'database|PostgreSQL|degraded' }
                }
            } catch {
                $notes += "post-recycle /api/health still failing: $_"
            }
        } catch {
            $failures += "self-heal pm2 restart failed: $_"
        }
    }
}

# 6. Feature freshness check: query the most stale leaf feature.
# If any leaf engine feature is > 60 min stale for XAUUSD, that's actionable.
try {
    $freshSql = @"
SELECT table_name, ROUND(EXTRACT(EPOCH FROM NOW() - MAX(ts))/60) AS age_min
FROM (
    SELECT 'features_moving_average' AS table_name, ts FROM features_moving_average WHERE symbol='XAUUSD'
    UNION ALL
    SELECT 'features_bollinger', ts FROM features_bollinger WHERE symbol='XAUUSD'
    UNION ALL
    SELECT 'features_keltner', ts FROM features_keltner WHERE symbol='XAUUSD'
    UNION ALL
    SELECT 'features_atr', ts FROM features_atr WHERE symbol='XAUUSD'
    UNION ALL
    SELECT 'features_pricing', ts FROM features_pricing WHERE symbol='XAUUSD'
    UNION ALL
    SELECT 'features_spread', ts FROM features_spread WHERE symbol='XAUUSD'
    UNION ALL
    SELECT 'features_bias', ts FROM features_bias WHERE symbol='XAUUSD'
    UNION ALL
    SELECT 'features_zone', ts FROM features_zone WHERE symbol='XAUUSD'
) sub
GROUP BY table_name
HAVING EXTRACT(EPOCH FROM NOW() - MAX(ts))/60 > 60
ORDER BY age_min DESC
"@
    $freshRows = & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h localhost -U postgres -d tradzfx_v2 -t -A -F "|" -c $freshSql 2>&1
    if ($LASTEXITCODE -eq 0 -and $freshRows) {
        foreach ($row in $freshRows) {
            if ($row -match '(.+?)\|(\d+)') {
                $notes += "STALE FEATURE: $($Matches[1]) aged $($Matches[2])min"
            }
        }
    }
} catch {
    # Feature freshness check is best-effort; don't fail the health check over it
    $notes += "feature freshness query failed: $_"
}

if ($failures.Count -gt 0) {
    $message = "V2 health check failed:`n" + ($failures -join "`n")
    if ($notes.Count -gt 0) { $message += "`nNotes:`n" + ($notes -join "`n") }
    Send-OpsAlert -Message $message -Level Error
    exit 1
}

# 6. Pipeline health + alerts: stale pipelines, rejection spikes,
#    consecutive losses, drawdown, zero-signal symbols.
try {
    $alerts = Invoke-RestMethod -Uri 'http://127.0.0.1:3003/api/v2/pipeline/alerts' -Method GET -TimeoutSec 10
    if ($alerts.ok -eq $true) {
        if ($alerts.alertCount -gt 0) {
            foreach ($alert in $alerts.alerts) {
                $msg = "[$($alert.severity)] $($alert.category): $($alert.message)"
                if ($alert.severity -eq 'critical') {
                    $failures += $msg
                    Send-OpsAlert -Message $msg -Level Error
                } else {
                    $notes += $msg
                    Send-OpsAlert -Message $msg -Level Warning
                }
            }
        }
        if ($alerts.stats) {
            $notes += "Active variants: $($alerts.stats.activeVariants) | Orders 24h: $($alerts.stats.totalOrders24h) | Consecutive losses: $($alerts.stats.consecutiveLosses) | 7d R: $($alerts.stats.drawdownR7d)"
        }
    }
} catch {
    $notes += "Pipeline alerts endpoint unreachable: $_"
}

$passMsg = 'V2 health check passed.'
if ($notes.Count -gt 0) { $passMsg += "`n" + ($notes -join "`n") }
Send-OpsAlert -Message $passMsg -Level Info
exit 0
