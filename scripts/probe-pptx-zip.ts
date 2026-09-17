/**
 * 대용량 PPTX — 전체 로드(A) vs ZIP 랜덤 액세스(B) 속도 실측.
 * DB 저장 없음. 15건만.
 *
 *   npx tsx scripts/probe-pptx-zip.ts
 */
import { config } from "dotenv";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { open as fsOpen } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import JSZip from "jszip";
import yauzl from "yauzl";

type Sample = {
  bucket: string;
  drive: string;
  path: string;
  sizeBytes: number;
};

/** nas_directory 에서 구간별 상위 3건 (백업 제외) */
const SAMPLES: Sample[] = [
  {
    bucket: "gt_1gb",
    drive: "T",
    path: "02 Project\\2023\\230410 인스파이어 디지털스트리트 콘텐츠제작\\99 최종산출물\\보고문서\\2. 프로덕션\\06 현장보고 (On-site 현장 보고)\\[Apollon] 인스파이어 미디어 콘텐츠_고객사 시연_전체 취합본.pptx",
    sizeBytes: 12623626844
  },
  {
    bucket: "gt_1gb",
    drive: "T",
    path: "02 Project\\2024\\240328 인스파이어 시즌2 콘텐츠제작\\06 Test\\00 On-Site Test\\240524 현장테스트 (레논,VA,위글앤트)\\00 현장 리포트\\240524_인스파이어 시즌2_On-Site Test_2차 리포트.pptx",
    sizeBytes: 6475374562
  },
  {
    bucket: "gt_1gb",
    drive: "T",
    path: "99 Apollog\\99 개인폴더\\박예림\\02 Project\\2024\\240328 인스파이어 시즌2 콘텐츠제작\\01 Planning\\01 Document\\03 PD 현장보고\\2차 현장보고\\[Apollon] 인스파이어 시즌2_Production Report_2nd 240524.pptx",
    sizeBytes: 6466929634
  },
  {
    bucket: "500mb_1gb",
    drive: "T",
    path: "00_회사기본자료\\77 Workprocess\\참고자료\\170905 표준워크프로세스 원고\\T\\d'strict\\03. Project\\Wrap-up\\참고자료\\FlyingTheater_Closing Wrap-up_170306.pptx",
    sizeBytes: 1071559832
  },
  {
    bucket: "500mb_1gb",
    drive: "P",
    path: "06 롯데 면세점 스타에비뉴 리뉴얼\\02 Planning\\02 Ideation\\250815_팔로미노_시그니처콘텐츠\\(25-08-15) Lotte Duty Free_Story Flow board_v2_PLMN.pptx",
    sizeBytes: 1071492383
  },
  {
    bucket: "500mb_1gb",
    drive: "T",
    path: "01 사업개발\\2026\\260629 국내 프레스티지 뷰티 브랜드 글로벌 이벤트\\01 Planning\\01 Ideation\\260701 [Apollon] THE WHOO_Bichup NAD Ampoule Global Launch_Heritage_1.pptx",
    sizeBytes: 1069495966
  },
  {
    bucket: "200_500mb",
    drive: "T",
    path: "02 Project\\2022\\03 트유 마스터플랜\\01 Planning\\88 소개자료\\221214 아만제공버젼\\트유_New Media Space Design_aman_ko_221212.pptx",
    sizeBytes: 524001770
  },
  {
    bucket: "200_500mb",
    drive: "T",
    path: "02 Project\\2022\\01 신세계 명동본점 옥외 LED 브랜드 콘텐츠\\03 Reference\\01. 참고문서\\RENHE\\03. 180622 RENHE PLAZA Kick off_final (이동훈 대표님 보고용)\\0622_RENHE PLAZA Kick off_final.pptx",
    sizeBytes: 523991640
  },
  {
    bucket: "200_500mb",
    drive: "T",
    path: "02 Project\\2022\\03 트유 마스터플랜\\01 Planning\\88 소개자료\\221214 아만제공버젼\\Trendy&Youthtown _New Media Space Design Overview_aman_en_221213.pptx",
    sizeBytes: 523846412
  },
  {
    bucket: "50_200mb",
    drive: "T",
    path: "07 마케팅 및 홍보\\88 Award\\240923 2025 iF Design Award\\01 트렌디유스타운\\02 5.07 User Experience Concepts 부문\\02 Preselection Submission\\02 추가자료\\트렌디유스타운_5.07 User Experience Concepts 부문_Preselection Submission_추가자료_241030.pptx",
    sizeBytes: 209479157
  },
  {
    bucket: "50_200mb",
    drive: "T",
    path: "01 사업개발\\2025\\250415 인스파이어 시즌4 제안\\02 Ideation\\- 위글앤트\\250523 [위글앤트] 인스파이어 오로라 3nd Ideation\\[위글앤트]일루션쇼_플로우정리_0523.pptx",
    sizeBytes: 209477898
  },
  {
    bucket: "50_200mb",
    drive: "T",
    path: "01 사업개발\\- 한화리조트x아폴론\\APOLLON Company Brief_260707.pptx",
    sizeBytes: 209467708
  },
  {
    bucket: "lt_50mb",
    drive: "T",
    path: "02 Project\\2021\\03 트유 컨설팅\\02_Document\\03 Interim Report\\01 1st 1F Big Square\\04 1차 Final\\두엠\\B안\\alt 2.pptx",
    sizeBytes: 52419546
  },
  {
    bucket: "lt_50mb",
    drive: "T",
    path: "01 사업개발\\2022\\221109 합천 영상테마파크\\03 Planning\\221128 아이데이션 미팅\\참고문서\\제주전시_191213.pptx",
    sizeBytes: 52358385
  },
  {
    bucket: "lt_50mb",
    drive: "T",
    path: "01 사업개발\\2022\\220525 그랜드하얏트JJ마호니 뉴미디어\\88 제공받은자료\\220531 평면 및 비주얼\\JJ_자료(투시도포함).pptx",
    sizeBytes: 52236290
  }
];

