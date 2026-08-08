@echo off
REM chatgpt-web-provider one-click startup: Chrome (CDP 9233) + adapter (8765)
REM Safe to run on every logon: only starts what is not already running.
setlocal

set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE=C:\Hermes\chatgpt-web-profile
set LOGDIR=D:\hermes\chatgpt-web-provider\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM --- 1. Chrome on CDP 9233 (dedicated profile keeps the ChatGPT login) ---
netstat -ano | findstr /R /C:":9233 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  start "" %CHROME% --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check "https://chatgpt.com"
  echo [start-adapter] Chrome launched on CDP 9233
) else (
  echo [start-adapter] Chrome already listening on 9233
)

REM --- 2. Adapter on 8765 ---
netstat -ano | findstr /R /C:":8765 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  cd /d D:\hermes\chatgpt-web-provider
  start "chatgpt-web-adapter" /min cmd /c "set CHROME_LAUNCH_AT_STARTUP=false&& set CHROME_CDP_PORT=9233&& set ADAPTER_PORT=8765&& set LOG_LEVEL=info&& .\node_modules\.bin\tsx src\index.ts >> %LOGDIR%\adapter.log 2>&1"
  echo [start-adapter] Adapter launched on 8765 (log: %LOGDIR%\adapter.log)
) else (
  echo [start-adapter] Adapter already listening on 8765
)

REM --- 3. Wait for health, report ---
timeout /t 8 /nobreak >nul
curl -s http://127.0.0.1:8765/health > %LOGDIR%\health.json 2>&1
echo [start-adapter] Health: 
type %LOGDIR%\health.json
echo.
endlocal
