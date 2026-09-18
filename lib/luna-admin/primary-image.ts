import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/luna/eval-schedule";
import { countGlossaryTermsInText } from "@/lib/luna/media-model-compare";
import type { MediaGlossaryTerm } from "@/lib/luna/media-vision-prompt";
import type {
  PrimaryImageChip,
  PrimaryImageListPayload,
  PrimaryImageRow
} from "@/lib/luna-admin/types";

export const IMAGE_PAGE_SIZE = 50;
const COLS =
  "path, drive, file_name, project, folder_category, description, thumbnail_url, file_size, width, height, indexed_at, description_model";

type ImageRow = {
  path: string;
  drive: string;
  file_name: string;
  project: string | null;
  folder_category: string | null;
  description: string | null;
  thumbnail_url: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  indexed_at: string | null;
  description_model: string | null;
};

function isChip(v: string | null): v is PrimaryImageChip {
  return v === "all" || v === "reference" || v === "ideation" || v === "kv" || v === "source";
}

function folderOf(path: string): string {
  const segs = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  return segs.slice(-3, -1).join("\\");
}

function parentFolder(path: string): string {
  const segs = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  return segs.length >= 2 ? segs[segs.length - 2]! : "";
}

function hangulWords(s: string): string[] {
  return s.match(/[가-힣]{2,}/g) ?? [];
}

