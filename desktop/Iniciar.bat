@echo off
cd /d "%~dp0"
set ELECTRON=node_modules\electron\dist\electron.exe
if not exist "%ELECTRON%" if exist "..\altapulse-teste-fase0\node_modules\electron\dist\electron.exe" set ELECTRON=..\altapulse-teste-fase0\node_modules\electron\dist\electron.exe
if not exist "%ELECTRON%" (
  where node >NUL 2>NUL || (echo Node.js nao encontrado. Instale em https://nodejs.org e tente de novo. & pause & exit /b 1)
  echo Instalando o Electron pela primeira vez, pode levar 1 ou 2 minutos...
  call npm install --no-audit --no-fund
)
start "" "%ELECTRON%" .
