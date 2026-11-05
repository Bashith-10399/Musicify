@echo off
title MusicFlow Backend API
echo Starting MusicFlow Backend...
echo.
cd /d "%~dp0backend"
python -m uvicorn api:app --host 127.0.0.1 --port 8002
pause

