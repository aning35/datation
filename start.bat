@echo off
setlocal enabledelayedexpansion
REM Datation 启动脚本 (Windows)
REM 端口优先级: app.json > 环境变量(.env) > 默认值

set MODE=dev
for %%x in (%*) do (
    if "%%x"=="--prod" set MODE=prod
)

if "%MODE%"=="prod" (
    echo === Starting Datation ^(Production Mode^) ===
) else (
    echo === Starting Datation ^(Development Mode^) ===
)

REM 检查 uv
where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] uv is not installed. Please visit https://docs.astral.sh/uv/ to install.
    pause
    exit /b 1
)

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please visit https://nodejs.org/ to install.
    pause
    exit /b 1
)

REM 加载 .env（如果存在）
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%a in (.env) do (
        set "%%a=%%b"
    )
)

REM 默认端口
set "API_PORT=18321"
set "WEB_PORT=1420"

REM 从 app.json 读取端口（优先级最高）
set "APP_CONFIG=%USERPROFILE%\.datation\config\app.json"
if exist "%APP_CONFIG%" (
    for /f "delims=" %%v in ('python -c "import json; d=json.load(open(r\"%APP_CONFIG%\")); print(d.get(\"api_port\",\"\"))" 2^>nul') do (
        if not "%%v"=="" set "API_PORT=%%v"
    )
    for /f "delims=" %%v in ('python -c "import json; d=json.load(open(r\"%APP_CONFIG%\")); print(d.get(\"web_port\",\"\"))" 2^>nul') do (
        if not "%%v"=="" set "WEB_PORT=%%v"
    )
)

if "%MODE%"=="prod" (
    echo [Config] Backend ^& Frontend port: !API_PORT!
) else (
    echo [Config] Backend port: !API_PORT! ^| Frontend port: !WEB_PORT!
)

REM 清理上一次残留的后端/前端进程
echo [Cleanup] Stopping any existing Datation processes...
REM 按端口号杀进程
set "_KILL_PORTS=!API_PORT! !WEB_PORT!"
for %%q in (!_KILL_PORTS!) do (
    for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":%%q " ^| findstr "LISTENING"') do (
        taskkill /f /pid %%p >nul 2>&1
    )
)
REM 清理旧日志
del "%TEMP%\datation-backend.log" >nul 2>&1
del "%TEMP%\datation-vite.log" >nul 2>&1
del "%TEMP%\datation-health.tmp" >nul 2>&1
timeout /t 2 /nobreak >nul

REM 安装 Python 依赖
echo [1/4] Installing Python dependencies...
uv sync
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b 1
)

REM 安装前端依赖
echo [2/4] Installing frontend dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install frontend dependencies.
    cd ..
    pause
    exit /b 1
)

if "%MODE%"=="prod" (
    echo [2.5/4] Building frontend static assets...
    call npm run build
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to build frontend.
        cd ..
        pause
        exit /b 1
    )
)
cd ..

REM 启动后端
echo [3/4] Starting Python backend...
set PYTHONPATH=%cd%\datation;%PYTHONPATH%
start /b "" cmd /c "uv run python -m datation.main > %TEMP%\datation-backend.log 2>&1"
echo   Backend log: %TEMP%\datation-backend.log

REM 等待后端完全就绪
echo Waiting for backend to be fully ready (port !API_PORT!)...
set READY=0
for /l %%i in (1,1,60) do (
    if !READY!==0 (
        curl -s http://localhost:!API_PORT!/health > "%TEMP%\datation-health.tmp" 2>nul
        findstr /c:"true" "%TEMP%\datation-health.tmp" >nul 2>&1
        if !errorlevel!==0 (
            echo [OK] Backend is fully ready.
            set READY=1
        ) else (
            timeout /t 2 /nobreak >nul
        )
    )
)

if "%MODE%"=="prod" (
    echo.
    echo === Datation is running ^(Production Mode^) ===
    echo Web UI / Backend:  http://localhost:!API_PORT!
    echo.
    echo Press any key to stop the service...
    pause >nul
    echo Stopping backend service...
    taskkill /f /fi "WINDOWTITLE eq datation-*" >nul 2>&1
    for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":!API_PORT!" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>&1
    echo === Datation Stopped ===
    exit /b 0
)

REM ==========================================================
REM 开发模式专属：启动前端 Vite
REM ==========================================================
echo [4/4] Starting Vite frontend...
cd frontend
start /b "" cmd /c "set VITE_PORT=!WEB_PORT! && npm run dev > %TEMP%\datation-vite.log 2>&1"
cd ..
echo   Vite log:    %TEMP%\datation-vite.log

REM 等待前端就绪
echo Waiting for Vite to start (port !WEB_PORT!)...
set READY=0
for /l %%i in (1,1,30) do (
    if !READY!==0 (
        curl -s http://localhost:!WEB_PORT! >nul 2>&1
        if !errorlevel!==0 (
            echo [OK] Vite is ready.
            set READY=1
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)

echo.
echo === Datation is running ===
echo Web UI:   http://localhost:!WEB_PORT!
echo Backend:  http://localhost:!API_PORT!
echo.
echo Press any key to stop all services...
pause >nul

REM 清理进程
echo Stopping all services...
taskkill /f /fi "WINDOWTITLE eq datation-*" >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":!API_PORT!" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":!WEB_PORT!" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>&1
echo === Datation Stopped ===

