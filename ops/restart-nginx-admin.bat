@echo off
echo [%date% %time%] Restarting nginx for tradzfx-v2 config... >> C:\tradzfx-v2\logs\nginx-restart.log
taskkill /F /IM nginx.exe >> C:\tradzfx-v2\logs\nginx-restart.log 2>&1
timeout /t 2 /nobreak >nul
cd /d C:\tradzfx-v2
nginx -c C:\tradzfx-v2\conf\nginx.conf >> C:\tradzfx-v2\logs\nginx-restart.log 2>&1
echo [%date% %time%] nginx started with exit code %errorlevel% >> C:\tradzfx-v2\logs\nginx-restart.log
