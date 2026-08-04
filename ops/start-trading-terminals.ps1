#Requires -Version 5.1
<#
.SYNOPSIS
    Starts exactly one MT5 terminal and one MT4 terminal at Windows sign-in.
.DESCRIPTION
    Waits for Windows restart-app restoration, then starts only missing terminals.
    Prevents a direct startup shortcut from creating a second MT5 process that
    shares the same data folder and causes history-file sharing error 32.
#>
param(
    [int]$StartupDelaySec = 20,
    [int]$ServerWaitSec = 180,
    [string]$Mt5Path = $env:MT5_TERMINAL_PATH,
    [string]$Mt4Path = $env:MT4_TERMINAL_PATH
)

$ErrorActionPreference = "Stop"
if (-not $Mt5Path) { $Mt5Path = "C:\Program Files\MetaTrader 5\terminal64.exe" }
if (-not $Mt4Path) { $Mt4Path = "C:\Program Files (x86)\MetaTrader 4\terminal.exe" }

$logDir = Join-Path $PSScriptRoot "..\logs"
$logFile = Join-Path $logDir "terminal-startup.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-TerminalLog([string]$Message) {
    Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Get-TerminalProcess([string]$Name, [string]$ExpectedPath) {
    Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -eq $ExpectedPath } catch { $false }
    }
}

function Assert-TerminalIfMissing([string]$Label, [string]$Name, [string]$Path) {
    $running = @(Get-TerminalProcess $Name $Path)
    if ($running.Count -gt 0) {
        Write-TerminalLog "$Label already running; PID(s): $($running.Id -join ', ')"
        return
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-TerminalLog "ERROR: $Label executable missing: $Path"
        return
    }
    $proc = Start-Process -FilePath $Path -WorkingDirectory (Split-Path -Parent $Path) -PassThru
    Write-TerminalLog "$Label started; PID: $($proc.Id)"
}

function Wait-ForServer([string]$Url, [string]$Label, [int]$TimeoutSec) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 5 -UseBasicParsing
            $body = $null
            try { $body = $response.Content | ConvertFrom-Json } catch { }
            $webDbReady = $null -ne $body -and $null -ne $body.database -and $body.database.connected -eq $true
            $ingestDbReady = $null -ne $body -and $body.db -eq $true
            if (($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) -or $webDbReady -or $ingestDbReady) {
                Write-TerminalLog "$Label reachable: HTTP $($response.StatusCode)"
                return $true
            }
        } catch {
            Write-TerminalLog "$Label not ready: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    Write-TerminalLog "ERROR: timed out waiting for $Label ($Url)"
    return $false
}

Write-TerminalLog "Startup check scheduled after ${StartupDelaySec}s delay"
Start-Sleep -Seconds $StartupDelaySec

# MT5 must start after both HTTP services. PM2 resurrect order is not a
# readiness guarantee; starting EA first causes WebRequest error 401/404 or
# connection failure while Next.js/nginx is still binding ports.
if (-not (Wait-ForServer "http://127.0.0.1:3004/health" "tz-ingestion" $ServerWaitSec)) { exit 1 }
if (-not (Wait-ForServer "http://127.0.0.1:3003/api/health" "tz-web-v2" $ServerWaitSec)) { exit 1 }

Assert-TerminalIfMissing "MT5" "terminal64" $Mt5Path
Assert-TerminalIfMissing "MT4" "terminal" $Mt4Path
