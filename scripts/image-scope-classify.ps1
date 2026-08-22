# Image scope classification — T:\ · P:\ read-only folder-type census
# No vision API. No moves/deletes. No nas_directory writes.
#
# Company PC (open T: and P: in Explorer first):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\image-scope-classify.ps1
#
# Output: tmp\image-scope-report.md
# Save this file as UTF-8 (BOM recommended on Windows).

$ErrorActionPreference = "Continue"
$ProgressEvery = 5000

$exts = @(".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".heic")
$extSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($e in $exts) { [void]$extSet.Add($e) }

$roots = @()
foreach ($r in @("T:\", "P:\")) {
  if (Test-Path -LiteralPath $r) { $roots += $r }
  else { Write-Host "MISSING root: $r" -ForegroundColor Red }
}
if ($roots.Count -eq 0) {
  Write-Host "No T: or P:. Open drives in Explorer, then re-run." -ForegroundColor Red
  exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "package.json"))) {
  $repoRoot = (Get-Location).Path
}
$outDir = Join-Path $repoRoot "tmp"
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}
$outPath = Join-Path $outDir "image-scope-report.md"

# Internal keys = ASCII. Labels for report = Korean.
$excludeOrder = @(
  "recycle",
  "d5_cache",
  "render_3d",
  "sketchup_enscape",
  "screen_capture",
  "texture_lib",
  "personal",
  "old_backup",
  "management",
  "tiny_under_100kb",
  "dup_filename"
)
$excludeLabel = @{
  recycle            = "휴지통 (#recycle)"
  d5_cache           = "D5 렌더 캐시 (_d5c · d5 · D5_)"
  render_3d          = "3D 렌더 시퀀스 (render · 3d asset · model · SKP · 시퀀스)"
  sketchup_enscape   = "스케치업/엔스케이프 (skp · enscape · lumion · vray · twinmotion)"
  screen_capture     = "영상 화면캡처 (캡처 · screenshot · 파일명 mp4/mov)"
  texture_lib        = "텍스처 라이브러리 (Design source · 재질 · texture · material)"
  personal           = "개인 폴더 (99 개인폴더 · 개인)"
  old_backup         = "구버전·백업 (old · 백업 · backup · 보류 · 임시 · temp)"
  management         = "행정·계약 (00 Management · 계약 · 사업자등록 · 통장)"
  tiny_under_100kb   = "아이콘·썸네일 (100KB 미만)"
  dup_filename       = "중복 (같은 파일명 · 첫 번째만 유지)"
}

$keepOrder = @(
  "our_design",
  "reference",
  "space",
  "field_test",
  "field_photo",
  "provided",
  "unclassified"
)
$keepLabel = @{
  our_design    = "우리시안"
  reference     = "레퍼런스"
  space         = "공간·도면"
  field_test    = "현장테스트"
  field_photo   = "현장사진"
  provided      = "제공받은자료"
  unclassified  = "미분류"
}

function New-BucketMap([string[]]$keys) {
  $h = @{}
  foreach ($k in $keys) {
    $h[$k] = @{ count = [int64]0; bytes = [int64]0 }
  }
  return $h
}

$exclude = New-BucketMap $excludeOrder
$keep = New-BucketMap $keepOrder
$byDrive = @{
  "T" = @{ total = [int64]0; bytes = [int64]0; kept = [int64]0; keptBytes = [int64]0 }
  "P" = @{ total = [int64]0; bytes = [int64]0; kept = [int64]0; keptBytes = [int64]0 }
}
$keepByYear = @{}
$keepSize = @{
  "100KB-1MB" = [int64]0
  "1MB-5MB"   = [int64]0
  "5MB+"      = [int64]0
}

$unclassifiedParents = @{}
$folderNameHits = @{}
$seenKeepNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

function Inc-Bucket($map, [string]$key, [int64]$bytes) {
  $map[$key].count++
  $map[$key].bytes += $bytes
}

function Fmt-Bytes([int64]$b) {
  if ($b -ge 1GB) { return ("{0:N2} GB" -f ($b / 1GB)) }
  if ($b -ge 1MB) { return ("{0:N2} MB" -f ($b / 1MB)) }
  if ($b -ge 1KB) { return ("{0:N2} KB" -f ($b / 1KB)) }
  return "$b B"
}

