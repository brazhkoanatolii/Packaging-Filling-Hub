@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - обновление для старшего механика
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1" -Workstation senior -WorkstationId senior-work -WorkstationLabel "Рабочий компьютер старшего механика"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Обновление не завершено. Код ошибки: %RESULT%
pause
exit /b %RESULT%
