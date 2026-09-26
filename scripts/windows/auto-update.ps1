[CmdletBinding()]
param(
  [string]$InstallRoot = "",
  [switch]$Watch
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$installPath = [System.IO.Path]::GetFullPath($InstallRoot)
$logDirectory = Join-Path $installPath "logs"
$packagePath = Join-Path $installPath "package.json"
$updaterPath = Join-Path $installPath "scripts\windows\update-program.ps1"
$manifestApi = "https://api.github.com/repos/brazhkoanatolii/Packaging-Filling-Hub-Updates/contents/update-manifest.json?ref=main"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-UpdateLog {
  param([string]$Message)
  Add-Content -LiteralPath (Join-Path $logDirectory "auto-update.log") -Value "$(Get-Date -Format s) $Message" -Encoding UTF8
}

function Compare-Version {
  param([string]$Left, [string]$Right)
  $leftParts = $Left.Split(".") | ForEach-Object { [int]$_ }
  $rightParts = $Right.Split(".") | ForEach-Object { [int]$_ }
  for ($index = 0; $index -lt 3; $index += 1) {
    if ($leftParts[$index] -gt $rightParts[$index]) { return 1 }
    if ($leftParts[$index] -lt $rightParts[$index]) { return -1 }
  }
  return 0
}

function Get-VerifiedManifest {
  $response = Invoke-RestMethod -Headers @{ Accept = "application/vnd.github+json"; "User-Agent" = "Packaging-Filling-Hub" } -Uri $manifestApi -TimeoutSec 20
  $content = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([string]$response.content -replace "\s", "")))
  $manifest = $content | ConvertFrom-Json
  if ($manifest.version -notmatch "^\d+\.\d+\.\d+$") { throw "Некорректная версия в манифесте обновления." }
  if ($manifest.sha256 -notmatch "^[A-Fa-f0-9]{64}$") { throw "Некорректная контрольная сумма в манифесте обновления." }
  $uri = [Uri][string]$manifest.packageUrl
  if ($uri.Scheme -ne "https" -or $uri.Host -ne "raw.githubusercontent.com" -or $uri.AbsolutePath -notmatch "^/brazhkoanatolii/(Packaging-Filling-Hub|Packaging-Filling-Hub-Updates)/.+\.zip$") {
    throw "Источник обновления не прошёл проверку."
  }
  return $manifest
}

function Invoke-AutomaticUpdate {
  try {
    if (-not (Test-Path -LiteralPath $packagePath)) { throw "Не найден package.json программы." }
    if (-not (Test-Path -LiteralPath $updaterPath)) { throw "Не найден сценарий обновления." }
    $currentVersion = (Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $manifest = Get-VerifiedManifest
    if ((Compare-Version $manifest.version $currentVersion) -le 0) {
      Write-UpdateLog "Проверено: установлена актуальная версия $currentVersion."
      return $false
    }
    Write-UpdateLog "Найдена версия $($manifest.version). Запускаем установку без участия пользователя."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updaterPath -InstallRoot $installPath -PackageUrl $manifest.packageUrl -ExpectedSha256 $manifest.sha256
    $installedVersion = (Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($installedVersion -ne $manifest.version) { throw "Установлена версия $installedVersion вместо $($manifest.version)." }
    Write-UpdateLog "Версия $installedVersion установлена автоматически."
    return $true
  } catch {
    Write-UpdateLog "Ошибка автоматического обновления: $($_.Exception.Message)"
    return $false
  }
}

$mutex = New-Object System.Threading.Mutex($false, "Local\PackagingFillingHubAutoUpdate")
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
  do {
    $installed = Invoke-AutomaticUpdate
    if ($installed -or -not $Watch) { break }
    Start-Sleep -Seconds 60
  } while ($true)
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
