# Work 본문 추출·임베딩 매일 증분 등록 (NAS Scan 03:00 뒤)
#   03:10 LUNA Work Text Extract  — --incremental --purge-missing
#   03:25 LUNA Work Text Embed    — 새 청크만
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ExtractBat = Join-Path $Root "run-nas-text-incremental.bat"
$EmbedBat = Join-Path $Root "run-nas-text-embed.bat"

function Register-DailyIT([string]$Name, [string]$BatPath, [string]$Time) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  & schtasks /Delete /TN $Name /F *> $null
  $ErrorActionPreference = $prev
  schtasks /Create /TN $Name `
    /TR "cmd /c `"$BatPath`"" `
    /SC DAILY /ST $Time /F /IT `
    /RL HIGHEST
  if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed for $Name ($LASTEXITCODE)" }
  Write-Host "Registered $Name daily at $Time (IT)"
}

Register-DailyIT "LUNA Work Text Extract" $ExtractBat "03:10"
Register-DailyIT "LUNA Work Text Embed" $EmbedBat "03:25"

Write-Host "Done. Logs: $Root\tmp\nas-text-index.log , $Root\tmp\nas-text-embed.log"
