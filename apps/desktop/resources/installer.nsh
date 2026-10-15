; Lincei's additions to the Windows installer. electron-builder includes this
; file by itself (nsis.include defaults to installer.nsh in build resources),
; so build-desktop-artifact.ts needs no line for it. See docs/lincei/README.md.

; Removes the lincei:// handler when Lincei is uninstalled. The app registers
; the scheme for the current user on every launch (Electron's
; app.setAsDefaultProtocolClient, called by @clerk/electron's bridge), which
; writes HKCU\Software\Classes\lincei. The uninstaller does not know about that
; key, so without this, links would keep pointing at a deleted Lincei.exe.
; Skipped on an update, which runs the old uninstaller first, and when the key
; points at another install. T3 Code's t3code key is never touched.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    ReadRegStr $0 HKCU "Software\Classes\lincei\shell\open\command" ""
    StrCpy $1 `"$INSTDIR\${APP_EXECUTABLE_FILENAME}"`
    StrLen $2 $1
    StrCpy $0 $0 $2
    ${if} $0 == $1
      DeleteRegKey HKCU "Software\Classes\lincei"
    ${endIf}
    Pop $2
    Pop $1
    Pop $0
  ${endIf}
!macroend
