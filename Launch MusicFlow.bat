@echo off
title MusicFlow
echo Starting MusicFlow Backend + App...

REM Start the Python backend in background
start "MusicFlow Backend" /min cmd /c "cd /d %~dp0backend && python -m uvicorn api:app --host 127.0.0.1 --port 8002"

REM Wait 3 seconds for backend to boot
timeout /t 3 /nobreak >nul

REM Launch Electron app
cd /d "%~dp0"
.\node_modules\.bin\electron.cmd .

exit

