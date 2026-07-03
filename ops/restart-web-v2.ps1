#requires -Version 5.1
<#
.SYNOPSIS
  Build and restart the tradzfx-v2 web app under PM2 on port 3003.

.DESCRIPTION
  1. Builds the entire V2 workspace (pnpm -r build).
  2. Stops any existing tz-web-v2 PM2 process.
  3. Starts tz-web-v2 via C:\tradzfx-v2\ecosystem.config.js.

  Run this after code or migration changes. Total build time is several minutes,
  so consider running it in a background task during quiet hours.
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

Write-Host "Building V2 workspace..." -ForegroundColor Cyan
& pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

& pnpm -r build
if ($LASTEXITCODE -ne 0) { throw "pnpm -r build failed" }

Write-Host "Restarting tz-web-v2 under PM2..." -ForegroundColor Cyan
& pm2 delete tz-web-v2
# pm2 delete returns non-zero if the process does not exist; ignore that.

& pm2 start ecosystem.config.js --only tz-web-v2
if ($LASTEXITCODE -ne 0) { throw "pm2 start failed" }

& pm2 save
Write-Host "tz-web-v2 restarted on port 3003." -ForegroundColor Green
