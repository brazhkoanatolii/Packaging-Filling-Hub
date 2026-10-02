@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - Update senior mechanic workstation
setlocal
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL%" set "POWERSHELL=powershell.exe"
"%POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1" -Workstation senior -WorkstationId senior-work -WorkstationLabel "Рабочий компьютер старшего механика"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Update was not completed. Error code: %RESULT%
pause
endlocal & exit /b %RESULT%
