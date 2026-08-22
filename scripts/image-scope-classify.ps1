# Image scope classification — T:\ · P:\ read-only folder-type census
# No vision API. No moves/deletes. No nas_directory writes.
#
# Company PC (open T: and P: in Explorer first):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\image-scope-classify.ps1
#
# Output: tmp\image-scope-report.md

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

# --- buckets ---
$excludeKeys = @(
  "휴지통",
  "D5렌더캐시",
  "3D렌더시퀀스",
  "스케치업엔스케이프",
  "영상화면캡처",
  "텍스처라이브러리",
  "개인폴더",
  "구버전백업",
  "행정계약",
  "아이콘썸네일_100KB미만",
  "중복파일명"
)
$keepKeys = @(
  "우리시안",
  "레퍼런스",
  "공간도면",
  "현장테스트",
  "현장사진",
  "제공받은자료",
  "미분류"
)

function New-BucketMap([string[]]$keys) {
  $h = @{}
  foreach ($k in $keys) {
    $h[$k] = @{ count = [int64]0; bytes = [int64]0 }
  }
  return $h
}

$exclude = New-BucketMap $excludeKeys
$keep = New-BucketMap $keepKeys
$byDrive = @{
  "T" = @{ total = [int64]0; bytes = [int64]0; kept = [int64]0; keptBytes = [int64]0 }
  "P" = @{ total = [int64]0; bytes = [int64]0; kept = [int64]0; keptBytes = [int64]0 }
}
$keepByYear = @{}
$keepSize = @{
  "100KB~1MB" = [int64]0
  "1MB~5MB"   = [int64]0
  "5MB+"      = [int64]0
}

# unclassified parent folder -> count (for top-20 + new patterns)
$unclassifiedParents = @{}
# all non-excluded folder name tokens that look junk (for pattern discovery)
$folderNameHits = @{}  # pattern label -> count of images under matching folders (among kept+unclassified path scan)

# basename (lower) -> already kept once
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

# Ordered exclude (first match wins). Returns exclude key or $null.
function Get-ExcludeReason([string]$fullPath, [string]$fileName, [int64]$len) {
  $p = $fullPath

  if ($p -match '(?i)#recycle') { return "휴지통" }

  if ($p -match '(?i)_d5c|[/\\]d5[/\\]|D5_|_d5_|d5c') { return "D5렌더캐시" }

  if ($p -match '(?i)[/\\]render(ing)?[/\\]|3d\s*asset|[/\\]model[/\\]|[/\\]SKP[/\\]|시퀀스') {
    return "3D렌더시퀀스"
  }

  if ($p -match '(?i)\.skp|enscape|lumion|vray|twinmotion|[/\\]skp[,\\]|★SKP') {
    return "스케치업엔스케이프"
  }

  # folder OR filename hints for screen grabs / video stills
  if ($p -match '(?i)화면캡쳐|화면\s*캡처|캡처|capture|screenshot|스크린샷') {
    return "영상화면캡처"
  }
  $baseNoExt = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
  if ($baseNoExt -match '(?i)\.(mp4|mov|avi|mkv|wmv)\b|mp4|mov') {
    # "foo.mp4.jpg" or names containing mp4/mov from video export
    if ($baseNoExt -match '(?i)(\.mp4|\.mov|mp4_|_mp4|mov_|_mov)') {
      return "영상화면캡처"
    }
  }

  if ($p -match '(?i)Design\s*source|재질|[/\\]texture[/\\]|[/\\]material[/\\]|텍스처|텍스쳐') {
    return "텍스처라이브러리"
  }

  if ($p -match '(?i)99\s*개인폴더|[/\\]개인[/\\]|개인폴더') {
    return "개인폴더"
  }

  if ($p -match '(?i)[/\\]old[/\\]|백업|backup|보류|임시|[/\\]temp[/\\]|[/\\]_tmp') {
    return "구버전백업"
  }

  if ($p -match '(?i)00\s*Management|계약|사업자등록|통장사본|통장') {
    return "행정계약"
  }

  if ($len -lt 100KB) { return "아이콘썸네일_100KB미만" }

  return $null
}

