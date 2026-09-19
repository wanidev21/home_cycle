@echo off
title PedalQuest
cd /d "%~dp0"
".venv\Scripts\python.exe" main.py %*
echo.
echo Server stopped. Press any key to close.
pause > nul
