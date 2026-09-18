import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPeriod, resolvePeriod } from "@/lib/luna-admin/period";
import { kstParts } from "@/lib/luna/eval-schedule";
import type {
  PrimaryWorkChip,
  PrimaryWorkChunk,
  PrimaryWorkFileRow,
  PrimaryWorkKind,
  PrimaryWorkListPayload,
  PrimaryWorkPreviewPayload,
  PrimaryWorkSort
} from "@/lib/luna-admin/types";

export const WORK_PAGE_SIZE = 15;

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

type DirRow = {
  path: string;
  drive: string;
  type: string;
  size_bytes: number | null;
  modified_at: string | null;
};

const TEXT_COLS =
  "path, drive, ext, size_bytes, modified_at, text_length, chunk_count, status, skip_reason, error, extracted_at";

const SORT_COL: Record<PrimaryWorkSort, string> = {
  file: "path",
  path: "path",
  chunks: "chunk_count",
  chars: "text_length",
  size: "size_bytes",
  modified: "modified_at",
  indexed: "extracted_at",
  status: "status"
};

const DIR_SORT: Record<string, string> = {
  file: "path",
  path: "path",
  size: "size_bytes",
  modified: "modified_at",
  indexed: "modified_at"
};

function isWorkKind(value: string | null): value is PrimaryWorkKind {
  return (
    value === "folders" ||
    value === "files" ||
    value === "docs" ||
    value === "images" ||
    value === "unread"
  );
}

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

function isSort(value: string | null): value is PrimaryWorkSort {
  return (
    value === "file" ||
    value === "path" ||
    value === "chunks" ||
    value === "chars" ||
    value === "size" ||
    value === "modified" ||
    value === "indexed" ||
    value === "status"
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

function mapDir(row: DirRow): PrimaryWorkFileRow {
  return {
    path: row.path,
    drive: row.drive,
    file_name: fileNameOf(row.path) || row.path,
    folder: folderOf(row.drive, row.path),
    full_path: fullPathOf(row.drive, row.path),
    ext: "",
    chunk_count: null,
    text_length: null,
    status: row.type,
    tag: row.type === "folder" ? "경로" : "파일",
    tag_kind: "gray",
    action_label: "",
    size_label: formatSize(row.size_bytes),
    modified_label: formatWhen(row.modified_at),
    extracted_label: formatWhen(row.modified_at)
  };
}

export async function listPrimaryWorkFiles(
  admin: SupabaseClient,
  params: {
    kind: string | null;
    chip: string | null;
    page: string | null;
    period: string | null;
    from: string | null;
    to: string | null;
    sort: string | null;
    dir: string | null;
  }
): Promise<PrimaryWorkListPayload> {
  const t0 = Date.now();
  const kind: PrimaryWorkKind = isWorkKind(params.kind) ? params.kind : "docs";
  const chip: PrimaryWorkChip = isWorkChip(params.chip) ? params.chip : "all";
  const sort: PrimaryWorkSort = isSort(params.sort) ? params.sort : "indexed";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const period = resolvePeriod(params.period, params.from, params.to);
  const from = (page - 1) * WORK_PAGE_SIZE;
  const to = from + WORK_PAGE_SIZE - 1;
  const emptyChips = { all: 0, pdf: 0, pptx: 0, xlsx: 0, docx: 0, unread: 0 };

  if (kind === "images") {
    return {
      kind,
      chip,
      period: period.key,
      sort,
      dir,
      page,
      page_size: WORK_PAGE_SIZE,
      total: 0,
      chip_counts: emptyChips,
      rows: [],
      failed_opaque: 0,
      from_label: period.from_label,
      to_label: period.to_label,
      query_ms: Date.now() - t0
    };
  }

  if (kind === "folders" || kind === "files") {
    const col = DIR_SORT[sort] ?? "modified_at";
    let q = admin
      .from("nas_directory")
      .select("path, drive, type, size_bytes, modified_at", { count: "exact" })
      .eq("type", kind === "folders" ? "folder" : "file")
      .order(col, { ascending: dir === "asc", nullsFirst: false })
      .range(from, to);
    q = applyPeriod(q, "modified_at", period);
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      kind,
      chip,
      period: period.key,
      sort,
      dir,
      page,
      page_size: WORK_PAGE_SIZE,
      total: count ?? 0,
      chip_counts: emptyChips,
      rows: ((data ?? []) as DirRow[]).map(mapDir),
      failed_opaque: 0,
      from_label: period.from_label,
      to_label: period.to_label,
      query_ms: Date.now() - t0
    };
  }

  const col = SORT_COL[sort] ?? "extracted_at";
  let q = admin
    .from("nas_file_text")
    .select(TEXT_COLS, { count: "exact" })
    .order(col, { ascending: dir === "asc", nullsFirst: false })
    .range(from, to);
  if (kind === "unread") {
    q = q.in("status", ["empty", "failed", "skipped"]);
  } else {
    q = q.eq("status", "ok");
    if (chip !== "all" && chip !== "unread") q = q.eq("ext", chip);
  }
  q = applyPeriod(q, "extracted_at", period);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);

  let failed_opaque = 0;
  if (kind === "unread") {
    const failed = await admin
      .from("nas_file_text")
      .select("path", { count: "exact", head: true })
      .eq("status", "failed");
    failed_opaque = failed.error ? 0 : (failed.count ?? 0);
  }

  return {
    kind,
    chip,
    period: period.key,
    sort,
    dir,
    page,
    page_size: WORK_PAGE_SIZE,
    total: count ?? 0,
    chip_counts: emptyChips,
    rows: ((data ?? []) as TextRow[]).map(mapFile),
    failed_opaque,
    from_label: period.from_label,
    to_label: period.to_label,
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
