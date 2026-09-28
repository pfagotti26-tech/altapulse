@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Execute Instalar.bat primeiro.
  pause
  exit /b 1
)
.venv\Scripts\python.exe agent.py
if errorlevel 1 pause