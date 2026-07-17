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

Write-TerminalLog "Startup check scheduled after ${StartupDelaySec}s delay"
Start-Sleep -Seconds $StartupDelaySec
Assert-TerminalIfMissing "MT5" "terminal64" $Mt5Path
Assert-TerminalIfMissing "MT4" "terminal" $Mt4Path
