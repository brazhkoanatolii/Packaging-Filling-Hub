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

function Maximize-PackagingHubWindow {
  param([int]$TimeoutSeconds = 10)

  # Chrome restores the previous size of an app window and can ignore
  # --start-maximized.  Maximize only the Hub app window after it appears.
  if (-not ("PackagingHubWindow" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PackagingHubWindow {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $window = Get-Process -Name chrome -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*Packaging-Filling-Hub*" } |
      Select-Object -First 1
    if ($window) {
      [PackagingHubWindow]::ShowWindowAsync($window.MainWindowHandle, 3) | Out-Null
      return $true
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $false
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
  $chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )
  $chromePath = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if ($chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList @("--app=$url", "--start-maximized")
    [void](Maximize-PackagingHubWindow)
  } else {
    Start-Process $url
  }
}
