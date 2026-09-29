Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "Alta Pulse - Piloto Chrome"
OutFile "dist/Alta-Pulse-Chrome-Pilot-${VERSION}-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\AltaPulseChromePilot"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Alta Agency - Piloto experimental"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Alta Pulse Chrome Pilot"
VIAddVersionKey "CompanyName" "Alta Agency"
VIAddVersionKey "FileDescription" "Instalador experimental Alta Pulse Chrome Pilot"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Alta Agency"
!define MUI_ICON "../../frontend/public/favicon.ico"
!define MUI_UNICON "../../frontend/public/favicon.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LEIA-ME.md"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidatePilotDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\AltaPulseChromePilot.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir Alta Pulse - Piloto Chrome"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Este piloto requer Windows de 64 bits e Google Chrome instalado."
    Abort
  ${EndIf}
FunctionEnd

Function ValidatePilotDirectory
  IfFileExists "$INSTDIR\AltaPulse.exe" refuse_directory
  IfFileExists "$INSTDIR\AltaCore.exe" refuse_directory
  IfFileExists "$INSTDIR\AltaPulseChromePilot.exe" directory_ok
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*"
  IfErrors directory_ok
  directory_scan:
    StrCmp $1 "" directory_empty
    StrCmp $1 "." directory_next
    StrCmp $1 ".." directory_next
    FindClose $0
    Goto refuse_directory
  directory_next:
    FindNext $0 $1
    Goto directory_scan
  directory_empty:
    FindClose $0
    Goto directory_ok
  refuse_directory:
    MessageBox MB_ICONSTOP "Escolha uma pasta nova e exclusiva do piloto. Não use a pasta do Alta Pulse regular, do Chrome ou de seus documentos."
    Abort
  directory_ok:
FunctionEnd

Section "Piloto Chrome"
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "dist/AltaPulseChromePilot-win32-x64/*"
  IfErrors failed
  WriteUninstaller "$INSTDIR\Desinstalar-Piloto.exe"
  CreateDirectory "$SMPROGRAMS\Alta Pulse Chrome Pilot"
  CreateShortCut "$SMPROGRAMS\Alta Pulse Chrome Pilot\Alta Pulse - Piloto Chrome.lnk" "$INSTDIR\AltaPulseChromePilot.exe"
  CreateShortCut "$DESKTOP\Alta Pulse - Piloto Chrome.lnk" "$INSTDIR\AltaPulseChromePilot.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaPulseChromePilot" "DisplayName" "Alta Pulse - Piloto Chrome"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaPulseChromePilot" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaPulseChromePilot" "Publisher" "Alta Agency"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaPulseChromePilot" "UninstallString" '$\"$INSTDIR\Desinstalar-Piloto.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaPulseChromePilot" "DisplayIcon" "$INSTDIR\AltaPulseChromePilot.exe"
  Goto complete
  failed:
    MessageBox MB_ICONSTOP "Instalação do piloto não concluída. Feche o piloto e verifique a pasta escolhida, sem desativar proteções do Windows."
    Abort
  complete:
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Alta Pulse - Piloto Chrome.lnk"
  RMDir /r "$SMPROGRAMS\Alta Pulse Chrome Pilot"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltaPulseChromePilot"
  !include "uninstall-files.nsh"
  Delete "$INSTDIR\Desinstalar-Piloto.exe"
  RMDir "$INSTDIR"
  MessageBox MB_OK "Somente o piloto foi removido. A versão regular e o Chrome pessoal não foram alterados. Os perfis locais do piloto foram preservados; remova-os manualmente apenas após encerrar as sessões e confirmar que não precisa mais dos dados."
SectionEnd