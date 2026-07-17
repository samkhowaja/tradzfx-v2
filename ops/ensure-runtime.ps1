#Requires -Version 5.1
<#
.SYNOPSIS
    Ensures runtime dependencies for tradzfx-v2 are present.
.DESCRIPTION
    - Creates nginx temp directories so nginx never fails with
      "CreateFile() ... client_body_temp failed" on startup.
    - Verifies required environment variables are set.
    - Checks that the ingestion server and web app ports are not blocked.
#>
param(
    [string]$ProjectRoot = "C:\tradzfx-v2",
    [switch]$CheckPorts
)

$ErrorActionPreference = "Stop"

$required = @("TM_DB_PASSWORD")
$missing = $required | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
if ($missing) {
    Write-Warning "Missing environment variables: $($missing -join ', ')"
}

$dirs = @(
    "$ProjectRoot\temp\client_body_temp",
    "$ProjectRoot\temp\proxy_temp",
    "$ProjectRoot\temp\fastcgi_temp",
    "$ProjectRoot\temp\uwsgi_temp",
    "$ProjectRoot\temp\scgi_temp"
)
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Host "Created $d"
    }
}

if ($CheckPorts) {
    $ports = @(3003, 3004)
    foreach ($p in $ports) {
        $listener = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            Write-Host "Port $p is in use by PID $($listener.OwningProcess)"
        } else {
            Write-Host "Port $p is free"
        }
    }
}

Write-Host "Runtime check complete."