function isMismatch(path: string, description: string | null): boolean {
  const folder = parentFolder(path);
  const words = hangulWords(folder).filter((w) => w.length >= 2);
  if (words.length === 0) return false;
  const desc = (description ?? "").toLowerCase();
  if (!desc.trim()) return false;
  return words.every((w) => !desc.includes(w.toLowerCase()));
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  return `${p.year}.${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function applyChip<T>(q: T, chip: PrimaryImageChip): T {
  const query = q as {
    eq: (c: string, v: string) => T;
    or: (f: string) => T;
  };
  if (chip === "reference") return query.eq("folder_category", "reference");
  if (chip === "ideation") return query.or("path.ilike.%아이데이션%,path.ilike.%ideation%");
  if (chip === "kv") return query.or("path.ilike.%KV%,path.ilike.%키비주얼%");
  if (chip === "source") return query.eq("folder_category", "kv_source");
  return q;
}

async function countChip(admin: SupabaseClient, chip: PrimaryImageChip): Promise<number> {
  let q = admin.from("luna_media_index").select("path", { count: "exact", head: true });
  q = applyChip(q, chip);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

let glossaryCache: { at: number; terms: MediaGlossaryTerm[] } | null = null;
let chipCache: { at: number; counts: Record<PrimaryImageChip, number> } | null = null;

async function glossary(admin: SupabaseClient): Promise<MediaGlossaryTerm[]> {
  if (glossaryCache && Date.now() - glossaryCache.at < 5 * 60 * 1000) return glossaryCache.terms;
  const { data } = await admin.from("glossary_terms").select("term_ko, term_en, synonyms");
  const terms = (data ?? []) as Array<{
    term_ko: string;
    term_en: string | null;
    synonyms: string[] | null;
  }>;
  const mapped: MediaGlossaryTerm[] = terms.map((t) => ({
    term_ko: t.term_ko,
    term_en: t.term_en,
    definition: "",
    synonyms: t.synonyms ?? []
  }));
  glossaryCache = { at: Date.now(), terms: mapped };
  return mapped;
}

async function chipCounts(admin: SupabaseClient): Promise<Record<PrimaryImageChip, number>> {
  if (chipCache && Date.now() - chipCache.at < 5 * 60 * 1000) return chipCache.counts;
  const [all, reference, ideation, kv, source] = await Promise.all([
    countChip(admin, "all"),
    countChip(admin, "reference"),
    countChip(admin, "ideation"),
    countChip(admin, "kv"),
    countChip(admin, "source")
  ]);
  chipCache = { at: Date.now(), counts: { all, reference, ideation, kv, source } };
  return chipCache.counts;
}

let mismatchCache: { at: number; count: number; sample: string; paths: string[] } | null = null;

async function mismatchSummary(admin: SupabaseClient): Promise<{ count: number; sample: string; paths: string[] }> {
  if (mismatchCache && Date.now() - mismatchCache.at < 5 * 60 * 1000) return mismatchCache;
  let sample = "";
  const paths: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_media_index")
      .select("path, description")
      .range(from, from + 999);
    if (error) break;
    const rows = (data ?? []) as Array<{ path: string; description: string | null }>;
    for (const row of rows) {
      if (!isMismatch(row.path, row.description)) continue;
      paths.push(row.path);
      if (!sample) {
        sample = `설명에 「${hangulWords(row.description ?? "").slice(0, 2).join("·") || "…"}」만 있고 폴더는 「${parentFolder(row.path)}」입니다`;
      }
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  mismatchCache = { at: Date.now(), count: paths.length, sample, paths };
  return mismatchCache;
}

function mapRow(
  row: ImageRow,
  terms: string[],
  mismatch: boolean
): PrimaryImageRow {
  return {
    path: row.path,
    drive: row.drive,
    file_name: row.file_name,
    full_path: `${row.drive}:\\${row.path.replace(/\//g, "\\")}`,
    project: row.project,
    folder: folderOf(row.path),
    folder_category: row.folder_category,
    size_label: formatSize(row.file_size),
    resolution: row.width && row.height ? `${row.width}×${row.height}` : "—",
    indexed_label: formatWhen(row.indexed_at),
    model: row.description_model,
    description: row.description ?? "",
    thumbnail_url: row.thumbnail_url,
    terms,
    mismatch
  };
}

const listCache = new Map<string, { at: number; payload: PrimaryImageListPayload }>();

export async function listPrimaryImages(
  admin: SupabaseClient,
  rawChip: string | null,
  rawPage: string | null,
  mismatchOnly: boolean
): Promise<PrimaryImageListPayload> {
  const t0 = Date.now();
  const chip: PrimaryImageChip = isChip(rawChip) ? rawChip : "all";
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const cacheKey = `${chip}:${page}:${mismatchOnly ? 1 : 0}`;
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) {
    return { ...hit.payload, query_ms: Date.now() - t0 };
  }
  const from = (page - 1) * IMAGE_PAGE_SIZE;
  const to = from + IMAGE_PAGE_SIZE - 1;
  const termsDict = await glossary(admin);
  const mismatch = await mismatchSummary(admin);

  let listRes: { data: ImageRow[] | null; error: { message: string } | null; count: number | null };
  if (mismatchOnly) {
    const slice = mismatch.paths.slice(from, to + 1);
    const res = await admin
      .from("luna_media_index")
      .select(COLS)
      .in("path", slice.length > 0 ? slice : ["__none__"]);
    listRes = { data: (res.data ?? []) as ImageRow[], error: res.error, count: mismatch.paths.length };
  } else {
    let q = admin
      .from("luna_media_index")
      .select(COLS, { count: "exact" })
      .order("indexed_at", { ascending: false })
      .range(from, to);
    q = applyChip(q, chip);
    const res = await q;
    listRes = { data: (res.data ?? []) as ImageRow[], error: res.error, count: res.count };
  }

  const counts = await chipCounts(admin);
  if (listRes.error) throw new Error(listRes.error.message);

  const rows = ((listRes.data ?? []) as ImageRow[]).map((row) => {
    const mismatchRow = isMismatch(row.path, row.description);
    const terms = countGlossaryTermsInText(row.description ?? "", termsDict).slice(0, 8);
    return mapRow(row, terms, mismatchRow);
  });

  const payload: PrimaryImageListPayload = {
    chip,
    page,
    page_size: IMAGE_PAGE_SIZE,
    total: listRes.count ?? 0,
    chip_counts: counts,
    rows,
    mismatch_count: mismatch.count,
    mismatch_sample: mismatch.sample,
    query_ms: Date.now() - t0
  };
  listCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}
