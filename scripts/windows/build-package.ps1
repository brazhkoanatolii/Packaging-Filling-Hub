[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot "..\..")))
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$distPath = Join-Path $projectRoot "dist"
$archiveName = "Packaging-Filling-Hub-$($package.version)-Windows.zip"
$archivePath = Join-Path $distPath $archiveName
$hashPath = "$archivePath.sha256"
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stagePath = Join-Path $temporaryRoot "packaging-filling-hub-$([guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Path $distPath -Force | Out-Null
New-Item -ItemType Directory -Path $stagePath -Force | Out-Null

try {
  foreach ($directory in @("assets", "src", "server", "scripts")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination (Join-Path $stagePath $directory) -Recurse
  }
  foreach ($file in @(
    "index.html",
    "manifest.webmanifest",
    "runtime-config.js",
    "service-worker.js",
    "package.json",
    ".env.example",
    "README-INSTALLATION-RU.md",
    "HOME-WORK-RU.md",
    "INSTALL-HOME-MANAGER.cmd",
    "INSTALL-MANAGER.cmd",
    "INSTALL-SENIOR-MECHANIC.cmd",
    "INSTALL-CENTRAL-SERVER.cmd",
    "INSTALL-MANAGER-NETWORK-CLIENT.cmd",
    "UPDATE-MANAGER-WORK.cmd",
    "UPDATE-SENIOR-MECHANIC-WORK.cmd",
    "CONNECT-GOOGLE.cmd",
    "TEST-GOOGLE-CONNECTION.cmd",
    "ENABLE-GOOGLE-WRITES.cmd",
    "VERIFY-INSTALLATION.cmd"
  )) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $stagePath $file)
  }
  New-Item -ItemType Directory -Path (Join-Path $stagePath "docs") -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot "docs\CENTRAL-SERVER-RU.md") -Destination (Join-Path $stagePath "docs\CENTRAL-SERVER-RU.md")

  if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  if (Test-Path -LiteralPath $hashPath) { Remove-Item -LiteralPath $hashPath -Force }
  Compress-Archive -Path (Join-Path $stagePath "*") -DestinationPath $archivePath -CompressionLevel Optimal
  $hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
  Set-Content -LiteralPath $hashPath -Value "$($hash.Hash)  $archiveName" -Encoding ascii
} finally {
  $resolvedStage = [System.IO.Path]::GetFullPath($stagePath)
  if ($resolvedStage.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStage)) {
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}

Write-Host "Создан установочный пакет:" -ForegroundColor Green
Write-Host $archivePath
Write-Host "SHA256: $($hash.Hash)"
