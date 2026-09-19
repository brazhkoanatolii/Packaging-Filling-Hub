@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - домашний компьютер начальника
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1" -Workstation manager -WorkstationId manager-home -WorkstationLabel "Домашний компьютер начальника"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Установка не завершена. Код ошибки: %RESULT%
pause
exit /b %RESULT%
