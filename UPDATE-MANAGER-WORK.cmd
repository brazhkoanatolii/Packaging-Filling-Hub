@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - Update manager workstation
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1" -Workstation manager -WorkstationId manager-work -WorkstationLabel "Рабочий компьютер начальника"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Update was not completed. Error code: %RESULT%
pause
exit /b %RESULT%