function Get-KeepCategory([string]$fullPath) {
  $p = $fullPath

  # promo / portfolio stills even if path says 레퍼런스
  if ($p -match '(?i)홍보|마케팅|촬영|준공|Behance|인스타|포트폴리오') {
    if ($p -match '(?i)레퍼런스\s*영상|still\s*cut|Thumnail|thumbnail') {
      return "현장사진"
    }
  }

  if ($p -match '(?i)제공받은|[/\\]\d{0,2}\s*제공|고객\s*제공') {
    return "제공받은자료"
  }

  if ($p -match '(?i)[/\\]\d{0,2}\s*Design[/\\]|Ideation|아이데이션|제안|시안|Concept|아트웍') {
    return "우리시안"
  }
  if ($p -match '(?i)design|ideation') {
    # loose Design folder without number
    if ($p -match '(?i)[/\\]Design[/\\]|[/\\]Ideation[/\\]') {
      return "우리시안"
    }
  }

  if ($p -match '(?i)Reference|레퍼런스|참고|사례') {
    return "레퍼런스"
  }

  if ($p -match '(?i)[/\\]\d{0,2}\s*Space[/\\]|도면|평면|현장답사') {
    return "공간도면"
  }
  if ($p -match '(?i)[/\\]Space[/\\]') { return "공간도면" }

  if ($p -match '(?i)[/\\]\d{0,2}\s*Test[/\\]|시뮬레이션|현장\s*테스트') {
    return "현장테스트"
  }
  if ($p -match '(?i)[/\\]Test[/\\]') { return "현장테스트" }

  if ($p -match '(?i)마케팅|홍보|촬영|준공|Behance|인스타그램|인스타') {
    return "현장사진"
  }

  return "미분류"
}

# Extra junk patterns to tally (informational) when path is NOT already recycle/d5
function Note-JunkHints([string]$fullPath, [string]$keepOrExclude) {
  $checks = @(
    @{ k = "AE_Premiere프로젝트"; re = '(?i)After\s*Effects|[/\\]AE[/\\]|Premiere|[/\\]Pr[/\\]|Adobe' },
    @{ k = "노드모듈_깃"; re = '(?i)node_modules|\.git[/\\]|[/\\]\.cache' },
    @{ k = "프리뷰_프록시"; re = '(?i)[/\\]preview[/\\]|proxy|프록시|프뷰' },
    @{ k = "플러그인_브러시"; re = '(?i)brush|플러그인|plugin|stock\s*photo' },
    @{ k = "프레임시퀀스_숫자폴더"; re = '(?i)frame|frames|[/\\]\d{4,}[/\\].*\.(png|jpg)' },
    @{ k = "PSD_링크에셋"; re = '(?i)Links|링크드|linked\s*files' },
    @{ k = "폰트_아이콘셋"; re = '(?i)[/\\]font|/icons?[/\\]|파비콘|favicon' },
    @{ k = "게임엔진"; re = '(?i)unity|unreal|blender' },
    @{ k = "클라우드동기화충돌"; re = '(?i)conflict|충돌본|\.sync' }
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
          # duplicate among survivors
          $nameKey = $fileName.ToLowerInvariant()
          if ($seenKeepNames.Contains($nameKey)) {
            $ex = "중복파일명"
          } else {
            [void]$seenKeepNames.Add($nameKey)
          }
        }

        if ($null -ne $ex) {
          Inc-Bucket $exclude $ex $len
          Note-JunkHints $file "exclude"
        } else {
          $cat = Get-KeepCategory $file
          Inc-Bucket $keep $cat $len
          $byDrive[$driveLetter].kept++
          $byDrive[$driveLetter].keptBytes += $len

          # year
          $yearHit = "other"
          if ($file -match '(?<!\d)(20[12][0-9])(?!\d)') { $yearHit = $Matches[1] }
          if (-not $keepByYear.ContainsKey($yearHit)) { $keepByYear[$yearHit] = [int64]0 }
          $keepByYear[$yearHit]++

          # size buckets for kept (>=100KB already)
          if ($len -lt 1MB) { $keepSize["100KB~1MB"]++ }
          elseif ($len -lt 5MB) { $keepSize["1MB~5MB"]++ }
          else { $keepSize["5MB+"]++ }

          if ($cat -eq "미분류") {
            $parent = [System.IO.Path]::GetDirectoryName($file)
            if (-not $unclassifiedParents.ContainsKey($parent)) {
              $unclassifiedParents[$parent] = [int64]0
            }
            $unclassifiedParents[$parent]++
          }

          Note-JunkHints $file "keep"
        }

        if (($totalSeen % $ProgressEvery) -eq 0) {
          $keptSoFar = [int64]0
          foreach ($k in $keepKeys) { $keptSoFar += $keep[$k].count }
          Write-Host ("  ... {0:N0} images | kept {1:N0} | {2:N1}s" -f $totalSeen, $keptSoFar, $sw.Elapsed.TotalSeconds)
        }
      }
    } catch { }
  }
}

$sw.Stop()

$excludeTotal = [int64]0
$excludeBytes = [int64]0
foreach ($k in $excludeKeys) {
  $excludeTotal += $exclude[$k].count
  $excludeBytes += $exclude[$k].bytes
}
$keepTotal = [int64]0
$keepBytes = [int64]0
foreach ($k in $keepKeys) {
  $keepTotal += $keep[$k].count
  $keepBytes += $keep[$k].bytes
}
$unclassifiedPct = if ($keepTotal -gt 0) {
  [math]::Round(100.0 * $keep["미분류"].count / $keepTotal, 1)
} else { 0 }

