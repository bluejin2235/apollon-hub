/**
 * Work 문서 본문 추출 · 청킹 · 도면 PDF 판별.
 * 파일 읽기만. 경로 수정·이동 없음.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import yauzl from "yauzl";
import { describeNasError, NasExtractionLimitError } from "@/lib/luna/nas-error";
import { contentHash } from "@/lib/luna/embedding";

export const NAS_TEXT_CHUNK_CHARS = 1000;
export const NAS_TEXT_CHUNK_OVERLAP = 200;
export const NAS_TEXT_MAX_CHUNKS = 200;
export const NAS_BUFFER_MAX_BYTES = 64 * 1024 * 1024;
export const NAS_PPTX_MAX_FILE_BYTES = 1024 * 1024 * 1024;
export const NAS_PPTX_MAX_XML_BYTES = 8 * 1024 * 1024;
export const NAS_PPTX_MAX_TOTAL_XML_BYTES = 32 * 1024 * 1024;

export const NAS_TEXT_EXTS = [
  "pdf",
  "pptx",
  "ppt",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "txt",
  "md",
  "hwp"
] as const;

export type NasTextExt = (typeof NAS_TEXT_EXTS)[number];

export type NasTextExtractResult = {
  status: "ok" | "empty" | "failed" | "skipped";
  text: string;
  skipReason?: string;
  error?: string;
  truncated?: boolean;
};

const BACKUP_RE = /(old|backup|백업|보관|archive|이전)/i;

const UNIT_RE =
  /(?:mm|cm|km|㎡|m²|m2|kg|g\b|ea|EA|Ø|ø|dia|DIA|φ|Φ)/gi;

/** 비공백 문자의 70%+ 가 숫자·좌표 문장부호·단위면 도면으로 본다. */
export function isDrawingPdfText(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 80) return false;

  const hangul = (compact.match(/[\uAC00-\uD7A3]/g) ?? []).length;
  if (hangul / compact.length >= 0.12) return false;

  const letters = (compact.match(/[A-Za-z\uAC00-\uD7A3]/g) ?? []).length;
  const unitHits = compact.match(UNIT_RE) ?? [];
  let unitChars = 0;
  for (const u of unitHits) unitChars += u.length;

  const withoutUnits = compact.replace(UNIT_RE, "");
  const drawingish =
    (withoutUnits.match(/[0-9.,+\-–—*/×xX°′″'%:=()[\]{}<>\\|_]/g) ?? [])
      .length + unitChars;

  const ratio = drawingish / compact.length;
  if (ratio < 0.7) return false;

  // 애매: 알파벳·한글이 꽤 있으면 제안서·스펙일 수 있음 → 유지
  if (letters / compact.length >= 0.25 && ratio < 0.85) return false;

  return true;
}

export function sanitizeNasText(text: string): string {
  // Postgres text 는 \u0000 불가
  return text.replace(/\u0000/g, "");
}

export function chunkNasText(
  text: string,
  opts?: { size?: number; overlap?: number; maxChunks?: number }
): { chunks: string[]; truncated: boolean } {
  const size = opts?.size ?? NAS_TEXT_CHUNK_CHARS;
  const overlap = opts?.overlap ?? NAS_TEXT_CHUNK_OVERLAP;
  const maxChunks = opts?.maxChunks ?? NAS_TEXT_MAX_CHUNKS;
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return { chunks: [], truncated: false };

  const chunks: string[] = [];
  let i = 0;
  const step = Math.max(1, size - overlap);
  while (i < cleaned.length && chunks.length < maxChunks) {
    chunks.push(cleaned.slice(i, i + size));
    if (i + size >= cleaned.length) break;
    i += step;
  }
  const maxCovered =
    maxChunks <= 1 ? size : size + (maxChunks - 1) * step;
  return {
    chunks,
    truncated: cleaned.length > maxCovered
  };
}

export function hashNasText(text: string): string {
  return contentHash(text);
}

export function isBackupPath(path: string): boolean {
  return BACKUP_RE.test(path);
}

export function extOfNasPath(path: string): NasTextExt | null {
  const e = extname(path).slice(1).toLowerCase();
  if ((NAS_TEXT_EXTS as readonly string[]).includes(e)) {
    return e as NasTextExt;
  }
  return null;
}

export function resolveNasFullPath(
  drive: string,
  relativePath: string
): string | null {
  const rel = relativePath.replace(/\//g, "\\");
  const letter = `${drive}:\\${rel}`;
  const uncRoots: Record<string, string> = {
    T: "\\\\aiw\\work",
    P: "\\\\aiw\\partners"
  };
  const unc = uncRoots[drive.toUpperCase()];
  const candidates = [letter];
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
  return /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name);
}

/** PPTX — yauzl 로 slides/notes XML 만. media 미접근. */
export function extractPptxYauzl(fullPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (statSync(fullPath).size > NAS_PPTX_MAX_FILE_BYTES) {
      reject(new NasExtractionLimitError("pptx_file_exceeds_1GiB"));
      return;
    }
    yauzl.open(
      fullPath,
      { lazyEntries: true, autoClose: true },
      (err, zipfile) => {
        if (err || !zipfile) {
          reject(err ?? new Error("yauzl_open_fail"));
          return;
        }
        const slideTexts: string[] = [];
        const noteTexts: string[] = [];
        let settled = false;
        let totalXmlBytes = 0;
        let entryCount = 0;
        let activeStream: import("node:stream").Readable | null = null;

        // A missing slide is an incomplete source, never a successful partial extraction.
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          activeStream?.destroy();
          zipfile.close?.();
          reject(error);
        };

        zipfile.on("entry", (entry) => {
          if (settled) return;
          entryCount += 1;
          if (entryCount > 50000) { fail(new NasExtractionLimitError("pptx_entry_count_exceeds_50000")); return; }
          const name = entry.fileName.replace(/\\/g, "/");
          if (isSlideXml(name) || isNotesXml(name)) {
            // Entry metadata is advisory; streamed bytes below enforce the same cap.
            const declaredBytes = (entry as { uncompressedSize?: number }).uncompressedSize;
            if (declaredBytes != null && (declaredBytes > NAS_PPTX_MAX_XML_BYTES ||
                totalXmlBytes + declaredBytes > NAS_PPTX_MAX_TOTAL_XML_BYTES)) {
              fail(new NasExtractionLimitError("pptx_xml_declared_size_exceeds_limit")); return;
            }
            zipfile.openReadStream(entry, (e2, stream) => {
              if (settled) {
                stream?.destroy();
                return;
              }
              if (e2 || !stream) {
                fail(e2 ?? new Error("pptx_xml_stream_unavailable"));
                return;
              }
              activeStream = stream;
              const chunks: Buffer[] = [];
              let entryBytes = 0;
              stream.on("data", (c) => {
                if (settled) return;
                const bytes = Buffer.isBuffer(c) ? c : Buffer.from(c);
                entryBytes += bytes.length;
                totalXmlBytes += bytes.length;
                if (entryBytes > NAS_PPTX_MAX_XML_BYTES || totalXmlBytes > NAS_PPTX_MAX_TOTAL_XML_BYTES) {
                  fail(new NasExtractionLimitError("pptx_xml_stream_exceeds_limit")); return;
                }
                chunks.push(bytes);
              });
              stream.on("end", () => {
                if (settled) return;
                activeStream = null;
                const xml = Buffer.concat(chunks).toString("utf8");
                const t = extractTextFromXml(xml);
                if (isSlideXml(name)) slideTexts.push(t);
                else noteTexts.push(t);
                zipfile.readEntry();
              });
              stream.on("error", fail);
            });
          } else {
            zipfile.readEntry();
          }
        });
        zipfile.on("end", () => {
          if (settled) return;
          settled = true;
          resolve([...slideTexts, ...noteTexts].join("\n").trim());
        });
        zipfile.on("error", fail);
        zipfile.readEntry();
      }
    );
  });
}

