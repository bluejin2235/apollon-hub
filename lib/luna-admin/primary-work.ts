import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/luna/eval-schedule";
import type {
  PrimaryWorkChip,
  PrimaryWorkChunk,
  PrimaryWorkFileRow,
  PrimaryWorkListPayload,
  PrimaryWorkPreviewPayload
} from "@/lib/luna-admin/types";

export const WORK_PAGE_SIZE = 50;

const CHIP_EXTS: Record<Exclude<PrimaryWorkChip, "all" | "unread">, string> = {
  pdf: "pdf",
  pptx: "pptx",
  xlsx: "xlsx",
  docx: "docx"
};

type TextRow = {
  path: string;
  drive: string;
  ext: string;
  size_bytes: number | null;
  modified_at: string | null;
  text_length: number | null;
  chunk_count: number | null;
  status: string;
  skip_reason: string | null;
  error: string | null;
  extracted_at: string | null;
};

const TEXT_COLS =
  "path, drive, ext, size_bytes, modified_at, text_length, chunk_count, status, skip_reason, error, extracted_at";

function isWorkChip(value: string | null): value is PrimaryWorkChip {
  return (
    value === "all" ||
    value === "pdf" ||
    value === "pptx" ||
    value === "xlsx" ||
    value === "docx" ||
    value === "unread"
  );
}

