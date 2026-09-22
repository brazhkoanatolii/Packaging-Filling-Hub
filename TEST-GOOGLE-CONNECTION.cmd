@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - проверка Google
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\verify-installation.ps1" -RequireProduction
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" echo Подключение Google и запись готовы.
if "%RESULT%"=="2" echo Чтение Google работает, но запись еще выключена.
pause
exit /b %RESULT%
