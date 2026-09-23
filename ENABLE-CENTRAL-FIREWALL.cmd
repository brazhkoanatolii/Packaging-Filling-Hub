@echo off
setlocal
echo Будет запрошено разрешение администратора Windows только для правила Firewall.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0scripts\windows\enable-central-firewall.ps1','-Port','4174'"
if errorlevel 1 echo Правило Firewall не создано. Обратитесь к IT.
pause
