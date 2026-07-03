#!/usr/bin/env pwsh
# Solid deployment script for tradzfx-v2.
# Builds the monorepo from C:\tradzfx-v2, applies pending DB migrations,
# and switches PM2 to run the canonical codebase.

$ErrorActionPreference = "Stop"
Set-Location C:\tradzfx-v2

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

Write-Host "[deploy] Waiting for services to come up..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

$health = Invoke-RestMethod -Uri http://127.0.0.1:3003/api/health -TimeoutSec 10
Write-Host "[deploy] Health check: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green

Write-Host "[deploy] Done. Reload the MT5 EA so it registers with the new build." -ForegroundColor Green
