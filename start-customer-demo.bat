@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ProjectsDashboard - Customer demo launcher
rem Usage: start-customer-demo.bat [crm|imageapp|airfinder|claudeworkspace|claudeos|rmm]   (no argument: shows a menu)
rem Starts the demo gateway (port 4300) + that product's isolated demo instance, creates an
rem 8-hour link for "Local owner", and opens it at http://<product>.localhost:4300/
set "APP=%~1"
if not "%APP%"=="" goto :picked
echo Which customer demo do you want to open?
echo   1. CRM
echo   2. ImageApp
echo   3. Airfinder
echo   4. ClaudeWorkspace
echo   5. ClaudeOS
echo   6. Remote Management (RMM)
choice /c 123456 /n /m "Press 1-6: "
if errorlevel 6 ( set "APP=rmm" & goto :picked )
if errorlevel 5 ( set "APP=claudeos" & goto :picked )
if errorlevel 4 ( set "APP=claudeworkspace" & goto :picked )
if errorlevel 3 ( set "APP=airfinder" & goto :picked )
if errorlevel 2 ( set "APP=imageapp" & goto :picked )
set "APP=crm"
:picked
set "GW=http://127.0.0.1:4300/"

if /i "%APP%"=="crm"             ( set "DPORT=3111" & set "DHEALTH=/sign-in" & goto :known )
if /i "%APP%"=="imageapp"        ( set "DPORT=5410" & set "DHEALTH=/" & goto :known )
if /i "%APP%"=="airfinder"       ( set "DPORT=5210" & set "DHEALTH=/" & goto :known )
if /i "%APP%"=="rmm"             ( set "DPORT=8711" & set "DHEALTH=/" & goto :known )
if /i "%APP%"=="claudeos"        ( set "DPORT=8611" & set "DHEALTH=/" & goto :known )
if /i "%APP%"=="claudeworkspace" ( set "DPORT=3112" & set "DHEALTH=/" & goto :known )
echo [demo] ERROR: unknown product "%APP%". Use: crm, imageapp, airfinder, claudeworkspace, claudeos, rmm.
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
