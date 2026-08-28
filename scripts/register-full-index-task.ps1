# 전체 색인 T:\02 Project\2026 — 작업 스케줄러 일회성 (/IT = 로그온 시 T: 접근)
# Cursor 가 등록·실행. 블루진 수동 실행 불필요.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "ApollonHub-LunaMediaIndexFull"
$Bat = Join-Path $Root "run-media-index.bat"
$RunAt = (Get-Date).AddMinutes(2)
$DateStr = $RunAt.ToString("yyyy/MM/dd")
$TimeStr = $RunAt.ToString("HH:mm")

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& schtasks /Delete /TN $TaskName /F *> $null
$ErrorActionPreference = $prevEap

schtasks /Create /TN $TaskName `
  /TR "cmd /c `"$Bat`"" `
  /SC ONCE /SD $DateStr /ST $TimeStr /F /IT `
  /RL LIMITED
if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed ($LASTEXITCODE)" }

Write-Host "Created task $TaskName at $DateStr $TimeStr (IT)"
schtasks /Run /TN $TaskName
if ($LASTEXITCODE -ne 0) { throw "schtasks /Run failed ($LASTEXITCODE)" }
Write-Host "Started. Log: $Root\media-index.log"
