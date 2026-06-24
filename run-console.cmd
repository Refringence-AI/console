@echo off
REM Console launcher. Double-click from Explorer or via
REM the Desktop shortcut. Builds + launches in production mode.
REM Strips ELECTRON_RUN_AS_NODE (the trap that makes Electron boot
REM as plain Node and crash on `app.whenReady`).

setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0console-electron"

echo Launching Console...
echo (window will close once the app exits)
echo.

call npm start
set ERR=%ERRORLEVEL%

if not %ERR%==0 (
  echo.
  echo Console exited with code %ERR%.
  pause
)
endlocal
