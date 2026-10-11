@echo off
setlocal
set "KPI_LAUNCH_SERVER=%~1"
set "KPI_LAUNCH_DATABASE=%~2"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
endlocal
exit /b 0
