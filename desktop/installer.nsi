Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "Alta Core"
OutFile "dist/Alta-Core-${VERSION}-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\AltaCore"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Alta Agency"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Alta Core"
VIAddVersionKey "CompanyName" "Alta Agency"
VIAddVersionKey "FileDescription" "Instalador Alta Core"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Alta Agency"
!define MUI_ICON "../frontend/public/favicon.ico"
!define MUI_UNICON "../frontend/public/favicon.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LEIA-ME.md"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\AltaCore.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir Alta Core"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Esta versão requer Windows 10/11 de 64 bits."
    Abort
  ${EndIf}
FunctionEnd

Section "Alta Core" SEC01
  SetOutPath "$INSTDIR"
  File /r "dist/AltaCore-win32-x64/*"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  CreateDirectory "$SMPROGRAMS\Alta Core"
  CreateShortCut "$SMPROGRAMS\Alta Core\Alta Core.lnk" "$INSTDIR\AltaCore.exe"
  CreateShortCut "$SMPROGRAMS\Alta Core\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  CreateShortCut "$DESKTOP\Alta Core.lnk" "$INSTDIR\AltaCore.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "DisplayName" "Alta Core"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "UninstallString" '$\"$INSTDIR\Desinstalar.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "Publisher" "Alta Agency"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore" "DisplayIcon" "$INSTDIR\AltaCore.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Alta Core.lnk"
  RMDir /r "$SMPROGRAMS\Alta Core"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaCore"
  RMDir /r "$INSTDIR"
  MessageBox MB_OK "Aplicativo removido. Por segurança, seus perfis locais foram preservados na pasta de dados Alta Core do usuário Windows. Para remover sessões, encerre-as na Privacy e exclua essa pasta manualmente após confirmar que não precisa mais dos dados."
SectionEnd