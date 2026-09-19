@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - проверка установки
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\verify-installation.ps1" -RequireProduction
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="2" echo Программа установлена, но подключение Google еще не готово к рабочей записи.
pause
exit /b %RESULT%
