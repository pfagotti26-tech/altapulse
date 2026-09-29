Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "Alta Pulse"
OutFile "dist/Alta-Pulse-${VERSION}-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\AltaPulse"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Alta Agency"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Alta Pulse"
VIAddVersionKey "CompanyName" "Alta Agency"
VIAddVersionKey "FileDescription" "Instalador Alta Pulse"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Alta Agency"
!define MUI_ICON "../frontend/public/favicon.ico"
!define MUI_UNICON "../frontend/public/favicon.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LEIA-ME.md"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\AltaPulse.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir Alta Pulse"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Esta versão requer Windows 10/11 de 64 bits."
    Abort
  ${EndIf}
  ; Mantém o diretório já instalado em uma atualização, sem mover perfis.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "InstallLocation"
  StrCmp $0 "" legacy_path use_existing
  use_existing:
    StrCpy $INSTDIR $0
    Goto init_done
  legacy_path:
    IfFileExists "$LOCALAPPDATA\Programs\AltaCore\AltaCore.exe" 0 init_done
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\AltaCore"
  init_done:
FunctionEnd

Section "Alta Pulse" SEC01
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "dist/AltaPulse-win32-x64/*"
  IfErrors install_failed
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  CreateDirectory "$SMPROGRAMS\Alta Pulse"
  CreateShortCut "$SMPROGRAMS\Alta Pulse\Alta Pulse.lnk" "$INSTDIR\AltaPulse.exe"
  CreateShortCut "$SMPROGRAMS\Alta Pulse\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  CreateShortCut "$DESKTOP\Alta Pulse.lnk" "$INSTDIR\AltaPulse.exe"
  Delete "$DESKTOP\Alta Core.lnk"
  Delete "$SMPROGRAMS\Alta Core\Alta Core.lnk"
  Delete "$SMPROGRAMS\Alta Core\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\Alta Core"
  Delete "$INSTDIR\AltaCore.exe"
  ; A chave interna estável evita entradas duplicadas após a mudança de nome.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "DisplayName" "Alta Pulse"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "UninstallString" '$\"$INSTDIR\Desinstalar.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "Publisher" "Alta Agency"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "DisplayIcon" "$INSTDIR\AltaPulse.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "InstallLocation" "$INSTDIR"
  Goto install_done
  install_failed:
    MessageBox MB_ICONSTOP "Não foi possível concluir a instalação. Feche o aplicativo, verifique a permissão de gravação na pasta escolhida e tente novamente. Não desative as proteções do Windows."
    Abort
  install_done:
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Alta Pulse.lnk"
  RMDir /r "$SMPROGRAMS\Alta Pulse"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore"
  RMDir /r "$INSTDIR"
  MessageBox MB_OK "Aplicativo removido. Por segurança, seus perfis locais foram preservados na pasta de dados do aplicativo no usuário Windows. Para remover sessões, encerre-as na Privacy e exclua essa pasta manualmente após confirmar que não precisa mais dos dados."
SectionEnd