function Get-ExcludeReason([string]$fullPath, [string]$fileName, [int64]$len) {
  $p = $fullPath

  if ($p -match '(?i)#recycle') { return "recycle" }
  if ($p -match '(?i)_d5c|[/\\]d5[/\\]|D5_|_d5_|d5c') { return "d5_cache" }
  if ($p -match '(?i)[/\\]render(ing)?[/\\]|3d\s*asset|[/\\]model[/\\]|[/\\]SKP[/\\]|시퀀스') {
    return "render_3d"
  }
  if ($p -match '(?i)\.skp|enscape|lumion|vray|twinmotion|★SKP') {
    return "sketchup_enscape"
  }
  if ($p -match '(?i)화면캡쳐|화면\s*캡처|캡처|capture|screenshot|스크린샷') {
    return "screen_capture"
  }
  $baseNoExt = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
  if ($baseNoExt -match '(?i)(\.mp4|\.mov|mp4_|_mp4|mov_|_mov)') {
    return "screen_capture"
  }
  if ($p -match '(?i)Design\s*source|재질|[/\\]texture[/\\]|[/\\]material[/\\]|텍스처|텍스쳐') {
    return "texture_lib"
  }
  if ($p -match '(?i)99\s*개인폴더|[/\\]개인[/\\]|개인폴더') {
    return "personal"
  }
  if ($p -match '(?i)[/\\]old[/\\]|백업|backup|보류|임시|[/\\]temp[/\\]|[/\\]_tmp') {
    return "old_backup"
  }
  if ($p -match '(?i)00\s*Management|계약|사업자등록|통장사본|통장') {
    return "management"
  }
  if ($len -lt 100KB) { return "tiny_under_100kb" }
  return $null
}

function Get-KeepCategory([string]$fullPath) {
  $p = $fullPath

  if ($p -match '(?i)홍보|마케팅|촬영|준공|Behance|인스타|포트폴리오') {
    if ($p -match '(?i)레퍼런스\s*영상|still\s*cut|Thumnail|thumbnail') {
      return "field_photo"
    }
  }
  if ($p -match '(?i)제공받은|[/\\]\d{0,2}\s*제공|고객\s*제공') {
    return "provided"
  }
  if ($p -match '(?i)[/\\]\d{0,2}\s*Design[/\\]|Ideation|아이데이션|제안|시안|Concept|아트웍') {
    return "our_design"
  }
  if ($p -match '(?i)[/\\]Design[/\\]|[/\\]Ideation[/\\]') {
    return "our_design"
  }
  if ($p -match '(?i)Reference|레퍼런스|참고|사례') {
    return "reference"
  }
  if ($p -match '(?i)[/\\]\d{0,2}\s*Space[/\\]|도면|평면|현장답사|[/\\]Space[/\\]') {
    return "space"
  }
  if ($p -match '(?i)[/\\]\d{0,2}\s*Test[/\\]|시뮬레이션|현장\s*테스트|[/\\]Test[/\\]') {
    return "field_test"
  }
  if ($p -match '(?i)마케팅|홍보|촬영|준공|Behance|인스타그램|인스타') {
    return "field_photo"
  }
  return "unclassified"
}

function Note-JunkHints([string]$fullPath) {
  $checks = @(
    @{ k = "AE_Premiere"; re = '(?i)After\s*Effects|[/\\]AE[/\\]|Premiere|[/\\]Pr[/\\]|Adobe' },
    @{ k = "node_modules_git"; re = '(?i)node_modules|\.git[/\\]|[/\\]\.cache' },
    @{ k = "preview_proxy"; re = '(?i)[/\\]preview[/\\]|proxy|프록시' },
    @{ k = "brush_plugin"; re = '(?i)brush|플러그인|plugin|stock\s*photo' },
    @{ k = "linked_assets"; re = '(?i)[/\\]Links[/\\]|linked\s*files|링크드' },
    @{ k = "font_icon"; re = '(?i)[/\\]font|/icons?[/\\]|favicon|파비콘' },
    @{ k = "game_engine"; re = '(?i)unity|unreal|blender' },
    @{ k = "sync_conflict"; re = '(?i)conflict|충돌본|\.sync' },
    @{ k = "output_export"; re = '(?i)[/\\]output[/\\]|[/\\]export[/\\]|내보내기' }
  )
  foreach ($c in $checks) {
    if ($fullPath -match $c.re) {
      if (-not $script:folderNameHits.ContainsKey($c.k)) {
        $script:folderNameHits[$c.k] = [int64]0
      }
      $script:folderNameHits[$c.k]++
    }
  }
}

