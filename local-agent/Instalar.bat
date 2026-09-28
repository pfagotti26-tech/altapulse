@echo off
cd /d "%~dp0"
py -3 --version >nul 2>&1
if errorlevel 1 (
  echo Instale o Python 3.11 ou superior para Windows e execute novamente.
  echo O Python precisa incluir tkinter e o Python Launcher.
  pause
  exit /b 1
)
py -3 -c "import sys; assert sys.version_info >= (3,11), 'Python 3.11 ou superior necessario'"
if errorlevel 1 goto :error
py -3 -m venv .venv
if errorlevel 1 goto :error
.venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 goto :error
.venv\Scripts\python.exe -m pip install playwright requests keyring
if errorlevel 1 goto :error
.venv\Scripts\python.exe -m playwright install chromium
if errorlevel 1 goto :error
echo Instalacao concluida. Execute Iniciar.bat.
pause
exit /b 0
:error
echo A instalacao nao foi concluida. Verifique sua conexao e a versao do Python.
pause
exit /b 1