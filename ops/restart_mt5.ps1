#Requires -Version 5.1
<#
.SYNOPSIS
    Restarts the MetaTrader 5 terminal(s) gracefully.
.DESCRIPTION
    - Detects running terminal64 processes and tries a graceful close first.
    - Falls back to force-kill after a timeout.
    - Restarts each stopped terminal from its original path (or $env:MT5_TERMINAL_PATH).
    - Verifies the process respawned.
#>
param(
    [string]$TerminalPath = $env:MT5_TERMINAL_PATH,
    [int]$GracefulTimeoutSec = 10,
    [int]$VerifyTimeoutSec = 30
)

$DefaultPath = "C:\Program Files\MetaTrader 5\terminal64.exe"

function Get-MtProcesses($name, $pathLike) {
    return Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -like $pathLike
    }
}

function Stop-Terminal($proc, [int]$timeoutSec) {
    Write-Host "  Requesting graceful close for PID $($proc.Id) ..."
    $proc.CloseMainWindow() | Out-Null
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        try {
            $still = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
            if (-not $still) { return $true }
        } catch { return $true }
        Start-Sleep -Milliseconds 500
    }
    Write-Warning "  Graceful close timed out; force-killing PID $($proc.Id)"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    return (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue))
}

function Start-Terminal($path) {
    if (-not (Test-Path $path)) {
        Write-Error "Terminal executable not found: $path"
        return $null
    }
    $dir = Split-Path -Parent $path
    return Start-Process -FilePath $path -WorkingDirectory $dir -PassThru
}

$processes = Get-MtProcesses "terminal64" "*MetaTrader 5*"
$pathsToStart = @()

if ($processes) {
    foreach ($proc in $processes) {
        $path = if ($TerminalPath) { $TerminalPath } else { $proc.Path }
        $pathsToStart += $path
        Write-Host "Stopping MT5 terminal PID $($proc.Id) at $path"
        Stop-Terminal $proc $GracefulTimeoutSec | Out-Null
    }
} else {
    Write-Host "No running MT5 terminal found."
    $pathsToStart += (if ($TerminalPath) { $TerminalPath } else { $DefaultPath })
}

Write-Host "Starting MT5 terminal(s)..."
$started = @()
foreach ($path in ($pathsToStart | Select-Object -Unique)) {
    $proc = Start-Terminal $path
    if ($proc) { $started += $proc.Id }
}

if (-not $started) {
    Write-Error "Failed to start any MT5 terminal."
    exit 1
}

Write-Host "Verifying restart..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$verified = $false
while ($sw.Elapsed.TotalSeconds -lt $VerifyTimeoutSec) {
    $running = Get-MtProcesses "terminal64" "*MetaTrader 5*"
    if ($running.Count -ge $started.Count) {
        $verified = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

if ($verified) {
    Write-Host "MT5 restart verified. Running terminals: $(($running | Select-Object -ExpandProperty Id) -join ', ')"
    exit 0
} else {
    Write-Error "MT5 restart verification failed."
    exit 1
}
