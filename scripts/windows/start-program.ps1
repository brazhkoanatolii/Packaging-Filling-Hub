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

function Get-PackagingHubHealth {
  param([string]$HealthUrl)
  try {
    return Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
  } catch {
    return $null
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
$expectedVersion = (Get-Content -LiteralPath (Join-Path $installPath "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$runningHealth = Get-PackagingHubHealth -HealthUrl $healthUrl

# During an update the old gateway can still answer on the port.  Do not treat
# that as success: replace it only when its reported version differs from the
# files just installed.  This keeps ordinary launches untouched and makes an
# update restart the actual program instead of merely refreshing the browser.
if (-not $runningHealth -or $runningHealth.version -ne $expectedVersion) {
  if ($runningHealth) {
    & (Join-Path $installPath "scripts\windows\stop-program.ps1") -InstallRoot $installPath
    Start-Sleep -Milliseconds 500
  }
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
    $health = Get-PackagingHubHealth -HealthUrl $healthUrl
    if ($health -and $health.version -eq $expectedVersion) {
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
