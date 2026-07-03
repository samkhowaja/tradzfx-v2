@echo off
set NGINX_EXE="C:\Users\Salman\AppData\Local\Microsoft\WinGet\Packages\nginxinc.nginx_Microsoft.Winget.Source_8wekyb3d8bbwe\nginx-1.29.6\nginx.exe"
set NGINX_CONF=C:\tradzfx-v2\conf\nginx.conf

echo [%date% %time%] Restarting nginx for tradzfx-v2 config... >> C:\tradzfx-v2\logs\nginx-restart.log
taskkill /F /IM nginx.exe >> C:\tradzfx-v2\logs\nginx-restart.log 2>&1
timeout /t 2 /nobreak >nul
cd /d C:\tradzfx-v2
%NGINX_EXE% -t -c %NGINX_CONF% >> C:\tradzfx-v2\logs\nginx-restart.log 2>&1
%NGINX_EXE% -c %NGINX_CONF% >> C:\tradzfx-v2\logs\nginx-restart.log 2>&1
echo [%date% %time%] nginx started with exit code %errorlevel% >> C:\tradzfx-v2\logs\nginx-restart.log
