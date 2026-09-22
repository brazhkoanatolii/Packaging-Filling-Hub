[CmdletBinding()]
param([Parameter(Mandatory = $true)][int]$Port)

$ErrorActionPreference = "Stop"
if ($Port -lt 1 -or $Port -gt 65535) { throw "Укажите корректный порт." }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Для доступа других компьютеров запустите установщик от имени администратора: требуется правило Windows Firewall." -ForegroundColor Yellow
  exit 2
}

$ruleName = "Packaging-Filling-Hub central server TCP $Port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet | Out-Null
}
Write-Host "Windows Firewall: доступ к центральному серверу разрешён только из локальной частной сети." -ForegroundColor Green
