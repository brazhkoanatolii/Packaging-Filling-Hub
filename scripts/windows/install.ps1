[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("manager", "senior")]
  [string]$Workstation,
  [string]$WorkstationId = "",
  [string]$WorkstationLabel = "",
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Packaging-Filling-Hub"),
  [switch]$NoStart,
  [switch]$NoShortcuts
)

function Set-EnvironmentValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path -Encoding UTF8) } else { @() }
  $replacement = "$Name=$Value"
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i += 1) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Name))\s*=") { $index = $i }
  }
  if ($index -ge 0) { $lines[$index] = $replacement } else { $lines += $replacement }
  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
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

$ErrorActionPreference = "Stop"
$WorkstationId = $WorkstationId.Trim().ToLowerInvariant()
$WorkstationLabel = $WorkstationLabel.Trim()
if (-not $WorkstationId) {
  $WorkstationId = if ($Workstation -eq "manager") { "manager-work" } else { "senior-work" }
}
if (-not $WorkstationLabel) {
  $WorkstationLabel = if ($Workstation -eq "manager") { "Рабочий компьютер начальника" } else { "Рабочий компьютер старшего механика" }
}
if ($WorkstationId -notmatch "^[a-z0-9][a-z0-9-]{1,63}$") {
  throw "Идентификатор рабочего места должен содержать только латинские буквы, цифры и дефисы."
}
if ($WorkstationLabel.Length -gt 80) {
  throw "Название рабочего места не должно превышать 80 символов."
}
$sourceRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot "..\..")))
$targetRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $node) {
  throw "Не найден Node.js. Сначала установите Node.js 20 LTS или новее."
}
$nodeVersion = (& $node.Source --version).TrimStart("v").Split(".")
if ([int]$nodeVersion[0] -lt 20) {
  throw "Требуется Node.js 20 или новее. Сейчас установлен Node.js $($nodeVersion -join '.')."
}

if ($sourceRoot -ne $targetRoot -and (Test-Path -LiteralPath (Join-Path $targetRoot "scripts\windows\stop-program.ps1"))) {
  & (Join-Path $targetRoot "scripts\windows\stop-program.ps1") -InstallRoot $targetRoot
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
if ($sourceRoot -ne $targetRoot) {
  foreach ($directory in @("assets", "src", "server", "scripts")) {
    $destination = Join-Path $targetRoot $directory
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceRoot "$directory\*") -Destination $destination -Recurse -Force
  }
  foreach ($file in @("index.html", "manifest.webmanifest", "runtime-config.js", "service-worker.js", "package.json", ".env.example", "README-INSTALLATION-RU.md", "HOME-WORK-RU.md")) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $targetRoot $file) -Force
  }
}

$environmentPath = Join-Path $targetRoot ".env"
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  Copy-Item -LiteralPath (Join-Path $targetRoot ".env.example") -Destination $environmentPath
}
Set-EnvironmentValue -Path $environmentPath -Name "WORKSTATION_ROLE" -Value $Workstation
Set-EnvironmentValue -Path $environmentPath -Name "WORKSTATION_ID" -Value $WorkstationId
Set-EnvironmentValue -Path $environmentPath -Name "WORKSTATION_LABEL" -Value $WorkstationLabel
Set-EnvironmentValue -Path $environmentPath -Name "HOST" -Value "127.0.0.1"

New-Item -ItemType Directory -Path (Join-Path $targetRoot "logs") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetRoot ".runtime") -Force | Out-Null

$startScript = Join-Path $targetRoot "scripts\windows\start-program.ps1"
if (-not $NoShortcuts) {
  $powerShellPath = Join-Path $PSHOME "powershell.exe"
  $shortcutArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
  $shell = New-Object -ComObject WScript.Shell

  $desktopShortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Packaging-Filling-Hub.lnk"))
  $chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )
  $chromePath = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if ($chromePath) {
    # The gateway starts from Windows Startup; opening Chrome directly avoids a hidden
    # PowerShell shortcut that can silently fail to foreground the application.
    $port = Get-EnvironmentValue -Path $environmentPath -Name "PORT" -Fallback "4173"
    $desktopShortcut.TargetPath = $chromePath
    $desktopShortcut.Arguments = "--app=http://127.0.0.1:$port/"
    $desktopShortcut.IconLocation = "$chromePath,0"
  } else {
    $desktopShortcut.TargetPath = $powerShellPath
    $desktopShortcut.Arguments = $shortcutArguments
    $desktopShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
  }
  $desktopShortcut.WorkingDirectory = $targetRoot
  $desktopShortcut.Description = "Открыть Packaging-Filling-Hub"
  $desktopShortcut.Save()

  $startupDirectory = [Environment]::GetFolderPath("Startup")
  $startupFile = Join-Path $startupDirectory "Packaging-Filling-Hub.cmd"
  $startupCommand = "@`"$powerShellPath`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -NoBrowser"
  Set-Content -LiteralPath $startupFile -Value $startupCommand -Encoding ascii
}

if (-not $NoStart) {
  & $startScript -InstallRoot $targetRoot
}

$roleTitle = if ($Workstation -eq "manager") { "Начальник участка" } else { "Старший механик" }
Write-Host ""
Write-Host "Packaging-Filling-Hub установлен." -ForegroundColor Green
Write-Host "Папка: $targetRoot"
Write-Host "Рабочее место: $roleTitle"
Write-Host "Устройство: $WorkstationLabel ($WorkstationId)"
if (-not $NoShortcuts) { Write-Host "Ярлык создан на рабочем столе; локальный шлюз добавлен в автозапуск." }
Write-Host "Google проверяется отдельно командой VERIFY-INSTALLATION.cmd."
