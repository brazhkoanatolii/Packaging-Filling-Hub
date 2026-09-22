[CmdletBinding()]
param(
  [string]$ServerUrl = "",
  [string]$ShortcutName = "Packaging-Filling-Hub"
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ServerUrl)) { $ServerUrl = Read-Host "Адрес центрального сервера, например http://PACKAGING-SENIOR:4174" }
$ServerUrl = $ServerUrl.Trim().TrimEnd("/")
if ($ServerUrl -notmatch "^https?://[^/]+(?::\d+)?$") { throw "Укажите адрес вида http://ИМЯ-КОМПЬЮТЕРА:4174" }

$chromeCandidates = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
)
$browser = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $browser) { throw "Не найден Google Chrome или Microsoft Edge." }

$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$ShortcutName.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $browser
$shortcut.Arguments = "--app=$ServerUrl/"
$shortcut.IconLocation = "$browser,0"
$shortcut.Description = "Открыть Packaging-Filling-Hub через центральный сервер участка"
$shortcut.Save()
Write-Host "Ярлык создан: $shortcutPath" -ForegroundColor Green
Write-Host "Google, Node.js и OAuth на этом компьютере не требуются." -ForegroundColor Green
