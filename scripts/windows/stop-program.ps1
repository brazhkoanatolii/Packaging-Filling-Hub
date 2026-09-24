[CmdletBinding()]
param(
  [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
)

$ErrorActionPreference = "Stop"
$resolvedRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$pidPath = Join-Path $resolvedRoot ".runtime\gateway.pid"
$processId = 0
if (Test-Path -LiteralPath $pidPath -PathType Leaf) {
  if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$processId)) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq "node") {
      Stop-Process -Id $processId -Force
      $process.WaitForExit(5000) | Out-Null
    }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

# A previous gateway can occasionally survive if its PID file became stale.
# Stop only a Node.js process that is actually listening on this app's port;
# unrelated programs are never touched.
$environmentPath = Join-Path $resolvedRoot ".env"
$port = 4173
if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
  $portLine = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
    Where-Object { $_ -match "^\s*PORT\s*=" } |
    Select-Object -Last 1
  if ($portLine) {
    $candidate = ($portLine -split "=", 2)[1].Trim().Trim('"').Trim("'")
    $parsedPort = 0
    if ([int]::TryParse($candidate, [ref]$parsedPort) -and $parsedPort -gt 0 -and $parsedPort -lt 65536) {
      $port = $parsedPort
    }
  }
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $listenerProcess = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($listenerProcess -and $listenerProcess.ProcessName -eq "node") {
    Stop-Process -Id $listenerProcess.Id -Force
    $listenerProcess.WaitForExit(5000) | Out-Null
  }
}