async function extractPdf(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractXlsx(buf: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      parts.push(`# ${name}`);
      parts.push(csv);
    }
  }
  return parts.join("\n").trim();
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer: buf });
  return (res.value ?? "").trim();
}

function readFileStreamToBuffer(fullPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const rs = createReadStream(fullPath);
    rs.on("data", (c) => {
      if (settled) return;
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += b.length;
      if (total > NAS_BUFFER_MAX_BYTES) {
        settled = true;
        rs.destroy();
        reject(new NasExtractionLimitError("buffer_stream_exceeds_64MiB"));
        return;
      }
      chunks.push(b);
    });
    rs.on("error", error => { if (!settled) { settled = true; reject(error); } });
    rs.on("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks, total)); } });
  });
}

export async function extractNasFileText(
  fullPath: string,
  ext: NasTextExt
): Promise<NasTextExtractResult> {
  try {
    if (ext === "hwp") {
      return {
        status: "skipped",
        text: "",
        skipReason: "hwp"
      };
    }

    if (ext === "pptx") {
      const text = await extractPptxYauzl(fullPath);
      if (!text) {
        return { status: "empty", text: "" };
      }
      return { status: "ok", text };
    }

    if (ext === "ppt") {
      return {
        status: "skipped",
        text: "",
        skipReason: "legacy_unsupported"
      };
    }

    if (ext === "doc") {
      return {
        status: "skipped",
        text: "",
        skipReason: "legacy_unsupported"
      };
    }

    const st = statSync(fullPath);
    if (st.size > NAS_BUFFER_MAX_BYTES) throw new NasExtractionLimitError("buffer_file_exceeds_64MiB");
    // Streaming to a final Buffer is NOT streaming parsing. Bound both stat and read.
    const buf = await readFileStreamToBuffer(fullPath);

    let text = "";
    if (ext === "pdf") {
      text = await extractPdf(buf);
      if (!text) return { status: "empty", text: "" };
      if (isDrawingPdfText(text)) {
        return {
          status: "skipped",
          text: "",
          skipReason: "drawing_pdf"
        };
      }
      return { status: "ok", text };
    }
    if (ext === "xlsx" || ext === "xls") {
      try {
        text = await extractXlsx(buf);
      } catch (e) {
        if (ext === "xls") {
          return {
            status: "skipped",
            text: "",
            skipReason: "legacy_unsupported",
            error: describeNasError(e, 200)
          };
        }
        throw e;
      }
    } else if (ext === "docx") {
      text = await extractDocx(buf);
    } else if (ext === "txt" || ext === "md") {
      text = buf.toString("utf8").trim();
    } else {
      return {
        status: "skipped",
        text: "",
        skipReason: "legacy_unsupported"
      };
    }

    if (!text) return { status: "empty", text: "" };
    return { status: "ok", text };
  } catch (e) {
    const msg = describeNasError(e);
    if (e instanceof NasExtractionLimitError) {
      return { status: "skipped", text: "", skipReason: "too_large", error: msg };
    }
    const lower = msg.toLowerCase();
    if (/password|encrypt|encrypted/i.test(lower)) {
      return {
        status: "skipped",
        text: "",
        skipReason: "encrypted",
        error: msg.slice(0, 300)
      };
    }
    if ((ext === "docx" && /could not find main document part/i.test(lower)) ||
        /corrupt|invalid|end of central|bad zip|not a zip/i.test(lower)) {
      return {
        status: "skipped",
        text: "",
        skipReason: "corrupt",
        error: msg.slice(0, 300)
      };
    }
    return {
      status: "failed",
      text: "",
      error: msg.slice(0, 500)
    };
  }
}
