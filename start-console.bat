@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ProjectsDashboard - Console launcher
if not defined CONSOLE_PORT set "CONSOLE_PORT=4100"
set "PORT=%CONSOLE_PORT%"
set "BASE=http://127.0.0.1:%PORT%/"
set "LOG=data\logs\console-launcher.out"
set "URLFILE=data\logs\console-url.tmp"

echo [console] Checking prerequisites...
where node >nul 2>&1 || ( echo [console] ERROR: Node.js is not installed or not on PATH. & goto :fail )
if not exist node_modules (
  echo [console] node_modules missing, running npm install...
  call npm install || ( echo [console] ERROR: npm install failed. & goto :fail )
)
if not exist data\logs mkdir data\logs

curl.exe -s -o NUL -m 2 "%BASE%" && (
  echo [console] Already running on port %PORT%, not starting a second copy.
  set "URL=%BASE%"
  goto :open
)

echo [console] Starting the admin console on port %PORT%...
if exist "%URLFILE%" del /q "%URLFILE%"
rem The one-time URL goes to a file that is deleted as soon as it is read, not into the log.
set "ADMIN_URL_FILE=%URLFILE%"
start "ProjectsDashboard Console (close this window to stop it)" /min cmd /c "node admin-console\server.mjs > %LOG% 2>&1"

echo [console] Waiting for it to respond...
for /l %%i in (1,1,60) do (
  curl.exe -s -o NUL -m 2 "%BASE%" && goto :ready
  ping -n 2 127.0.0.1 >nul
)
echo [console] ERROR: no response after 60 seconds. Last log lines:
if exist %LOG% type %LOG%
goto :fail

:ready
echo [console] Server is up.
set "URL=%BASE%"
rem Token mode leaves a one-time URL with ?t=... in %URLFILE%; password mode needs just the base URL.
if exist "%URLFILE%" (
  set /p URL=<"%URLFILE%"
  del /q "%URLFILE%"
)

:open
echo [console] Opening %URL%
start "" "%URL%"
echo [console] Done. The server keeps running in its own minimized window.
timeout /t 4 >nul
exit /b 0

:fail
echo.
echo [console] Startup failed. Press any key to close.
pause >nul
exit /b 1
