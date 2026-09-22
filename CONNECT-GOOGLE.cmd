@echo off
chcp 65001 >nul
setlocal
title Packaging-Filling-Hub - подключение Google
set "INSTALL_ROOT=%LOCALAPPDATA%\Packaging-Filling-Hub"

if not exist "%INSTALL_ROOT%\scripts\setup-google-oauth.mjs" (
  echo Программа еще не установлена. Сначала выполните INSTALL-MANAGER.cmd или INSTALL-SENIOR-MECHANIC.cmd.
  pause
  exit /b 1
)

echo.
echo Подключение этого компьютера к корпоративной учетной записи Google.
set /p "OAUTH_FILE=Вставьте полный путь к client_secret JSON: "
set "OAUTH_FILE=%OAUTH_FILE:"=%"

if not exist "%OAUTH_FILE%" (
  echo Файл не найден. Настройки не изменены.
  pause
  exit /b 1
)

node "%INSTALL_ROOT%\scripts\setup-google-oauth.mjs" "%OAUTH_FILE%"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo Подключение Google не завершено. Запись не включалась.
  pause
  exit /b %RESULT%
)

echo.
echo Авторизация Google завершена. Запустите TEST-GOOGLE-CONNECTION.cmd.
pause
exit /b 0
