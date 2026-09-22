[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Packaging-Filling-Hub"),
  [int]$Port = 4174,
  [string]$ServerLabel = ""
)

function Set-EnvironmentValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path -Encoding UTF8) } else { @() }
  $replacement = "$Name=$Value"
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i += 1) { if ($lines[$i] -match "^\s*$([regex]::Escape($Name))\s*=") { $index = $i } }
  if ($index -ge 0) { $lines[$index] = $replacement } else { $lines += $replacement }
  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Read-PlainPassword {
  param([string]$Prompt)
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$ErrorActionPreference = "Stop"
if ($Port -lt 1 -or $Port -gt 65535) { throw "Укажите корректный порт." }
if ([string]::IsNullOrWhiteSpace($ServerLabel)) { $ServerLabel = "Центральный сервер фасовочного участка" }
$sourceRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot "..\..")))
$installer = Join-Path $sourceRoot "scripts\windows\install.ps1"

# Reuse the proven copier and startup shortcut. In central mode the configured
# workstation role is ignored by the server; rights are assigned after login.
& $installer -Workstation senior -WorkstationId "central-server" -WorkstationLabel $ServerLabel -InstallRoot $InstallRoot -NoStart

$environmentPath = Join-Path $InstallRoot ".env"
Set-EnvironmentValue -Path $environmentPath -Name "DEPLOYMENT_MODE" -Value "central"
Set-EnvironmentValue -Path $environmentPath -Name "HOST" -Value "0.0.0.0"
Set-EnvironmentValue -Path $environmentPath -Name "PORT" -Value "$Port"

$accountsPath = Join-Path $InstallRoot ".runtime\central-accounts.json"
if (-not (Test-Path -LiteralPath $accountsPath -PathType Leaf)) {
  Write-Host "`nСоздайте два пароля центрального доступа (не менее 6 символов)." -ForegroundColor Cyan
  $manager = Read-PlainPassword "Пароль начальника участка"
  $managerRepeat = Read-PlainPassword "Повторите пароль начальника участка"
  if ($manager -ne $managerRepeat) { throw "Пароли начальника не совпадают." }
  $senior = Read-PlainPassword "Пароль старшего механика"
  $seniorRepeat = Read-PlainPassword "Повторите пароль старшего механика"
  if ($senior -ne $seniorRepeat) { throw "Пароли старшего механика не совпадают." }
  $env:PFH_MANAGER_PASSWORD = $manager
  $env:PFH_SENIOR_PASSWORD = $senior
  try {
    & (Get-Command node -ErrorAction Stop).Source (Join-Path $InstallRoot "scripts\windows\initialize-central-auth.mjs") $accountsPath
    if ($LASTEXITCODE -ne 0) { throw "Не удалось создать центральные учётные записи." }
  } finally {
    Remove-Item Env:PFH_MANAGER_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:PFH_SENIOR_PASSWORD -ErrorAction SilentlyContinue
    $manager = $null; $senior = $null; $managerRepeat = $null; $seniorRepeat = $null
  }
}

& (Join-Path $InstallRoot "scripts\windows\start-program.ps1") -InstallRoot $InstallRoot
$firewallScript = Join-Path $InstallRoot "scripts\windows\enable-central-firewall.ps1"
if (Test-Path -LiteralPath $firewallScript -PathType Leaf) {
  & $firewallScript -Port $Port
  if ($LASTEXITCODE -eq 2) { Write-Host "Сервер запущен локально, но для сети потребуется правило Firewall." -ForegroundColor Yellow }
}
Write-Host "`nЦентральный сервер готов." -ForegroundColor Green
Write-Host "На этом компьютере программа открывается по адресу: http://127.0.0.1:$Port"
Write-Host ("Для других компьютеров используйте имя этого ПК или его постоянный IP: http://{0}:{1}" -f $env:COMPUTERNAME, $Port)
Write-Host "Перед подключением другого компьютера разрешите входящие подключения к порту $Port в Windows Firewall." -ForegroundColor Yellow
