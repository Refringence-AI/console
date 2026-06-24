; Custom NSIS hooks for the Console installer.
;
; electron-builder picks this file up automatically (nsis.include) and calls
; customInstall / customUnInstall around its own install steps.
;
; The `console <path>` PATH-shim was removed here: it relied on the third-party
; EnVar NSIS plugin, which is NOT part of the electron-builder toolchain and is
; absent on clean build runners, so it broke packaging
; (ERR_ELECTRON_BUILDER_CANNOT_EXECUTE / "Plugin not found, cannot call
; EnVar::SetHKCU"). The in-app behaviour is unaffected: Console.exe still accepts
; a path argument (Console.exe <repo>), and the desktop / Start-menu shortcuts
; work normally.
;
; To restore `console <path>` on PATH for the public launch, bundle the EnVar
; plugin DLLs under the build-resources plugin dirs (resources/x86-unicode/ and
; resources/x86-ansi/) and re-add the EnVar::AddValue / EnVar::DeleteValue calls.

!macro customInstall
!macroend

!macro customUnInstall
!macroend
