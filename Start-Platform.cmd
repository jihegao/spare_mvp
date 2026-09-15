@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-portable.ps1" -AutoSelectPorts %*
if errorlevel 1 pause
