@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ProjectsDashboard - CRM launcher
rem Starts your REAL CRM (Desktop\CRM) on port 3101 via the supervisor, then opens it.
set "URL=http://localhost:3101/sign-in"
set "PROBE=http://127.0.0.1:3101/sign-in"

echo [crm] Checking prerequisites...
where node >nul 2>&1 || ( echo [crm] ERROR: Node.js is not installed or not on PATH. & goto :fail )
if not exist node_modules (
  echo [crm] node_modules missing, running npm install...
  call npm install || ( echo [crm] ERROR: npm install failed. & goto :fail )
)
if not exist "%~dp0..\CRM" ( echo [crm] ERROR: CRM folder not found at %~dp0..\CRM & goto :fail )

curl.exe -s -o NUL -m 2 "%PROBE%" && (
  echo [crm] Already running on port 3101, not starting a second copy.
  goto :open
)
echo [crm] Starting CRM (first start can take a minute)...
call node supervisor\index.mjs start crm || ( echo [crm] ERROR: CRM failed to start. See data\logs\crm-app.log & goto :fail )
curl.exe -s -o NUL -m 5 "%PROBE%" || ( echo [crm] ERROR: CRM is not responding on port 3101. See data\logs\crm-app.log & goto :fail )

:open
echo [crm] Opening %URL%
start "" "%URL%"
echo [crm] Done. CRM keeps running in the background.
echo [crm] Stop it from the admin console, or: node supervisor\index.mjs stop crm
timeout /t 4 >nul
exit /b 0

:fail
echo.
echo [crm] Startup failed. Press any key to close.
pause >nul
exit /b 1
