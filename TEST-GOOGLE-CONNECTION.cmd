@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - Test Google connection
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\verify-installation.ps1" -RequireProduction
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" echo Google connection and writing are ready.
if "%RESULT%"=="2" echo Reading works, but Google writing is still disabled.
pause
exit /b %RESULT%
