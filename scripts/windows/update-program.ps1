[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [string]$PackageUrl,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedSha256
)

$ErrorActionPreference = "Stop"

function Get-EnvironmentValue {
  param([string]$Path, [string]$Name)
  $match = Get-Content -LiteralPath $Path -Encoding UTF8 |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -Last 1
  if (-not $match) { return "" }
  return ($match -split "=", 2)[1].Trim().Trim('"').Trim("'")
}

$targetRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$environmentPath = Join-Path $targetRoot ".env"
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) { throw "Не найдено локальное подключение программы." }
if ($ExpectedSha256 -notmatch "^[A-Fa-f0-9]{64}$") { throw "Некорректная контрольная сумма обновления." }

$uri = [Uri]$PackageUrl
if ($uri.Scheme -ne "https" -or $uri.Host -ne "raw.githubusercontent.com" -or $uri.AbsolutePath -notmatch "^/brazhkoanatolii/(Packaging-Filling-Hub|Packaging-Filling-Hub-Updates)/.+\.zip$") {
  throw "Источник обновления не прошёл проверку."
}

$workstation = Get-EnvironmentValue -Path $environmentPath -Name "WORKSTATION_ROLE"
$workstationId = Get-EnvironmentValue -Path $environmentPath -Name "WORKSTATION_ID"
$workstationLabel = Get-EnvironmentValue -Path $environmentPath -Name "WORKSTATION_LABEL"
if ($workstation -notin @("manager", "senior")) { throw "Не определена роль рабочего компьютера." }

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "packaging-filling-hub-update-$([guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $temporaryRoot "update.zip"
$expandedPath = Join-Path $temporaryRoot "package"

try {
  New-Item -ItemType Directory -Path $expandedPath -Force | Out-Null
  Invoke-WebRequest -Uri $uri.AbsoluteUri -OutFile $archivePath -UseBasicParsing
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if (-not [string]::Equals($actualHash, $ExpectedSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Контрольная сумма не совпала. Обновление отменено."
  }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $expandedPath -Force
  $installer = Join-Path $expandedPath "scripts\windows\install.ps1"
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "В пакете нет сценария установки." }
  & $installer -Workstation $workstation -WorkstationId $workstationId -WorkstationLabel $workstationLabel -InstallRoot $targetRoot
} catch {
  $message = $_.Exception.Message
  $logDirectory = Join-Path $targetRoot "logs"
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $logDirectory "update-error.log") -Value "$(Get-Date -Format s) $message" -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
