[CmdletBinding()]
param(
  [string]$InstallRoot = "",
  [switch]$NoBrowser
)

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-EnvironmentValue {
  param([string]$Path, [string]$Name, [string]$Fallback)
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $match = Get-Content -LiteralPath $Path -Encoding UTF8 |
      Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
      Select-Object -Last 1
    if ($match) {
      $value = ($match -split "=", 2)[1].Trim().Trim('"').Trim("'")
      if ($value) { return $value }
    }
  }
  return $Fallback
}

function Test-PackagingHub {
  param([string]$HealthUrl)
  try {
    $response = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
    return $response.ok -eq $true -and [bool]$response.version
  } catch {
    return $false
  }
}

$ErrorActionPreference = "Stop"
$installPath = [System.IO.Path]::GetFullPath($InstallRoot)
$serverPath = Join-Path $installPath "server\google-workspace-gateway.mjs"
$environmentPath = Join-Path $installPath ".env"
$runtimePath = Join-Path $installPath ".runtime"
$logPath = Join-Path $installPath "logs"

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
  throw "Не найден сервер программы: $serverPath"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Не найден Node.js. Установите Node.js 20 LTS или новее и повторите запуск."
}

$port = Get-EnvironmentValue -Path $environmentPath -Name "PORT" -Fallback "4173"
$url = "http://127.0.0.1:$port/"
$healthUrl = "${url}api/health"

if (-not (Test-PackagingHub -HealthUrl $healthUrl)) {
  New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
  New-Item -ItemType Directory -Path $logPath -Force | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdout = Join-Path $logPath "gateway-$stamp.log"
  $stderr = Join-Path $logPath "gateway-$stamp-error.log"
  $process = Start-Process -FilePath $node.Source `
    -ArgumentList @("server/google-workspace-gateway.mjs") `
    -WorkingDirectory $installPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
  Set-Content -LiteralPath (Join-Path $runtimePath "gateway.pid") -Value $process.Id -Encoding ascii

  $started = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-PackagingHub -HealthUrl $healthUrl) {
      $started = $true
      break
    }
    if ($process.HasExited) { break }
  }
  if (-not $started) {
    throw "Программа не запустилась. Проверьте журнал: $stderr"
  }
}

if (-not $NoBrowser) {
  Start-Process $url
}
