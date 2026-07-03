#requires -Version 5.1
<#
.SYNOPSIS
  Start the tradzfx-v2 web app under PM2 on port 3003.

.DESCRIPTION
  Assumes the V2 workspace has already been built (pnpm -r build).
  Uses C:\tradzfx-v2\ecosystem.config.js. If a tz-web-v2 process is already running,
  this script will fail — use restart-web-v2.ps1 instead.
#>

$ErrorActionPreference = 'Stop'

$V2Root = 'C:\tradzfx-v2'

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

Write-Host "Starting tz-web-v2 on port 3003..." -ForegroundColor Cyan
& pm2 start ecosystem.config.js --only tz-web-v2
if ($LASTEXITCODE -ne 0) { throw "pm2 start failed" }

& pm2 save
Write-Host "tz-web-v2 started. Run 'pm2 logs tz-web-v2' to follow logs." -ForegroundColor Green
