[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Packaging-Filling-Hub"),
  [switch]$RequireProduction
)

function Read-Environment {
  param([string]$Path)
  $result = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $result }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($line -match "^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$") {
      $result[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $result
}

$ErrorActionPreference = "Stop"
$installPath = [System.IO.Path]::GetFullPath($InstallRoot)
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

Write-Host "Проверка Packaging-Filling-Hub" -ForegroundColor Cyan
Write-Host "Папка: $installPath"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $failures.Add("Node.js не установлен")
} else {
  $nodeVersion = (& $node.Source --version).Trim()
  $major = [int]$nodeVersion.TrimStart("v").Split(".")[0]
  if ($major -lt 20) { $failures.Add("Node.js $nodeVersion устарел; требуется 20 или новее") }
  else { Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green }
}

foreach ($relativePath in @("index.html", "package.json", "service-worker.js", "server\google-workspace-gateway.mjs", "src\app.js", ".env")) {
  if (-not (Test-Path -LiteralPath (Join-Path $installPath $relativePath) -PathType Leaf)) {
    $failures.Add("Отсутствует файл $relativePath")
  }
}

$environmentPath = Join-Path $installPath ".env"
$environment = Read-Environment -Path $environmentPath
$role = $environment["WORKSTATION_ROLE"]
if ($role -notin @("manager", "senior")) {
  $failures.Add("Не назначена роль компьютера manager или senior")
} else {
  Write-Host "[OK] Роль компьютера: $role" -ForegroundColor Green
}
$workstationId = $environment["WORKSTATION_ID"]
$workstationLabel = $environment["WORKSTATION_LABEL"]
if ($workstationId -notmatch "^[a-z0-9][a-z0-9-]{1,63}$") {
  $failures.Add("Не назначен корректный идентификатор рабочего места")
} elseif (-not $workstationLabel) {
  $failures.Add("Не задано название рабочего места")
} else {
  Write-Host "[OK] Устройство: $workstationLabel ($workstationId)" -ForegroundColor Green
}

$port = if ($environment["PORT"]) { $environment["PORT"] } else { "4173" }
$healthUrl = "http://127.0.0.1:$port/api/health"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3
  if ($health.ok -ne $true) { throw "шлюз вернул ошибку" }
  Write-Host "[OK] Локальная программа запущена, версия $($health.version)" -ForegroundColor Green
  if ($health.workstationId -ne $workstationId -or $health.workstationLabel -ne $workstationLabel) {
    $failures.Add("Запущенный шлюз использует другое рабочее место; перезапустите программу")
  }
  if (-not $health.configured) {
    $warnings.Add("Google OAuth и/или Apps Script ещё не настроены: $($health.missing -join ', ')")
  } else {
    Write-Host "[OK] Доступ Google настроен" -ForegroundColor Green
  }
  if (-not $health.writesEnabled) {
    $warnings.Add("Запись в Google выключена до контрольной проверки")
  } else {
    Write-Host "[OK] Запись в Google включена" -ForegroundColor Green
  }
} catch {
  $failures.Add("Локальный шлюз не отвечает: $healthUrl")
}

foreach ($warning in $warnings) { Write-Host "[ОЖИДАЕТ] $warning" -ForegroundColor Yellow }
foreach ($failure in $failures) { Write-Host "[ОШИБКА] $failure" -ForegroundColor Red }

if ($failures.Count -gt 0) {
  Write-Host "Результат: установка неисправна." -ForegroundColor Red
  exit 1
}
if ($RequireProduction -and $warnings.Count -gt 0) {
  Write-Host "Результат: пилотная установка работает, но производственный режим ещё не готов." -ForegroundColor Yellow
  exit 2
}

Write-Host "Результат: локальная установка работает." -ForegroundColor Green
if ($warnings.Count -gt 0) { Write-Host "До производственного запуска выполните пункты со статусом ОЖИДАЕТ." -ForegroundColor Yellow }
