@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ProjectsDashboard - Showcase launcher
set "PORT=4200"
set "BASE=http://127.0.0.1:%PORT%/"
set "LOG=data\logs\showcase-launcher.out"

echo [showcase] Checking prerequisites...
where node >nul 2>&1 || ( echo [showcase] ERROR: Node.js is not installed or not on PATH. & goto :fail )
if not exist node_modules (
  echo [showcase] node_modules missing, running npm install...
  call npm install || ( echo [showcase] ERROR: npm install failed. & goto :fail )
)
if not exist data\logs mkdir data\logs

curl.exe -s -o NUL -m 2 "%BASE%" && (
  echo [showcase] Already running on port %PORT%, not starting a second copy.
  goto :open
)

echo [showcase] Building and starting the showcase on port %PORT%...
start "ProjectsDashboard Showcase (close this window to stop it)" /min cmd /c "node showcase\build.mjs && node showcase\serve.mjs > %LOG% 2>&1"

echo [showcase] Waiting for it to respond...
for /l %%i in (1,1,60) do (
  curl.exe -s -o NUL -m 2 "%BASE%" && goto :ready
  ping -n 2 127.0.0.1 >nul
)
echo [showcase] ERROR: no response after 60 seconds. Last log lines:
if exist %LOG% type %LOG%
goto :fail

:ready
echo [showcase] Server is up.
:open
echo [showcase] Opening %BASE%
start "" "%BASE%"
echo [showcase] Done. The server keeps running in its own minimized window.
timeout /t 4 >nul
exit /b 0

:fail
echo.
echo [showcase] Startup failed. Press any key to close.
pause >nul
exit /b 1