Write-Host "=== image-scope-classify ==="
Write-Host "Roots: $($roots -join ', ')"
Write-Host "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Report -> $outPath"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$totalSeen = [int64]0

foreach ($root in $roots) {
  $driveLetter = $root.Substring(0, 1).ToUpperInvariant()
  Write-Host "--- $root ---"

  $stack = [System.Collections.Generic.Stack[string]]::new()
  $stack.Push($root)

  while ($stack.Count -gt 0) {
    $dir = $stack.Pop()
    try {
      foreach ($sub in [System.IO.Directory]::EnumerateDirectories($dir)) {
        $stack.Push($sub)
      }
    } catch { }

    try {
      foreach ($file in [System.IO.Directory]::EnumerateFiles($dir)) {
        $ext = [System.IO.Path]::GetExtension($file)
        if (-not $extSet.Contains($ext)) { continue }

        $totalSeen++
        $len = [int64]0
        try { $len = (New-Object System.IO.FileInfo($file)).Length } catch { $len = 0 }

        $byDrive[$driveLetter].total++
        $byDrive[$driveLetter].bytes += $len

        $fileName = [System.IO.Path]::GetFileName($file)
        $ex = Get-ExcludeReason $file $fileName $len

        if ($null -eq $ex) {
          $nameKey = $fileName.ToLowerInvariant()
          if ($seenKeepNames.Contains($nameKey)) {
            $ex = "dup_filename"
          } else {
            [void]$seenKeepNames.Add($nameKey)
          }
        }

        if ($null -ne $ex) {
          Inc-Bucket $exclude $ex $len
          Note-JunkHints $file
        } else {
          $cat = Get-KeepCategory $file
          Inc-Bucket $keep $cat $len
          $byDrive[$driveLetter].kept++
          $byDrive[$driveLetter].keptBytes += $len

          $yearHit = "other"
          if ($file -match '(?<!\d)(20[12][0-9])(?!\d)') { $yearHit = $Matches[1] }
          if (-not $keepByYear.ContainsKey($yearHit)) { $keepByYear[$yearHit] = [int64]0 }
          $keepByYear[$yearHit]++

          if ($len -lt 1MB) { $keepSize["100KB-1MB"]++ }
          elseif ($len -lt 5MB) { $keepSize["1MB-5MB"]++ }
          else { $keepSize["5MB+"]++ }

          if ($cat -eq "unclassified") {
            $parent = [System.IO.Path]::GetDirectoryName($file)
            if (-not $unclassifiedParents.ContainsKey($parent)) {
              $unclassifiedParents[$parent] = [int64]0
            }
            $unclassifiedParents[$parent]++
          }

          Note-JunkHints $file
        }

        if (($totalSeen % $ProgressEvery) -eq 0) {
          $keptSoFar = [int64]0
          foreach ($k in $keepOrder) { $keptSoFar += $keep[$k].count }
          Write-Host ("  ... {0:N0} images | kept {1:N0} | {2:N1}s" -f $totalSeen, $keptSoFar, $sw.Elapsed.TotalSeconds)
        }
      }
    } catch { }
  }
}

$sw.Stop()

$excludeTotal = [int64]0
$excludeBytes = [int64]0
foreach ($k in $excludeOrder) {
  $excludeTotal += $exclude[$k].count
  $excludeBytes += $exclude[$k].bytes
}
$keepTotal = [int64]0
$keepBytes = [int64]0
foreach ($k in $keepOrder) {
  $keepTotal += $keep[$k].count
  $keepBytes += $keep[$k].bytes
}
$uncCount = $keep["unclassified"].count
$unclassifiedPct = if ($keepTotal -gt 0) {
  [math]::Round(100.0 * $uncCount / $keepTotal, 1)
} else { 0 }

$topUnc = $unclassifiedParents.GetEnumerator() |
  Sort-Object { $_.Value } -Descending |
  Select-Object -First 20

$suggestions = New-Object System.Collections.Generic.List[string]
foreach ($kv in ($folderNameHits.GetEnumerator() | Sort-Object { $_.Value } -Descending)) {
  if ($kv.Value -ge 500) {
    $suggestions.Add(("- `{0}` — ~{1:N0} paths hit (exclude candidate)" -f $kv.Key, $kv.Value))
  }
}

