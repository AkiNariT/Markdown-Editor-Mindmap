; Standalone launcher, built through electron-builder's custom NSIS script API.
; Runtime files live only in this invocation's private NSIS plugin directory.
; Documents and settings are managed by MD, never inside the extraction dir.
!include "common.nsh"
!include "extractAppPackage.nsh"

CRCCheck on
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel user
Icon "${MUI_ICON}"

Function .onInit
  SetSilent silent
  !insertmacro check64BitAndSetRegView
  ; Capture before SetOutPath changes the child's current working directory.
  System::Call 'kernel32::GetCurrentDirectory(i ${NSIS_MAX_STRLEN}, t .r1) i.r2'
  System::Call 'kernel32::SetEnvironmentVariable(t "MD_PORTABLE_CWD", t r1) i.r0'
  Banner::show /NOUNLOAD /set 1030 "正在打开 MD…$\r$\nOpening MD…" "MD"
FunctionEnd

Section
  InitPluginsDir
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  SetOutPath $INSTDIR
  !insertmacro extractEmbeddedAppPackage
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 unpack_failed
  IfFileExists "$INSTDIR\icudtl.dat" 0 unpack_failed
  IfFileExists "$INSTDIR\resources\app\electron\main.cjs" 0 unpack_failed
  Banner::destroy

  System::Call 'kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_DIR", t "$EXEDIR") i.r0'
  System::Call 'kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_FILE", t "$EXEPATH") i.r0'
  System::Call 'kernel32::SetEnvironmentVariable(t "MD_PORTABLE_RUNTIME", t "$INSTDIR\${APP_EXECUTABLE_FILENAME}") i.r0'
  ${StdUtils.GetAllParameters} $R0 0
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "无法打开 MD，请检查可用磁盘空间并重新下载程序。$\nMD could not start. Check free disk space and download the application again."
    StrCpy $0 1
  ${ElseIf} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "MD 未能正常运行（代码 $0）。请检查可用磁盘空间，或重新下载程序。$\nMD did not exit normally (code $0). Check free disk space or download the application again."
  ${EndIf}
  Goto cleanup
unpack_failed:
  Banner::destroy
  MessageBox MB_OK|MB_ICONSTOP "无法展开 MD 运行文件。请检查临时目录的可用空间和权限，然后重试。$\nCould not prepare MD. Check free space and access to your temporary folder, then try again."
  StrCpy $0 1
cleanup:
  SetErrorLevel $0
  ; Only remove this launch's own runtime, after its Electron main process exits.
  SetOutPath $EXEDIR
  RMDir /r $INSTDIR
SectionEnd
