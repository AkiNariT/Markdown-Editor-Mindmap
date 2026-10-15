@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-integration.ps1" -Action Install
if errorlevel 1 (echo Registration failed. Existing defaults were not changed.) else (echo MD is available in Open with. Default apps were not changed.)
pause
