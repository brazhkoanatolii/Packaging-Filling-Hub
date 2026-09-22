@echo off
chcp 65001 >nul
title Packaging-Filling-Hub - включение записи Google
setlocal
set "INSTALL_ROOT=%LOCALAPPDATA%\Packaging-Filling-Hub"
set /p "CONFIRM=Включить запись с этого компьютера в Google Sheets? Введите YES: "
if /I not "%CONFIRM%"=="YES" (
  echo Ничего не изменено.
  pause
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path $env:LOCALAPPDATA 'Packaging-Filling-Hub\.env'; if(!(Test-Path -LiteralPath $p)){throw 'Не найдены настройки программы.'}; $l=Get-Content -LiteralPath $p -Encoding UTF8; $i=[Array]::FindIndex([string[]]$l,[Predicate[string]]{param($x) $x -match '^\s*GOOGLE_WRITES_ENABLED\s*='}); if($i -ge 0){$l[$i]='GOOGLE_WRITES_ENABLED=true'}else{$l += 'GOOGLE_WRITES_ENABLED=true'}; Set-Content -LiteralPath $p -Value $l -Encoding UTF8"
if errorlevel 1 (
  echo Запись не включена.
  pause
  exit /b 1
)
echo Запись включена. Перезапустите Packaging-Filling-Hub через ярлык на рабочем столе.
pause
exit /b 0