function fileNameOf(path: string): string {
  const norm = path.replace(/\//g, "\\");
  const i = norm.lastIndexOf("\\");
  return i >= 0 ? norm.slice(i + 1) : path;
}

function folderOf(drive: string, path: string): string {
  const norm = path.replace(/\//g, "\\");
  const i = norm.lastIndexOf("\\");
  const dir = i >= 0 ? norm.slice(0, i) : "";
  return dir ? `${drive}:\\${dir}` : `${drive}:\\`;
}

function fullPathOf(drive: string, path: string): string {
  return `${drive}:\\${path.replace(/\//g, "\\")}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  return `${p.year}.${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")}`;
}

function formatWhenHm(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  return `${p.year}.${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function formatSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function tagFor(row: TextRow): { tag: string; tag_kind: PrimaryWorkFileRow["tag_kind"]; action_label: string } {
  if (row.status === "ok") return { tag: "ok", tag_kind: "g", action_label: "보기 →" };
  if (row.status === "empty") return { tag: "빈손", tag_kind: "gray", action_label: "제외" };
  if (row.status === "failed") return { tag: "실패", tag_kind: "r", action_label: "확인 →" };
  const reason = (row.skip_reason ?? "").toLowerCase();
  if (reason === "hwp") return { tag: "hwp", tag_kind: "gray", action_label: "제외" };
  if (reason === "drawing_pdf") return { tag: "도면", tag_kind: "gray", action_label: "제외" };
  if (reason === "corrupt") return { tag: "손상", tag_kind: "r", action_label: "확인 →" };
  if (reason === "encrypted") return { tag: "암호", tag_kind: "gray", action_label: "제외" };
  if (reason === "legacy_unsupported") return { tag: "legacy", tag_kind: "gray", action_label: "제외" };
  if (reason === "too_large") return { tag: "큼", tag_kind: "gray", action_label: "제외" };
  return { tag: reason || "skip", tag_kind: "gray", action_label: "제외" };
}

function mapFile(row: TextRow): PrimaryWorkFileRow {
  const tags = tagFor(row);
  const unread = row.status !== "ok";
  return {
    path: row.path,
    drive: row.drive,
    file_name: fileNameOf(row.path),
    folder: folderOf(row.drive, row.path),
    full_path: fullPathOf(row.drive, row.path),
    ext: row.ext,
    chunk_count: unread ? null : row.chunk_count,
    text_length: unread ? null : row.text_length,
    status: row.status,
    tag: tags.tag,
    tag_kind: tags.tag_kind,
    action_label: tags.action_label,
    size_label: formatSize(row.size_bytes),
    modified_label: formatWhen(row.modified_at),
    extracted_label: formatWhenHm(row.extracted_at)
  };
}

function applyStatus<T>(
  q: T,
  chip: PrimaryWorkChip
): T {
  const query = q as {
    eq: (c: string, v: string) => T;
    in: (c: string, v: string[]) => T;
  };
  if (chip === "unread") return query.in("status", ["empty", "failed", "skipped"]);
  if (chip === "all") return query.eq("status", "ok");
  return (query.eq("status", "ok") as typeof query).eq("ext", CHIP_EXTS[chip]);
}

async function countChip(
  admin: SupabaseClient,
  chip: PrimaryWorkChip
): Promise<number> {
  let q = admin.from("nas_file_text").select("path", { count: "exact", head: true });
  q = applyStatus(q, chip);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

const CHIP_CACHE_MS = 5 * 60 * 1000;
let chipCache: { at: number; counts: Record<PrimaryWorkChip, number>; failed_opaque: number } | null =
  null;

async function chipCounts(admin: SupabaseClient): Promise<{
  counts: Record<PrimaryWorkChip, number>;
  failed_opaque: number;
}> {
  if (chipCache && Date.now() - chipCache.at < CHIP_CACHE_MS) {
    return { counts: chipCache.counts, failed_opaque: chipCache.failed_opaque };
  }
  const [all, pdf, pptx, xlsx, docx, unread, failedRes] = await Promise.all([
    countChip(admin, "all"),
    countChip(admin, "pdf"),
    countChip(admin, "pptx"),
    countChip(admin, "xlsx"),
    countChip(admin, "docx"),
    countChip(admin, "unread"),
    admin
      .from("nas_file_text")
      .select("path", { count: "exact", head: true })
      .eq("status", "failed")
  ]);
  const counts = { all, pdf, pptx, xlsx, docx, unread };
  const failed_opaque = failedRes.error ? 0 : (failedRes.count ?? 0);
  chipCache = { at: Date.now(), counts, failed_opaque };
  return { counts, failed_opaque };
}

export async function listPrimaryWorkFiles(
  admin: SupabaseClient,
  rawChip: string | null,
  rawPage: string | null
): Promise<PrimaryWorkListPayload> {
  const t0 = Date.now();
  const chip: PrimaryWorkChip = isWorkChip(rawChip) ? rawChip : "all";
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const from = (page - 1) * WORK_PAGE_SIZE;
  const to = from + WORK_PAGE_SIZE - 1;

  let q = admin
    .from("nas_file_text")
    .select(TEXT_COLS, { count: "exact" })
    .order("extracted_at", { ascending: false })
    .range(from, to);
  q = applyStatus(q, chip);

  const [listRes, chips] = await Promise.all([q, chipCounts(admin)]);
  if (listRes.error) {
    throw new Error(listRes.error.message);
  }
  const rows = ((listRes.data ?? []) as TextRow[]).map(mapFile);
  return {
    chip,
    page,
    page_size: WORK_PAGE_SIZE,
    total: listRes.count ?? 0,
    chip_counts: chips.counts,
    rows,
    failed_opaque: chips.failed_opaque,
    query_ms: Date.now() - t0
  };
}

function sampleSeqs(total: number): number[] {
  if (total <= 3) return Array.from({ length: total }, (_, i) => i + 1);
  const mid = Math.max(2, Math.round(total / 4));
  const later = Math.max(mid + 1, Math.round(total / 2));
  return [...new Set([1, mid, later])].sort((a, b) => a - b);
}

function rangeLabel(seq: number): string {
  const start = (seq - 1) * 1000;
  const end = seq * 1000;
  return `${start.toLocaleString("ko-KR")}~${end.toLocaleString("ko-KR")}자`;
}

export async function previewPrimaryWorkFile(
  admin: SupabaseClient,
  path: string,
  all: boolean
): Promise<PrimaryWorkPreviewPayload | null> {
  const t0 = Date.now();
  const { data: fileRow, error: fileErr } = await admin
    .from("nas_file_text")
    .select(TEXT_COLS)
    .eq("path", path)
    .maybeSingle();
  if (fileErr) throw new Error(fileErr.message);
  if (!fileRow) return null;
  const file = mapFile(fileRow as TextRow);
  const total = file.chunk_count ?? 0;
  if (total <= 0 || file.status !== "ok") {
    return {
      file,
      chunks: [],
      shown: 0,
      total_chunks: total,
      all: false,
      query_ms: Date.now() - t0
    };
  }

  const seqs = all ? undefined : sampleSeqs(total);
  let chunkQ = admin
    .from("nas_file_chunks")
    .select("seq, content")
    .eq("path", path)
    .order("seq", { ascending: true });
  if (seqs) chunkQ = chunkQ.in("seq", seqs);
  const { data: chunkRows, error: chunkErr } = await chunkQ;
  if (chunkErr) throw new Error(chunkErr.message);

  const chunks: PrimaryWorkChunk[] = ((chunkRows ?? []) as Array<{ seq: number; content: string }>).map(
    (c) => ({
      seq: c.seq,
      range_label: rangeLabel(c.seq),
      content: c.content
    })
  );

  return {
    file,
    chunks,
    shown: chunks.length,
    total_chunks: total,
    all,
    query_ms: Date.now() - t0
  };
}
