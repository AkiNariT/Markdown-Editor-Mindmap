@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-integration.ps1" -Action Uninstall
if errorlevel 1 (echo Unregistration failed. See details above.) else (echo Matching MD registrations and shortcuts removed. Other apps were preserved.)
pause
