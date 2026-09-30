@echo off
title Alta Pulse
cd /d "%~dp0"
set LOG=%~dp0iniciar.log
echo [%date% %time%] iniciando em "%CD%" > "%LOG%"

echo %CD% | findstr /i /c:"\Temp\" /c:"\AppData\Local\Temp" >NUL && (
  echo.
  echo A pasta ainda esta dentro do arquivo .zip. Primeiro clique com o botao direito no
  echo Alta-Pulse-Desktop.zip, escolha "Extrair tudo..." e abra o Iniciar de dentro da pasta extraida.
  echo.
  pause
  exit /b 1
)

set ELECTRON=node_modules\electron\dist\electron.exe
if not exist "%ELECTRON%" if exist "..\altapulse-teste-fase0\node_modules\electron\dist\electron.exe" set ELECTRON=..\altapulse-teste-fase0\node_modules\electron\dist\electron.exe
if not exist "%ELECTRON%" (
  where node >NUL 2>NUL
  if errorlevel 1 (
    echo.
    echo Node.js nao encontrado neste computador.
    echo 1. Abra https://nodejs.org e baixe a versao LTS ^(botao verde^).
    echo 2. Instale com as opcoes padrao ^(avancar, avancar, concluir^).
    echo 3. Feche esta janela e abra o Iniciar de novo.
    echo.
    echo Node.js nao encontrado >> "%LOG%"
    pause
    exit /b 1
  )
  echo Instalando o navegador do app pela primeira vez ^(cerca de 100 MB^). Pode levar 1 ou 2 minutos...
  call npm install --no-audit --no-fund >> "%LOG%" 2>&1
  if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo A instalacao nao terminou. Verifique a internet ^(ou antivirus/proxy^) e abra o Iniciar de novo.
    echo Detalhes em: %LOG%
    echo.
    echo npm install falhou >> "%LOG%"
    pause
    exit /b 1
  )
)
echo abrindo %ELECTRON% >> "%LOG%"
start "" "%ELECTRON%" .