const UNC: Record<string, string> = {
  T: "\\\\aiw\\work",
  P: "\\\\aiw\\partners"
};

/** 방식 A 가 메모리/시간으로 무너지지 않게 — 초과 시 skip */
const METHOD_A_MAX_BYTES = 1500 * 1024 * 1024; // 1.5GB
const METHOD_A_TIMEOUT_MS = 10 * 60 * 1000;

function resolvePath(drive: string, rel: string): string | null {
  const candidates = [`${drive}:\\${rel}`];
  const unc = UNC[drive.toUpperCase()];
  if (unc) candidates.push(`${unc}\\${rel}`);
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* */
    }
  }
  return null;
}

function extractTextFromXml(xml: string): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
    const t = (m[1] ?? "").trim();
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

function isSlideXml(name: string): boolean {
  return /^ppt\/slides\/slide\d+\.xml$/i.test(name);
}

function isNotesXml(name: string): boolean {
  return (
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name) ||
    /^ppt\/slides\/notesSlides\/notesSlide\d+\.xml$/i.test(name)
  );
}

type ExtractResult = {
  ok: boolean;
  ms: number;
  bytesRead: number;
  chars: number;
  slides: number;
  notesFiles: number;
  notesChars: number;
  preview: string;
  notesPreview: string;
  error?: string;
  skipped?: boolean;
};

