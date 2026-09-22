@echo off
chcp 65001 >nul
setlocal
title Packaging-Filling-Hub - Connect Google
set "INSTALL_ROOT=%LOCALAPPDATA%\Packaging-Filling-Hub"

if not exist "%INSTALL_ROOT%\scripts\setup-google-oauth.mjs" (
  echo Program is not installed yet. Run INSTALL-MANAGER.cmd or INSTALL-SENIOR-MECHANIC.cmd first.
  pause
  exit /b 1
)

echo.
echo Connect this computer to the corporate Google account.
echo The OAuth JSON file is needed only for this setup and is not copied into the program.
set /p "OAUTH_FILE=Paste the full path to client_secret JSON: "
set "OAUTH_FILE=%OAUTH_FILE:"=%"

if not exist "%OAUTH_FILE%" (
  echo File was not found. Nothing was changed.
  pause
  exit /b 1
)

node "%INSTALL_ROOT%\scripts\setup-google-oauth.mjs" "%OAUTH_FILE%"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo Google connection was not completed. Nothing was enabled.
  pause
  exit /b %RESULT%
)

echo.
echo Google authorization is complete. Run TEST-GOOGLE-CONNECTION.cmd next.
pause
exit /b 0
