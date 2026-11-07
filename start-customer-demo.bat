@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ProjectsDashboard - Customer demo launcher
rem Usage: start-customer-demo.bat [crm|imageapp|airfinder|claudeworkspace]   (default: crm)
rem Starts the demo gateway (port 4300) + that product's isolated demo instance, creates an
rem 8-hour link for "Local owner", and opens it at http://<product>.localhost:4300/
set "APP=%~1"
if "%APP%"=="" set "APP=crm"
set "GW=http://127.0.0.1:4300/"

if /i "%APP%"=="crm"             ( set "DPORT=3111" & set "DHEALTH=/sign-in" & goto :known )
if /i "%APP%"=="imageapp"        ( set "DPORT=5410" & set "DHEALTH=/" & goto :known )
if /i "%APP%"=="airfinder"       ( set "DPORT=5210" & set "DHEALTH=/" & goto :known )
if /i "%APP%"=="claudeworkspace" ( set "DPORT=3112" & set "DHEALTH=/" & goto :known )
echo [demo] ERROR: unknown product "%APP%". Use: crm, imageapp, airfinder, claudeworkspace.
goto :fail
:known
set "DURL=http://127.0.0.1:%DPORT%%DHEALTH%"

echo [demo] Checking prerequisites...
where node >nul 2>&1 || ( echo [demo] ERROR: Node.js is not installed or not on PATH. & goto :fail )
if not exist node_modules (
  echo [demo] node_modules missing, running npm install...
  call npm install || ( echo [demo] ERROR: npm install failed. & goto :fail )
)
if not exist data\logs mkdir data\logs

curl.exe -s -o NUL -m 2 "%GW%" && (
  echo [demo] Gateway already running on port 4300.
  goto :gwdone
)
echo [demo] Starting the demo gateway...
call node supervisor\index.mjs start gateway || ( echo [demo] ERROR: gateway failed to start. See data\logs. & goto :fail )
:gwdone

curl.exe -s -o NUL -m 2 "%DURL%" && (
  echo [demo] %APP% demo instance already running on port %DPORT%.
  goto :instdone
)
echo [demo] Starting the %APP% demo instance (first start can take a minute)...
call node supervisor\index.mjs start %APP%-demo || ( echo [demo] ERROR: %APP%-demo failed to start. See data\logs. & goto :fail )
curl.exe -s -o NUL -m 5 "%DURL%" || ( echo [demo] ERROR: %APP%-demo is not responding on port %DPORT%. See data\logs. & goto :fail )
:instdone

echo [demo] Creating a demo link...
set "LINK="
for /f "tokens=*" %%L in ('node demo-gateway\grants.mjs create --customer "Local owner" --app %APP% --hours 8 ^| findstr /b /c:"  http"') do set "LINK=%%L"
if not defined LINK ( echo [demo] ERROR: could not create a demo link. Is "%APP%" demo-ready in registry\apps.json? & goto :fail )

echo [demo] Opening %LINK%
start "" "%LINK%"
echo [demo] Done. Gateway and demo instance keep running in the background.
echo [demo] Stop them from the admin console, or: node supervisor\index.mjs stop gateway ^| stop %APP%-demo
timeout /t 5 >nul
exit /b 0

:fail
echo.
echo [demo] Startup failed. Press any key to close.
pause >nul
exit /b 1
