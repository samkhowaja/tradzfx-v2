#requires -Version 5.1
<#
.SYNOPSIS
  Start the TradeMentor V2 web app under PM2 on port 3003.

.DESCRIPTION
  Assumes the V2 workspace has already been built (pnpm -r build).
  Uses v2/ecosystem.config.js. If a tm-web-v2 process is already running,
  this script will fail — use restart-web-v2.ps1 instead.
#>

$ErrorActionPreference = 'Stop'

$V2Root = 'C:\TradeMentor\v2'

# Ensure log directory exists
$LogsDir = Join-Path $V2Root 'logs'
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

cd $V2Root

Write-Host "Starting tm-web-v2 on port 3003..." -ForegroundColor Cyan
& pm2 start ecosystem.config.js
if ($LASTEXITCODE -ne 0) { throw "pm2 start failed" }

& pm2 save
Write-Host "tm-web-v2 started. Run 'pm2 logs tm-web-v2' to follow logs." -ForegroundColor Green
