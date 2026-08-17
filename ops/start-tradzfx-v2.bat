@echo off
setlocal
cd /d C:\tradzfx-v2

echo Starting tradzfx-v2 PM2 services...
pm2 start ecosystem.config.js --update-env
if errorlevel 1 (
  echo PM2 start failed.
  pause
  exit /b 1
)
pm2 save
pm2 status
pause
