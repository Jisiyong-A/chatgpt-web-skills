@echo off
REM chatgpt-web-provider one-click startup: Chrome (CDP 9233) + adapter (8765)
REM v1.1.0-hardening: relative paths (no hardcoded D:\hermes), unified CDP args,
REM local API key required by default.
setlocal EnableExtensions

set "PROVIDER_DIR=%~dp0"
set "LOGDIR=%PROVIDER_DIR%logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

if not defined CHROME_PATH set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHATGPT_PROFILE_DIR set "CHATGPT_PROFILE_DIR=%LOCALAPPDATA%\chatgpt-web-profile"
if not defined CHROME_CDP_PORT set "CHROME_CDP_PORT=9233"
if not defined ADAPTER_PORT set "ADAPTER_PORT=8765"
if not defined CHROME_REMOTE_ALLOW_ORIGINS set "CHROME_REMOTE_ALLOW_ORIGINS=*"

REM --- Local API key (v1.1.0: required by default) ---
if not defined ADAPTER_API_KEY (
  if exist "%PROVIDER_DIR%.adapter-key" (
    set /p ADAPTER_API_KEY=<"%PROVIDER_DIR%.adapter-key"
  ) else (
    echo [start-adapter] ERROR: ADAPTER_API_KEY is required (ADAPTER_REQUIRE_API_KEY defaults to true).
    echo   Set it before starting, e.g.:
    echo     setx ADAPTER_API_KEY your-long-random-local-secret
    echo   Then re-run this script.
    exit /b 2
  )
)

REM --- 1. Chrome on CDP (dedicated profile keeps the ChatGPT login) ---
netstat -ano | findstr /R /C:":%CHROME_CDP_PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  start "chatgpt-web-chrome" "%CHROME_PATH%" ^
    --remote-debugging-address=127.0.0.1 ^
    --remote-debugging-port=%CHROME_CDP_PORT% ^
    --user-data-dir="%CHATGPT_PROFILE_DIR%" ^
    --remote-allow-origins=%CHROME_REMOTE_ALLOW_ORIGINS% ^
    --no-first-run --no-default-browser-check ^
    "https://chatgpt.com"
  echo [start-adapter] Chrome launched on CDP %CHROME_CDP_PORT%
) else (
  echo [start-adapter] Chrome already listening on %CHROME_CDP_PORT%
)

REM --- 2. Adapter on ADAPTER_PORT ---
netstat -ano | findstr /R /C:":%ADAPTER_PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  pushd "%PROVIDER_DIR%"
  start "chatgpt-web-adapter" /min cmd /c ^
    "set ADAPTER_HOST=127.0.0.1&& ^
     set CHROME_PATH=%CHROME_PATH%&& ^
     set CHROME_PROFILE_DIR=%CHATGPT_PROFILE_DIR%&& ^
     set CHROME_CDP_PORT=%CHROME_CDP_PORT%&& ^
     set CHROME_REMOTE_ALLOW_ORIGINS=%CHROME_REMOTE_ALLOW_ORIGINS%&& ^
     set ADAPTER_PORT=%ADAPTER_PORT%&& ^
     set ADAPTER_API_KEY=%ADAPTER_API_KEY%&& ^
     set ADAPTER_REQUIRE_API_KEY=true&& ^
     set ADAPTER_TIMEOUT_MS=600000&& ^
     set CHROME_LAUNCH_AT_STARTUP=false&& ^
     npm start >> "%LOGDIR%adapter.log" 2>&1"
  popd
  echo [start-adapter] Adapter launched on %ADAPTER_PORT% (log: %LOGDIR%adapter.log)
) else (
  echo [start-adapter] Adapter already listening on %ADAPTER_PORT%
)

REM --- 3. Wait for health, report ---
timeout /t 8 /nobreak >nul
curl -s -H "Authorization: Bearer %ADAPTER_API_KEY%" ^
  "http://127.0.0.1:%ADAPTER_PORT%/health" > "%LOGDIR%health.json" 2>&1
echo [start-adapter] Health:
type "%LOGDIR%health.json"
echo.
endlocal
