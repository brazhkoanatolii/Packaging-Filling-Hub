@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - Update senior mechanic workstation
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1" -Workstation senior -WorkstationId senior-work -WorkstationLabel "Рабочий компьютер старшего механика"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Update was not completed. Error code: %RESULT%
pause
exit /b %RESULT%