# Top 20 unclassified parents
$topUnc = $unclassifiedParents.GetEnumerator() |
  Sort-Object { $_.Value } -Descending |
  Select-Object -First 20

# Suggest new exclude patterns: junk hints with high counts + scan top unc folder names
$suggestions = New-Object System.Collections.Generic.List[string]
foreach ($kv in ($folderNameHits.GetEnumerator() | Sort-Object { $_.Value } -Descending)) {
  if ($kv.Value -ge 500) {
    $suggestions.Add(("`{0}` — 약 {1:N0}장 경로에서 감지 (추가 제외 후보)" -f $kv.Key, $kv.Value))
  }
}
# From unclassified folder path keywords
$uncKeywordHits = @{}
$uncKw = @(
  @{ k = "Document문서폴더"; re = '(?i)Document|문서|기획서' },
  @{ k = "R&D_IP"; re = '(?i)R&D|IP개발|연구' },
  @{ k = "Partners외주루트"; re = '(?i)^P:\\' },
  @{ k = "Apollog아카이브"; re = '(?i)99\s*Apollog' },
  @{ k = "사업개발루트"; re = '(?i)01\s*사업개발' },
  @{ k = "숫자만시퀀스폴더"; re = '(?i)\\[0-9]{3,}\\[^\\]+\.(png|jpg)' },
  @{ k = "output_export"; re = '(?i)[/\\]output[/\\]|[/\\]export[/\\]|내보내기' },
  @{ k = "캐시_프록시잔여"; re = '(?i)cache|프록시|proxy|preview' }
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
    $suggestions.Add(("미분류 안 `{0}` — {1:N0}장 (규칙 추가 검토)" -f $kv.Key, $kv.Value))
  }
}

# Build markdown
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
L ("| **합계** | **{0:N0}** | **{1}** |" -f $totalSeen, (Fmt-Bytes ($byDrive["T"].bytes + $byDrive["P"].bytes)))
L ""
L "## 2. 제외 유형별 (우선순위 순 · 첫 매칭)"
L ""
L "| 제외 유형 | 장수 | 용량 |"
L "|-----------|-----:|------|"
foreach ($k in $excludeKeys) {
  L ("| {0} | {1:N0} | {2} |" -f $k, $exclude[$k].count, (Fmt-Bytes $exclude[$k].bytes))
}
L ("| **제외 합계** | **{0:N0}** | **{1}** |" -f $excludeTotal, (Fmt-Bytes $excludeBytes))
L ""
L "## 3. 남는 수 (제외 후)"
L ""
L ("| 항목 | 값 |")
L ("|------|---:|")
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
foreach ($k in $keepKeys) {
  $pct = if ($keepTotal -gt 0) { [math]::Round(100.0 * $keep[$k].count / $keepTotal, 1) } else { 0 }
  L ("| {0} | {1:N0} | {2} | {3}% |" -f $k, $keep[$k].count, (Fmt-Bytes $keep[$k].bytes), $pct)
}
L ("| **합계** | **{0:N0}** | **{1}** | 100% |" -f $keepTotal, (Fmt-Bytes $keepBytes))
L ""
L "## 5. 미분류"
L ""
L ("- 미분류: **{0:N0}** / {1:N0} = **{2}%**" -f $keep["미분류"].count, $keepTotal, $unclassifiedPct)
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
# any other year keys
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
foreach ($k in @("100KB~1MB", "1MB~5MB", "5MB+")) {
  L ("| {0} | {1:N0} |" -f $k, $keepSize[$k])
}
L ""
L "## 8. 새로 찾은 제외 패턴 제안"
L ""
if ($suggestions.Count -eq 0) {
  L "- (임계치 이상 후보 없음 — 미분류 상위 폴더를 직접 확인)"
} else {
  foreach ($s in $suggestions) { L ("- {0}" -f $s) }
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
L "- 제외는 **위에서 아래 우선순위**로 첫 매칭만 카운트 (겹침 이중계산 없음)."
L "- 중복파일명: 경로·크기 제외를 통과한 뒤, **같은 파일명**이 이미 1회 남았으면 제외."
L "- 「홍보·마케팅 안 레퍼런스 영상/still」은 현장사진으로 분류."
L "- 읽기만 수행. 원본·DB 미변경."

$text = $sb.ToString()
[System.IO.File]::WriteAllText($outPath, $text, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "========== SUMMARY =========="
Write-Host ("Total: {0:N0}" -f $totalSeen)
Write-Host ("Excluded: {0:N0}" -f $excludeTotal)
Write-Host ("Kept: {0:N0}" -f $keepTotal)
Write-Host ("Unclassified: {0:N0} ({1}%)" -f $keep["미분류"].count, $unclassifiedPct)
Write-Host ("Elapsed: {0:N1}s" -f $sw.Elapsed.TotalSeconds)
Write-Host "Wrote $outPath"
Write-Host $text