$uncKeywordHits = @{}
$uncKw = @(
  @{ k = "Document"; re = '(?i)Document|문서|기획서' },
  @{ k = "RnD_IP"; re = '(?i)R&D|IP개발|연구' },
  @{ k = "Apollog"; re = '(?i)99\s*Apollog' },
  @{ k = "BizDev"; re = '(?i)01\s*사업개발' },
  @{ k = "output_export"; re = '(?i)[/\\]output[/\\]|[/\\]export[/\\]|내보내기' },
  @{ k = "cache_proxy"; re = '(?i)cache|프록시|proxy|preview' }
)
foreach ($parent in $unclassifiedParents.Keys) {
  $c = $unclassifiedParents[$parent]
  foreach ($u in $uncKw) {
    if ($parent -match $u.re) {
      if (-not $uncKeywordHits.ContainsKey($u.k)) { $uncKeywordHits[$u.k] = [int64]0 }
      $uncKeywordHits[$u.k] += $c
    }
  }
}
foreach ($kv in ($uncKeywordHits.GetEnumerator() | Sort-Object { $_.Value } -Descending)) {
  if ($kv.Value -ge 200) {
    $suggestions.Add(("- unclassified folder hint `{0}` — {1:N0} images (review rule)" -f $kv.Key, $kv.Value))
  }
}

$utf8Bom = New-Object System.Text.UTF8Encoding $true
$sb = New-Object System.Text.StringBuilder
function L([string]$s) { [void]$script:sb.AppendLine($s) }

