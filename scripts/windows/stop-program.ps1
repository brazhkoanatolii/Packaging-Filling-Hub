[CmdletBinding()]
param(
  [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
)

$ErrorActionPreference = "Stop"
$pidPath = Join-Path ([System.IO.Path]::GetFullPath($InstallRoot)) ".runtime\gateway.pid"
if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { return }

$processId = 0
if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$processId)) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq "node") {
    Stop-Process -Id $processId -Force
    $process.WaitForExit(5000) | Out-Null
  }
}
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