async function methodA_fullLoad(fullPath: string, sizeBytes: number): Promise<ExtractResult> {
  const t0 = performance.now();
  if (sizeBytes > METHOD_A_MAX_BYTES) {
    return {
      ok: false,
      ms: 0,
      bytesRead: 0,
      chars: 0,
      slides: 0,
      notesFiles: 0,
      notesChars: 0,
      preview: "",
      notesPreview: "",
      skipped: true,
      error: `skip_gt_${METHOD_A_MAX_BYTES}_bytes`
    };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const buf = await Promise.race([
      new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const rs = createReadStream(fullPath);
        rs.on("data", (c) => {
          const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
          chunks.push(b);
          total += b.length;
        });
        rs.on("error", reject);
        rs.on("end", () => resolve(Buffer.concat(chunks, total)));
      }),
      new Promise<Buffer>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout_${METHOD_A_TIMEOUT_MS}ms`)),
          METHOD_A_TIMEOUT_MS
        );
      })
    ]);
    if (timer) clearTimeout(timer);

    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    let slides = 0;
    let notesFiles = 0;
    const slideTexts: string[] = [];
    const noteTexts: string[] = [];
    for (const name of names) {
      if (isSlideXml(name)) {
        slides += 1;
        const xml = await zip.file(name)!.async("string");
        slideTexts.push(extractTextFromXml(xml));
      } else if (isNotesXml(name)) {
        notesFiles += 1;
        const xml = await zip.file(name)!.async("string");
        noteTexts.push(extractTextFromXml(xml));
      }
    }
    const text = slideTexts.join("\n").trim();
    const notes = noteTexts.join("\n").trim();
    return {
      ok: true,
      ms: performance.now() - t0,
      bytesRead: buf.length,
      chars: text.length,
      slides,
      notesFiles,
      notesChars: notes.length,
      preview: text.slice(0, 300),
      notesPreview: notes.slice(0, 300)
    };
  } catch (e) {
    if (timer) clearTimeout(timer);
    return {
      ok: false,
      ms: performance.now() - t0,
      bytesRead: 0,
      chars: 0,
      slides: 0,
      notesFiles: 0,
      notesChars: 0,
      preview: "",
      notesPreview: "",
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
    };
  }
}

function methodB_yauzl(fullPath: string): Promise<ExtractResult> {
  const t0 = performance.now();
  return new Promise((resolveResult) => {
    yauzl.open(
      fullPath,
      { lazyEntries: true, autoClose: true },
      (err, zipfile) => {
        if (err || !zipfile) {
          resolveResult({
            ok: false,
            ms: performance.now() - t0,
            bytesRead: 0,
            chars: 0,
            slides: 0,
            notesFiles: 0,
            notesChars: 0,
            preview: "",
            notesPreview: "",
            error: err?.message ?? "yauzl_open_fail"
          });
          return;
        }

        let bytesRead = 0;
        let slides = 0;
        let notesFiles = 0;
        const slideTexts: string[] = [];
        const noteTexts: string[] = [];
        let pending = 0;
        let ended = false;

        const maybeDone = () => {
          if (!ended || pending > 0) return;
          const text = slideTexts.join("\n").trim();
          const notes = noteTexts.join("\n").trim();
          resolveResult({
            ok: true,
            ms: performance.now() - t0,
            bytesRead,
            chars: text.length,
            slides,
            notesFiles,
            notesChars: notes.length,
            preview: text.slice(0, 300),
            notesPreview: notes.slice(0, 300)
          });
        };

        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          const name = entry.fileName;
          if (isSlideXml(name) || isNotesXml(name)) {
            pending += 1;
            bytesRead += entry.compressedSize + 30; // local header 대략
            zipfile.openReadStream(entry, (e2, stream) => {
              if (e2 || !stream) {
                pending -= 1;
                zipfile.readEntry();
                maybeDone();
                return;
              }
              const chunks: Buffer[] = [];
              stream.on("data", (c) => {
                const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
                chunks.push(b);
              });
              stream.on("end", () => {
                const xml = Buffer.concat(chunks).toString("utf8");
                const t = extractTextFromXml(xml);
                if (isSlideXml(name)) {
                  slides += 1;
                  slideTexts.push(t);
                } else {
                  notesFiles += 1;
                  noteTexts.push(t);
                }
                pending -= 1;
                zipfile.readEntry();
                maybeDone();
              });
              stream.on("error", () => {
                pending -= 1;
                zipfile.readEntry();
                maybeDone();
              });
            });
          } else {
            zipfile.readEntry();
          }
        });
        zipfile.on("end", () => {
          ended = true;
          // central directory 읽기량 대략 (엔트리당 ~50B + EOCD)
          bytesRead += (zipfile.entryCount ?? 0) * 50 + 22;
          maybeDone();
        });
        zipfile.on("error", (e3) => {
          resolveResult({
            ok: false,
            ms: performance.now() - t0,
            bytesRead,
            chars: 0,
            slides,
            notesFiles,
            notesChars: 0,
            preview: "",
            notesPreview: "",
            error: e3.message.slice(0, 200)
          });
        });
      }
    );
  });
}

/** EOCD 위치만 읽어 ZIP 목차 접근이 되는지 확인 (추가 지표) */
async function peekZipTail(fullPath: string, sizeBytes: number): Promise<number> {
  const t0 = performance.now();
  const fh = await fsOpen(fullPath, "r");
  try {
    const tailLen = Math.min(65536 + 22, sizeBytes);
    const buf = Buffer.alloc(tailLen);
    await fh.read(buf, 0, tailLen, sizeBytes - tailLen);
    return performance.now() - t0;
  } finally {
    await fh.close();
  }
}

async function main() {
  const mapped = ["T", "P"].filter((d) => existsSync(`${d}:\\`));
  console.log(`mapped: ${mapped.join(",") || "(none)"}`);
  if (mapped.length === 0) {
    console.error("T:/P: 필요 — 대화형 세션에서 실행");
    process.exit(1);
  }

  console.log("\n=== targets (15) ===");
  for (const s of SAMPLES) {
    console.log(
      `${s.bucket.padEnd(10)} ${(s.sizeBytes / 1024 / 1024).toFixed(1).padStart(8)} MB  ${s.drive}:\\${s.path}`
    );
  }

  const rows: Array<{
    bucket: string;
    drive: string;
    path: string;
    sizeBytes: number;
    sizeMb: number;
    fullPath: string | null;
    tailMs: number | null;
    a: ExtractResult | null;
    b: ExtractResult | null;
  }> = [];

  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i]!;
    const full = resolvePath(s.drive, s.path);
    console.log(
      `\n[${i + 1}/15] ${s.bucket} ${(s.sizeBytes / 1024 / 1024).toFixed(0)}MB …`
    );
    if (!full) {
      console.log("  MISSING");
      rows.push({
        bucket: s.bucket,
        drive: s.drive,
        path: s.path,
        sizeBytes: s.sizeBytes,
        sizeMb: s.sizeBytes / 1024 / 1024,
        fullPath: null,
        tailMs: null,
        a: null,
        b: null
      });
      continue;
    }

    let tailMs: number | null = null;
    try {
      tailMs = await peekZipTail(full, s.sizeBytes);
      console.log(`  tail-peek ${tailMs.toFixed(0)}ms`);
    } catch (e) {
      console.log(`  tail-peek fail: ${e instanceof Error ? e.message : e}`);
    }

    console.log("  method B (yauzl)…");
    const b = await methodB_yauzl(full);
    console.log(
      `  B: ${b.ok ? "ok" : "fail"} ${b.ms.toFixed(0)}ms bytes≈${b.bytesRead} chars=${b.chars} slides=${b.slides} notes=${b.notesFiles}/${b.notesChars} ${b.error ?? ""}`
    );

    console.log("  method A (full+JSZip)…");
    const a = await methodA_fullLoad(full, s.sizeBytes);
    console.log(
      `  A: ${a.skipped ? "skip" : a.ok ? "ok" : "fail"} ${a.ms.toFixed(0)}ms bytes=${a.bytesRead} chars=${a.chars} slides=${a.slides} ${a.error ?? ""}`
    );

    rows.push({
      bucket: s.bucket,
      drive: s.drive,
      path: s.path,
      sizeBytes: s.sizeBytes,
      sizeMb: s.sizeBytes / 1024 / 1024,
      fullPath: full,
      tailMs,
      a,
      b
    });
  }

  // PPTX 전체 시간 추정 — 방식 B만, 구간 평균으로 5607건 환산
  // 구간별 PPTX 건수는 대략 사용자 수치: >200MB 2008, 그 외는 나머지
  // 실측 버킷 평균 ms 사용
  const bucketAvgB: Record<string, number[]> = {};
  for (const r of rows) {
    if (!r.b?.ok) continue;
    (bucketAvgB[r.bucket] ??= []).push(r.b.ms);
  }
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0;

  // nas 구간 대략 분포 (이전 조사 맥락: 5607 total, >200MB = 2008)
  // 세분화 추정: gt_1gb≈495, 500-1gb≈(2008-495)*비율 보수적으로
  // 간단히: 실측 5구간 평균을 균등 가중하지 않고
  //   lt_50 + 50_200 ≈ 3599건 → 두 구간 평균
  //   200_500 + 500_1gb + gt_1gb ≈ 2008건 → 세 구간 평균
  const smallAvg =
    (avg(bucketAvgB.lt_50mb ?? []) + avg(bucketAvgB["50_200mb"] ?? [])) / 2;
  const largeAvg =
    (avg(bucketAvgB["200_500mb"] ?? []) +
      avg(bucketAvgB["500mb_1gb"] ?? []) +
      avg(bucketAvgB.gt_1gb ?? [])) /
    3;
  const smallN = 5607 - 2008;
  const largeN = 2008;
  const totalMs = smallN * smallAvg + largeN * largeAvg;
  const totalHours = totalMs / 1000 / 3600;

  const largest = [...rows].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];

  const report = {
    generated_at: new Date().toISOString(),
    method_a_max_bytes: METHOD_A_MAX_BYTES,
    samples: rows.map((r) => ({
      bucket: r.bucket,
      size_mb: Math.round(r.sizeMb * 10) / 10,
      path: `${r.drive}:\\${r.path}`,
      missing: !r.fullPath,
      tail_ms: r.tailMs,
      a_ms: r.a?.ms ?? null,
      a_ok: r.a?.ok ?? false,
      a_skipped: r.a?.skipped ?? false,
      a_bytes: r.a?.bytesRead ?? null,
      a_chars: r.a?.chars ?? null,
      a_error: r.a?.error ?? null,
      b_ms: r.b?.ms ?? null,
      b_ok: r.b?.ok ?? false,
      b_bytes: r.b?.bytesRead ?? null,
      b_chars: r.b?.chars ?? null,
      b_slides: r.b?.slides ?? null,
      b_notes_files: r.b?.notesFiles ?? null,
      b_notes_chars: r.b?.notesChars ?? null,
      b_error: r.b?.error ?? null,
      speedup:
        r.a?.ok && r.b?.ok && r.b.ms > 0
          ? Math.round((r.a.ms / r.b.ms) * 10) / 10
          : null
    })),
    largest_preview: largest?.b?.preview ?? null,
    largest_notes_preview: largest?.b?.notesPreview ?? null,
    largest_notes: {
      files: largest?.b?.notesFiles ?? 0,
      chars: largest?.b?.notesChars ?? 0
    },
    estimate_pptx_5607: {
      small_n: smallN,
      large_n: largeN,
      small_avg_ms: smallAvg,
      large_avg_ms: largeAvg,
      total_hours: totalHours
    }
  };

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const out = resolve(process.cwd(), "tmp", "probe-pptx-zip.json");
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nJSON: ${out}`);
  console.log("\n=== estimate PPTX 5607 (method B) ===");
  console.log(JSON.stringify(report.estimate_pptx_5607, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