L "# 이미지 색인 대상 정밀 산정"
L ""
L ("생성: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
L ("소요: **{0:N1}초 ({1:N2}분)**" -f $sw.Elapsed.TotalSeconds, $sw.Elapsed.TotalMinutes)
L ("루트: {0}" -f ($roots -join ', '))
L ""
L "## 1. 전체 이미지 수"
L ""
L "| 드라이브 | 장수 | 용량 |"
L "|----------|-----:|------|"
foreach ($d in @("T", "P")) {
  L ("| {0}: | {1:N0} | {2} |" -f $d, $byDrive[$d].total, (Fmt-Bytes $byDrive[$d].bytes))
}
$totalBytesAll = $byDrive["T"].bytes + $byDrive["P"].bytes
L ("| **합계** | **{0:N0}** | **{1}** |" -f $totalSeen, (Fmt-Bytes $totalBytesAll))
L ""
L "## 2. 제외 유형별 (우선순위 순 · 첫 매칭만 카운트)"
L ""
L "| 제외 유형 | 장수 | 용량 |"
L "|-----------|-----:|------|"
foreach ($k in $excludeOrder) {
  L ("| {0} | {1:N0} | {2} |" -f $excludeLabel[$k], $exclude[$k].count, (Fmt-Bytes $exclude[$k].bytes))
}
L ("| **제외 합계** | **{0:N0}** | **{1}** |" -f $excludeTotal, (Fmt-Bytes $excludeBytes))
L ""
L "## 3. 남는 수 (제외 후)"
L ""
L "| 항목 | 값 |"
L "|------|---:|"
L ("| 전체 | {0:N0} |" -f $totalSeen)
L ("| 제외 | {0:N0} |" -f $excludeTotal)
L ("| **남음 (색인 후보)** | **{0:N0}** |" -f $keepTotal)
L ("| 남음 용량 | {0} |" -f (Fmt-Bytes $keepBytes))
L ""
L "| 드라이브 | 남은 장수 | 남은 용량 |"
L "|----------|----------:|----------|"
foreach ($d in @("T", "P")) {
  L ("| {0}: | {1:N0} | {2} |" -f $d, $byDrive[$d].kept, (Fmt-Bytes $byDrive[$d].keptBytes))
}
L ""
L "## 4. 남은 것의 유형별"
L ""
L "| 유형 | 장수 | 용량 | 비율 |"
L "|------|-----:|------|-----:|"
foreach ($k in $keepOrder) {
  $pct = if ($keepTotal -gt 0) { [math]::Round(100.0 * $keep[$k].count / $keepTotal, 1) } else { 0 }
  L ("| {0} | {1:N0} | {2} | {3}% |" -f $keepLabel[$k], $keep[$k].count, (Fmt-Bytes $keep[$k].bytes), $pct)
}
L ("| **합계** | **{0:N0}** | **{1}** | 100% |" -f $keepTotal, (Fmt-Bytes $keepBytes))
L ""
L "## 5. 미분류"
L ""
L ("- 미분류: **{0:N0}** / {1:N0} = **{2}%**" -f $uncCount, $keepTotal, $unclassifiedPct)
L ""
L "### 대표 폴더 20 (미분류 · 이미지 많은 순)"
L ""
L "| # | 장수 | 폴더 |"
L "|--:|-----:|------|"
$rank = 0
foreach ($row in $topUnc) {
  $rank++
  L ("| {0} | {1:N0} | `{2}` |" -f $rank, $row.Value, $row.Key)
}
if ($rank -eq 0) { L "| — | 0 | (없음) |" }
L ""
L "## 6. 남은 것 · 연도별"
L ""
L "| 연도 | 장수 |"
L "|------|-----:|"
$years = @("2020","2021","2022","2023","2024","2025","2026","other")
foreach ($y in $years) {
  $c = if ($keepByYear.ContainsKey($y)) { $keepByYear[$y] } else { [int64]0 }
  L ("| {0} | {1:N0} |" -f $y, $c)
}
foreach ($y in ($keepByYear.Keys | Sort-Object)) {
  if ($years -notcontains $y) {
    L ("| {0} | {1:N0} |" -f $y, $keepByYear[$y])
  }
}
L ""
L "## 7. 남은 것 · 크기 분포"
L ""
L "| 구간 | 장수 |"
L "|------|-----:|"
foreach ($k in @("100KB-1MB", "1MB-5MB", "5MB+")) {
  L ("| {0} | {1:N0} |" -f $k, $keepSize[$k])
}
L ""
L "## 8. 새로 찾은 제외 패턴 제안"
L ""
if ($suggestions.Count -eq 0) {
  L "- (임계치 이상 후보 없음 — 미분류 상위 폴더를 직접 확인)"
} else {
  foreach ($s in $suggestions) { L $s }
}
L ""
L "경로 힌트 전체 (참고):"
L ""
L "| 힌트 | 감지 장수 |"
L "|------|----------:|"
foreach ($kv in ($folderNameHits.GetEnumerator() | Sort-Object { $_.Value } -Descending)) {
  L ("| {0} | {1:N0} |" -f $kv.Key, $kv.Value)
}
L ""
L "## 9. 소요 시간"
L ""
L ("**{0:N1}초 ({1:N2}분)** · 처리 {2:N0}장" -f $sw.Elapsed.TotalSeconds, $sw.Elapsed.TotalMinutes, $totalSeen)
L ""
L "---"
L ""
L "### 분류 규칙 메모"
L "- 제외는 **위에서 아래 우선순위**로 첫 매칭만 카운트 (이중계산 없음)."
L "- 중복파일명: 경로·크기 제외를 통과한 뒤, 같은 파일명이 이미 1회 남았으면 제외."
L "- 홍보·마케팅 안 레퍼런스 영상/still 은 현장사진."
L "- 읽기만. 원본·DB 미변경."

$text = $sb.ToString()
[System.IO.File]::WriteAllText($outPath, $text, $utf8Bom)

Write-Host ""
Write-Host "========== SUMMARY =========="
Write-Host ("Total: {0:N0}" -f $totalSeen)
Write-Host ("Excluded: {0:N0}" -f $excludeTotal)
Write-Host ("Kept: {0:N0}" -f $keepTotal)
Write-Host ("Unclassified: {0:N0} ({1}%)" -f $uncCount, $unclassifiedPct)
Write-Host ("Elapsed: {0:N1}s" -f $sw.Elapsed.TotalSeconds)
Write-Host "Wrote $outPath"

# Console summary tables (ASCII-safe keys + counts)
Write-Host ""
Write-Host "EXCLUDE:"
foreach ($k in $excludeOrder) {
  Write-Host ("  {0,-20} {1,12:N0}  {2}" -f $k, $exclude[$k].count, (Fmt-Bytes $exclude[$k].bytes))
}
Write-Host "KEEP:"
foreach ($k in $keepOrder) {
  Write-Host ("  {0,-20} {1,12:N0}  {2}" -f $k, $keep[$k].count, (Fmt-Bytes $keep[$k].bytes))
}
